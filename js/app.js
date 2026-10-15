import * as API from './api.js';
import * as D from './data.js';
import { $, el, svgEl, int, money, signed, pct, money2, GLYPH, toast, openSheet, closeSheet, sheetOpen, armed, field, input } from './ui.js';

const VERSION = '1.0.0';
const S = {
  rows: [], units: [], summary: null, models: [], mix: [], prices: [], flags: [],
  photos: {},                       // phone id -> data URL (in-stock phones, plus any opened on demand)
  view: API.cache.get('view', 'In stock') === 'All' ? 'All' : 'In stock',
  model: '',
  sync: 'load', syncText: 'Syncing', syncedAt: 0,
  email: API.cache.get('email', ''),
  ready: false
};

const root = $('#ft');
const q = (s) => root.querySelector(s);
const list = q('#ft-list'), bars = q('#ft-bars'), flagBody = q('#ft-flags'), pick = q('#ft-pick');
const live = q('#ft-live'), liveText = q('#ft-live-t'), heading = q('#ft-h');

// ============================================================ data flow
function recompute() {
  S.units = D.buildUnits(S.rows);
  S.summary = D.summarize(S.units);
  S.models = D.modelStats(S.units);
  S.mix = D.mixOf(S.models);
  S.prices = D.priceTable(S.units);
  S.flags = D.flagsOf(S.units);
}
function loadPhotoCache() {
  const c = API.cachedPhotos(), out = {};
  Object.keys(c).forEach((id) => { out[id] = c[id].d; });
  Object.assign(S.photos, out);
}
function setSync(state, text) {
  S.sync = state; S.syncText = text;
  live.dataset.state = state; liveText.textContent = text;
}
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isAuthError = (e) => {
  const m = String((e && e.message) || '') + ' ' + String((e && e.code) || '') + ' ' + String((e && e.status) || '');
  return /jwt|not authenticated|PGRST30[0-9]|invalid refresh|refresh token|401/i.test(m);
};

let refreshing = null;
function refresh() {
  if (refreshing) return refreshing;
  const run = (async () => {
    try {
      if (!navigator.onLine) { setSync('off', S.rows.length ? 'Offline · saved data' : 'Offline'); return; }
      setSync('load', 'Syncing');
      S.rows = await API.fetchPhones();
      recompute(); render();
      const stockIds = S.rows.filter((r) => r.status === 'in_stock').map((r) => r.id);
      const photos = await API.syncPhotos(stockIds);
      const keep = {};   // photos opened on demand for phones that are not in stock stay in memory
      Object.keys(S.photos).forEach((id) => { const u = S.units.find((x) => String(x.id) === id); if (u && u.status !== 'In stock') keep[id] = S.photos[id]; });
      Object.keys(photos).forEach((id) => { keep[id] = photos[id].d; });
      S.photos = keep; render();
      S.syncedAt = Date.now();
      setSync('ok', 'Synced ' + clock(S.syncedAt));
    } catch (e) {
      if (isAuthError(e)) { await API.signOut(); showLogin(); return; }
      if (API.isNetworkError(e)) setSync('off', S.rows.length ? 'Offline · saved data' : 'Offline');
      else { setSync('fail', 'Sync failed'); toast(API.errText(e), true); }
    }
  })();
  refreshing = run.finally(() => { refreshing = null; });   // cleared asynchronously, so an early return cannot leave it stuck
  return refreshing;
}

// ============================================================ render
const bold = (t) => el('b', '', t);

function renderTake() {
  const s = S.summary;
  const p = q('#ft-take');
  const kids = [bold(int(s.stock_n)), ' phones in stock hold ', bold(money(s.stock_cost)), ' at cost. ',
    bold(money(s.profit)), ' recorded profit on ', bold(int(s.sold_n)), ' sold phones, ', bold(money(s.avg)), ' each. ',
    bold(int(s.over_n)), ' of the phones in stock are past their sell-by target, holding ', bold(money(s.over_cost)), '.'];
  if (s.timed_n >= 3) kids.push(' Average time to sell: ', bold(s.avg_days_to_sell.toFixed(1) + ' days'), ' over ' + s.timed_n + (s.timed_n === 1 ? ' phone.' : ' phones.'));
  p.replaceChildren(...kids);
}

function renderKpis() {
  const s = S.summary;
  const defs = [
    ['var(--ok)', 'Recorded profit', money(s.profit), 'all ' + int(s.sold_n) + ' sold phones'],
    ['var(--accent)', 'Profit per phone', money(s.avg), money(s.est_profit) + ' of the profit is an unconfirmed estimate'],
    ['var(--accent2)', 'Return on cost', pct(s.roi), 'profit divided by cost of sold phones'],
    ['var(--warn)', 'In stock, at cost', money(s.stock_cost), int(s.stock_n) + ' phones, ' + int(s.over_n) + ' past sell-by target']
  ];
  q('#kpis').replaceChildren(...defs.map((d) => {
    const c = el('div', 'gl ft-kpi');
    const l = el('span', 'ft-kl'); const dot = el('i'); dot.style.background = d[0]; l.append(dot, d[1]);
    c.append(l, el('b', 'ft-kv', d[2]), el('span', 'ft-ks', d[3]));
    return c;
  }));
}

function photoNode(u) {
  const ph = el('div', 'ft-ph');
  const src = S.photos[String(u.id)];
  if (src) { const im = new Image(); im.src = src; im.alt = ''; ph.append(im); } else ph.innerHTML = GLYPH;
  return ph;
}

