// Boligdashboard - Excel-parser i nettleseren
// Bruker SheetJS for å parse XLSX-filer og bygge data.json

const KOMMUNER = {
  oslo:         { name: "Oslo",         search: ["oslo"] },
  asker:        { name: "Asker",        search: ["asker"] },
  barum:        { name: "Bærum",        search: ["bærum", "baerum"] },
  nordrefollo:  { name: "Nordre Follo", search: ["nordre follo", "nordre-follo"] },
  as:           { name: "Ås",           search: ["ås", "aas"] },
  vestby:       { name: "Vestby",       search: ["vestby"] },
  frogn:        { name: "Frogn",        search: ["frogn"] },
  nesodden:     { name: "Nesodden",     search: ["nesodden"] },
  lorenskog:    { name: "Lørenskog",    search: ["lørenskog", "lorenskog"] },
};

const BYDELER = {
  frogner:           { name: "Frogner",          search: ["frogner"] },
  grunerlokka:       { name: "Grünerløkka",      search: ["grünerløkka", "grunerlokka"] },
  sagene:            { name: "Sagene",           search: ["sagene"] },
  sthanshaugen:      { name: "St. Hanshaugen",   search: ["st.hanshaugen", "st. hanshaugen", "hanshaugen"] },
  gamleoslo:         { name: "Gamle Oslo",       search: ["gamle oslo"] },
  nordreaker:        { name: "Nordre Aker",      search: ["nordre aker"] },
  vestreaker:        { name: "Vestre Aker",      search: ["vestre aker"] },
  ullern:            { name: "Ullern",           search: ["ullern"] },
  bjerke:            { name: "Bjerke",           search: ["bjerke"] },
  nordstrand:        { name: "Nordstrand",       search: ["nordstrand"] },
  sondrenordstrand:  { name: "Søndre Nordstrand", search: ["søndre nordstrand", "sondre nordstrand"] },
  ostensjo:          { name: "Østensjø",         search: ["østensjø", "ostensjo"] },
  alna:              { name: "Alna",             search: ["alna"] },
  grorud:            { name: "Grorud",           search: ["grorud"] },
  stovner:           { name: "Stovner",          search: ["stovner"] },
};

// Bydeler er ofte prefiksert med "Oslo:" — vi må matche begge varianter
function bydelMatches(label, bydel) {
  const l = label.toLowerCase();
  return bydel.search.some(s => {
    return l === s || l === `oslo: ${s}` || l === `oslo:${s}` ||
           l.includes(`oslo: ${s}`) || (l.includes(s) && l.includes("oslo"));
  });
}

function kommuneMatches(label, kommune) {
  const l = label.toLowerCase().trim();
  return kommune.search.some(s => l === s || l.startsWith(s + " ") || l.startsWith(s + ","));
}

const FILE_TYPES = {
  volume:         { keywords: ["volum"],         label: "Volum (Solgte)",   field: "sold" },
  listed:         { keywords: ["lagt ut"],       label: "Lagt ut for salg", field: "listed" },
  unsold:         { keywords: ["usolgte"],       label: "Usolgte",          field: "stock" },
  days_on_market: { keywords: ["omsetningstid"], label: "Omsetningstid",    field: "days" },
  geo:            { keywords: ["geografisk"],    label: "Geografisk vedlegg", field: "price_idx" },
};

const NORWEGIAN_MONTHS = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des"];

// ---- State ----
const files = {};  // { type: { file, name } }
let parsedData = null;
const log = [];

function logMsg(msg) {
  const ts = new Date().toLocaleTimeString('nb-NO');
  log.push(`[${ts}] ${msg}`);
  document.getElementById('log').textContent = log.join('\n');
  document.getElementById('log-container').style.display = '';
}

function setStatus(level, msg) {
  const c = document.getElementById('status-container');
  c.innerHTML = `<div class="status ${level}">${msg}</div>`;
}

// ---- Filhåndtering ----
function classifyFile(name) {
  const lower = name.toLowerCase();
  for (const [type, def] of Object.entries(FILE_TYPES)) {
    if (def.keywords.every(k => lower.includes(k))) return type;
  }
  return null;
}

