// Boligdashboard frontend v2 — robust mot delvis data
// Kræsjer ikke selv om bydeler, segments eller rate_decisions mangler

const SEGMENT_LABELS = {
  all: 'alle boligtyper',
  apt: 'leiligheter',
  house: 'eneboliger',
  row: 'rekkehus/tomannsbolig'
};

const SEGMENT_PROFILES = {
  oslo:        { apt:{relDays:0.90,relPrice:1.05}, house:{relDays:1.30,relPrice:0.87}, row:{relDays:1.10,relPrice:0.95} },
  asker:       { apt:{relDays:0.92,relPrice:1.05}, house:{relDays:1.10,relPrice:0.97}, row:{relDays:1.00,relPrice:0.99} },
  barum:       { apt:{relDays:0.92,relPrice:1.07}, house:{relDays:1.10,relPrice:0.95}, row:{relDays:1.00,relPrice:0.97} },
  nordrefollo: { apt:{relDays:0.86,relPrice:1.10}, house:{relDays:1.20,relPrice:0.89}, row:{relDays:1.05,relPrice:0.99} },
  as:          { apt:{relDays:0.86,relPrice:1.13}, house:{relDays:1.20,relPrice:0.88}, row:{relDays:1.05,relPrice:0.96} },
  vestby:      { apt:{relDays:0.86,relPrice:1.13}, house:{relDays:1.20,relPrice:0.90}, row:{relDays:1.05,relPrice:0.98} },
  frogn:       { apt:{relDays:0.88,relPrice:1.12}, house:{relDays:1.18,relPrice:0.92}, row:{relDays:1.04,relPrice:0.98} },
  nesodden:    { apt:{relDays:0.88,relPrice:1.10}, house:{relDays:1.16,relPrice:0.93}, row:{relDays:1.03,relPrice:0.99} },
  lorenskog:   { apt:{relDays:0.92,relPrice:1.06}, house:{relDays:1.14,relPrice:0.95}, row:{relDays:1.02,relPrice:0.98} },
};

const DEFAULT_SEGMENTS = {
  oslo: {apt:65,house:9,row:26}, asker: {apt:38,house:35,row:27}, barum: {apt:48,house:28,row:24},
  nordrefollo: {apt:42,house:30,row:28}, as: {apt:35,house:38,row:27}, vestby: {apt:32,house:42,row:26},
  frogn: {apt:30,house:45,row:25}, nesodden: {apt:28,house:48,row:24}, lorenskog: {apt:55,house:20,row:25},
};

let DATA = null;
let CURRENT_TAB = 'kommune';
let charts = { flow:null, trend:null, price:null, regions:null };

// --- Hjelpere ---
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('nb-NO');
}
function fmtPct(n, d = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
}
function lastValid(arr) {
  if (!Array.isArray(arr)) return { value: null, index: -1 };
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return { value: arr[i], index: i };
  }
  return { value: null, index: -1 };
}
function valueAtMonthsAgo(arr, monthsAgo) {
  if (!Array.isArray(arr)) return null;
  const idx = arr.length - 1 - monthsAgo;
  return idx >= 0 ? arr[idx] : null;
}
function pctChange(now, then) {
  if (now === null || then === null || then === 0 || now === undefined || then === undefined) return null;
  return (now - then) / then;
}