function card(u) {
  const a = el('article', 'gl ft-u' + (u.status === 'In stock' && u.state ? ' st-' + u.state : ''));
  a.setAttribute('role', 'button'); a.tabIndex = 0;
  a.setAttribute('aria-label', u.label + (u.gb_label ? ' ' + u.gb_label : '') + ', open details');
  const main = el('div', 'ft-main');
  const t = el('div', 'ft-t');
  t.append(el('span', 'ft-name', u.label));
  if (u.gb_label) t.append(el('span', 'ft-gb', u.gb_label));
  const m = el('div', 'ft-m');
  m.append('No. ' + u.no);
  if (u.bought_label) m.append(' · ' + u.bought_label);
  m.append(' · cost ' + money(u.cost));
  if (u.status === 'Sold' && u.days_to_sell !== null) m.append(' · sold in ' + u.days_to_sell + ' d');
  main.append(t, m);
  if (u.status === 'In stock' && u.age !== null) {
    const pace = el('div', 'ft-pace ' + u.state), track = el('span', 'ft-pt'), fill = el('i');
    fill.style.width = Math.max(3, Math.min(100, (u.age / u.target) * 100)) + '%';
    track.append(fill);
    pace.append(el('span', 'ft-pc', 'day ' + (u.age_min ? '≥' : '') + u.age + ' of ' + u.target), track);
    main.append(pace);
  }
  if (u.note) main.append(el('p', 'ft-nt', u.note));

  const r = el('div', 'ft-r');
  if (u.status === 'Sold') {
    r.append(el('span', 'ft-pf ' + (u.profit < 0 ? 'neg' : 'pos'), signed(u.profit)));
    if (u.est) r.append(el('span', 'ft-chip warn', 'estimate'));
  } else if (u.state === 'over') {
    r.append(el('span', 'ft-chip bad', (u.age_min ? '≥ ' : '') + (-u.left) + ' d over'));
  } else if (u.state === 'due') {
    r.append(el('span', 'ft-chip warn', u.left === 0 ? 'due today' : u.left + ' d left'));
  } else if (u.state === 'ok') {
    r.append(el('span', 'ft-chip', u.left + ' d left'));
  } else {
    r.append(el('span', 'ft-chip', 'no date'));
  }
  r.append(el('span', 'ft-chip ' + (u.status === 'Sold' ? 'sold' : 'stock'), u.status));
  a.append(photoNode(u), main, r);
  const open = () => openDetail(u.id);
  a.addEventListener('click', open);
  a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return a;
}

