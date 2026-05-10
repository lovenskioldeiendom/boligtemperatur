# Boligmarked Oslo og Akershus — v3

Dashboard med månedlig manuell oppdatering via et innebygd opplastings-verktøy.

## Hvorfor manuell?

Eiendom Norges side bruker JavaScript for å rendre nedlastningslenker, og automatisk skraping fra GitHub Actions er upålitelig. Manuell oppdatering med innebygd verktøy tar 2 minutter i måneden og fungerer **garantert** så lenge Eiendom Norge fortsetter å publisere Excel-filer.

## Månedlig rutine (2 minutter)

Rundt den 10. hver måned, etter at Eiendom Norge har publisert ny månedsrapport:

### Steg 1: Last ned Excel-filer

Gå til [Eiendom Norges månedsrapporter](https://eiendomnorge.no/boligprisstatistikk/statistikkbank/rapporter/manedsrapporter/), åpne nyeste rapport, og last ned disse 5 filene:

- **Volum (Solgte)** — antall solgte boliger
- **Lagt ut for salg** — antall nye annonser
- **Usolgte** — beholdning
- **Omsetningstid** — salgstid i dager
- **Geografisk vedlegg** — prisindeks per område

### Steg 2: Last opp til verktøyet

Åpne ditt dashboard → klikk **"Oppdater data"** i footeren (eller gå direkte til `/upload/`).

- Velg måneden rapporten gjelder for
- Dra alle 5 Excel-filene inn
- Klikk **"Generer data.json"**
- Verktøyet parser filene direkte i nettleseren og viser deg en preview

### Steg 3: Last ned og commit

- Klikk **"Last ned data.json"** for å få den ferdige filen
- Gå til repoet på GitHub
- Naviger til `docs/data/data.json`
- Klikk blyant-ikonet ✏️ for å redigere
- Slett innholdet, lim inn fra den nedlastede filen
- Commit changes

Dashboardet oppdateres automatisk i løpet av 1-2 minutter.

## Hva som dekkes

**9 Akershus-kommuner:** Oslo, Asker, Bærum, Nordre Follo, Ås, Vestby, Frogn, Nesodden, Lørenskog

**15 Oslo-bydeler:** Frogner, Grünerløkka, Sagene, St. Hanshaugen, Gamle Oslo, Nordre Aker, Vestre Aker, Ullern, Bjerke, Nordstrand, Søndre Nordstrand, Østensjø, Alna, Grorud, Stovner

**3 boligtyper** (estimerte profiler): Leilighet, enebolig, rekkehus/tomannsbolig

## Funksjonalitet

- **Tre faner:** Kommuner · Oslo bydeler · Oversikt (heatmap)
- **Markedstemperatur** med varselindikator (grønn/gul/rød)
- **Tilbud vs. salg** — den ledende indikatoren
- **Salgstid og beholdning** over 24 måneder
- **Prisindeks med Norges Banks rentemarkører**
- **Boligtype-fordeling** med varmeindikator per segment
- **E-postvarsling** når et område forverres (valgfritt)
- **Datakvalitet-indikator** viser hvor mye av siste innhenting som lykkes

## Arkitektur

```
.
├── docs/                          GitHub Pages-rot
│   ├── index.html                 hoveddashboardet
│   ├── app.js
│   ├── data/data.json             dataene (oppdateres manuelt)
│   └── upload/                    opplastings-verktøyet
│       ├── index.html
│       └── upload.js              parser Excel i nettleseren med SheetJS
├── scripts/
│   ├── check_alerts.py            sjekker varsler etter manuell oppdatering
│   └── requirements.txt
└── .github/workflows/
    └── check-alerts.yml           sender e-post ved forverring (valgfritt)
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

Settings → Pages → Source: "Deploy from a branch", Branch: `main`, mappe: `/docs` → Save.

Du får URL `https://DITT-BRUKERNAVN.github.io/boligdashboard/` og verktøyet på `/upload/`.

### 3. (Valgfritt) Sett opp e-postvarsling

Hvis du vil ha e-post når varselnivået forverres (gul/rød), sett opp Secrets:

| Navn | Verdi |
|------|-------|
| `SMTP_HOST` | f.eks. `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | din-konto@gmail.com |
| `SMTP_PASS` | App-passord |
| `ALERT_TO` | mottaker@example.com |

Og en variabel: `DASHBOARD_URL` = `https://DITT-BRUKERNAVN.github.io/boligdashboard/`

Workflowen `check-alerts.yml` kjører automatisk hver gang `data.json` oppdateres.

### 4. Oppdater footer-lenken

I `docs/index.html`, søk etter `DITT-BRUKERNAVN` og bytt med ditt eget repo-navn.

## Hvordan opplastings-verktøyet fungerer

Verktøyet bruker [SheetJS](https://sheetjs.com/) som er en JavaScript-bibliotek for å parse Excel-filer i nettleseren. Ingen data forlater din maskin — alt parsing skjer lokalt.

For hver fil:
1. Identifiserer arkstrukturen (header-rad, dato-kolonner)
2. Søker etter rader som matcher hver kommune/bydel (med fuzzy matching for spesialtegn)
3. Henter tidsserier for de siste 24 månedene
4. Fletter inn med eksisterende `data.json` for måneder som ikke finnes i de nye Excel-filene

Hvis noe ikke matcher, vises detaljert logg slik at du kan se hvilke ark og rader ble sjekket.

## Forbehold

For mindre kommuner og bydeler publiseres data med varierende granularitet i Eiendom Norges rapporter. Boligtype-fordelingen i `app.js` (relativ salgstid og pris per type per kommune) er estimater. Dashboardet er et personlig analyseverktøy, ikke et transaksjonsgrunnlag.

## Lisens og kildeangivelse

- Kildekode: MIT
- Boligdata: Eiendom Norge, FINN og Eiendomsverdi AS — viderepublisering tillatt ved kildeangivelse
- Renter: Norges Bank