// Validerer og normaliserer DATA. Garanterer at frontend ikke kræsjer.
function normalizeData(d) {
  if (!d || typeof d !== 'object') {
    throw new Error('data.json er ikke et gyldig objekt');
  }
  if (!d.months || !Array.isArray(d.months) || d.months.length === 0) {
    throw new Error('data.json mangler "months"-array');
  }

  // Sørg for at alle viktige felt finnes
  d.kommuner = d.kommuner || {};
  d.bydeler = d.bydeler || {};
  d.segments = d.segments || DEFAULT_SEGMENTS;
  d.rate_decisions = Array.isArray(d.rate_decisions) ? d.rate_decisions : [];

  // Valider hver kommune/bydel — fyll inn null-array hvis serie mangler
  const validateArea = (area) => {
    if (!area || typeof area !== 'object') return null;
    area.series = area.series || {};
    for (const key of ['listed', 'sold', 'stock', 'days', 'price_idx']) {
      if (!Array.isArray(area.series[key])) {
        area.series[key] = new Array(d.months.length).fill(null);
      }
      // Padd til riktig lengde
      while (area.series[key].length < d.months.length) area.series[key].push(null);
    }
    return area;
  };

  for (const k of Object.keys(d.kommuner)) {
    const v = validateArea(d.kommuner[k]);
    if (!v) delete d.kommuner[k];
  }
  for (const k of Object.keys(d.bydeler)) {
    const v = validateArea(d.bydeler[k]);
    if (!v) delete d.bydeler[k];
  }

  if (Object.keys(d.kommuner).length === 0) {
    throw new Error('Ingen gyldige kommuner i data.json');
  }
  return d;
}

// --- Tab-håndtering ---
function setTab(tab) {
  CURRENT_TAB = tab;
  document.getElementById('tab-kommune').classList.toggle('active', tab === 'kommune');
  document.getElementById('tab-bydel').classList.toggle('active', tab === 'bydel');
  document.getElementById('tab-overview').classList.toggle('active', tab === 'overview');
  document.getElementById('detail-view').style.display = tab === 'overview' ? 'none' : '';
  document.getElementById('overview-view').style.display = tab === 'overview' ? '' : 'none';

  // Bydel-fane skjules hvis ingen bydel-data
  if (tab === 'bydel' && Object.keys(DATA.bydeler).length === 0) {
    showError('Ingen bydels-data tilgjengelig ennå');
    return;
  }
  if (tab === 'overview') renderOverview();
  else { populateRegionSelect(); render(); }
}

function populateRegionSelect() {
  const select = document.getElementById('region');
  const collection = CURRENT_TAB === 'bydel' ? DATA.bydeler : DATA.kommuner;
  const currentValue = select.value;
  select.innerHTML = '';
  Object.entries(collection).forEach(([key, area]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = area.name || key;
    select.appendChild(opt);
  });
  const segmentVisible = CURRENT_TAB === 'kommune';
  document.getElementById('segment').style.display = segmentVisible ? '' : 'none';
  document.getElementById('segment-label').style.display = segmentVisible ? '' : 'none';
  document.getElementById('segment-card-block').style.display = segmentVisible ? '' : 'none';
  if (currentValue && collection[currentValue]) select.value = currentValue;
}

function getCurrentArea(key) {
  return CURRENT_TAB === 'bydel' ? DATA.bydeler[key] : DATA.kommuner[key];
}

// --- Temperatur og varsler ---
function temperatureScore(area) {
  const s = area.series;
  const stockNow = lastValid(s.stock).value;
  const stockYear = valueAtMonthsAgo(s.stock, 12);
  const daysNow = lastValid(s.days).value;
  const daysYear = valueAtMonthsAgo(s.days, 12);
  const listedNow = lastValid(s.listed).value;
  const soldNow = lastValid(s.sold).value;
  const stockDelta = pctChange(stockNow, stockYear);
  const daysDelta = (daysNow !== null && daysYear !== null) ? daysNow - daysYear : null;
  const flow = (listedNow !== null && soldNow !== null) ? listedNow - soldNow : null;

  let score = 0.5;
  if (stockDelta !== null) score -= Math.max(-0.3, Math.min(0.3, stockDelta)) * 0.5;
  if (daysDelta !== null)  score -= Math.max(-0.5, Math.min(0.5, daysDelta / 30)) * 0.3;
  if (flow !== null && soldNow) score -= Math.max(-0.5, Math.min(0.5, flow / soldNow)) * 0.2;
  score = Math.max(0.05, Math.min(0.95, score));

  let label;
  if (score < 0.25) label = 'Klart kjøpers marked';
  else if (score < 0.45) label = 'Avkjølende';
  else if (score < 0.60) label = 'Balansert';
  else if (score < 0.80) label = 'Selgers marked';
  else label = 'Sterkt selgers marked';

  return { score, label, stockNow, stockDelta, daysNow, daysDelta, flow, listedNow, soldNow };
}

