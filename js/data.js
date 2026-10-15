// Pure calculations: no DOM, no network. Takes rows as stored in Supabase (public.phones) and returns display data.

export const SIZES = [64, 128, 256, 512, 1024];
export const STATUS = { in_stock: 'In stock', sold: 'Sold', personal: 'Personal', repair: 'Repair job' };
export const TIERS = [[300, 7], [450, 10], [Infinity, 14]];   // sell-by target in days by cost
export const DUE = 3;                                           // "due" window in days
export const TARGET_PROFIT = 50;                                // used for the max-offer figure in the price check
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export const isoToday = (now = new Date()) =>
  now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

const utc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export const sinceDays = (iso, now = new Date()) =>
  Math.max(0, Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - utc(iso)) / 864e5));

export const dateLabel = (iso) => (iso ? Number(iso.slice(8, 10)) + ' ' + MON[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4) : '');

export function buildUnits(rows, now = new Date()) {
  const units = rows.map((r) => {
    const note = String(r.note || '');
    const paid = num(r.price_paid) || 0;
    const total = num(r.total_cost) || 0;
    const profit = num(r.profit);
    const gb = num(r.gb) || 0;
    const cost = total > 0 ? total : paid;
    const bought = r.bought_on || null;
    const soldOn = r.sold_on || null;
    const status = STATUS[r.status] || 'In stock';
    const issues = [];
    if (status === 'Sold' || status === 'In stock') {
      if (total > 0 && paid > 0 && total < paid) issues.push('Total cost is below price paid');
      if (gb !== 0 && SIZES.indexOf(gb) < 0) issues.push('GB reads ' + gb + ', not a storage size');
      if (status === 'Sold' && profit > cost && !/CONFIRMED/i.test(note)) issues.push('profit is above cost');
    }
    return {
      id: r.id, no: Number(r.no), label: r.model, paid, gb, gb_label: SIZES.indexOf(gb) >= 0 ? gb + ' GB' : '',
      status, db_status: r.status, cost, profit,
      sold: status === 'Sold' ? (num(r.sold_price) !== null ? Number(r.sold_price) : cost + profit) : null,
      est: /^EST\./i.test(note), note,
      bought_iso: bought, bought_label: dateLabel(bought), days: bought ? sinceDays(bought, now) : null,
      sold_iso: soldOn, sold_label: dateLabel(soldOn),
      days_to_sell: bought && soldOn ? Math.max(0, Math.round((utc(soldOn) - utc(bought)) / 864e5)) : null,
      issue: issues.join('; ')
    };
  });
  // A phone with no purchase date counts as at least as old as the next phone that has one.
  const dated = rows.length ? units.filter((u) => u.bought_iso).sort((a, b) => a.no - b.no) : [];
  return units.map((u) => {
    if (u.status !== 'In stock') return Object.assign(u, { target: null, age: null, age_min: false, left: null, state: null });
    const target = TIERS.find((t) => u.cost <= t[0])[1];
    let age = u.days, ageMin = false;
    if (age === null) {
      const next = dated.find((d) => d.no > u.no);
      if (next) { age = sinceDays(next.bought_iso, now); ageMin = true; }
    }
    const left = age === null ? null : target - age;
    const state = left === null ? 'unknown' : left < 0 ? 'over' : left <= DUE ? 'due' : 'ok';
    return Object.assign(u, { target, age, age_min: ageMin, left, state });
  });
}

