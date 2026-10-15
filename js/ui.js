// Small DOM + formatting helpers shared by the app: elements, money, bottom sheets, toasts.
export const $ = (s, r = document) => r.querySelector(s);

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};
export const svgEl = (tag, attrs) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
  return e;
};

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const int = (v) => nf.format(Math.round(v));
export const money = (v) => '€' + nf.format(Math.round(Math.abs(v)));
export const signed = (v) => (Math.round(v) < 0 ? '−' : '+') + money(v);
export const pct = (v) => Math.round(v * 100) + '%';
export const money2 = (v) => '€' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const GLYPH = '<svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true"><rect x="3" y="1.5" width="20" height="27" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="9.5" y="4" width="7" height="2.2" rx="1.1" fill="currentColor"/></svg>';
const X_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

// ---- toast ----
let toastTimer = 0;
export function toast(msg, bad) {
  const host = $('#toast-host');
  host.replaceChildren();
  const t = el('div', 'ft-toast' + (bad ? ' bad' : ''), msg);
  host.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), bad ? 5200 : 2800);
}

// ---- bottom sheet (one at a time) ----
let current = null;
export function closeSheet() { if (current) current.close(); }
export const sheetOpen = () => Boolean(current);

export function openSheet(title, build, opts) {
  const o = opts || {};
  closeSheet();
  const ov = el('div', 'ft-ov');
  const sh = el('div', 'gl ft-sheet');
  sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
  const sb = el('div', 'ft-sb');
  const head = el('div', 'ft-sh');
  const h = el('h2', '', title);
  const x = el('button', 'ft-x'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.innerHTML = X_ICON;
  head.append(h, x);
  sb.append(el('div', 'ft-grab'), head);
  sh.append(sb); ov.append(sh);
  $('#ov-host').append(ov);
  document.documentElement.classList.add('lock');
  const opener = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    ov.remove();
    current = null;
    document.documentElement.classList.remove('lock');
    if (o.onClose) o.onClose();
    if (opener && opener.focus && document.contains(opener)) { try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  };
  x.addEventListener('click', close);
  if (!o.sticky) ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  current = { close };
  build(sb, close, (t) => { h.textContent = t; sh.setAttribute('aria-label', t); });
  return { close, body: sb };
}

// Two-tap guard for destructive buttons: first tap arms it, second tap within 4 s runs it.
export function armed(btn, armedText, fn) {
  const label = btn.textContent;
  let timer = 0, on = false;
  btn.addEventListener('click', () => {
    if (!on) {
      on = true; btn.textContent = armedText;
      timer = setTimeout(() => { on = false; btn.textContent = label; }, 4000);
      return;
    }
    clearTimeout(timer); on = false; btn.textContent = label;
    fn();
  });
}

export function field(label, input) {
  const l = el('label', 'ft-fld');
  l.append(el('span', '', label), input);
  return l;
}
export function input(type, attrs) {
  const i = el('input');
  i.type = type;
  Object.keys(attrs || {}).forEach((k) => { if (attrs[k] === true) i.setAttribute(k, ''); else if (attrs[k] !== false && attrs[k] != null) i.setAttribute(k, attrs[k]); });
  return i;
}