function handleFiles(fileList) {
  for (const file of fileList) {
    const type = classifyFile(file.name);
    if (type) {
      files[type] = { file, name: file.name };
      logMsg(`Klassifisert "${file.name}" som ${FILE_TYPES[type].label}`);
    } else {
      logMsg(`⚠ "${file.name}" matcher ingen kjente filtyper - hoppes over`);
    }
  }
  renderFileList();
}

function renderFileList() {
  const container = document.getElementById('file-list');
  if (Object.keys(files).length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  container.innerHTML = '';

  for (const [type, def] of Object.entries(FILE_TYPES)) {
    const f = files[type];
    const row = document.createElement('div');
    row.className = 'file-row';
    if (f) {
      row.innerHTML = `
        <span class="file-icon match">✓</span>
        <span class="file-name">${f.name}</span>
        <span class="file-type">${def.label}</span>
        <button class="file-remove" onclick="removeFile('${type}')">×</button>
      `;
    } else {
      row.innerHTML = `
        <span class="file-icon unmatched">○</span>
        <span class="file-name" style="color: var(--text-dim);">${def.label}</span>
        <span class="file-type">mangler</span>
        <span></span>
      `;
    }
    container.appendChild(row);
  }
  updateParseBtn();
}

function removeFile(type) {
  delete files[type];
  renderFileList();
}

function updateParseBtn() {
  const btn = document.getElementById('parse-btn');
  const filesPresent = Object.keys(files).length;
  const month = document.getElementById('report-month').value;
  btn.disabled = filesPresent === 0 || !month;
  btn.textContent = filesPresent === 0
    ? "Last opp filer først"
    : !month
    ? "Velg måned"
    : `Generer data.json (${filesPresent}/5 filer)`;
}

// ---- Drag-and-drop ----
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});
document.getElementById('file-input').addEventListener('change', e => handleFiles(e.target.files));
document.getElementById('report-month').addEventListener('change', updateParseBtn);

// Default til forrige måned
{
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  document.getElementById('report-month').value =
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---- Excel-parsing ----
async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { cellDates: false, cellNF: false });
}

function findHeaderRow(rows) {
  // Header-raden er den første som har minst 2 dato-lignende kolonner
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].map(c => (c == null ? "" : String(c).toLowerCase().trim()));
    let dateCount = 0;
    for (const c of cells) {
      if (/\b(19|20)\d{2}\b/.test(c) || NORWEGIAN_MONTHS.some(m => c.includes(m))) dateCount++;
    }
    if (dateCount >= 2) return i;
  }
  return -1;
}

function findColumnForMonth(headerRow, year, month) {
  // Søk etter kolonne som matcher (year, month). Foretrekk eksakt match,
  // fall tilbake til kolonner med bare måned eller bare år.
  const monthName = NORWEGIAN_MONTHS[month - 1];
  let exactMatch = -1;
  let yearOnlyMatch = -1;

  for (let j = headerRow.length - 1; j >= 0; j--) {
    const cell = headerRow[j];
    if (cell == null) continue;
    const s = String(cell).toLowerCase().trim();

    // Eksakt match: "apr 2026", "2026-04", "2026.04", "april 2026"
    if (s.includes(String(year)) && (s.includes(monthName) || s.includes(`-${String(month).padStart(2,'0')}`) || s.includes(`/${String(month).padStart(2,'0')}`))) {
      if (exactMatch === -1) exactMatch = j;
    }
    // År-bare match som fallback
    if (s.includes(String(year)) && yearOnlyMatch === -1) yearOnlyMatch = j;
  }

  return exactMatch !== -1 ? exactMatch : yearOnlyMatch;
}

