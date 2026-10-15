// Supabase access + on-device cache. Everything the UI needs from the network goes through here.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const sb = configured && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null;

// ---- cache (localStorage, always wrapped: it can be missing or full) ----
const K = 'ft1.';
export const cache = {
  get(key, fallback = null) { try { const v = localStorage.getItem(K + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
  set(key, val) { try { localStorage.setItem(K + key, JSON.stringify(val)); return true; } catch (e) { return false; } },
  del(key) { try { localStorage.removeItem(K + key); } catch (e) { /* ignore */ } },
  clear() { try { Object.keys(localStorage).filter((k) => k.indexOf(K) === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ } }
};

export const isNetworkError = (e) => {
  const m = String((e && (e.message || e.details)) || e || '').toLowerCase();
  return !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|fetch failed/.test(m);
};
export const errText = (e) => {
  if (isNetworkError(e)) return 'No connection. Try again when you are online.';
  const m = (e && (e.message || e.details)) || String(e);
  if (/violates check constraint/i.test(m)) return 'The numbers do not pass the database checks. Review the form.';
  if (/duplicate key/i.test(m)) return 'That stock number already exists.';
  if (/row-level security|permission denied/i.test(m)) return 'This account has no write access.';
  return m;
};

// ---- auth ----
export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data.session;   // null when the project still requires e-mail confirmation
}
export async function signOut() {
  try { await sb.auth.signOut(); } catch (e) { /* offline: local session is cleared anyway */ }
  cache.clear();
}
export async function checkOwner() {
  const { data, error } = await sb.rpc('is_owner');
  if (error) throw error;
  return data === true;
}

// ---- phones ----
export async function fetchPhones() {
  const { data, error } = await sb.from('phones').select('*').order('no', { ascending: true }).limit(5000);
  if (error) throw error;
  cache.set('phones', data);
  return data;
}
export const cachedPhones = () => cache.get('phones', []);

export async function insertPhone(values) {
  const { data, error } = await sb.from('phones').insert(values).select().single();
  if (error) throw error;
  return data;
}
export async function updatePhone(id, values) {
  const { data, error } = await sb.from('phones').update(values).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
export async function deletePhone(id) {
  const { error } = await sb.from('phones').delete().eq('id', id);
  if (error) throw error;
}

// ---- photos: kept in their own table; the list view only needs the in-stock ones ----
// cache layout: ft1.photos = { "<phone_id>": { u: updated_at, d: dataUrl } }
export const cachedPhotos = () => cache.get('photos', {});

export async function syncPhotos(wantedIds) {
  const have = cachedPhotos();
  const { data: index, error } = await sb.from('phone_photos').select('phone_id, updated_at').limit(5000);
  if (error) throw error;
  const wanted = new Set(wantedIds.map(String));
  const next = {};
  const need = [];
  index.forEach((r) => {
    const id = String(r.phone_id);
    if (!wanted.has(id)) return;
    if (have[id] && have[id].u === r.updated_at) next[id] = have[id]; else need.push(r.phone_id);
  });
  for (let i = 0; i < need.length; i += 6) {
    const { data, error: e2 } = await sb.from('phone_photos').select('phone_id, photo, updated_at').in('phone_id', need.slice(i, i + 6));
    if (e2) throw e2;
    data.forEach((r) => { next[String(r.phone_id)] = { u: r.updated_at, d: r.photo }; });
  }
  cache.set('photos', next);
  return next;
}
export async function fetchPhoto(id) {
  const { data, error } = await sb.from('phone_photos').select('photo, updated_at').eq('phone_id', id).maybeSingle();
  if (error) throw error;
  return data ? { u: data.updated_at, d: data.photo } : null;
}
export async function savePhoto(id, dataUrl) {
  const { data, error } = await sb.from('phone_photos').upsert({ phone_id: id, photo: dataUrl }).select('updated_at').single();
  if (error) throw error;
  return { u: data.updated_at, d: dataUrl };
}
export async function removePhoto(id) {
  const { error } = await sb.from('phone_photos').delete().eq('phone_id', id);
  if (error) throw error;
}
