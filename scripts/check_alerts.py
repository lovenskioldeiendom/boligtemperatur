"""
Sjekker dagens varselindikatorer mot forrige kjørings tilstand og sender
e-post hvis noen område har gått fra grønn → gul/rød eller rød → noe annet.

Krever miljøvariabler (settes som GitHub Secrets):
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
- ALERT_TO  (mottakers e-postadresse)
- ALERT_FROM (avsender, default = SMTP_USER)

Lagrer forrige tilstand i .alert_state.json (committes ikke; lagres i Actions
cache hvis ønskelig). Hvis filen mangler, regnes alle som "first run" og
ingen e-post sendes — bare initialisering.
"""
from __future__ import annotations

import json
import logging
import os
import smtplib
import sys
from email.mime.text import MIMEText
from email.utils import formatdate
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("alerts")

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "docs" / "data" / "data.json"
STATE_FILE = ROOT / ".alert_state.json"


def temperature_score(series: dict) -> dict:
    """Forenklet replikering av frontend-logikken."""
    def last(arr):
        for v in reversed(arr):
            if v is not None:
                return v
        return None

    def at(arr, i):
        if i < 0 or i >= len(arr):
            return None
        return arr[i]

    stock_now = last(series["stock"])
    stock_year = at(series["stock"], len(series["stock"]) - 13)
    days_now = last(series["days"])
    days_year = at(series["days"], len(series["days"]) - 13)
    listed_now = last(series["listed"])
    sold_now = last(series["sold"])

    stock_delta = (stock_now - stock_year) / stock_year if stock_now and stock_year else None
    days_delta = (days_now - days_year) if days_now is not None and days_year is not None else None
    flow = (listed_now - sold_now) if listed_now is not None and sold_now is not None else None

    return {
        "stock_delta": stock_delta,
        "days_delta": days_delta,
        "flow": flow,
        "sold_now": sold_now,
    }


def evaluate_alert(t: dict, price_idx: list) -> str:
    """Returnerer 'danger', 'warning' eller 'success'."""
    if t["stock_delta"] is not None and t["stock_delta"] > 0.20:
        return "danger"

    triggers = 0
    if t["stock_delta"] is not None and t["stock_delta"] > 0.10:
        triggers += 1
    if t["flow"] is not None and t["sold_now"] and t["flow"] / t["sold_now"] > 0.25:
        triggers += 1
    if t["days_delta"] is not None and t["days_delta"] > 6:
        triggers += 1

    valid_px = [v for v in price_idx if v is not None]
    if valid_px:
        last_p, peak = valid_px[-1], max(valid_px)
        if (last_p - peak) / peak < -0.015:
            triggers += 1

    if triggers >= 1:
        return "warning"
    return "success"


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


SEVERITY = {"success": 0, "warning": 1, "danger": 2}


def send_email(subject: str, body: str) -> None:
    host = os.environ.get("SMTP_HOST")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASS")
    to = os.environ.get("ALERT_TO")
    sender = os.environ.get("ALERT_FROM", user)

    if not all([host, user, password, to]):
        log.warning("SMTP-konfig mangler — hopper over e-post (vil bli sendt når secrets er satt)")
        log.info("Ville sendt:\n  Til: %s\n  Subject: %s\n  Body:\n%s", to, subject, body)
        return

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    msg["Date"] = formatdate(localtime=True)

    log.info("Sender e-post til %s", to)
    with smtplib.SMTP(host, port) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(msg)
    log.info("E-post sendt")


def main() -> int:
    if not DATA_FILE.exists():
        log.error("Ingen data.json funnet")
        return 1

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    if not data.get("kommuner"):
        log.warning("Ingen kommune-data — hopper over varsling")
        return 0

    previous = load_state()
    current = {}
    changes = []

    for key, area in data["kommuner"].items():
        t = temperature_score(area["series"])
        level = evaluate_alert(t, area["series"]["price_idx"])
        current[key] = level

        prev = previous.get(key)
        if prev is None:
            continue  # første kjøring for dette området
        if SEVERITY[level] > SEVERITY[prev]:
            changes.append((area["name"], prev, level, t))

    save_state(current)

    if not previous:
        log.info("Første kjøring — initialiserte tilstand uten e-post")
        return 0

    if not changes:
        log.info("Ingen forverring i noen kommune — ingen e-post")
        return 0

    # Bygg e-post
    subject_levels = {c[2] for c in changes}
    if "danger" in subject_levels:
        subject = f"Boligvarsel: rødt flagg i {len(changes)} område(r)"
    else:
        subject = f"Boligvarsel: gult flagg i {len(changes)} område(r)"

    lines = [
        "Boligmarkedet — endringer i varselnivå denne måneden:",
        "",
    ]
    for name, prev, lvl, t in changes:
        emoji = {"success": "🟢", "warning": "🟡", "danger": "🔴"}[lvl]
        lines.append(f"{emoji} {name}: {prev} → {lvl}")
        if t["stock_delta"] is not None:
            lines.append(f"   Lager vs i fjor: {t['stock_delta']*100:+.0f}%")
        if t["days_delta"] is not None:
            lines.append(f"   Salgstid vs i fjor: {t['days_delta']:+.0f} dager")
        if t["flow"] is not None:
            lines.append(f"   Flow (lagt ut – solgt): {int(t['flow']):+d}")
        lines.append("")

    lines.append(f"Se dashboardet: {os.environ.get('DASHBOARD_URL', '(ikke konfigurert)')}")
    lines.append("")
    lines.append("Kilde: Eiendom Norge / FINN / Eiendomsverdi AS")

    send_email(subject, "\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
