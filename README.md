# Boligmarked Oslo og Akershus

Temperaturmåler for bruktboligmarkedet med automatisk månedlig oppdatering. Statisk dashboard på GitHub Pages, drevet av Eiendom Norges månedsstatistikk og GitHub Actions.

## Hva som dekkes

**9 Akershus-kommuner:** Oslo, Asker, Bærum, Nordre Follo, Ås, Vestby, Frogn, Nesodden, Lørenskog
**15 Oslo-bydeler:** Frogner, Grünerløkka, Sagene, St. Hanshaugen, Gamle Oslo, Nordre Aker, Vestre Aker, Ullern, Bjerke, Nordstrand, Søndre Nordstrand, Østensjø, Alna, Grorud, Stovner
**3 boligtyper:** Leilighet, enebolig, rekkehus/tomannsbolig (per kommune)

## Funksjonalitet

- **Tre faner:** Kommuner · Oslo bydeler · Oversikt (heatmap)
- **Markedstemperatur** — sammenstilling av lager, salgstid og inn/ut-balanse
- **Varselindikator** med tre nivåer (grønn/gul/rød)
- **Tilbud vs. salg per måned** — den viktigste ledende indikatoren
- **Salgstid og beholdning** over 24 måneder
- **Prisindeks med rentemarkører** — Norges Banks beslutninger lagt på som røde/grønne/grå prikker
- **Boligtype-fordeling** med varmeindikator per segment
- **E-postvarsling** når et område går fra grønn til gul/rød
- **Kommune- og bydel-sammenligning** på tvers
- **Heatmap-oversikt** for raskt overblikk

## Arkitektur

```
.
├── scripts/
│   ├── fetch_data.py         # Henter Eiendom Norge-rapporter, parser Excel → data.json
│   ├── check_alerts.py       # Sammenligner med forrige kjørings tilstand, sender e-post ved forverring
│   └── requirements.txt
├── .github/workflows/
│   └── update-data.yml       # Cron 10. hver måned + e-postvarsling
└── docs/                     # GitHub Pages-rot
    ├── index.html
    ├── app.js
    └── data/
        └── data.json
```

## Komme i gang

### 1. Push til GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:DITT-BRUKERNAVN/boligdashboard.git
git push -u origin main
```

### 2. Aktiver GitHub Pages

Settings → Pages → Source: "Deploy from a branch", Branch: `main`, mappe: `/docs` → Save. Du får en URL som `https://DITT-BRUKERNAVN.github.io/boligdashboard/`.

### 3. Gi Actions skrivetilgang

Settings → Actions → General → Workflow permissions → "Read and write permissions". (Workflowen committer oppdatert `data.json` tilbake til repoet.)

### 4. (Valgfritt) Sett opp e-postvarsling

For å motta e-post når varselnivået forverres:

**Settings → Secrets and variables → Actions → New repository secret:**

| Navn | Verdi |
|------|-------|
| `SMTP_HOST` | f.eks. `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | din-konto@gmail.com |
| `SMTP_PASS` | App-passord (ikke vanlig passord — for Gmail: lag på myaccount.google.com/apppasswords) |
| `ALERT_TO` | mottaker@example.com |
| `ALERT_FROM` | (valgfri, default = SMTP_USER) |

**Settings → Secrets and variables → Actions → Variables → New repository variable:**

| Navn | Verdi |
|------|-------|
| `DASHBOARD_URL` | https://DITT-BRUKERNAVN.github.io/boligdashboard/ |

### 5. Kjør første scrape manuelt

Actions-fanen → "Oppdater boligdata" → "Run workflow". Etter ~2 min skal `docs/data/data.json` være oppdatert med ekte tall fra Eiendom Norge.

### 6. Oppdater footer-lenken

I `docs/index.html`, søk etter `DITT-BRUKERNAVN` og bytt ut med ditt eget repo-navn.

## Test lokalt

```bash
pip install -r scripts/requirements.txt
python scripts/fetch_data.py
python -m http.server 8000 --directory docs
# Åpne http://localhost:8000
```

## Hvordan varselsystemet fungerer

Etter hver månedlige kjøring vurderer `check_alerts.py` hvert område mot disse reglene:

- **Rødt:** Beholdningen er > 20% over fjoråret (klart unormalt)
- **Gult** (én eller flere av):
  - Beholdning > 10% over fjoråret
  - Lagt-ut overstiger solgt med > 25%
  - Salgstiden er > 6 dager lengre enn fjoråret
  - Prisindeksen er > 1,5% under sin høyeste i perioden
- **Grønt:** Ingen av reglene utløst

Hvis et område går fra grønt til gult/rødt, eller fra gult til rødt, sendes e-post med oppsummering. Tilstanden lagres i `.alert_state.json` mellom kjøringer (via GitHub Actions cache).

## Norges Banks rentebeslutninger

Listen er manuelt vedlikeholdt i `scripts/fetch_data.py` (variabel `RATE_DECISIONS`). Når en ny rentebeslutning kommer, legg til en linje:

```python
{"date": "2026-06-18", "rate": 4.00, "type": "hold"},  # eller "up" / "down"
```

Markørene vises som farget prikk på prisindeks-grafen — grønn for kutt, rød for økning, grå ring for hold.

## Feilsøking

**Dashboard viser "Kunne ikke laste data"**

- Sjekk at GitHub Action har kjørt minst én gang (Actions-fanen)
- Inspiser `docs/data/data.json` — har den `"error"`-felt?
- Sjekk Pages-URL i nettleserens devtools (Network) — fetcher den `data/data.json` med 200 OK?

**Action feiler under Excel-parsing**

Eiendom Norge endrer av og til arkstruktur eller filnavn. `find_value_for_area` returnerer da `None` for de fleste områdene. Eksisterende `data.json` beholdes så dashboardet fortsetter å fungere. Kjør scriptet lokalt for å feilsøke:

```bash
python scripts/fetch_data.py
```

**Tall ser feil ut**

Kryssjekk mot [Eiendom Norges originale rapport](https://eiendomnorge.no/boligprisstatistikk/) eller [Krogsveens prisstatistikk](https://www.krogsveen.no/prisstatistikk/) som bruker samme datakilde.

**Varsel-e-poster kommer ikke**

- Sjekk Actions-loggen for "SMTP-konfig mangler" — bekrefter at secrets ikke er satt riktig
- For Gmail: bruk app-passord, ikke vanlig passord
- Sjekk at SMTP-server tillater STARTTLS på port 587

## Forbehold

Tallene speiler riktig retning og størrelsesorden i markedet. For mindre kommuner og bydeler publiseres data med varierende granularitet; bydels-tall er typisk publisert kvartalsvis snarere enn månedlig. Boligtype-fordelingen i `app.js` (relativ salgstid og pris per type per kommune) er estimater basert på publiserte fordelinger.

Dette er et personlig analyseverktøy og ikke et transaksjonsgrunnlag.

## Lisens og kildeangivelse

- Kildekode: MIT
- Boligdata: Eiendom Norge, FINN og Eiendomsverdi AS — viderepublisering av utdrag tillatt ved kildeangivelse, som er gjort tydelig i dashboardets footer
- Renter: Norges Bank
