"""
Henter og parser Eiendom Norges månedsstatistikk og oppdaterer data.json.

KRITISK PRINSIPP: Mister aldri data.
- Hvis Eiendom Norge er nede: behold eksisterende data.json uendret
- Hvis Excel-parsing feilet: behold eksisterende verdier
- Hvis nye verdier finnes: flett inn i eksisterende struktur
- Hvis struktur er ufullstendig: fyll inn manglende felt fra seed
"""
from __future__ import annotations

import io
import json
import logging
import re
import sys
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from openpyxl import load_workbook

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("fetch_data")

BASE = "https://eiendomnorge.no"
INDEX_URL = f"{BASE}/boligprisstatistikk/statistikkbank/rapporter/manedsrapporter/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; boligdashboard/2.0; +https://github.com)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
}
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "docs" / "data"
DATA_FILE = DATA_DIR / "data.json"
SEED_FILE = ROOT / "scripts" / "seed_data.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)

KOMMUNER = {
    "oslo":         ["Oslo"],
    "asker":        ["Asker"],
    "barum":        ["Bærum"],
    "nordrefollo":  ["Nordre Follo"],
    "as":           ["Ås"],
    "vestby":       ["Vestby"],
    "frogn":        ["Frogn"],
    "nesodden":     ["Nesodden"],
    "lorenskog":    ["Lørenskog"],
}

BYDELER = {
    "frogner":           ["Oslo: Frogner", "Frogner"],
    "grunerlokka":       ["Oslo: Grünerløkka", "Grünerløkka"],
    "sagene":            ["Oslo: Sagene", "Sagene"],
    "sthanshaugen":      ["Oslo: St.Hanshaugen", "Oslo: St. Hanshaugen", "St.Hanshaugen"],
    "gamleoslo":         ["Oslo: Gamle Oslo", "Gamle Oslo"],
    "nordreaker":        ["Oslo: Nordre Aker", "Nordre Aker"],
    "vestreaker":        ["Oslo: Vestre Aker", "Vestre Aker"],
    "ullern":            ["Oslo: Ullern", "Ullern"],
    "bjerke":            ["Oslo: Bjerke", "Bjerke"],
    "nordstrand":        ["Oslo: Nordstrand", "Nordstrand"],
    "sondrenordstrand":  ["Oslo: Søndre Nordstrand", "Søndre Nordstrand"],
    "ostensjo":          ["Oslo: Østensjø", "Østensjø"],
    "alna":              ["Oslo: Alna", "Alna"],
    "grorud":            ["Oslo: Grorud", "Grorud"],
    "stovner":           ["Oslo: Stovner", "Stovner"],
}

ALIAS = {
    "Bærum": ["Baerum"], "Nordre Follo": ["Nordre-Follo"], "Ås": ["Aas"],
    "Lørenskog": ["Lorenskog"], "Grünerløkka": ["Grunerlokka"],
    "Søndre Nordstrand": ["Sondre Nordstrand"], "Østensjø": ["Ostensjo"],
}

RATE_DECISIONS = [
    {"date": "2024-05-03", "rate": 4.50, "type": "hold"},
    {"date": "2024-06-20", "rate": 4.50, "type": "hold"},
    {"date": "2024-08-15", "rate": 4.50, "type": "hold"},
    {"date": "2024-09-19", "rate": 4.50, "type": "hold"},
    {"date": "2024-11-07", "rate": 4.50, "type": "hold"},
    {"date": "2024-12-19", "rate": 4.50, "type": "hold"},
    {"date": "2025-01-23", "rate": 4.50, "type": "hold"},
    {"date": "2025-03-27", "rate": 4.50, "type": "hold"},
    {"date": "2025-05-08", "rate": 4.50, "type": "hold"},
    {"date": "2025-06-19", "rate": 4.25, "type": "down"},
    {"date": "2025-08-14", "rate": 4.25, "type": "hold"},
    {"date": "2025-09-18", "rate": 4.00, "type": "down"},
    {"date": "2025-11-06", "rate": 4.00, "type": "hold"},
    {"date": "2025-12-18", "rate": 4.00, "type": "hold"},
    {"date": "2026-01-22", "rate": 4.00, "type": "hold"},
    {"date": "2026-03-19", "rate": 4.00, "type": "hold"},
    {"date": "2026-05-08", "rate": 4.00, "type": "hold"},
]


@dataclass
class MonthReport:
    year: int
    month: int
    article_id: str
    url: str

    @property
    def label(self) -> str:
        return f"{self.year}-{self.month:02d}"