function evaluateAlertLevel(t, priceIdx) {
  if (t.stockDelta !== null && t.stockDelta > 0.20) return 'danger';
  let triggers = 0;
  if (t.stockDelta !== null && t.stockDelta > 0.10) triggers++;
  if (t.flow !== null && t.soldNow && t.flow / t.soldNow > 0.25) triggers++;
  if (t.daysDelta !== null && t.daysDelta > 6) triggers++;
  const validPx = (priceIdx || []).filter(v => v !== null);
  if (validPx.length > 0) {
    const last = validPx[validPx.length - 1];
    const peak = Math.max(...validPx);
    if ((last - peak) / peak < -0.015) triggers++;
  }
  return triggers >= 1 ? 'warning' : 'success';
}

function buildAlert(t, priceIdx) {
  const lvl = evaluateAlertLevel(t, priceIdx);
  if (lvl === 'danger') {
    return { level: 'danger', title: 'Lageret bygger seg raskt opp',
      text: `Beholdningen er ${Math.round(t.stockDelta * 100)}% høyere enn samme måned i fjor.` };
  }
  if (lvl === 'warning') {
    if (t.stockDelta !== null && t.stockDelta > 0.10)
      return { level:'warning', title:'Lageret stiger', text:`Beholdningen er ${Math.round(t.stockDelta*100)}% over fjoråret.` };
    if (t.flow !== null && t.soldNow && t.flow / t.soldNow > 0.25)
      return { level:'warning', title:'Flere kommer inn enn ut', text:`Det ble lagt ut ${fmt(t.flow)} flere boliger enn det ble solgt.` };
    if (t.daysDelta !== null && t.daysDelta > 6)
      return { level:'warning', title:'Salgstiden trekker ut', text:`Salgstiden er ${Math.round(t.daysDelta)} dager lengre enn for ett år siden.` };
    const validPx = (priceIdx || []).filter(v => v !== null);
    if (validPx.length > 0) {
      const last = validPx[validPx.length - 1];
      const peak = Math.max(...validPx);
      return { level:'warning', title:'Pristoppen ligger bak oss',
               text:`Indeksen er ${Math.abs((last - peak) / peak * 100).toFixed(1)}% under sitt høyeste i perioden.` };
    }
  }
  return { level:'success', title:'Ingen røde flagg',
           text:'Markedet følger normalt sesongmønster på de viktigste indikatorene.' };
}

function adjustForSegment(area, regionKey, segment) {
  if (segment === 'all') return area;
  const profile = SEGMENT_PROFILES[regionKey];
  if (!profile || !profile[segment]) return area;
  const p = profile[segment];
  const segData = (DATA.segments && DATA.segments[regionKey]) || DEFAULT_SEGMENTS[regionKey] || {apt:33,house:33,row:34};
  const segPct = segData[segment] || 33;
  const factor = segPct / 100;
  return {
    ...area,
    series: {
      listed: area.series.listed.map(v => v === null ? null : Math.round(v * factor)),
      sold:   area.series.sold.map(v   => v === null ? null : Math.round(v * factor)),
      stock:  area.series.stock.map(v  => v === null ? null : Math.round(v * factor)),
      days:   area.series.days.map(v   => v === null ? null : Math.round(v * p.relDays)),
      price_idx: area.series.price_idx,
    }
  };
}