function renderList() {
  const view = S.view, model = S.model;
  root.querySelectorAll('.ft-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  heading.textContent = view === 'All' ? 'All phones' : 'In stock';
  pick.hidden = !model;
  pick.textContent = model ? model + ' ×' : '';
  const shown = S.units.filter((u) => (view === 'All' ? u.status === 'In stock' || u.status === 'Sold' : u.status === 'In stock') && (!model || u.label === model));
  const stockRows = shown.filter((u) => u.status === 'In stock').sort(D.byUrgency);
  const soldRows = shown.filter((u) => u.status === 'Sold').sort((a, b) => b.no - a.no);
  const head = (cls, label, rows, withCost) => {
    const h = el('div', 'ft-grp ' + cls);
    h.append(el('b', '', label), el('span', '', rows.length + (rows.length === 1 ? ' phone' : ' phones') + (withCost ? ' · ' + money(rows.reduce((s, u) => s + u.cost, 0)) + ' at cost' : '')));
    return h;
  };
  const items = [];
  [['over', 'Past sell-by target'], ['due', 'Due within 3 days'], ['ok', 'On pace'], ['unknown', 'Age unknown']].forEach((g) => {
    const rows = stockRows.filter((u) => u.state === g[0]);
    if (rows.length) { items.push(head(g[0], g[1], rows, true)); rows.forEach((u) => items.push(card(u))); }
  });
  if (soldRows.length) { items.push(head('sold', 'Sold', soldRows, false)); soldRows.forEach((u) => items.push(card(u))); }
  list.classList.remove('dash-skeleton');
  list.replaceChildren(...items);
  if (!shown.length) list.append(el('p', 'ft-empty', S.rows.length ? 'No phones match.' : 'No phones yet. Tap + to add the first one.'));
}

function renderDonut() {
  const mix = S.mix, model = S.model;
  bars.classList.remove('dash-skeleton');
  if (!mix.length) { bars.replaceChildren(el('p', 'ft-empty', 'No sold phones yet.')); return; }
  const d3 = window.d3;
  const PAL = ['#6bb2ff', '#a58bff', '#ff7aa8', '#4fe0c8', '#ffcb66', '#62e8a8', '#ff9a7a'];
  const tint = (r, i) => (r.other ? 'rgba(214, 222, 255, .55)' : PAL[i % PAL.length]);
  const total = mix[0].total;
  const cur = mix.filter((r) => !r.other && r.label === model)[0] || null;
  const RO = 112, RI = 74;
  const arcN = d3.arc().innerRadius(RI).outerRadius(RO).cornerRadius(5);
  const arcS = d3.arc().innerRadius(RI - 3).outerRadius(RO + 8).cornerRadius(5);
  const svg = svgEl('svg', { viewBox: '-136 -136 272 272', role: 'img', 'aria-label': 'Share of sold phones by model' });
  const defs = svgEl('defs');
  const sh = svgEl('linearGradient', { id: 'ftSheen', x1: 0, y1: 0, x2: 1, y2: 1 });
  sh.append(svgEl('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.34 }), svgEl('stop', { offset: 0.6, 'stop-color': '#fff', 'stop-opacity': 0 }));
  const gl = svgEl('filter', { id: 'ftGlow', x: '-30%', y: '-30%', width: '160%', height: '160%' });
  gl.append(svgEl('feGaussianBlur', { stdDeviation: 7 }));
  defs.append(sh, gl); svg.append(defs);
  svg.append(svgEl('circle', { r: (RO + RI) / 2, fill: 'none', stroke: 'rgba(255,255,255,.06)', 'stroke-width': RO - RI }));
  svg.append(svgEl('circle', { r: RI - 9, fill: 'rgba(255,255,255,.04)', stroke: 'rgba(255,255,255,.12)' }));
  d3.pie().sort(null).value((r) => r.n).padAngle(0.03)(mix).forEach((d, i) => {
    const r = d.data, on = !!cur && r.label === cur.label, color = tint(r, i);
    const g = svgEl('g', { class: 'ft-arc' + (r.other ? ' static' : '') + (cur && !on ? ' dim' : '') });
    const path = (on ? arcS : arcN)(d);
    g.append(
      svgEl('path', { d: path, fill: color, filter: 'url(#ftGlow)', opacity: 0.35, 'pointer-events': 'none' }),
      svgEl('path', { d: path, fill: color, stroke: 'rgba(255,255,255,.4)', 'stroke-width': 0.8 }),
      svgEl('path', { d: path, fill: 'url(#ftSheen)', 'pointer-events': 'none' })
    );
    if (!r.other) g.addEventListener('click', () => setModel(on ? '' : r.label));
    svg.append(g);
  });
  const wrap = el('div', 'ft-dw'), ctr = el('div', 'ft-dc');
  ctr.append(el('span', 'ft-dn', String(cur ? cur.n : total)), el('span', 'ft-dl', cur ? cur.label + ' · ' + pct(cur.share) : 'phones sold'));
  wrap.append(svg, ctr);
  const leg = el('div', 'ft-leg');
  mix.forEach((r, i) => {
    const row = el(r.other ? 'div' : 'button', 'ft-lg' + (r.other ? ' static' : '') + (cur && cur.label !== r.label ? ' dim' : ''));
    if (!r.other) {
      row.type = 'button'; row.setAttribute('aria-pressed', String(r.label === model));
      row.addEventListener('click', () => setModel(S.model === r.label ? '' : r.label));
    }
    row.style.setProperty('--sc', tint(r, i));
    const main = el('span', 'ft-lm');
    main.append(el('span', 'ft-ln', r.other ? 'Other · ' + r.models + ' models' : r.label), el('span', 'ft-ls', r.n + ' sold · avg profit ' + signed(r.avg_profit)));
    row.append(el('i'), main, el('span', 'ft-lv', pct(r.share)));
    leg.append(row);
  });
  bars.replaceChildren(wrap, leg);
}

function renderFlags() {
  q('#checks-sec').hidden = !S.flags.length;
  flagBody.replaceChildren(...S.flags.map((f) => {
    const tr = el('tr');
    [f.no, f.label, f.status, f.issue].forEach((x) => tr.append(el('td', '', String(x))));
    return tr;
  }));
}

function renderFoot() {
  q('#ft-foot').textContent =
    'Data is stored in your Supabase database and cached on this device, so the last synced numbers show offline. ' +
    'A phone counts as in stock until it is marked sold. Cost is Total cost (price paid plus parts). ' +
    'Personal phones and zero-cost repair jobs are left out of every total. ' +
    'Sell-by targets: 7 days for phones that cost up to €300, 10 days up to €450, 14 days above. They are a starting assumption, not measured. ' +
    'Phones sold from now on record a sale date, so days-to-sell will be measured. Older rows have no sale date. ' +
    'A phone with no purchase date counts as at least as old as the next phone that has one.';
}

function renderModelList() {
  const set = new Set();
  const gens = [11, 12, 13, 14, 15, 16, 17];
  gens.forEach((g) => {
    set.add('iPhone ' + g);
    if (g < 17) { set.add('iPhone ' + g + ' Pro'); set.add('iPhone ' + g + ' Pro Max'); }
    if (g === 12 || g === 13) set.add('iPhone ' + g + ' mini');
    if (g >= 14 && g <= 16) set.add('iPhone ' + g + ' Plus');
    if (g === 17) { set.add('iPhone 17 Air'); set.add('iPhone 17 Pro'); set.add('iPhone 17 Pro Max'); }
  });
  S.rows.forEach((r) => set.add(r.model));
  $('#models-dl').replaceChildren(...[...set].sort().map((m) => { const o = el('option'); o.value = m; return o; }));
}

function render() {
  if (!S.summary) return;
  renderTake(); renderKpis(); renderList(); renderDonut(); renderFlags(); renderFoot(); renderModelList();
  if (!panel.hidden) { renderChips(); renderSearch(); }
}

function setModel(m) { S.model = m; renderList(); renderDonut(); }
function setView(v) { S.view = v; API.cache.set('view', v); renderList(); }

// ============================================================ price check (search panel)
const sbtn = q('#ft-sbtn'), panel = q('#ft-search'), qIn = q('#ft-q'), askIn = q('#ft-ask'), chipsEl = q('#ft-qchips'), resEl = q('#ft-res');
let selModel = null, selKey = null;
const sizeOf = (r) => parseInt(r.gb_label, 10) || 0;

function detailCard(m, r, ask) {
  const c = el('article', 'ft-rc');
  const h = el('div', 'ft-rh');
  const name = el('span', 'ft-rn', m.label + (r.gb_label ? ' · ' + r.gb_label : ''));
  const thin = r.n < 3;
  h.append(name, el('span', 'ft-chip' + (thin ? ' warn' : ''), r.n + ' sold' + (thin ? ' · thin sample' : '')));
  const big = el('div', 'ft-bigrow');
  big.append(el('span', 'ft-big', money(r.avg_sold)), el('span', 'ft-rm', 'average sold price'));
  c.append(h, big);
  if (ask > 0) {
    const profit = r.avg_sold - ask - r.avg_extra;
    c.append(el('p', 'ft-verdict ' + (profit >= 0 ? 'pos' : 'neg'), signed(profit) + ' expected profit at ' + money(ask)));
  }
  const off = el('p', 'ft-rm');
  off.append('Max offer for ', bold(money(r.target)), ' profit: ', bold(money(r.max_offer)));
  const r1 = el('p', 'ft-rm');
  r1.append('Range ', bold(money(r.min_sold)), ' to ', bold(money(r.max_sold)), ' · latest entry No. ', bold(String(r.last_no)), ' sold for ', bold(money(r.last_sold)));
  const r2 = el('p', 'ft-rm');
  r2.append('You paid on average ', bold(money(r.avg_cost)), ' · profit ', bold(signed(r.avg_profit)), ' per phone');
  c.append(off, r1, r2);
  if (r.est_n) c.append(el('p', 'ft-snote', r.est_n + ' of ' + r.n + ' profits are unconfirmed estimates.'));
  return c;
}

function renderSearch(reset) {
  resEl.replaceChildren();
  chipsEl.hidden = !!qIn.value.trim();
  const priceRows = S.prices;
  const raw = qIn.value.trim();
  const qt = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (!qt.length) { resEl.append(el('p', 'ft-sub', 'Type a model, for example 13 or 15 Pro, then tap a storage size. Add the asking price to see your expected profit.')); return; }
  const ask = D.parseMoney(askIn.value) || 0;
  const qn = qt.filter((t) => t !== 'iphone').join(' ');
  const exact = (r) => (r.label.toLowerCase().replace(/^iphone /, '') === qn ? 0 : 1);
  const hits = priceRows
    .filter((r) => !r.gb_label && qt.every((t) => r.label.toLowerCase().split(/\s+/).some((w) => w.indexOf(t) === 0)))
    .sort((a, b) => exact(a) - exact(b) || b.n - a.n);
  if (!hits.length) { resEl.append(el('p', 'ft-empty', 'No sold “' + raw + '” in the table, so there is nothing to price it against.')); return; }

  if (reset || !hits.some((h) => h.key === selModel)) { selModel = hits[0].key; selKey = null; }
  const m = hits.filter((h) => h.key === selModel)[0];
  const sizes = priceRows.filter((r) => r.gb_label && r.label === m.label).sort((a, b) => sizeOf(a) - sizeOf(b));
  const opts = sizes.length ? sizes : [m];
  if (!opts.some((r) => r.key === selKey)) selKey = opts.reduce((x, r) => (r.n > x.n ? r : x), opts[0]).key;
  const sel = opts.filter((r) => r.key === selKey)[0];

  if (hits.length > 1) {
    const mc = el('div', 'ft-mchips');
    hits.slice(0, 6).forEach((h) => {
      const b = el('button', '', h.label);
      b.type = 'button'; b.setAttribute('aria-pressed', String(h.key === selModel));
      b.addEventListener('click', () => { selModel = h.key; selKey = null; renderSearch(); });
      mc.append(b);
    });
    resEl.append(mc);
    if (hits.length > 6) resEl.append(el('p', 'ft-snote', (hits.length - 6) + ' more models match. Add a word to narrow it.'));
  }

  const grid = el('div', 'ft-gbgrid');
  grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Storage size');
  opts.forEach((r) => {
    const b = el('button', 'ft-gbc' + (r.n < 3 ? ' thin' : ''));
    b.type = 'button'; b.setAttribute('aria-pressed', String(r.key === selKey));
    b.append(el('span', 'ft-gbl', r.gb_label || 'Any size'), el('span', 'ft-gbp', money(r.avg_sold)));
    if (ask > 0) {
      const profit = r.avg_sold - ask - r.avg_extra;
      b.append(el('span', 'ft-gbs ' + (profit >= 0 ? 'pos' : 'neg'), signed(profit)));
    } else {
      b.append(el('span', 'ft-gbs', r.n + ' sold' + (r.n < 3 ? ' · thin' : '')));
    }
    b.addEventListener('click', () => { selKey = r.key; renderSearch(); });
    grid.append(b);
  });
  resEl.append(grid, detailCard(m, sel, ask));
  resEl.append(el('p', 'ft-snote', 'Sold price is cost plus recorded profit. Estimated profits make some prices approximate. Profit at an asking price subtracts the average extra spend (repairs, parts) on top of the purchase price.'));
}

function renderChips() {
  chipsEl.replaceChildren(...S.prices.filter((r) => !r.gb_label).sort((a, b) => b.n - a.n).slice(0, 5).map((r) => {
    const b = el('button', '', r.label.replace(/^iPhone /, ''));
    b.type = 'button';
    b.addEventListener('click', () => { qIn.value = b.textContent; renderSearch(true); });
    return b;
  }));
}

sbtn.addEventListener('click', () => {
  const open = panel.hidden;
  panel.hidden = !open;
  sbtn.setAttribute('aria-expanded', String(open));
  if (open) { renderChips(); renderSearch(); qIn.focus(); }
});
qIn.addEventListener('input', () => renderSearch(true));
askIn.addEventListener('input', () => renderSearch());
qIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') qIn.blur(); });
panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { sbtn.click(); sbtn.focus(); } });
pick.addEventListener('click', () => setModel(''));
root.querySelectorAll('.ft-seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
live.addEventListener('click', () => { refresh(); });

// ============================================================ local mutations
function upsertLocal(row) {
  const i = S.rows.findIndex((r) => r.id === row.id);
  if (i >= 0) S.rows[i] = row; else S.rows.push(row);
  S.rows.sort((a, b) => Number(a.no) - Number(b.no));
  API.cache.set('phones', S.rows);
  recompute(); render();
}
function removeLocal(id) {
  S.rows = S.rows.filter((r) => r.id !== id);
  delete S.photos[String(id)];
  const pc = API.cachedPhotos(); delete pc[String(id)]; API.cache.set('photos', pc);
  API.cache.set('phones', S.rows);
  recompute(); render();
}
function setPhotoLocal(id, rec) {
  const pc = API.cachedPhotos();
  if (rec) { S.photos[String(id)] = rec.d; pc[String(id)] = rec; } else { delete S.photos[String(id)]; delete pc[String(id)]; }
  API.cache.set('photos', pc);
}

// ============================================================ photo helper
async function resizePhoto(file, W = 240, H = 300, quality = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That image could not be read. Try a JPEG or PNG.'));
      i.src = url;
    });
    const sw = img.naturalWidth, sh = img.naturalHeight, ratio = W / H;
    let cw = sw, ch = sw / ratio;
    if (ch > sh) { ch = sh; cw = sh * ratio; }
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#10152e'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
    return cv.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

// ============================================================ sheets
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function priceFor(label, gb) {
  const base = slug(label || '');
  if (!base) return null;
  return S.prices.find((p) => p.key === base + '-' + gb) || S.prices.find((p) => p.key === base) || null;
}
const canonicalModel = (name) => {
  const clean = name.trim().replace(/\s+/g, ' ');
  const hit = S.rows.find((r) => r.model.toLowerCase() === clean.toLowerCase());
  return hit ? hit.model : clean;
};
const num = (inp) => D.parseMoney(inp.value);

function openDetail(id) {
  const u = S.units.find((x) => x.id === id);
  if (!u) return;
  openSheet(u.label + (u.gb_label ? ' · ' + u.gb_label : ''), (sb, close) => {
    const top = el('div', 'ft-dtop');
    const ph = photoNode(u);
    top.append(ph);
    const side = el('div', 'ft-kv2');
    const stat = el('div');
    if (u.status === 'Sold') stat.append(el('span', '', 'Profit'), el('span', 'ft-pf ' + (u.profit < 0 ? 'neg' : 'pos'), signed(u.profit)));
    else if (u.status === 'In stock' && u.state) stat.append(el('span', '', 'Sell-by'), el('span', 'ft-chip ' + (u.state === 'over' ? 'bad' : u.state === 'due' ? 'warn' : ''),
      u.left === null ? 'no date' : u.left < 0 ? (u.age_min ? '≥ ' : '') + (-u.left) + ' d over' : u.left + ' d left'));
    else stat.append(el('span', '', 'Status'), el('span', 'ft-chip', u.status));
    side.append(stat);
    const row = (k, v) => { const d = el('div'); d.append(el('span', '', k), el('span', '', v)); side.append(d); };
    row('Stock no.', String(u.no));
    row('Status', u.status);
    if (u.bought_label) row('Bought', u.bought_label);
    if (u.status === 'In stock' && u.age !== null) row('Age', (u.age_min ? '≥ ' : '') + u.age + ' d of ' + u.target);
    top.append(side);
    sb.append(top);

    const kv = el('div', 'ft-kv2');
    const r2 = (k, v) => { const d = el('div'); d.append(el('span', '', k), el('span', '', v)); kv.append(d); };
    r2('Price paid', money2(u.paid));
    r2('Total cost', money2(u.cost));
    if (u.status === 'Sold') {
      r2('Sold for', money2(u.sold));
      if (u.sold_label) r2('Sold on', u.sold_label);
      if (u.days_to_sell !== null) r2('Time to sell', u.days_to_sell + ' d');
      if (u.cost > 0) r2('Return on cost', pct(u.profit / u.cost));
    }
    sb.append(kv);
    if (u.note) sb.append(el('p', 'ft-dnote', u.note));

    // photo for phones that are not in the list cache: fetch on demand
    if (!S.photos[String(u.id)]) {
      API.fetchPhoto(u.id).then((rec) => {
        if (rec && document.contains(ph)) { S.photos[String(u.id)] = rec.d; ph.replaceChildren(Object.assign(new Image(), { src: rec.d, alt: '' })); }
      }).catch(() => { /* offline: keep the placeholder */ });
    }

    const acts = el('div', 'ft-acts');
    if (u.status === 'In stock') {
      const sold = el('button', 'ft-btn ok', 'Mark as sold'); sold.type = 'button';
      sold.addEventListener('click', () => openSold(u.id));
      acts.append(sold);
    }
    const two = el('div', 'ft-acts');
    const edit = el('button', 'ft-btn', 'Edit'); edit.type = 'button';
    edit.addEventListener('click', () => openForm(u.id));
    two.append(edit);
    if (u.status === 'Sold') {
      const back = el('button', 'ft-btn', 'Back to stock'); back.type = 'button';
      armed(back, 'Tap again to confirm', async () => {
        back.disabled = true;
        try {
          upsertLocal(await API.updatePhone(u.id, { status: 'in_stock', sold_on: null, sold_price: null, profit: null }));
          toast('No. ' + u.no + ' is back in stock'); close();
        } catch (e) { back.disabled = false; toast(API.errText(e), true); }
      });
      two.append(back);
      two.classList.add('two');
    }
    const del = el('button', 'ft-btn bad', 'Delete'); del.type = 'button';
    armed(del, 'Tap again to delete', async () => {
      del.disabled = true;
      try { await API.deletePhone(u.id); removeLocal(u.id); toast('No. ' + u.no + ' deleted'); close(); }
      catch (e) { del.disabled = false; toast(API.errText(e), true); }
    });
    acts.append(two, del);
    sb.append(acts);
  });
}

function openSold(id) {
  const u = S.units.find((x) => x.id === id);
  if (!u) return;
  openSheet('Mark as sold', (sb, close) => {
    sb.append(el('p', 'ft-sub', 'No. ' + u.no + ' · ' + u.label + (u.gb_label ? ' ' + u.gb_label : '') + ' · cost ' + money2(u.cost)));
    const form = el('form', 'ft-form'); form.noValidate = true;
    const price = input('text', { inputmode: 'decimal', autocomplete: 'off', placeholder: '0', 'aria-label': 'Sold price' });
    const date = input('date', { value: D.isoToday(), max: D.isoToday() });
    const ref = priceFor(u.label, u.gb);
    form.append(field('Sold for (€)', price));
    if (ref) form.append(el('p', 'ft-snote', 'Your average for ' + ref.label + (ref.gb_label ? ' ' + ref.gb_label : '') + ': ' + money(ref.avg_sold) + ' over ' + ref.n + ' sold (range ' + money(ref.min_sold) + ' to ' + money(ref.max_sold) + ').'));
    form.append(field('Sold on', date));
    const calc = el('div', 'ft-calc'), cv = el('span', 'ft-cv', '—');
    calc.append(el('span', 'ft-rm', 'Profit'), cv, el('span', 'ft-rm', ''));
    form.append(calc);
    const err = el('p', 'ft-err'); err.setAttribute('role', 'alert');
    const go = el('button', 'ft-btn ok', 'Save sale'); go.type = 'submit';
    form.append(err, go);
    const upd = () => {
      const v = num(price);
      if (v === null) { cv.textContent = '—'; cv.className = 'ft-cv'; calc.lastChild.textContent = ''; return; }
      const p = D.round2(v - u.cost);
      cv.textContent = signed(p); cv.className = 'ft-cv ' + (p >= 0 ? 'pos' : 'neg');
      calc.lastChild.textContent = (u.cost > 0 ? pct(p / u.cost) + ' return on cost' : '') + (u.bought_iso && date.value ? (u.cost > 0 ? ' · ' : '') + Math.max(0, Math.round((Date.parse(date.value) - Date.parse(u.bought_iso)) / 864e5)) + ' days to sell' : '');
    };
    price.addEventListener('input', upd); date.addEventListener('input', upd);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      const v = num(price);
      if (v === null || v < 0) { err.textContent = 'Enter the price it sold for.'; price.focus(); return; }
      if (!date.value) { err.textContent = 'Pick the sale date.'; return; }
      go.disabled = true; go.textContent = 'Saving…';
      try {
        const profit = D.round2(v - u.cost);
        upsertLocal(await API.updatePhone(u.id, { status: 'sold', sold_price: D.round2(v), sold_on: date.value, profit }));
        toast('Sold · profit ' + signed(profit)); close();
      } catch (e2) { err.textContent = API.errText(e2); go.disabled = false; go.textContent = 'Save sale'; }
    });
    sb.append(form);
    setTimeout(() => { try { price.focus(); } catch (e) { /* ignore */ } }, 60);
  }, { sticky: true });
}