def discover_monthly_reports() -> list[MonthReport]:
    log.info("Henter rapportoversikt fra %s", INDEX_URL)
    r = requests.get(INDEX_URL, headers=HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    month_names = {
        "januar":1,"februar":2,"mars":3,"april":4,"mai":5,"juni":6,
        "juli":7,"august":8,"september":9,"oktober":10,"november":11,"desember":12,
    }
    reports: list[MonthReport] = []
    for a in soup.find_all("a", href=re.compile(r"article=\d+")):
        text = a.get_text(strip=True).lower()
        m = re.match(r"(\w+)\s+(\d{4})", text)
        if not m or m.group(1) not in month_names:
            continue
        article_match = re.search(r"article=(\d+)", a["href"])
        if not article_match:
            continue
        reports.append(MonthReport(
            year=int(m.group(2)), month=month_names[m.group(1)],
            article_id=article_match.group(1), url=urljoin(BASE, a["href"]),
        ))
    seen: dict = {}
    for rep in reports:
        seen[(rep.year, rep.month)] = rep
    out = sorted(seen.values(), key=lambda r: (r.year, r.month))
    log.info("Fant %d rapporter", len(out))
    return out


def fetch_month_files(report: MonthReport) -> dict[str, str]:
    log.info("Leser månedsside %s", report.label)
    r = requests.get(report.url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    keywords = {
        "volume": ["volum"], "listed": ["lagt ut"], "unsold": ["usolgte"],
        "days_on_market": ["omsetningstid"], "geo": ["geografisk"],
    }
    files: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not (href.endswith(".xlsx") or href.endswith(".xls") or "getfile.php" in href):
            continue
        text = a.get_text(" ", strip=True).lower()
        for key, kws in keywords.items():
            if all(kw in text for kw in kws) and key not in files:
                files[key] = urljoin(BASE, href)
                break
    log.info("  → fant %d Excel-filer: %s", len(files), list(files.keys()))
    return files


def download_excel(url: str) -> bytes:
    r = requests.get(url, headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.content


def _matches_month(s: str, month: int) -> bool:
    months = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des"]
    if f"-{month:02d}" in s or f"/{month:02d}" in s or f".{month:02d}" in s:
        return True
    if 0 < month <= 12 and months[month - 1] in s:
        return True
    return False


def find_value_for_area(wb_bytes: bytes, area_names: list[str], target: tuple[int,int]) -> float | None:
    try:
        wb = load_workbook(io.BytesIO(wb_bytes), data_only=True, read_only=True)
    except Exception as exc:
        log.warning("    workbook-feil: %s", exc)
        return None

    candidates = set()
    for name in area_names:
        candidates.add(name.lower())
        candidates.update(a.lower() for a in ALIAS.get(name, []))

    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        header_row_idx = None
        for i, row in enumerate(rows[:20]):
            cells = [str(c).strip().lower() if c is not None else "" for c in row]
            month_words = ("jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des")
            if sum(1 for c in cells if re.match(r"\d{4}", c) or any(w in c for w in month_words)) >= 2:
                header_row_idx = i
                break
        if header_row_idx is None:
            continue

        header = rows[header_row_idx]
        target_col = None
        for j in range(len(header) - 1, -1, -1):
            cell = header[j]
            if cell is None:
                continue
            cell_str = str(cell).strip().lower()
            if str(target[0]) in cell_str and _matches_month(cell_str, target[1]):
                target_col = j
                break
        if target_col is None:
            continue

        for row in rows[header_row_idx + 1:]:
            if not row or row[0] is None:
                continue
            label = str(row[0]).strip().lower()
            if any(c == label or c in label for c in candidates):
                if target_col < len(row) and row[target_col] is not None:
                    try:
                        val = float(row[target_col])
                        if val > 0:
                            return val
                    except (TypeError, ValueError):
                        continue
    return None


# -----------------------------------------------------------------------------
# Smart fletting - mister ALDRI eksisterende data
# -----------------------------------------------------------------------------
def load_existing_or_seed() -> dict:
    if DATA_FILE.exists():
        try:
            existing = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            if existing.get("kommuner") and existing.get("bydeler"):
                log.info("Lastet eksisterende data.json (%d kommuner, %d bydeler)",
                         len(existing["kommuner"]), len(existing["bydeler"]))
                return existing
        except Exception as exc:
            log.warning("Kunne ikke parse eksisterende data.json: %s", exc)
    if SEED_FILE.exists():
        log.info("Bruker seed-data som utgangspunkt")
        return json.loads(SEED_FILE.read_text(encoding="utf-8"))
    log.error("Ingen eksisterende data eller seed-fil!")
    return {}


def merge_into_dataset(existing: dict, new_months: list[str], new_data: dict) -> dict:
    result = deepcopy(existing)
    result.setdefault("kommuner", {})
    result.setdefault("bydeler", {})
    result.setdefault("segments", {})
    result["rate_decisions"] = RATE_DECISIONS

    existing_months = result.get("months", [])
    all_months = sorted(set(existing_months) | set(new_months))[-24:]
    result["months"] = all_months

    def merge_series(area_key: str, collection_key: str):
        area = result[collection_key].get(area_key)
        if not area:
            return
        old_series = area.get("series", {})
        new_area_data = new_data.get(collection_key, {}).get(area_key, {})
        for series_key in ["listed", "sold", "stock", "days", "price_idx"]:
            old_values = old_series.get(series_key, [])
            old_by_month = dict(zip(existing_months, old_values))
            new_by_month = {}
            for m, v in zip(new_months, new_area_data.get(series_key, [])):
                if v is not None:
                    new_by_month[m] = v
            merged = []
            for m in all_months:
                if m in new_by_month:
                    merged.append(new_by_month[m])
                elif m in old_by_month:
                    merged.append(old_by_month[m])
                else:
                    merged.append(None)
            old_series[series_key] = merged
        area["series"] = old_series

    for k in result.get("kommuner", {}):
        merge_series(k, "kommuner")
    for k in result.get("bydeler", {}):
        merge_series(k, "bydeler")
    return result


def fetch_new_data(reports: list[MonthReport], months_to_fetch: int = 6) -> tuple[list[str], dict]:
    recent = reports[-months_to_fetch:]
    months_labels = [rep.label for rep in recent]
    new_data = {
        "kommuner": {k: {s: [] for s in ["listed","sold","stock","days","price_idx"]} for k in KOMMUNER},
        "bydeler":  {k: {s: [] for s in ["listed","sold","stock","days","price_idx"]} for k in BYDELER},
    }

    for rep in recent:
        log.info("--- %s ---", rep.label)
        try:
            files = fetch_month_files(rep)
        except Exception as exc:
            log.warning("  kunne ikke hente filer: %s", exc)
            for col, target in [(KOMMUNER,"kommuner"), (BYDELER,"bydeler")]:
                for k in col:
                    for s in new_data[target][k]:
                        new_data[target][k][s].append(None)
            continue

        cache = {}
        for fk in ("listed","volume","unsold","days_on_market","geo"):
            if fk in files:
                try:
                    cache[fk] = download_excel(files[fk])
                    log.info("  lastet %s (%d kB)", fk, len(cache[fk]) // 1024)
                except Exception as exc:
                    log.warning("  kunne ikke laste %s: %s", fk, exc)

        target_ym = (rep.year, rep.month)
        mapping = {"listed":"listed","sold":"volume","stock":"unsold","days":"days_on_market","price_idx":"geo"}

        for collection, target in [(KOMMUNER,"kommuner"), (BYDELER,"bydeler")]:
            found = 0
            for area_key, names in collection.items():
                for sk, fk in mapping.items():
                    val = None
                    if fk in cache:
                        val = find_value_for_area(cache[fk], names, target_ym)
                    new_data[target][area_key][sk].append(val)
                    if val is not None:
                        found += 1
            log.info("  %s: %d/%d verdier funnet", target, found, len(collection) * 5)

    return months_labels, new_data


def main() -> int:
    existing = load_existing_or_seed()
    if not existing:
        log.error("Kunne ikke laste eksisterende data eller seed - avbryter")
        return 1

    try:
        reports = discover_monthly_reports()
        if not reports:
            log.warning("Ingen rapporter — beholder eksisterende")
            return _save_existing(existing)
    except Exception as exc:
        log.warning("Kunne ikke hente rapportliste: %s — beholder eksisterende", exc)
        return _save_existing(existing)

    try:
        new_months, new_data = fetch_new_data(reports, months_to_fetch=6)
    except Exception as exc:
        log.exception("Feil under datainnhenting: %s", exc)
        return _save_existing(existing)

    new_count = total = 0
    for col in ("kommuner","bydeler"):
        for area_data in new_data[col].values():
            for series in area_data.values():
                total += len(series)
                new_count += sum(1 for v in series if v is not None)
    quality = 100 * new_count / total if total else 0
    log.info("Ny data: %d/%d verdier (%.0f%%)", new_count, total, quality)

    # Hvis vi fant mindre enn 5% nye verdier, ikke flett — det er sannsynligvis parsefeil
    if new_count == 0 or quality < 5:
        log.warning("For lite ny data (%.0f%%) — beholder eksisterende uendret", quality)
        return _save_existing(existing, quality=quality)

    merged = merge_into_dataset(existing, new_months, new_data)
    merged["generated_at"] = datetime.now(timezone.utc).isoformat()
    merged["source"] = "Eiendom Norge / FINN / Eiendomsverdi AS"
    merged["source_url"] = INDEX_URL
    merged["license_note"] = "Tall fra Eiendom Norge. Viderepublisering av utdrag tillatt ved kildeangivelse."
    merged.pop("is_seed", None)
    merged["fetch_quality"] = round(quality, 1)

    DATA_FILE.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Skrev %s (%d kB) — kvalitet: %.0f%%", DATA_FILE, DATA_FILE.stat().st_size // 1024, quality)
    return 0


def _save_existing(existing: dict, quality: float = 0.0) -> int:
    existing["generated_at"] = datetime.now(timezone.utc).isoformat()
    existing.setdefault("rate_decisions", RATE_DECISIONS)
    existing["rate_decisions"] = RATE_DECISIONS
    existing["fetch_quality"] = round(quality, 1)
    DATA_FILE.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Beholdt eksisterende data, oppdatert timestamp")
    return 0


if __name__ == "__main__":
    sys.exit(main())