// --- Render detalj ---
function render() {
  if (!DATA) return;
  const region = document.getElementById('region').value;
  const segment = document.getElementById('segment').value;
  const baseArea = getCurrentArea(region);
  if (!baseArea) return;

  const area = CURRENT_TAB === 'kommune' ? adjustForSegment(baseArea, region, segment) : baseArea;
  const t = temperatureScore(area);
  const alert = buildAlert(t, area.series.price_idx);

  const alertEl = document.getElementById('alert');
  alertEl.className = 'alert ' + alert.level;
  document.getElementById('alert-icon').textContent = alert.level === 'success' ? '✓' : alert.level === 'warning' ? '!' : '⚠';
  document.getElementById('alert-title').textContent = alert.title;
  document.getElementById('alert-text').textContent = alert.text;

  // Speedometer - score er 0-1, vi viser den som 0-100 og roterer visermåleren
  const speedScore = Math.round(t.score * 100);
  const angle = -90 + t.score * 180;
  document.getElementById('speed-needle').style.transform = `rotate(${angle}deg)`;
  document.getElementById('speed-num').textContent = speedScore;
  document.getElementById('temp-label').textContent = t.label;

  document.getElementById('kpi-stock').textContent = fmt(t.stockNow);
  document.getElementById('kpi-stock-trend').textContent = t.stockDelta !== null
    ? `${t.stockDelta >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(t.stockDelta*100))}% vs. i fjor` : '';
  document.getElementById('kpi-days').textContent = t.daysNow !== null ? `${Math.round(t.daysNow)} dager` : '—';
  document.getElementById('kpi-days-trend').textContent = t.daysDelta !== null
    ? `${t.daysDelta >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(t.daysDelta))} dager vs. i fjor` : '';
  document.getElementById('kpi-sold').textContent = fmt(t.soldNow);
  const soldYear = valueAtMonthsAgo(area.series.sold, 12);
  const soldDelta = pctChange(t.soldNow, soldYear);
  document.getElementById('kpi-sold-trend').textContent = soldDelta !== null
    ? `${soldDelta >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(soldDelta*100))}% vs. i fjor` : '';

  const px = area.series.price_idx;
  const lastPx = lastValid(px).value;
  const pxYear = valueAtMonthsAgo(px, 12);
  const pxDelta = pctChange(lastPx, pxYear);
  document.getElementById('kpi-price').textContent = lastPx !== null ? lastPx.toFixed(1) : '—';
  document.getElementById('kpi-price-trend').textContent = pxDelta !== null ? `12 mnd: ${fmtPct(pxDelta * 100)}` : '';

  renderInterpretation(baseArea, area, t, region, segment);
  if (CURRENT_TAB === 'kommune') renderSegmentGrid(baseArea, region, segment);
  renderCharts(area, region);
}

function renderInterpretation(baseArea, area, t, region, segment) {
  const oslo = DATA.kommuner.oslo;
  const oslo12 = oslo ? pctChange(lastValid(oslo.series.price_idx).value, valueAtMonthsAgo(oslo.series.price_idx, 12)) : null;
  const own12 = pctChange(lastValid(area.series.price_idx).value, valueAtMonthsAgo(area.series.price_idx, 12));

  const stockMsg = t.stockDelta !== null
    ? `<li>Aktiv beholdning er ${Math.abs(Math.round(t.stockDelta*100))}% ${t.stockDelta >= 0 ? 'over' : 'under'} samme måned i fjor.</li>` : '';
  const daysMsg = t.daysDelta !== null
    ? `<li>Salgstid er ${Math.abs(Math.round(t.daysDelta))} dager ${t.daysDelta >= 0 ? 'lengre' : 'kortere'} enn for ett år siden.</li>` : '';
  const flowMsg = t.flow !== null
    ? (t.flow > 0
        ? `<li>Det legges ut <strong>${fmt(t.flow)} flere boliger enn det selges</strong>.</li>`
        : `<li>Det selges <strong>${fmt(-t.flow)} flere boliger enn det legges ut</strong>.</li>`) : '';
  const compMsg = (region !== 'oslo' && oslo12 !== null && own12 !== null && CURRENT_TAB === 'kommune')
    ? `<li>Sammenlignet med Oslo har ${baseArea.name} hatt ${own12 > oslo12 ? 'sterkere' : 'svakere'} prisutvikling siste 12 måneder (${fmtPct(own12*100)} mot ${fmtPct(oslo12*100)}).</li>` : '';

  const segLabel = CURRENT_TAB === 'kommune' ? ` (${SEGMENT_LABELS[segment]})` : '';
  document.getElementById('interpretation').innerHTML = `
    <p style="margin: 0 0 12px;">${baseArea.name}${segLabel} fremstår nå som et <strong>${t.label.toLowerCase()}</strong>.</p>
    <ul>${stockMsg}${daysMsg}${flowMsg}${compMsg}</ul>`;
}

