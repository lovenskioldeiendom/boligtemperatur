// Boligdashboard frontend
// Leser data.json (kommuner + bydeler + segments + rate_decisions)

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

let DATA = null;
let CURRENT_TAB = 'kommune';
let charts = { flow:null, trend:null, price:null, regions:null };

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('nb-NO');
}

function fmtPct(n, d = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
}

function lastValid(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return { value: arr[i], index: i };
  }
  return { value: null, index: -1 };
}

function valueAtMonthsAgo(arr, monthsAgo) {
  const idx = arr.length - 1 - monthsAgo;
  return idx >= 0 ? arr[idx] : null;
}

function pctChange(now, then) {
  if (now === null || then === null || then === 0 || now === undefined || then === undefined) return null;
  return (now - then) / then;
}

// -----------------------------------------------------------------------------
// Tab-håndtering
// -----------------------------------------------------------------------------
function setTab(tab) {
  CURRENT_TAB = tab;
  document.getElementById('tab-kommune').classList.toggle('active', tab === 'kommune');
  document.getElementById('tab-bydel').classList.toggle('active', tab === 'bydel');
  document.getElementById('tab-overview').classList.toggle('active', tab === 'overview');
  document.getElementById('detail-view').style.display = tab === 'overview' ? 'none' : '';
  document.getElementById('overview-view').style.display = tab === 'overview' ? '' : 'none';

  if (tab === 'overview') {
    renderOverview();
  } else {
    populateRegionSelect();
    render();
  }
}

function populateRegionSelect() {
  const select = document.getElementById('region');
  const collection = CURRENT_TAB === 'bydel' ? DATA.bydeler : DATA.kommuner;
  const currentValue = select.value;
  select.innerHTML = '';
  Object.entries(collection).forEach(([key, area]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = area.name;
    select.appendChild(opt);
  });
  // For bydeler skjuler vi segment-velger fordi data ikke er brutt ned på boligtype der
  const segmentVisible = CURRENT_TAB === 'kommune';
  document.getElementById('segment').style.display = segmentVisible ? '' : 'none';
  document.getElementById('segment-label').style.display = segmentVisible ? '' : 'none';
  document.getElementById('segment-card-block').style.display = segmentVisible ? '' : 'none';
  if (currentValue && collection[currentValue]) select.value = currentValue;
}

function getCurrentArea(key) {
  return CURRENT_TAB === 'bydel' ? DATA.bydeler[key] : DATA.kommuner[key];
}

// -----------------------------------------------------------------------------
// Temperatur og varsler
// -----------------------------------------------------------------------------
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

  const validPx = priceIdx.filter(v => v !== null);
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
    return {
      level: 'danger',
      title: 'Lageret bygger seg raskt opp',
      text: `Beholdningen er ${Math.round(t.stockDelta * 100)}% høyere enn samme måned i fjor — klart over normalt sesongmønster.`
    };
  }
  if (lvl === 'warning') {
    if (t.stockDelta !== null && t.stockDelta > 0.10) {
      return { level:'warning', title:'Lageret stiger', text:`Beholdningen er ${Math.round(t.stockDelta*100)}% over fjoråret. Verdt å følge med.` };
    }
    if (t.flow !== null && t.soldNow && t.flow / t.soldNow > 0.25) {
      return { level:'warning', title:'Flere kommer inn enn ut', text:`Det ble lagt ut ${fmt(t.flow)} flere boliger enn det ble solgt i siste måned.` };
    }
    if (t.daysDelta !== null && t.daysDelta > 6) {
      return { level:'warning', title:'Salgstiden trekker ut', text:`Salgstiden er ${Math.round(t.daysDelta)} dager lengre enn for ett år siden.` };
    }
    const validPx = priceIdx.filter(v => v !== null);
    const last = validPx[validPx.length - 1];
    const peak = Math.max(...validPx);
    return { level:'warning', title:'Pristoppen ligger bak oss',
             text:`Indeksen er ${Math.abs((last - peak) / peak * 100).toFixed(1)}% under sitt høyeste i perioden.` };
  }
  return { level:'success', title:'Ingen røde flagg',
           text:'Markedet følger normalt sesongmønster på de viktigste indikatorene.' };
}