function openForm(id) {
  const u = id ? S.units.find((x) => x.id === id) : null;
  const row = id ? S.rows.find((r) => r.id === id) : null;
  openSheet(u ? 'Edit phone' : 'Add phone', (sb, close) => {
    const form = el('form', 'ft-form'); form.noValidate = true;
    let gb = row ? row.gb : API.cache.get('lastGb', 128);
    let photo = u ? S.photos[String(u.id)] || null : null, photoDirty = false, photoChecked = !u || Boolean(photo);

    const model = input('text', { list: 'models-dl', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', placeholder: 'e.g. iPhone 15 Pro', value: row ? row.model : '' });
    form.append(field('Model', model));

    const sizes = el('div', 'ft-chs'); sizes.setAttribute('role', 'group'); sizes.setAttribute('aria-label', 'Storage');
    const sizeBtns = [...D.SIZES, null].map((g) => {
      const b = el('button', '', g ? g + ' GB' : 'n/a'); b.type = 'button';
      b.addEventListener('click', () => { gb = g; paintSizes(); hint(); });
      sizes.append(b); return [g, b];
    });
    const paintSizes = () => sizeBtns.forEach(([g, b]) => b.setAttribute('aria-pressed', String(g === gb)));
    const sizeWrap = el('div', 'ft-fld'); sizeWrap.append(el('span', '', 'Storage'), sizes);
    form.append(sizeWrap);
    paintSizes();

    const info = el('p', 'ft-snote'); info.hidden = true;
    const paid = input('text', { inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: row ? String(row.price_paid) : '' });
    const total = input('text', { inputmode: 'decimal', autocomplete: 'off', placeholder: 'same as paid', value: row ? String(row.total_cost) : '' });
    let totalDirty = Boolean(row) && Number(row.total_cost) !== Number(row.price_paid);
    const r1 = el('div', 'ft-row2'); r1.append(field('Price paid (€)', paid), field('Total cost (€)', total));
    form.append(info, r1, el('p', 'ft-snote', 'Total cost = price paid + parts, repairs and trade-in value. It is what profit is measured against.'));
    paid.addEventListener('input', () => { if (!totalDirty) total.value = paid.value; hint(); calc(); });
    total.addEventListener('input', () => { totalDirty = true; calc(); });

    const bought = input('date', { value: row ? row.bought_on || '' : D.isoToday(), max: D.isoToday() });
    form.append(field('Bought on', bought));

    // status (edit only)
    let status = row ? row.status : 'in_stock';
    const statusSel = el('select');
    [['in_stock', 'In stock'], ['sold', 'Sold'], ['personal', 'Personal (kept)'], ['repair', 'Repair job']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; statusSel.append(o); });
    statusSel.value = status;
    const statusFld = field('Status', statusSel);
    if (u) form.append(statusFld);
    const soldBox = el('div', 'ft-form');
    const soldPrice = input('text', { inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: row && row.sold_price != null ? String(row.sold_price) : '' });
    const soldOn = input('date', { value: row && row.sold_on ? row.sold_on : D.isoToday(), max: D.isoToday() });
    const r2 = el('div', 'ft-row2'); r2.append(field('Sold for (€)', soldPrice), field('Sold on', soldOn));
    soldBox.append(r2);
    const repairBox = el('div', 'ft-form');
    const repairProfit = input('text', { inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: row && row.status === 'repair' && row.profit != null ? String(row.profit) : '' });
    repairBox.append(field('Profit (€)', repairProfit));
    const calcBox = el('div', 'ft-calc'); const cv = el('span', 'ft-cv', '—');
    calcBox.append(el('span', 'ft-rm', 'Profit'), cv); calcBox.hidden = true;
    form.append(soldBox, repairBox, calcBox);
    const calc = () => {
      status = statusSel.value;
      soldBox.hidden = status !== 'sold'; repairBox.hidden = status !== 'repair';
      calcBox.hidden = status !== 'sold';
      if (status === 'sold') {
        const sp = num(soldPrice), c = num(total) !== null ? num(total) : num(paid);
        if (sp === null || c === null) { cv.textContent = '—'; cv.className = 'ft-cv'; }
        else { const p = D.round2(sp - c); cv.textContent = signed(p); cv.className = 'ft-cv ' + (p >= 0 ? 'pos' : 'neg'); }
      }
    };
    statusSel.addEventListener('change', calc); soldPrice.addEventListener('input', calc);
    calc();

    form.append(field('Note', Object.assign(el('textarea'), { value: row ? row.note : '', placeholder: 'Battery health, trade details, parts…', rows: 3 })));
    const noteEl = form.lastChild.querySelector('textarea');

    // photo
    const phWrap = el('div', 'ft-photo');
    const ph = el('div', 'ft-ph');
    const paintPh = () => { ph.replaceChildren(); if (photo) { const im = new Image(); im.src = photo; im.alt = ''; ph.append(im); } else ph.innerHTML = GLYPH; };
    paintPh();
    const pb = el('div', 'ft-pb');
    const lab = el('label', 'ft-btn sm', photo ? 'Change photo' : 'Add photo');
    const file = input('file', { accept: 'image/*', class: 'vh' });
    lab.append(file);
    const rm = el('button', 'ft-link', 'Remove photo'); rm.type = 'button'; rm.hidden = !photo;
    const perr = el('p', 'ft-err');
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0]; if (!f) return;
      perr.textContent = '';
      try { photo = await resizePhoto(f); photoDirty = true; photoChecked = true; paintPh(); lab.firstChild.textContent = 'Change photo'; rm.hidden = false; }
      catch (e) { perr.textContent = e.message; }
      file.value = '';
    });
    rm.addEventListener('click', () => { photo = null; photoDirty = true; photoChecked = true; paintPh(); lab.firstChild.textContent = 'Add photo'; rm.hidden = true; });
    pb.append(lab, rm, perr);
    phWrap.append(ph, pb);
    const phFld = el('div', 'ft-fld'); phFld.append(el('span', '', 'Photo'), phWrap);
    form.append(phFld);
    if (u && !photo) {   // existing phone whose photo is not in the local cache yet
      API.fetchPhoto(u.id).then((rec) => { if (rec && !photoDirty && document.contains(ph)) { photo = rec.d; S.photos[String(u.id)] = rec.d; paintPh(); lab.firstChild.textContent = 'Change photo'; rm.hidden = false; } photoChecked = true; }).catch(() => { photoChecked = true; });
    }

    const err = el('p', 'ft-err'); err.setAttribute('role', 'alert');
    const go = el('button', 'ft-btn pri', u ? 'Save changes' : 'Add phone'); go.type = 'submit';
    form.append(err, go);

    function hint() {
      const ref = priceFor(model.value.trim() && canonicalModel(model.value), gb);
      if (!ref) { info.hidden = true; return; }
      const p = num(paid);
      info.hidden = false;
      info.textContent = 'Sold before: ' + ref.label + (ref.gb_label ? ' ' + ref.gb_label : '') + ' averaged ' + money(ref.avg_sold) + ' over ' + ref.n + ' sold. Max offer for ' + money(ref.target) + ' profit: ' + money(ref.max_offer) + '.' +
        (p !== null && p > 0 ? ' At ' + money(p) + ' paid, expected profit is ' + signed(ref.avg_sold - p - ref.avg_extra) + '.' : '');
    }
    model.addEventListener('input', hint); model.addEventListener('change', hint);
    hint();

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      const name = canonicalModel(model.value);
      if (!name) { err.textContent = 'Enter the model.'; model.focus(); return; }
      const p = num(paid);
      if (p === null || p < 0) { err.textContent = 'Enter the price paid.'; paid.focus(); return; }
      let t = num(total); if (t === null) t = p;
      if (t < 0) { err.textContent = 'Total cost cannot be negative.'; total.focus(); return; }
      const st = u ? statusSel.value : 'in_stock';
      const values = { model: name, gb: gb || null, price_paid: D.round2(p), total_cost: D.round2(t), bought_on: bought.value || null, status: st, note: noteEl.value.trim(), sold_on: null, sold_price: null, profit: null };
      if (st === 'sold') {
        const sp = num(soldPrice);
        if (sp === null || sp < 0) { err.textContent = 'Enter the price it sold for.'; soldPrice.focus(); return; }
        if (!soldOn.value) { err.textContent = 'Pick the sale date.'; return; }
        values.sold_price = D.round2(sp); values.sold_on = soldOn.value; values.profit = D.round2(sp - t);
      } else if (st === 'repair') {
        const rp = num(repairProfit);
        if (rp === null) { err.textContent = 'Enter the profit for this repair job.'; repairProfit.focus(); return; }
        values.profit = D.round2(rp);
      }
      go.disabled = true; go.textContent = 'Saving…';
      try {
        const saved = u ? await API.updatePhone(u.id, values) : await API.insertPhone(values);
        if (gb) API.cache.set('lastGb', gb);
        upsertLocal(saved);
        let photoFailed = false;
        if (photoDirty && photoChecked) {
          try {
            if (photo) setPhotoLocal(saved.id, await API.savePhoto(saved.id, photo));
            else { await API.removePhoto(saved.id); setPhotoLocal(saved.id, null); }
            render();
          } catch (pe) { photoFailed = true; toast('Saved, but the photo failed: ' + API.errText(pe), true); }
        }
        if (!photoFailed) toast(u ? 'Saved No. ' + saved.no : 'Added No. ' + saved.no);
        close();
      } catch (e2) { err.textContent = API.errText(e2); go.disabled = false; go.textContent = u ? 'Save changes' : 'Add phone'; }
    });
    sb.append(form);
  }, { sticky: true });
}