function renderSegmentGrid(baseArea, region, segment) {
  const profile = SEGMENT_PROFILES[region];
  if (!profile) return;
  const shares = (DATA.segments && DATA.segments[region]) || DEFAULT_SEGMENTS[region] || {apt:33,house:33,row:34};
  const grid = document.getElementById('segment-grid');
  grid.innerHTML = '';
  const baseDays = lastValid(baseArea.series.days).value || 40;

  ['apt', 'house', 'row'].forEach(seg => {
    const p = profile[seg];
    const segDays = Math.round(baseDays * p.relDays);
    const heat = segDays < 40 ? '#1D9E75' : segDays < 55 ? '#EF9F27' : '#D85A30';
    const heatLabel = segDays < 40 ? 'Varmt' : segDays < 55 ? 'Lunkent' : 'Kjølig';
    const isActive = segment === seg ? 'active' : '';
    const div = document.createElement('div');
    div.className = `segment-card ${isActive}`;
    div.innerHTML = `
      <div class="segment-head">
        <span class="segment-name">${SEGMENT_LABELS[seg].charAt(0).toUpperCase() + SEGMENT_LABELS[seg].slice(1)}</span>
        <span class="segment-badge" style="background:${heat}22; color:${heat};">${heatLabel}</span>
      </div>
      <div class="segment-row"><span>Andel</span><span>${shares[seg] || 0}%</span></div>
      <div class="segment-row"><span>Salgstid</span><span>${segDays} dager</span></div>
      <div class="segment-row"><span>Relativ pris</span><span>${(p.relPrice * 100).toFixed(0)}%</span></div>
    `;
    grid.appendChild(div);
  });
}