// -----------------------------------------------------------------------------
// Segment-justering (bare for kommuner)
// -----------------------------------------------------------------------------
function adjustForSegment(area, regionKey, segment) {
  if (segment === 'all') return area;
  const profile = SEGMENT_PROFILES[regionKey];
  if (!profile || !profile[segment]) return area;
  const p = profile[segment];
  const segPct = (DATA.segments[regionKey] && DATA.segments[regionKey][segment]) || 33;
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

// -----------------------------------------------------------------------------
// Render detalj-visning
// -----------------------------------------------------------------------------
function render() {
  if (!DATA) return;
  const region = document.getElementById('region').value;
  const segment = document.getElementById('segment').value;
  const baseArea = getCurrentArea(region);
  if (!baseArea) return;

  const area = CURRENT_TAB === 'kommune'
    ? adjustForSegment(baseArea, region, segment)
    : baseArea;
  const t = temperatureScore(area);
  const alert = buildAlert(t, area.series.price_idx);

  // Alert-banner
  const alertEl = document.getElementById('alert');
  alertEl.className = 'alert ' + alert.level;
  document.getElementById('alert-icon').textContent = alert.level === 'success' ? '✓' : alert.level === 'warning' ? '!' : '⚠';
  document.getElementById('alert-title').textContent = alert.title;
  document.getElementById('alert-text').textContent = alert.text;

  // Temperatur
  document.getElementById('temp-marker').style.left = (t.score * 100) + '%';
  document.getElementById('temp-label').textContent = t.label;

  // KPI
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
  const oslo12 = pctChange(lastValid(oslo.series.price_idx).value, valueAtMonthsAgo(oslo.series.price_idx, 12));
  const own12 = pctChange(lastValid(area.series.price_idx).value, valueAtMonthsAgo(area.series.price_idx, 12));

  const stockMsg = t.stockDelta !== null
    ? `<li>Aktiv beholdning er ${Math.abs(Math.round(t.stockDelta*100))}% ${t.stockDelta >= 0 ? 'over' : 'under'} samme måned i fjor.</li>`
    : '';
  const daysMsg = t.daysDelta !== null
    ? `<li>Salgstid er ${Math.abs(Math.round(t.daysDelta))} dager ${t.daysDelta >= 0 ? 'lengre' : 'kortere'} enn for ett år siden.</li>`
    : '';
  const flowMsg = t.flow !== null
    ? (t.flow > 0
        ? `<li>Det legges ut <strong>${fmt(t.flow)} flere boliger enn det selges</strong> — overskudd på tilbudssiden.</li>`
        : `<li>Det selges <strong>${fmt(-t.flow)} flere boliger enn det legges ut</strong>.</li>`) : '';
  const compMsg = (region !== 'oslo' && oslo12 !== null && own12 !== null && CURRENT_TAB === 'kommune')
    ? `<li>Sammenlignet med Oslo har ${baseArea.name} hatt ${own12 > oslo12 ? 'sterkere' : 'svakere'} prisutvikling siste 12 måneder (${fmtPct(own12*100)} mot ${fmtPct(oslo12*100)}).</li>`
    : '';

  const segLabel = CURRENT_TAB === 'kommune' ? ` (${SEGMENT_LABELS[segment]})` : '';
  document.getElementById('interpretation').innerHTML = `
    <p style="margin: 0 0 12px;">${baseArea.name}${segLabel} fremstår nå som et <strong>${t.label.toLowerCase()}</strong>.</p>
    <ul>${stockMsg}${daysMsg}${flowMsg}${compMsg}</ul>`;
}

function renderSegmentGrid(baseArea, region, segment) {
  const profile = SEGMENT_PROFILES[region];
  const shares = DATA.segments[region] || { apt: 33, house: 33, row: 34 };
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

  // Tilbud vs salg, siste 12
  const recent = months.slice(-12);
  charts.flow = new Chart(document.getElementById('chart-flow'), {
    type: 'bar',
    data: { labels: recent, datasets: [
      { label: 'Lagt ut', data: area.series.listed.slice(-12), backgroundColor: '#378ADD' },
      { label: 'Solgt',   data: area.series.sold.slice(-12),   backgroundColor: '#1D9E75' }
    ]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: { autoSkip: false, maxRotation: 0, font: { size: 10 } }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { font: { size: 10 } } } } }
  });

  // Salgstid + beholdning
  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: { labels: months, datasets: [
      { label: 'Salgstid', data: area.series.days, borderColor: '#D85A30', backgroundColor: '#D85A30', yAxisID: 'y', tension: 0.3, pointRadius: 1.5, borderWidth: 2 },
      { label: 'Beholdning', data: area.series.stock, borderColor: '#534AB7', backgroundColor: '#534AB7', yAxisID: 'y1', tension: 0.3, pointRadius: 1.5, borderWidth: 2, borderDash: [5, 4] }
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
        y: { type: 'linear', position: 'left', ticks: { font: { size: 10 }, callback: v => v + ' d' } },
        y1: { type: 'linear', position: 'right', ticks: { font: { size: 10 }, callback: v => fmt(v) }, grid: { drawOnChartArea: false } }
      } }
  });

  // Prisindeks med rentemarkører
  const oslo = DATA.kommuner.oslo;
  const ratePoints = buildRateMarkers(months, area.series.price_idx);
  charts.price = new Chart(document.getElementById('chart-price'), {
    type: 'line',
    data: { labels: months, datasets: [
      { label: area.name, data: area.series.price_idx, borderColor: '#185FA5', backgroundColor: '#185FA5', tension: 0.3, pointRadius: 1.5, borderWidth: 2.5, order: 2 },
      { label: 'Oslo', data: oslo.series.price_idx, borderColor: '#888780', backgroundColor: '#888780', tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [5, 4], order: 3 },
      { label: 'Renter', data: ratePoints.data, borderColor: 'transparent', backgroundColor: 'transparent',
        pointBackgroundColor: ratePoints.bg, pointBorderColor: ratePoints.border,
        pointRadius: 7, pointHoverRadius: 9, pointBorderWidth: 1.5,
        showLine: false, order: 1 }
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: function(c) {
          if (c.datasetIndex === 2) return ratePoints.tooltips[c.dataIndex] || '';
          return c.dataset.label + ': ' + (c.parsed.y !== null ? c.parsed.y.toFixed(1) : '—');
        }
      } } },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { font: { size: 10 } } }
      } }
  });

  // Sammenligning av kommuner/bydeler
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
        x: { beginAtZero: true, ticks: { font: { size: 10 }, callback: v => v + ' d' } },
        y: { ticks: { font: { size: 11 } }, grid: { display: false } }
      } }
  });
}