function exportCsv() {
  const cols = ['no', 'model', 'gb', 'price_paid', 'total_cost', 'bought_on', 'status', 'sold_on', 'sold_price', 'profit', 'note'];
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = cols.join(',') + '\n' + S.rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n') + '\n';
  const name = 'ms-mobile-' + D.isoToday() + '.csv';
  const file = new File([csv], name, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => { /* cancelled */ });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function openMenu() {
  openSheet('Menu', (sb, close) => {
    const kv = el('div', 'ft-kv2');
    const r = (k, v) => { const d = el('div'); d.append(el('span', '', k), el('span', '', v)); kv.append(d); };
    r('Signed in as', S.email || '—');
    r('Phones', String(S.rows.length));
    r('Last sync', S.syncedAt ? clock(S.syncedAt) : 'not yet this session');
    r('Version', VERSION);
    sb.append(kv);
    const acts = el('div', 'ft-acts');
    const sync = el('button', 'ft-btn', 'Sync now'); sync.type = 'button';
    sync.addEventListener('click', () => { close(); refresh(); });
    const csv = el('button', 'ft-btn', 'Export CSV backup'); csv.type = 'button';
    csv.addEventListener('click', exportCsv);
    const out = el('button', 'ft-btn bad', 'Sign out'); out.type = 'button';
    out.addEventListener('click', async () => { close(); await API.signOut(); showLogin(); });
    acts.append(sync, csv, out);
    sb.append(acts);
  });
}

q('#ft-menu').addEventListener('click', openMenu);
q('#ft-add').addEventListener('click', () => openForm(null));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.ready && Date.now() - S.syncedAt > 60000 && !sheetOpen()) refresh();
});
window.addEventListener('online', () => { if (S.ready) refresh(); });
window.addEventListener('offline', () => { if (S.ready) setSync('off', S.rows.length ? 'Offline · saved data' : 'Offline'); });