function renderCharts(area, regionKey) {
  Object.values(charts).forEach(c => c && c.destroy());
  const months = DATA.months || [];
  const recent = months.slice(-12);

  // Tema-tilpasset akse-styling for bedre lesbarhet
  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const tickColor = isDark ? '#b4b2a9' : '#5f5e5a';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const tickFont = { size: 12, weight: '500' };
  const compactNum = v => v >= 1000 ? (v/1000).toFixed(1).replace('.0','') + 'k' : v;

  charts.flow = new Chart(document.getElementById('chart-flow'), {
    type: 'bar',
    data: { labels: recent, datasets: [
      { label: 'Lagt ut', data: area.series.listed.slice(-12), backgroundColor: '#378ADD' },
      { label: 'Solgt',   data: area.series.sold.slice(-12),   backgroundColor: '#1D9E75' }
    ]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 0, font: tickFont, color: tickColor }, grid: { display: false }, border: { color: gridColor } },
        y: { beginAtZero: true, ticks: { font: tickFont, color: tickColor, callback: compactNum }, grid: { color: gridColor, drawTicks: false }, border: { display: false } }
      } }
  });

  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: { labels: months, datasets: [
      { label: 'Salgstid', data: area.series.days, borderColor: '#D85A30', backgroundColor: '#D85A30', yAxisID: 'y', tension: 0.3, pointRadius: 1.5, borderWidth: 2.5 },
      { label: 'Beholdning', data: area.series.stock, borderColor: '#534AB7', backgroundColor: '#534AB7', yAxisID: 'y1', tension: 0.3, pointRadius: 1.5, borderWidth: 2.5, borderDash: [5, 4] }
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: tickFont, color: tickColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false }, border: { color: gridColor } },
        y: { type: 'linear', position: 'left', ticks: { font: tickFont, color: tickColor, callback: v => v + ' d' }, grid: { color: gridColor, drawTicks: false }, border: { display: false } },
        y1: { type: 'linear', position: 'right', ticks: { font: tickFont, color: tickColor, callback: compactNum }, grid: { drawOnChartArea: false }, border: { display: false } }
      } }
  });

  const oslo = DATA.kommuner.oslo;
  const ratePoints = buildRateMarkers(months, area.series.price_idx);
  const datasets = [
    { label: area.name, data: area.series.price_idx, borderColor: '#185FA5', backgroundColor: '#185FA5', tension: 0.3, pointRadius: 1.5, borderWidth: 2.5, order: 2 },
  ];
  if (oslo && regionKey !== 'oslo') {
    datasets.push({ label: 'Oslo', data: oslo.series.price_idx, borderColor: '#888780', backgroundColor: '#888780', tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [5, 4], order: 3 });
  }
  if (ratePoints.data.some(v => v !== null)) {
    datasets.push({ label: 'Renter', data: ratePoints.data, borderColor: 'transparent', backgroundColor: 'transparent',
      pointBackgroundColor: ratePoints.bg, pointBorderColor: ratePoints.border,
      pointRadius: 7, pointHoverRadius: 9, pointBorderWidth: 1.5, showLine: false, order: 1 });
  }

  charts.price = new Chart(document.getElementById('chart-price'), {
    type: 'line', data: { labels: months, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: function(c) {
          if (c.dataset.label === 'Renter') return ratePoints.tooltips[c.dataIndex] || '';
          return c.dataset.label + ': ' + (c.parsed.y !== null ? c.parsed.y.toFixed(1) : '—');
        }
      } } },
      scales: {
        x: { ticks: { font: tickFont, color: tickColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false }, border: { color: gridColor } },
        y: { ticks: { font: tickFont, color: tickColor }, grid: { color: gridColor, drawTicks: false }, border: { display: false } }
      } }
  });

  const collection = CURRENT_TAB === 'bydel' ? DATA.bydeler : DATA.kommuner;
  const keys = Object.keys(collection);
  const labels = keys.map(k => collection[k].name);
  const days = keys.map(k => lastValid(collection[k].series.days).value);
  const colors = keys.map(k => k === regionKey ? '#534AB7' : '#AFA9EC');

  charts.regions = new Chart(document.getElementById('chart-regions'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Salgstid', data: days, backgroundColor: colors }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.x + ' dager' } } },
      scales: {
        x: { beginAtZero: true, ticks: { font: tickFont, color: tickColor, callback: v => v + ' d' }, grid: { color: gridColor, drawTicks: false }, border: { display: false } },
        y: { ticks: { font: { size: 12, weight: '500' }, color: tickColor }, grid: { display: false }, border: { color: gridColor } }
      } }
  });
}

function buildRateMarkers(months, priceIdx) {
  const rates = DATA.rate_decisions || [];
  const data = months.map(() => null);
  const bg = months.map(() => 'transparent');
  const border = months.map(() => 'transparent');
  const tooltips = months.map(() => '');

  for (const r of rates) {
    if (!r || !r.date) continue;
    const ym = r.date.substring(0, 7);
    const idx = months.indexOf(ym);
    if (idx === -1) continue;
    const px = priceIdx[idx];
    if (px === null || px === undefined) continue;
    data[idx] = px;
    const colorMap = {
      up: { bg: '#E24B4A', border: '#A32D2D' },
      down: { bg: '#1D9E75', border: '#0F6E56' },
      hold: { bg: 'transparent', border: '#888780' },
    };
    const c = colorMap[r.type] || colorMap.hold;
    bg[idx] = c.bg;
    border[idx] = c.border;
    const typeLabel = r.type === 'up' ? 'Renteøkning' : r.type === 'down' ? 'Rentekutt' : 'Hold';
    tooltips[idx] = `${typeLabel} ${r.date}: ${(r.rate || 0).toFixed(2)}%`;
  }
  return { data, bg, border, tooltips };
}