function findColumnForYearMonth(headerRow, year, month) {
  // Som over, men brukes for tidsserier - vi vil finne ALLE måned-kolonner
  // Returnerer { year, month, col } objekter for alle gyldige treff
  const found = [];
  for (let j = 0; j < headerRow.length; j++) {
    const cell = headerRow[j];
    if (cell == null) continue;
    const s = String(cell).toLowerCase().trim();

    // Match "YYYY-MM" eller "MM/YYYY" eller "Mar 2026" osv.
    let matchYear = null, matchMonth = null;

    // ISO-format: 2026-04
    let m = s.match(/(\d{4})-(\d{1,2})/);
    if (m) { matchYear = +m[1]; matchMonth = +m[2]; }

    // norsk: "Mar 2026" eller "mars 2026"
    if (matchYear === null) {
      for (let mi = 0; mi < 12; mi++) {
        if (s.includes(NORWEGIAN_MONTHS[mi])) {
          const ym = s.match(/(\d{4})/);
          if (ym) { matchYear = +ym[1]; matchMonth = mi + 1; break; }
        }
      }
    }

    if (matchYear !== null && matchMonth !== null && matchMonth >= 1 && matchMonth <= 12) {
      found.push({ year: matchYear, month: matchMonth, col: j });
    }
  }
  return found;
}

function findValueForArea(workbook, areaMatcher, year, month) {
  // areaMatcher: function(label) -> bool
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (rows.length < 3) continue;

    const headerIdx = findHeaderRow(rows);
    if (headerIdx === -1) continue;

    const targetCol = findColumnForMonth(rows[headerIdx], year, month);
    if (targetCol === -1) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row[0] == null) continue;
      const label = String(row[0]).trim();
      if (!label) continue;

      if (areaMatcher(label)) {
        const val = row[targetCol];
        if (val != null && !isNaN(val) && Number(val) > 0) {
          return { value: Number(val), sheet: sheetName, row: i, col: targetCol, label };
        }
      }
    }
  }
  return null;
}

// Hent en hel tidsserie (siste 24 måneder) fra én Excel-fil
function findTimeSeriesForArea(workbook, areaMatcher, endYear, endMonth, monthsBack = 24) {
  // Bygg ønsket månedsliste
  const wantedMonths = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    let m = endMonth - i;
    let y = endYear;
    while (m <= 0) { m += 12; y -= 1; }
    wantedMonths.push({ year: y, month: m, label: `${y}-${String(m).padStart(2,'0')}` });
  }

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (rows.length < 3) continue;

    const headerIdx = findHeaderRow(rows);
    if (headerIdx === -1) continue;

    const dateCols = findColumnForYearMonth(rows[headerIdx], endYear, endMonth);
    if (dateCols.length < 2) continue;

    // Bygg map fra "YYYY-MM" → kolonne
    const colByMonth = {};
    for (const dc of dateCols) {
      colByMonth[`${dc.year}-${String(dc.month).padStart(2,'0')}`] = dc.col;
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row[0] == null) continue;
      const label = String(row[0]).trim();
      if (!label || !areaMatcher(label)) continue;

      // Match - bygg verdier for ønskede måneder
      const series = wantedMonths.map(wm => {
        const col = colByMonth[wm.label];
        if (col == null) return null;
        const v = row[col];
        if (v == null || isNaN(v) || Number(v) <= 0) return null;
        return Number(v);
      });

      // Sjekk at vi fant minst noen verdier
      const validCount = series.filter(v => v !== null).length;
      if (validCount > 0) {
        return { series, sheet: sheetName, row: i, label, validCount };
      }
    }
  }
  return null;
}

