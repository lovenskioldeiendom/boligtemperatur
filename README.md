# Boligmarked Oslo og Akershus — v2 (robust)

## Hva er nytt i v2

Dette er den robuste versjonen som **aldri ødelegger eksisterende data**, selv hvis Eiendom Norges struktur endres eller deres servere er nede.

**Tre viktige forbedringer:**

1. **Smart fletting i stedet for full overskriving:** Scriptet leser eksisterende `data.json`, henter nye verdier fra Eiendom Norge, og fletter dem inn. Hvis en verdi ikke kan hentes, beholdes den eksisterende.

2. **`seed_data.json` som permanent sikkerhetsnett:** Hvis ingenting kan hentes, får du fortsatt et fungerende dashboard.

3. **Frontend tåler delvis data:** Mangler `bydeler` eller `segments`? Frontend bruker fornuftige defaults og viser bare det den har data for, i stedet for å kræsje.

**Workflow er også tryggere:**

- Kjører kun på cron og manuell trigger (ikke ved hver push av kode)
- Pull før push for å unngå race conditions
- Retry hvis push feiler

## Oppgradering fra v1

Hvis du allerede har v1 oppe og kjørende:

**Filer du skal erstatte:**

```
scripts/fetch_data.py          ← bytt ut
scripts/seed_data.json         ← NY fil (kopi av nåværende data.json)
docs/app.js                    ← bytt ut
.github/workflows/update-data.yml  ← bytt ut
README.md                      ← bytt ut
```

**Filer som er uendret:**

```
docs/index.html
docs/data/data.json
scripts/check_alerts.py
scripts/requirements.txt
LICENSE
.gitignore
```

**Steg for steg:**

1. Aktivér workflow igjen hvis du har deaktivert den (Actions → Oppdater boligdata → "..." → Enable workflow)

2. Erstatt de fire filene over (kopier-lim-inn på GitHub web-grensesnittet, eller via git lokalt)

3. Commit endringene

4. Gå til Actions-fanen → kjør "Oppdater boligdata" manuelt

5. Vent 2-3 minutter, sjekk Action-loggen. Du skal se:
   - `Lastet eksisterende data.json (9 kommuner, 15 bydeler)`
   - `Fant N rapporter`
   - `Ny data: X/Y verdier (Z%)`
   - Hvis Z% er høyt: ekte ferske tall i dashboardet
   - Hvis Z% er lavt: din eksisterende data er beholdt, dashboardet fortsetter å fungere

6. Last dashboardet på nytt. Du ser nå "datakvalitet"-prosent ved siden av "Oppdatert"-stempelet.

## Hvordan det fungerer

```
┌─────────────────────────────────────────────────────┐
│  Last eksisterende data.json (eller seed_data.json) │
│  Inneholder ALLTID: 9 kommuner, 15 bydeler, segments│
└──────────────────────────┬──────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────┐
│  Prøv å hente fra Eiendom Norge                     │
│  Hvis ned/timeout: behold eksisterende, avbryt      │
└──────────────────────────┬──────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────┐
│  Parse de 6 siste månedene fra Excel-filer          │
│  Hver verdi: enten et tall, eller None              │
└──────────────────────────┬──────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────┐
│  Flett inn:                                         │
│  - For hver måned, for hvert område, for hver serie:│
│    Hvis ny verdi finnes → bruk den                  │
│    Ellers → behold eksisterende verdi               │
└──────────────────────────┬──────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────┐
│  Sikkerhetssjekk:                                   │
│  Hvis < 5% nye verdier funnet → behold ALT eksiste- │
│  rende uendret (sannsynligvis parsing-feil)         │
└──────────────────────────┬──────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────┐
│  Skriv data.json med fetch_quality: X%              │
│  Vises i frontend ved siden av "Oppdatert"          │
└─────────────────────────────────────────────────────┘
```

## Det som dekkes

**9 Akershus-kommuner:** Oslo, Asker, Bærum, Nordre Follo, Ås, Vestby, Frogn, Nesodden, Lørenskog

**15 Oslo-bydeler:** Frogner, Grünerløkka, Sagene, St. Hanshaugen, Gamle Oslo, Nordre Aker, Vestre Aker, Ullern, Bjerke, Nordstrand, Søndre Nordstrand, Østensjø, Alna, Grorud, Stovner

**3 boligtyper:** Leilighet, enebolig, rekkehus/tomannsbolig (per kommune)

## Funksjonalitet

- **Tre faner:** Kommuner · Oslo bydeler · Oversikt (heatmap)
- **Markedstemperatur** med varselindikator (grønn/gul/rød)
- **Tilbud vs. salg per måned** — den ledende indikatoren
- **Salgstid og beholdning** over 24 måneder
- **Prisindeks med Norges Banks rentemarkører**
- **Boligtype-fordeling** med varmeindikator per segment
- **E-postvarsling** når et område forverres
- **Datakvalitet-indikator** viser hvor mye av siste innhenting som lykkes

## Forbehold

For mindre kommuner og bydeler publiseres data med varierende granularitet i Eiendom Norges rapporter. Boligtype-fordelingen i `app.js` (relativ salgstid og pris per type per kommune) er estimater. Dashboardet er et personlig analyseverktøy, ikke et transaksjonsgrunnlag.

## Lisens og kildeangivelse

- Kildekode: MIT
- Boligdata: Eiendom Norge, FINN og Eiendomsverdi AS — kildeangivelse i footer
- Renter: Norges Bank (manuelt vedlikeholdt liste i `fetch_data.py`)