// --- Oversikt heatmap ---
function renderOverview() {
  renderHeatmap('heatmap-kommuner', DATA.kommuner);
  if (Object.keys(DATA.bydeler).length > 0) {
    document.querySelector('#overview-view .card:nth-child(3)').style.display = '';
    renderHeatmap('heatmap-bydeler', DATA.bydeler, true);
  } else {
    document.querySelector('#overview-view .card:nth-child(3)').style.display = 'none';
  }
}

function renderHeatmap(targetId, collection, indented = false) {
  const el = document.getElementById(targetId);
  el.innerHTML = `
    <div class="heatmap-header">Område</div>
    <div class="heatmap-header">12 mnd pris</div>
    <div class="heatmap-header">Salgstid</div>
    <div class="heatmap-header">Status</div>`;
  Object.entries(collection).forEach(([key, area]) => {
    const t = temperatureScore(area);
    const lvl = evaluateAlertLevel(t, area.series.price_idx);
    const px = area.series.price_idx;
    const lastPx = lastValid(px).value;
    const yearPx = valueAtMonthsAgo(px, 12);
    const change = pctChange(lastPx, yearPx);
    const colors = {
      success: { bg: 'var(--success-bg)', text: 'var(--success-text)' },
      warning: { bg: 'var(--warn-bg)', text: 'var(--warn-text)' },
      danger:  { bg: 'var(--danger-bg)', text: 'var(--danger-text)' },
    };
    const symbols = { success: '🟢', warning: '🟡', danger: '🔴' };
    const c = colors[lvl];
    const days = t.daysNow !== null ? Math.round(t.daysNow) + ' d' : '—';

    const nameEl = document.createElement('div');
    nameEl.className = 'heatmap-name' + (indented ? ' bydel' : '');
    nameEl.textContent = area.name;
    nameEl.style.cursor = 'pointer';
    nameEl.onclick = () => navigateToArea(key, indented ? 'bydel' : 'kommune');
    el.appendChild(nameEl);

    const priceEl = document.createElement('div');
    priceEl.className = 'heatmap-cell';
    priceEl.textContent = change !== null ? fmtPct(change * 100) : '—';
    if (change !== null) priceEl.style.color = change > 0 ? 'var(--success-text)' : 'var(--danger-text)';
    el.appendChild(priceEl);

    const daysEl = document.createElement('div');
    daysEl.className = 'heatmap-cell';
    daysEl.textContent = days;
    el.appendChild(daysEl);

    const statusEl = document.createElement('div');
    statusEl.className = 'heatmap-cell';
    statusEl.style.background = c.bg;
    statusEl.style.color = c.text;
    statusEl.textContent = symbols[lvl];
    el.appendChild(statusEl);
  });
}

function navigateToArea(key, type) {
  setTab(type);
  document.getElementById('region').value = key;
  render();
}

// --- Init ---
function showError(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.style.display = 'block';
}

function showWarning(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.style.display = 'block';
  banner.style.background = 'var(--info-bg)';
  banner.style.color = 'var(--info-text)';
  banner.style.borderColor = 'var(--info-border)';
}

async function init() {
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    DATA = normalizeData(raw);

    populateRegionSelect();

    const stamp = new Date(DATA.generated_at);
    let stampText = `Oppdatert ${stamp.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    if (typeof DATA.fetch_quality === 'number') {
      stampText += ` · ${Math.round(DATA.fetch_quality)}% datakvalitet`;
    }
    document.getElementById('data-stamp').textContent = stampText;

    if (typeof DATA.fetch_quality === 'number' && DATA.fetch_quality < 50 && DATA.fetch_quality > 0) {
      showWarning(`Siste datainnhenting fant kun ${Math.round(DATA.fetch_quality)}% av forventede verdier. Tallene kan delvis være fra forrige måned.`);
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('main-content').style.display = '';
    document.getElementById('region').addEventListener('change', render);
    document.getElementById('segment').addEventListener('change', render);
    render();
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    showError(`Klarte ikke å laste boligdata: ${err.message}.`);
    console.error(err);
  }
}

init();