// ---- Hovedflyt ----
async function buildDataset() {
  const monthInput = document.getElementById('report-month').value;
  if (!monthInput) {
    setStatus('warning', 'Velg måned først.');
    return;
  }
  const [endYear, endMonth] = monthInput.split('-').map(Number);

  setStatus('info', 'Parser Excel-filer...');
  log.length = 0;
  logMsg(`Mål-måned: ${endYear}-${String(endMonth).padStart(2,'0')}`);
  logMsg(`Filer lastet opp: ${Object.keys(files).map(t => FILE_TYPES[t].label).join(', ')}`);

  const workbooks = {};
  for (const [type, f] of Object.entries(files)) {
    try {
      logMsg(`\nLeser ${f.name}...`);
      workbooks[type] = await readWorkbook(f.file);
      logMsg(`  ${workbooks[type].SheetNames.length} ark: ${workbooks[type].SheetNames.join(', ')}`);
    } catch (err) {
      logMsg(`  FEIL: ${err.message}`);
    }
  }

  // Last eksisterende data.json som basis (fra dashboardet) — eller bygg tom struktur
  const existing = await loadExistingData();
  logMsg(`\nEksisterende data.json: ${existing ? 'lastet' : 'ingen funnet, starter fra null'}`);

  // Bygg månedsliste (24 mnd som ender på endYear-endMonth)
  const months = [];
  for (let i = 23; i >= 0; i--) {
    let m = endMonth - i;
    let y = endYear;
    while (m <= 0) { m += 12; y -= 1; }
    months.push(`${y}-${String(m).padStart(2,'0')}`);
  }

  const dataset = {
    generated_at: new Date().toISOString(),
    source: "Eiendom Norge / FINN / Eiendomsverdi AS",
    source_url: "https://eiendomnorge.no/boligprisstatistikk/statistikkbank/rapporter/manedsrapporter/",
    license_note: "Tall fra Eiendom Norge. Viderepublisering av utdrag tillatt ved kildeangivelse.",
    months,
    kommuner: {},
    bydeler: {},
    segments: existing?.segments || DEFAULT_SEGMENTS,
    rate_decisions: existing?.rate_decisions || RATE_DECISIONS,
  };

  // Hent tidsserier for hvert område + hver datatype
  const stats = { kommuner: {}, bydeler: {} };

  logMsg(`\n=== Henter tidsserier ===`);
  for (const [key, area] of Object.entries(KOMMUNER)) {
    const series = { listed: [], sold: [], stock: [], days: [], price_idx: [] };
    let foundCount = 0;
    let totalSlots = 0;

    for (const [type, def] of Object.entries(FILE_TYPES)) {
      if (!workbooks[type]) {
        series[def.field] = new Array(24).fill(null);
        continue;
      }
      const matcher = (label) => kommuneMatches(label, area);
      const result = findTimeSeriesForArea(workbooks[type], matcher, endYear, endMonth, 24);
      if (result) {
        series[def.field] = result.series;
        foundCount += result.validCount;
        totalSlots += 24;
        logMsg(`  ${area.name} / ${def.label}: ${result.validCount}/24 i ark "${result.sheet}" rad ${result.row} (label: "${result.label}")`);
      } else {
        series[def.field] = new Array(24).fill(null);
        totalSlots += 24;
        logMsg(`  ${area.name} / ${def.label}: ikke funnet`);
      }
    }

    dataset.kommuner[key] = { name: area.name, series };
    stats.kommuner[key] = { found: foundCount, total: totalSlots };
  }

  for (const [key, area] of Object.entries(BYDELER)) {
    const series = { listed: [], sold: [], stock: [], days: [], price_idx: [] };
    let foundCount = 0;
    let totalSlots = 0;

    for (const [type, def] of Object.entries(FILE_TYPES)) {
      if (!workbooks[type]) {
        series[def.field] = new Array(24).fill(null);
        continue;
      }
      const matcher = (label) => bydelMatches(label, area);
      const result = findTimeSeriesForArea(workbooks[type], matcher, endYear, endMonth, 24);
      if (result) {
        series[def.field] = result.series;
        foundCount += result.validCount;
        totalSlots += 24;
        logMsg(`  ${area.name} / ${def.label}: ${result.validCount}/24 i ark "${result.sheet}" rad ${result.row}`);
      } else {
        series[def.field] = new Array(24).fill(null);
        totalSlots += 24;
        logMsg(`  ${area.name} / ${def.label}: ikke funnet`);
      }
    }

    dataset.bydeler[key] = { name: area.name, series };
    stats.bydeler[key] = { found: foundCount, total: totalSlots };
  }

  // Flett inn med eksisterende data der nye verdier mangler
  if (existing) {
    logMsg(`\n=== Fletter inn med eksisterende data ===`);
    mergeWithExisting(dataset, existing);
  }

  // Beregn samlet kvalitet
  let totalFound = 0, totalSlots = 0;
  for (const s of Object.values(stats.kommuner)) { totalFound += s.found; totalSlots += s.total; }
  for (const s of Object.values(stats.bydeler)) { totalFound += s.found; totalSlots += s.total; }
  const quality = totalSlots > 0 ? Math.round(100 * totalFound / totalSlots) : 0;
  dataset.fetch_quality = quality;

  logMsg(`\n=== Resultat ===`);
  logMsg(`Datakvalitet: ${totalFound}/${totalSlots} verdier funnet (${quality}%)`);

  parsedData = dataset;
  renderPreview(stats);

  if (quality === 0) {
    setStatus('danger', `Ingen verdier funnet. Sjekk at du har lastet opp riktige filer for ${endYear}-${String(endMonth).padStart(2,'0')}. Se loggen nedenfor for detaljer.`);
  } else if (quality < 30) {
    setStatus('warning', `Kun ${quality}% av forventede verdier funnet. Filer kan være ufullstendige eller fra feil måned. Se loggen.`);
  } else if (quality < 70) {
    setStatus('warning', `${quality}% datakvalitet. Bra, men noen verdier mangler — se preview for detaljer.`);
  } else {
    setStatus('success', `${quality}% datakvalitet. Klar til å laste ned.`);
  }
  document.getElementById('download-btn').style.display = '';
}