// ============================================================ auth + boot
const loginEl = q('#login'), appEl = q('#app');
const loginForm = q('#login-form'), lgEmail = q('#lg-email'), lgPass = q('#lg-pass'), lgErr = q('#lg-err'), lgGo = q('#lg-go'), lgMode = q('#lg-mode');
let signUpMode = false;

function showLogin() {
  S.ready = false; closeSheet();
  S.rows = []; S.units = []; S.summary = null; S.photos = {};
  appEl.hidden = true; loginEl.hidden = false;
  q('#setup').hidden = true; q('#noaccess').hidden = true; loginForm.hidden = false;
  lgPass.value = ''; lgErr.textContent = '';
  list.classList.add('dash-skeleton');
}
function showNoAccess() {
  appEl.hidden = true; loginEl.hidden = false; loginForm.hidden = true; q('#setup').hidden = true; q('#noaccess').hidden = false;
  q('#noaccess-t').textContent = 'You are signed in as ' + S.email + ', but this account is not set up as the owner of this tracker yet.';
}
function setMode(up) {
  signUpMode = up;
  q('#login-h').textContent = up ? 'Create account' : 'Sign in';
  lgGo.textContent = up ? 'Create account' : 'Sign in';
  lgMode.textContent = up ? 'I already have an account' : 'Create account';
  lgPass.autocomplete = up ? 'new-password' : 'current-password';
  lgErr.textContent = '';
}
lgMode.addEventListener('click', () => setMode(!signUpMode));
q('#noaccess-out').addEventListener('click', async () => { await API.signOut(); showLogin(); });

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault(); lgErr.textContent = '';
  const email = lgEmail.value.trim(), pass = lgPass.value;
  if (!/^\S+@\S+\.\S+$/.test(email)) { lgErr.textContent = 'Enter a valid email.'; lgEmail.focus(); return; }
  if (pass.length < 8) { lgErr.textContent = 'The password needs at least 8 characters.'; lgPass.focus(); return; }
  lgGo.disabled = true; lgGo.textContent = 'Please wait…';
  try {
    const session = signUpMode ? await API.signUp(email, pass) : await API.signIn(email, pass);
    if (!session) { lgErr.textContent = 'Account created. Confirm it with the email we sent, then sign in.'; setMode(false); return; }
    await startApp(email);
  } catch (err) {
    lgErr.textContent = /invalid login/i.test(err.message || '') ? 'Wrong email or password.' : API.errText(err);
  } finally { lgGo.disabled = false; lgGo.textContent = signUpMode ? 'Create account' : 'Sign in'; }
});

async function startApp(email) {
  S.email = email || S.email;
  API.cache.set('email', S.email);
  let owner = API.cache.get('owner', false);
  if (navigator.onLine) {
    try { owner = await API.checkOwner(); API.cache.set('owner', owner); }
    catch (e) { if (!API.isNetworkError(e)) { showLogin(); lgErr.textContent = API.errText(e); return; } }
  }
  if (!owner) { showNoAccess(); return; }
  loginEl.hidden = true; appEl.hidden = false;
  S.rows = API.cachedPhones(); loadPhotoCache();
  if (S.rows.length) { recompute(); render(); }
  S.ready = true;
  await refresh();
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* app still works online */ });
  if (!API.configured) { loginEl.hidden = false; loginForm.hidden = true; q('#setup').hidden = false; return; }
  API.sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && S.ready) showLogin(); });
  let session = null;
  try { session = await API.getSession(); } catch (e) { session = null; }
  if (session) { await startApp(session.user && session.user.email); return; }
  if (!navigator.onLine && API.cachedPhones().length && API.cache.get('owner', false)) { await startApp(S.email); return; }
  showLogin();
}
boot();