function buildRateMarkers(months, priceIdx) {
  // For hver måned, finn rentebeslutning som faller i den måneden (om noen)
  const rates = DATA.rate_decisions || [];
  const data = months.map(() => null);
  const bg = months.map(() => 'transparent');
  const border = months.map(() => 'transparent');
  const tooltips = months.map(() => '');

  for (const r of rates) {
    const ym = r.date.substring(0, 7); // YYYY-MM
    const idx = months.indexOf(ym);
    if (idx === -1) continue;

    // Plasser markøren litt over indekslinjen
    const px = priceIdx[idx];
    if (px !== null) {
      data[idx] = px;
      const colorMap = {
        up:   { bg: '#E24B4A', border: '#A32D2D' },
        down: { bg: '#1D9E75', border: '#0F6E56' },
        hold: { bg: 'transparent', border: '#888780' },
      };
      bg[idx] = colorMap[r.type].bg;
      border[idx] = colorMap[r.type].border;
      const typeLabel = r.type === 'up' ? 'Renteøkning' : r.type === 'down' ? 'Rentekutt' : 'Hold';
      tooltips[idx] = `${typeLabel} ${r.date}: ${r.rate.toFixed(2)}%`;
    }
  }
  return { data, bg, border, tooltips };
}

// -----------------------------------------------------------------------------
// Oversikt: heatmap
// -----------------------------------------------------------------------------
function renderOverview() {
  renderHeatmap('heatmap-kommuner', DATA.kommuner);
  renderHeatmap('heatmap-bydeler', DATA.bydeler, true);
}

function renderHeatmap(targetId, collection, indented = false) {
  const el = document.getElementById(targetId);
  el.innerHTML = `
    <div class="heatmap-header">Område</div>
    <div class="heatmap-header">12 mnd pris</div>
    <div class="heatmap-header">Salgstid</div>
    <div class="heatmap-header">Status</div>
  `;
  Object.entries(collection).forEach(([key, area]) => {
    const t = temperatureScore(area);
    const lvl = evaluateAlertLevel(t, area.series.price_idx);
    const px = area.series.price_idx;
    const lastPx = lastValid(px).value;
    const yearPx = valueAtMonthsAgo(px, 12);
    const change = pctChange(lastPx, yearPx);

    const colors = {
      success: { bg: 'var(--success-bg)', text: 'var(--success-text)' },
      warning: { bg: 'var(--warn-bg)',    text: 'var(--warn-text)' },
      danger:  { bg: 'var(--danger-bg)',  text: 'var(--danger-text)' },
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
    if (change !== null) {
      priceEl.style.color = change > 0 ? 'var(--success-text)' : 'var(--danger-text)';
    }
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

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------
function showError(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.style.display = 'block';
}

async function init() {
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();

    if (DATA.error || !DATA.kommuner || Object.keys(DATA.kommuner).length === 0) {
      showError('Kunne ikke laste data. GitHub Action har enten ikke kjørt ennå, eller Eiendom Norge har endret datastruktur.');
      document.getElementById('loading').style.display = 'none';
      return;
    }

    populateRegionSelect();

    const stamp = new Date(DATA.generated_at);
    document.getElementById('data-stamp').textContent =
      `Oppdatert ${stamp.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}`;

    document.getElementById('loading').style.display = 'none';
    document.getElementById('main-content').style.display = '';

    document.getElementById('region').addEventListener('change', render);
    document.getElementById('segment').addEventListener('change', render);
    render();
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    showError(`Klarte ikke å laste boligdata: ${err.message}.`);
  }
}

init();