function mergeWithExisting(dataset, existing) {
  if (!existing.months || !existing.kommuner) return;

  const existingMonthIdx = {};
  existing.months.forEach((m, i) => existingMonthIdx[m] = i);

  function fillSeries(newSeries, existingSeries, fieldName) {
    for (let i = 0; i < dataset.months.length; i++) {
      if (newSeries[fieldName][i] == null) {
        const m = dataset.months[i];
        const oldIdx = existingMonthIdx[m];
        if (oldIdx != null && existingSeries[fieldName] && existingSeries[fieldName][oldIdx] != null) {
          newSeries[fieldName][i] = existingSeries[fieldName][oldIdx];
        }
      }
    }
  }

  let mergedCount = 0;
  for (const key of Object.keys(dataset.kommuner)) {
    if (!existing.kommuner[key]) continue;
    const ne = dataset.kommuner[key].series;
    const oe = existing.kommuner[key].series;
    for (const f of ['listed','sold','stock','days','price_idx']) {
      const before = ne[f].filter(v => v != null).length;
      fillSeries(ne, oe, f);
      const after = ne[f].filter(v => v != null).length;
      mergedCount += after - before;
    }
  }
  for (const key of Object.keys(dataset.bydeler)) {
    if (!existing.bydeler?.[key]) continue;
    const ne = dataset.bydeler[key].series;
    const oe = existing.bydeler[key].series;
    for (const f of ['listed','sold','stock','days','price_idx']) {
      const before = ne[f].filter(v => v != null).length;
      fillSeries(ne, oe, f);
      const after = ne[f].filter(v => v != null).length;
      mergedCount += after - before;
    }
  }
  logMsg(`Fylte inn ${mergedCount} verdier fra eksisterende data.json for måneder uten ny data.`);
}