export function summarize(units) {
  const sold = units.filter((u) => u.status === 'Sold');
  const stock = units.filter((u) => u.status === 'In stock');
  const sum = (a, f) => a.reduce((s, u) => s + f(u), 0);
  const profit = sum(sold, (u) => u.profit);
  const costSold = sum(sold, (u) => u.cost);
  const over = stock.filter((u) => u.state === 'over');
  const timed = sold.filter((u) => u.days_to_sell !== null);
  return {
    total: units.length,
    sold_n: sold.length,
    profit,
    est_profit: sum(sold.filter((u) => u.est), (u) => u.profit),
    avg: sold.length ? profit / sold.length : 0,
    roi: costSold ? profit / costSold : 0,
    stock_n: stock.length,
    stock_cost: sum(stock, (u) => u.cost),
    over_n: over.length,
    over_cost: sum(over, (u) => u.cost),
    timed_n: timed.length,
    avg_days_to_sell: timed.length ? sum(timed, (u) => u.days_to_sell) / timed.length : null
  };
}

export function modelStats(units) {
  const g = {};
  units.filter((u) => u.status === 'Sold').forEach((u) => {
    const m = (g[u.label] = g[u.label] || { label: u.label, n: 0, profit: 0, cost: 0 });
    m.n += 1; m.profit += u.profit; m.cost += u.cost;
  });
  return Object.values(g)
    .map((m) => ({ label: m.label, n: m.n, avg_profit: m.profit / m.n, avg_cost: m.cost / m.n, roi: m.profit / m.cost }))
    .sort((a, b) => b.avg_profit - a.avg_profit);
}

export function mixOf(models) {
  const total = models.reduce((s, m) => s + m.n, 0);
  const ranked = models.slice().sort((a, b) => b.n - a.n || b.avg_profit - a.avg_profit);
  const head = ranked.slice(0, 7), rest = ranked.slice(7);
  const rows = head.map((m) => ({ label: m.label, n: m.n, share: m.n / total, avg_profit: m.avg_profit, other: false, models: 1, total }));
  if (rest.length) {
    const n = rest.reduce((s, m) => s + m.n, 0);
    rows.push({ label: 'Other', n, share: n / total, avg_profit: rest.reduce((s, m) => s + m.avg_profit * m.n, 0) / n, other: true, models: rest.length, total });
  }
  return rows;
}

export function priceTable(units) {
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const g = {};
  const add = (key, u, gb) => { (g[key] = g[key] || { key, label: u.label, gb_label: gb, a: [] }).a.push(u); };
  units.filter((u) => u.status === 'Sold').forEach((u) => {
    add(slug(u.label), u, '');
    if (u.gb_label) add(slug(u.label) + '-' + parseInt(u.gb_label, 10), u, u.gb_label);
  });
  const mean = (a, f) => a.reduce((s, u) => s + f(u), 0) / a.length;
  return Object.values(g).map((m) => {
    const a = m.a;
    const paid = a.filter((u) => u.paid > 0);
    const last = a.reduce((x, u) => (u.no > x.no ? u : x), a[0]);
    const avgSold = mean(a, (u) => u.sold);
    const extra = paid.length ? mean(paid, (u) => Math.max(0, u.cost - u.paid)) : 0;
    return {
      key: m.key, label: m.label, gb_label: m.gb_label, n: a.length,
      avg_sold: avgSold, min_sold: Math.min.apply(null, a.map((u) => u.sold)), max_sold: Math.max.apply(null, a.map((u) => u.sold)),
      avg_cost: mean(a, (u) => u.cost), avg_profit: mean(a, (u) => u.profit), avg_extra: extra,
      est_n: a.filter((u) => u.est).length, last_sold: last.sold, last_no: last.no,
      target: TARGET_PROFIT, max_offer: Math.max(0, avgSold - extra - TARGET_PROFIT)
    };
  });
}

export const flagsOf = (units) => units.filter((u) => u.issue).map((u) => ({ no: u.no, label: u.label, status: u.status, issue: u.issue }));

// Sorting used by the phone list: soonest deadline first, unknown ages last.
export const byUrgency = (a, b) => (a.left === null) - (b.left === null) || a.left - b.left || b.cost - a.cost || b.no - a.no;

export const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// Accepts "12", "12.5", "12,5", "€ 1 200,50"; returns a number or null.
export function parseMoney(s) {
  const t = String(s === null || s === undefined ? '' : s).replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}