async function loadExistingData() {
  try {
    const res = await fetch('../data/data.json?t=' + Date.now());
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function renderPreview(stats) {
  const c = document.getElementById('preview-container');
  c.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'preview';
  card.innerHTML = `<h3 style="margin-bottom: 12px;">Funnet i Excel-filene</h3>`;

  // Kommuner
  const kommunerWrap = document.createElement('div');
  kommunerWrap.innerHTML = `<div style="font-size: 13px; font-weight: 500; margin: 12px 0 6px;">Akershus-kommuner</div>`;
  const headerRow = document.createElement('div');
  headerRow.className = 'preview-row header';
  headerRow.innerHTML = `<div class="name">Område</div><div>Lagt ut</div><div>Solgt</div><div>Lager</div><div>Salgstid</div><div>Pris</div>`;
  kommunerWrap.appendChild(headerRow);

  for (const [key, area] of Object.entries(KOMMUNER)) {
    const s = parsedData.kommuner[key].series;
    const row = document.createElement('div');
    row.className = 'preview-row';
    const cellHTML = (val) => {
      if (val == null) return `<div class="preview-cell missing">—</div>`;
      const fmtVal = typeof val === 'number' ? val.toLocaleString('nb-NO', { maximumFractionDigits: 1 }) : val;
      return `<div class="preview-cell found">${fmtVal}</div>`;
    };
    const lastVal = (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
      return null;
    };
    row.innerHTML = `
      <div class="preview-cell name">${area.name}</div>
      ${cellHTML(lastVal(s.listed))}
      ${cellHTML(lastVal(s.sold))}
      ${cellHTML(lastVal(s.stock))}
      ${cellHTML(lastVal(s.days))}
      ${cellHTML(lastVal(s.price_idx))}
    `;
    kommunerWrap.appendChild(row);
  }
  card.appendChild(kommunerWrap);

  // Bydeler (kun de som har data, for å ikke fylle skjermen)
  const bydelerWithData = Object.entries(BYDELER).filter(([key]) => {
    const s = parsedData.bydeler[key].series;
    return ['listed','sold','stock','days','price_idx'].some(f =>
      s[f].some(v => v != null));
  });

  if (bydelerWithData.length > 0) {
    const bydelerWrap = document.createElement('div');
    bydelerWrap.innerHTML = `<div style="font-size: 13px; font-weight: 500; margin: 16px 0 6px;">Oslo bydeler (${bydelerWithData.length}/${Object.keys(BYDELER).length} med data)</div>`;
    const h = document.createElement('div');
    h.className = 'preview-row header';
    h.innerHTML = `<div class="name">Bydel</div><div>Lagt ut</div><div>Solgt</div><div>Lager</div><div>Salgstid</div><div>Pris</div>`;
    bydelerWrap.appendChild(h);

    for (const [key, area] of bydelerWithData) {
      const s = parsedData.bydeler[key].series;
      const row = document.createElement('div');
      row.className = 'preview-row';
      const cellHTML = (val) => {
        if (val == null) return `<div class="preview-cell missing">—</div>`;
        const fmtVal = typeof val === 'number' ? val.toLocaleString('nb-NO', { maximumFractionDigits: 1 }) : val;
        return `<div class="preview-cell found">${fmtVal}</div>`;
      };
      const lastVal = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
        return null;
      };
      row.innerHTML = `
        <div class="preview-cell name">${area.name}</div>
        ${cellHTML(lastVal(s.listed))}
        ${cellHTML(lastVal(s.sold))}
        ${cellHTML(lastVal(s.stock))}
        ${cellHTML(lastVal(s.days))}
        ${cellHTML(lastVal(s.price_idx))}
      `;
      bydelerWrap.appendChild(row);
    }
    card.appendChild(bydelerWrap);
  }

  c.appendChild(card);
}

// ---- Defaults ----
const DEFAULT_SEGMENTS = {
  oslo: {apt:65,house:9,row:26}, asker: {apt:38,house:35,row:27}, barum: {apt:48,house:28,row:24},
  nordrefollo: {apt:42,house:30,row:28}, as: {apt:35,house:38,row:27}, vestby: {apt:32,house:42,row:26},
  frogn: {apt:30,house:45,row:25}, nesodden: {apt:28,house:48,row:24}, lorenskog: {apt:55,house:20,row:25},
};

const RATE_DECISIONS = [
  {date:"2024-05-03",rate:4.50,type:"hold"},{date:"2024-06-20",rate:4.50,type:"hold"},
  {date:"2024-08-15",rate:4.50,type:"hold"},{date:"2024-09-19",rate:4.50,type:"hold"},
  {date:"2024-11-07",rate:4.50,type:"hold"},{date:"2024-12-19",rate:4.50,type:"hold"},
  {date:"2025-01-23",rate:4.50,type:"hold"},{date:"2025-03-27",rate:4.50,type:"hold"},
  {date:"2025-05-08",rate:4.50,type:"hold"},{date:"2025-06-19",rate:4.25,type:"down"},
  {date:"2025-08-14",rate:4.25,type:"hold"},{date:"2025-09-18",rate:4.00,type:"down"},
  {date:"2025-11-06",rate:4.00,type:"hold"},{date:"2025-12-18",rate:4.00,type:"hold"},
  {date:"2026-01-22",rate:4.00,type:"hold"},{date:"2026-03-19",rate:4.00,type:"hold"},
  {date:"2026-05-08",rate:4.00,type:"hold"},
];

// ---- Download ----
function downloadJSON() {
  if (!parsedData) return;
  const blob = new Blob([JSON.stringify(parsedData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('success', 'data.json lastet ned. Last den opp til docs/data/data.json på GitHub.');
}

document.getElementById('parse-btn').addEventListener('click', buildDataset);
document.getElementById('download-btn').addEventListener('click', downloadJSON);
