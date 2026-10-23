'use strict';
// Client Vault — all client data is encrypted in the browser (AES-256-GCM) before it is
// stored or uploaded. The server only ever sees ciphertext.
//
// Key design: a random 256-bit data key (DEK) encrypts every record. The DEK itself is
// encrypted ("wrapped") with a key derived from the master password (PBKDF2-SHA256).
// Changing the master password only re-wraps the DEK.
(() => {
const CFG = window.CLIENT_VAULT_CONFIG || {};
const DEMO = !CFG.apiKey || CFG.apiKey === 'demo';
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');

// ---------- small utils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const uid = () => [...rand(9)].map(b => b.toString(16).padStart(2, '0')).join('');
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function readLS(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function writeLS(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const fmtDate = t => t ? new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const fmtTime = t => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- local key-value store (IndexedDB) ----------
const store = (() => {
  let p;
  const db = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('client-vault', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => db().then(d => new Promise((res, rej) => {
    const t = d.transaction('kv', mode); const r = fn(t.objectStore('kv'));
    t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error);
  }));
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
})();

// ---------- crypto ----------
async function passwordKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const dataKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function encJSON(key, obj) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
async function decJSON(key, { iv, ct }) {
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct))));
}
async function wrapDek(pw, raw) {
  const salt = rand(16), iv = rand(12);
  const k = await passwordKey(pw, salt, ITER);
  const w = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, raw);
  return { salt: toB64(salt), iter: ITER, wiv: toB64(iv), wkey: toB64(new Uint8Array(w)) };
}
async function unwrapDek(pw, v) {
  const k = await passwordKey(pw, fromB64(v.salt), +v.iter);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(v.wiv) }, k, fromB64(v.wkey)));
}

// ---------- backends ----------
class AuthError extends Error {}
const AUTH_MSG = {
  EMAIL_NOT_FOUND: 'Wrong email or password.', INVALID_PASSWORD: 'Wrong email or password.',
  INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.', INVALID_EMAIL: 'That email address looks wrong.',
  USER_DISABLED: 'This account is disabled.', TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Try again later.',
};

function firebaseBackend() {
  const FS = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(CFG.projectId)}/databases/(default)/documents`;
  let auth = readLS('cv-auth');
  const saveAuth = a => { auth = a; writeLS('cv-auth', a && { uid: a.uid, email: a.email, refreshToken: a.refreshToken }); };

  async function post(url, body, form) {
    const r = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body) : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const code = String(j.error?.message || r.status).split(' ')[0]; throw Object.assign(new Error(AUTH_MSG[code] || code), { code }); }
    return j;
  }
  async function token() {
    if (!auth) throw new AuthError('Signed out');
    if (auth.idToken && Date.now() < auth.exp - 60000) return auth.idToken;
    try {
      const j = await post(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`, { grant_type: 'refresh_token', refresh_token: auth.refreshToken }, true);
      saveAuth({ ...auth, idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + j.expires_in * 1000 });
      return auth.idToken;
    } catch (e) { if (e.code) throw new AuthError('Please sign in again.'); throw e; }
  }
  async function fs(method, path, body) {
    const r = await fetch(FS + path, { method,
      headers: { Authorization: 'Bearer ' + await token(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404 && method === 'GET') return null;
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new AuthError('Please sign in again.');
    if (r.status === 403) throw new Error('Access denied. Check the Firestore security rules in the setup guide.');
    if (!r.ok) throw new Error(j.error?.message || 'Server error ' + r.status);
    return j;
  }
  const toFields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) }]));
  const fromDoc = d => { const o = { id: d.name.split('/').pop() }; for (const [k, v] of Object.entries(d.fields || {})) o[k] = v.integerValue !== undefined ? +v.integerValue : v.stringValue; return o; };
  const mask = keys => keys.map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const base = () => `/users/${encodeURIComponent(auth.uid)}`;

  return {
    demo: false,
    get user() { return auth; },
    async signIn(email, password) {
      const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CFG.apiKey}`, { email, password, returnSecureToken: true });
      saveAuth({ uid: j.localId, email: j.email, refreshToken: j.refreshToken, idToken: j.idToken, exp: Date.now() + j.expiresIn * 1000 });
    },
    signOut() { saveAuth(null); },
    async getVault() { const d = await fs('GET', base()); return d && fromDoc(d); },
    async putVault(f) { await fs('PATCH', `${base()}?${mask(Object.keys(f))}`, { fields: toFields(f) }); },
    async listClients() {
      const out = []; let pt = '';
      do {
        const j = await fs('GET', `${base()}/clients?pageSize=300${pt ? '&pageToken=' + encodeURIComponent(pt) : ''}`);
        (j?.documents || []).forEach(d => out.push(fromDoc(d))); pt = j?.nextPageToken;
      } while (pt);
      return out;
    },
    async putClient(id, rec) { await fs('PATCH', `${base()}/clients/${id}`, { fields: toFields(rec) }); },
    async delClient(id) { await fs('DELETE', `${base()}/clients/${id}`); },
  };
}

// Demo mode: same interface, stored in this browser only. Used until Firebase is configured.
function demoBackend() {
  return {
    demo: true,
    user: { uid: 'demo', email: 'Demo mode' },
    async signIn() {}, signOut() {},
    async getVault() { return (await store.get('demo:vault')) || null; },
    async putVault(f) { await store.set('demo:vault', { ...((await store.get('demo:vault')) || {}), ...f }); },
    async listClients() { return Object.values((await store.get('demo:clients')) || {}); },
    async putClient(id, rec) { const m = (await store.get('demo:clients')) || {}; m[id] = { id, ...rec }; await store.set('demo:clients', m); },
    async delClient(id) { const m = (await store.get('demo:clients')) || {}; delete m[id]; await store.set('demo:clients', m); },
  };
}
const DB = DEMO ? demoBackend() : firebaseBackend();
const cacheKey = () => 'cache:' + DB.user.uid;

// ---------- client fields ----------
const TYPES = ['Individual', 'HUF', 'Proprietorship', 'Partnership Firm', 'LLP', 'Company', 'Trust', 'AOP / BOI', 'Other'];
const SECTIONS = [
  { title: 'Basic details', fields: [
    { k: 'name', label: 'Name', ph: 'Full or business name' },
    { k: 'type', label: 'Type', kind: 'select', options: TYPES },
    { k: 'fileNo', label: 'File no.', ph: 'Optional' },
    { k: 'mobile', label: 'Mobile', input: 'tel', link: 'tel:' },
    { k: 'email', label: 'Email', input: 'email', link: 'mailto:' },
    { k: 'dob', label: 'DOB / DOI', input: 'date' },
    { k: 'address', label: 'Address', kind: 'textarea' },
  ] },
  { title: 'Identity', fields: [
    { k: 'pan', label: 'PAN', up: true, max: 10, check: 'pan', ph: 'ABCDE1234F' },
    { k: 'aadhaar', label: 'Aadhaar', input: 'numeric', max: 14, check: 'aadhaar', secret: true, ph: '12 digits' },
    { k: 'tan', label: 'TAN', up: true, max: 10, check: 'tan' },
  ] },
  { title: 'Income Tax portal', url: 'https://eportal.incometax.gov.in/iec/foservices/#/login', fields: [
    { k: 'itUser', label: 'User ID', up: true, ph: 'Usually the PAN' },
    { k: 'itPass', label: 'Password', secret: true },
  ] },
  { title: 'GST portal', url: 'https://services.gst.gov.in/services/login', fields: [
    { k: 'gstin', label: 'GSTIN', up: true, max: 15, check: 'gstin', ph: '24ABCDE1234F1Z5' },
    { k: 'gstUser', label: 'Username' },
    { k: 'gstPass', label: 'Password', secret: true },
  ] },
  { title: 'TRACES', url: 'https://www.tdscpc.gov.in/app/login.xhtml', fields: [
    { k: 'tracesUser', label: 'User ID' },
    { k: 'tracesPass', label: 'Password', secret: true },
  ] },
  { title: 'Bank', fields: [
    { k: 'bankName', label: 'Bank' },
    { k: 'bankAcc', label: 'Account no.', input: 'numeric' },
    { k: 'ifsc', label: 'IFSC', up: true, max: 11 },
  ] },
  { title: 'Notes', fields: [{ k: 'notes', label: 'Notes', kind: 'textarea', bare: true, ph: 'Anything else about this client' }] },
];
const UPPER = new Set(SECTIONS.flatMap(s => s.fields).filter(f => f.up).map(f => f.k));
const CHECKS = {
  pan: v => /^[A-Z]{5}\d{4}[A-Z]$/.test(v),
  tan: v => /^[A-Z]{4}\d{5}[A-Z]$/.test(v),
  gstin: v => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v),
  aadhaar: v => /^\d{12}$/.test(v.replace(/\s/g, '')),
};
const CHECK_MSG = { pan: 'PAN should look like ABCDE1234F', tan: 'TAN should look like ABCD12345E', gstin: 'GSTIN should be 15 characters, e.g. 24ABCDE1234F1Z5', aadhaar: 'Aadhaar should be 12 digits' };

// ---------- icons ----------
const I = {
  back: '<svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  lockSm: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>',
  unlockSm: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  chev: '<svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true"><path d="m1 1 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---------- session state ----------
// S = { key, raw, vault, meta:{customFields}, clients:[], recs:Map, offline, syncedAt }
let S = null, PV = null, Q = '', cur = { v: 'list' }, ACT = {};
const settings = Object.assign({ lockAfter: 60, lastBackup: 0 }, readLS('cv-settings'));
const saveSettings = () => writeLS('cv-settings', settings);

app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && ACT[t.dataset.act]) { e.preventDefault(); ACT[t.dataset.act](t, e); }
});

const bar = ({ left = '', title = '', right = '' }) =>
  `<header class="bar"><div class="bar-row"><div>${left}</div><div class="bar-t">${esc(title)}</div><div class="bar-r">${right}</div></div></header>`;
const backBtn = (label, act) => `<button class="nav-btn back" data-act="${act}">${I.back}<span>${esc(label)}</span></button>`;
const initials = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const hue = n => { let h = 0; for (const ch of n || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const avatar = (n, big) => `<div class="avatar${big ? ' big' : ''}" style="--h:${hue(n)}" aria-hidden="true">${esc(initials(n))}</div>`;

function go(v, arg, keepScroll) {
  cur = { v, arg }; ACT = {};
  ({ list: renderList, detail: renderDetail, edit: renderEdit, settings: renderSettings, changepw: renderChangePw, import: renderImport })[v](arg);
  if (!keepScroll) scrollTo(0, 0);
}

// ---------- vault data helpers ----------
async function applyMeta() {
  S.meta = S.vault.metaCt ? await decJSON(S.key, { iv: S.vault.metaIv, ct: S.vault.metaCt }) : {};
  S.meta.customFields = Array.isArray(S.meta.customFields) ? S.meta.customFields : [];
}
async function applyRecs(recs) {
  const prev = new Map(S.clients.map(c => [c.id, c]));
  const clients = [], map = new Map();
  for (const r of recs) {
    map.set(r.id, r);
    const old = prev.get(r.id), oldRec = S.recs.get(r.id);
    if (old && oldRec && oldRec.ct === r.ct) { clients.push(old); continue; }
    try { const c = await decJSON(S.key, r); c.id = r.id; c.custom ||= {}; c.extra ||= []; clients.push(c); }
    catch { console.warn('Could not decrypt record', r.id); }
  }
  S.clients = clients; S.recs = map;
}
const writeCache = () => store.set(cacheKey(), { vault: S.vault, clients: [...S.recs.values()] }).catch(() => {});
function canWrite() { if (S.offline) { toast("You're offline — changes can't be saved right now."); return false; } return true; }

async function saveClient(c) {
  const e = await encJSON(S.key, c);
  const rec = { iv: e.iv, ct: e.ct, updated: c.updated };
  await DB.putClient(c.id, rec);
  S.recs.set(c.id, { id: c.id, ...rec });
  const i = S.clients.findIndex(x => x.id === c.id);
  i < 0 ? S.clients.push(c) : (S.clients[i] = c);
  writeCache();
}
async function deleteClient(id) {
  await DB.delClient(id);
  S.recs.delete(id); S.clients = S.clients.filter(c => c.id !== id);
  writeCache();
}
async function saveMeta() {
  const e = await encJSON(S.key, S.meta);
  await DB.putVault({ metaIv: e.iv, metaCt: e.ct });
  Object.assign(S.vault, { metaIv: e.iv, metaCt: e.ct });
  writeCache();
}

let syncing = false;
async function sync() {
  if (!S || syncing) return;
  syncing = true;
  try {
    const [v, recs] = await Promise.all([DB.getVault(), DB.listClients()]);
    if (!S) return;
    if (v) { S.vault = v; await applyMeta(); }
    await applyRecs(recs);
    S.offline = false; S.syncedAt = Date.now(); writeCache();
    if (cur.v === 'list' || cur.v === 'detail') go(cur.v, cur.arg, true);
  } catch (e) {
    if (e instanceof AuthError) return signOut(e.message);
  } finally { syncing = false; }
}

// ---------- auto-lock ----------
let lastActive = Date.now(), hiddenAt = 0, suppressLock = false;
['pointerdown', 'keydown', 'input'].forEach(ev => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true }));
const idleLimit = () => (settings.lockAfter || 60) * 1000;
setInterval(() => { if (S && Date.now() - lastActive > idleLimit()) lock(); }, 5000);
document.addEventListener('visibilitychange', () => {
  if (!S) return;
  if (document.hidden) {
    hiddenAt = Date.now();
    if (suppressLock) return;
    document.body.classList.add('cover');
    if (settings.lockAfter === 0) lock();
  } else {
    document.body.classList.remove('cover');
    if (suppressLock) { suppressLock = false; return; }
    if (Date.now() - hiddenAt >= settings.lockAfter * 1000) lock();
    else if (cur.v !== 'edit') sync();
  }
});
function lock() {
  S = null; Q = ''; ACT = {};
  document.body.classList.remove('cover');
  openVault();
}
async function signOut(msg) {
  S = null; PV = null;
  await store.del(cacheKey()).catch(() => {});
  DB.signOut();
  renderSignIn(msg);
}

// ---------- entry screens ----------
function lockScreen(title, sub, inner) {
  ACT = {};
  app.innerHTML = `<main class="lock"><div class="lock-icon">${I.lock}</div><h1>${esc(title)}</h1><p class="sub">${sub}</p>${inner}</main>`;
}
function renderLoading(msg) {
  ACT = {};
  app.innerHTML = `<main class="lock"><div class="spinner" aria-hidden="true"></div><p class="sub">${esc(msg)}</p></main>`;
}
function renderError(msg, retry) {
  lockScreen('Can’t connect', esc(msg), `<div class="stack"><button class="btn primary" data-act="retry">Try again</button></div>`);
  ACT.retry = retry;
}

function renderSignIn(msg) {
  lockScreen('Client Vault', 'Sign in to your vault account.', `
    <form id="f" class="stack" autocomplete="on">
      <input class="field" id="em" type="email" placeholder="Email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" required>
      <input class="field" id="pw" type="password" placeholder="Account password" autocomplete="current-password" required>
      <button class="btn primary" id="go" type="submit">Sign in</button>
      <p class="err" id="err" role="alert">${esc(msg || '')}</p>
      <p class="hint">This is your Firebase account (created in the setup guide). Your client data is unlocked separately with your master password.</p>
    </form>`);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#go'); btn.disabled = true; btn.textContent = 'Signing in…';
    try { await DB.signIn($('#em').value.trim(), $('#pw').value); openVault(); }
    catch (err) {
      btn.disabled = false; btn.textContent = 'Sign in';
      $('#err').textContent = err instanceof TypeError ? 'No internet connection.' : err.message;
    }
  };
}

async function openVault() {
  if (!DB.user) return renderSignIn();
  renderLoading('Connecting…');
  let vault = null, offline = false;
  try { vault = await DB.getVault(); }
  catch (e) {
    if (e instanceof AuthError) return signOut(e.message);
    const c = await store.get(cacheKey()).catch(() => null);
    if (!c) return renderError(e instanceof TypeError ? 'No internet connection, and this device has no saved copy yet.' : e.message, openVault);
    vault = c.vault; offline = true;
  }
  if (!vault || !vault.wkey) return renderCreate();
  PV = { vault, offline };
  renderUnlock();
}

function renderCreate() {
  lockScreen('Create master password', 'This password encrypts every client record on your device before it is uploaded. Nobody — not Google, not us — can read your data without it.', `
    <form id="f" class="stack" autocomplete="off">
      <input class="field" id="p1" type="password" placeholder="Master password" autocomplete="new-password">
      <input class="field" id="p2" type="password" placeholder="Confirm master password" autocomplete="new-password">
      <button class="btn primary" id="go" type="submit">Create vault</button>
      <p class="err" id="err" role="alert"></p>
      <p class="hint">Use at least 10 characters, and make it <b>different from your account password</b>. It cannot be recovered — if you forget it, the data is lost. Write it down somewhere safe.</p>
    </form>`);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const a = $('#p1').value, b = $('#p2').value, err = $('#err');
    if (a.length < 10) return (err.textContent = 'Use at least 10 characters.');
    if (a !== b) return (err.textContent = 'Passwords don’t match.');
    const btn = $('#go'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const raw = rand(32), key = await dataKey(raw);
      const m = await encJSON(key, { customFields: [] });
      const vault = { ...(await wrapDek(a, raw)), metaIv: m.iv, metaCt: m.ct, created: Date.now() };
      await DB.putVault(vault);
      S = { key, raw, vault, meta: { customFields: [] }, clients: [], recs: new Map(), offline: false, syncedAt: Date.now() };
      PV = { vault, offline: false };
      writeCache(); lastActive = Date.now();
      go('list');
    } catch (ex) {
      btn.disabled = false; btn.textContent = 'Create vault';
      err.textContent = ex instanceof TypeError ? 'No internet connection.' : ex.message;
    }
  };
}

let fails = +readLS('cv-fails') || 0, until = +readLS('cv-until') || 0;
function renderUnlock() {
  lockScreen('Client Vault', DEMO ? 'Demo mode — enter your master password.' : `Signed in as ${esc(DB.user.email)}`, `
    <form id="f" class="stack" autocomplete="off">
      <input class="field" id="pw" type="password" placeholder="Master password" autocomplete="current-password" enterkeyhint="go">
      <button class="btn primary" id="go" type="submit">Unlock</button>
      <p class="err" id="err" role="alert"></p>
    </form>`);
  const pw = $('#pw'), btn = $('#go'), err = $('#err');
  const wait = () => {
    if (!document.body.contains(btn)) return;
    const s = Math.ceil((until - Date.now()) / 1000);
    if (s > 0) { btn.disabled = true; err.textContent = `Too many wrong attempts. Try again in ${s}s.`; setTimeout(wait, 1000); }
    else if (btn.disabled && btn.textContent === 'Unlock') { btn.disabled = false; err.textContent = ''; }
  };
  wait();
  $('#f').onsubmit = async e => {
    e.preventDefault();
    if (Date.now() < until || !pw.value) return;
    btn.disabled = true; btn.textContent = 'Unlocking…';
    let raw;
    try { raw = await unwrapDek(pw.value, PV.vault); }
    catch {
      fails++; if (fails >= 5) until = Date.now() + Math.min(300, 15 * 2 ** (fails - 5)) * 1000;
      writeLS('cv-fails', fails); writeLS('cv-until', until);
      pw.value = ''; btn.textContent = 'Unlock'; btn.disabled = false; err.textContent = 'Wrong master password.';
      return wait();
    }
    fails = 0; until = 0; writeLS('cv-fails', 0); writeLS('cv-until', 0);
    btn.textContent = 'Loading clients…';
    let offline = PV.offline, recs = null;
    if (!offline) {
      try { recs = await DB.listClients(); }
      catch (ex) { if (ex instanceof AuthError) return signOut(ex.message); offline = true; }
    }
    if (offline) recs = ((await store.get(cacheKey()).catch(() => null)) || {}).clients || [];
    S = { key: await dataKey(raw), raw, vault: PV.vault, meta: {}, clients: [], recs: new Map(), offline, syncedAt: offline ? 0 : Date.now() };
    try { await applyMeta(); } catch { S.meta = { customFields: [] }; }
    await applyRecs(recs);
    if (!offline) writeCache();
    lastActive = Date.now();
    go('list');
  };
}

// ---------- list ----------
function haystack(c) {
  const parts = [c.name, c.pan, c.gstin, c.mobile, c.email, c.fileNo, c.tan, c.itUser, c.gstUser, c.type];
  for (const f of S.meta.customFields) if (!f.secret && c.custom[f.id]) parts.push(c.custom[f.id]);
  for (const x of c.extra) if (!x.secret) parts.push(x.label, x.value);
  return parts.filter(Boolean).join(' ').toLowerCase();
}
function renderList() {
  let banner = '';
  if (DB.demo) banner = `<div class="banner info">Demo mode: data is kept in this browser only. Follow the setup guide to sync securely across your devices.</div>`;
  else if (S.offline) banner = `<button class="banner" data-act="sync">You’re offline — showing the saved copy. Changes can’t be saved. Tap to retry.</button>`;
  app.innerHTML = bar({
    left: `<button class="nav-btn" data-act="settings">Settings</button>`,
    right: `<button class="nav-btn" data-act="add" aria-label="Add client">${I.plus}</button>`,
  }) + `
    <h1 class="large">Clients</h1>
    <div class="search">${I.search}<input id="q" type="search" placeholder="Name, PAN, GSTIN, mobile…" value="${esc(Q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search clients"></div>
    ${banner}<div id="list"></div>`;
  drawList();
  $('#q').oninput = e => { Q = e.target.value; drawList(); };
  ACT.settings = () => go('settings');
  ACT.add = () => { if (canWrite()) go('edit', null); };
  ACT.open = t => go('detail', t.dataset.id);
  ACT.sync = () => sync();
}
function drawList() {
  const q = Q.trim().toLowerCase();
  const all = [...S.clients].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
  const shown = q ? all.filter(c => haystack(c).includes(q)) : all;
  const el = $('#list');
  if (!all.length) {
    el.innerHTML = `<div class="empty"><b>No clients yet</b>Tap + to add your first client.</div>`; return;
  }
  if (!shown.length) { el.innerHTML = `<div class="empty"><b>No matches</b>Nothing found for “${esc(Q)}”.</div>`; return; }
  const groups = new Map();
  for (const c of shown) { const L = /[A-Z]/i.test(c.name?.[0]) ? c.name[0].toUpperCase() : '#'; (groups.get(L) || groups.set(L, []).get(L)).push(c); }
  let html = '';
  for (const [L, cs] of groups) {
    html += `<div class="group-h">${esc(L)}</div><div class="group">` + cs.map(c => {
      const sub = [c.pan, c.gstin].filter(Boolean).join(' · ') || c.mobile || c.type || '';
      return `<button class="row lrow" data-act="open" data-id="${esc(c.id)}">${avatar(c.name)}<span class="lt"><b>${esc(c.name)}</b><small>${esc(sub)}</small></span><span class="chev">${I.chev}</span></button>`;
    }).join('') + `</div>`;
  }
  const synced = S.syncedAt && !DB.demo ? ` · synced ${fmtTime(S.syncedAt)}` : '';
  html += `<p class="foot center" style="margin-top:-12px">${shown.length} of ${all.length} client${all.length === 1 ? '' : 's'}${synced}</p>`;
  el.innerHTML = html;
}

// ---------- detail ----------
function renderDetail(id) {
  const c = S.clients.find(x => x.id === id);
  if (!c) return go('list');
  const vals = [];
  const row = (label, value, o = {}) => {
    const i = vals.push({ label, raw: value, text: o.text ?? value, mask: o.secret ? o.mask || '••••••••' : null }) - 1;
    const shown = o.secret ? esc(vals[i].mask) : o.link ? `<a href="${esc(o.link + value)}">${esc(vals[i].text)}</a>` : esc(vals[i].text);
    return `<div class="row"><div class="dcol"><div class="dlabel">${esc(label)}</div><div class="dval${o.mono ? ' mono' : ''}" id="v${i}">${shown}</div></div>${
      o.secret ? `<button class="ibtn" data-act="reveal" data-i="${i}" aria-label="Show ${esc(label)}">${I.eye}</button>` : ''
    }<button class="ibtn" data-act="copy" data-i="${i}" aria-label="Copy ${esc(label)}">${I.copy}</button></div>`;
  };
  let html = bar({ left: backBtn('Clients', 'back'), right: `<button class="nav-btn" data-act="edit">Edit</button>` });
  html += `<div class="hero">${avatar(c.name, true)}<h2>${esc(c.name)}</h2><p>${esc([c.type, c.fileNo && 'File ' + c.fileNo].filter(Boolean).join(' · '))}</p></div>`;
  for (const s of SECTIONS) {
    const rows = s.fields.filter(f => f.k !== 'name' && f.k !== 'type' && f.k !== 'fileNo' && c[f.k]).map(f => {
      let v = c[f.k], o = { secret: f.secret, mono: f.up || f.check || f.input === 'numeric' || f.input === 'tel', link: f.link };
      if (f.k === 'aadhaar') { const d = v.replace(/\D/g, ''); if (d.length === 12) { o.text = d.replace(/(\d{4})(?=\d)/g, '$1 '); o.mask = '•••• •••• ' + d.slice(-4); } }
      if (f.input === 'date') o.text = fmtDate(v);
      return row(f.label, v, o);
    });
    if (rows.length) html += `<div class="group-h"><span>${esc(s.title)}</span>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener noreferrer">Open portal ${I.ext}</a>` : ''}</div><div class="group">${rows.join('')}</div>`;
  }
  const extra = [
    ...S.meta.customFields.filter(f => c.custom[f.id]).map(f => row(f.label, c.custom[f.id], { secret: f.secret })),
    ...c.extra.filter(x => x.value).map(x => row(x.label || 'Other', x.value, { secret: x.secret })),
  ];
  if (extra.length) html += `<div class="group-h">Other details</div><div class="group">${extra.join('')}</div>`;
  html += `<p class="meta">Added ${fmtDate(c.created)}${c.updated && c.updated !== c.created ? ' · Updated ' + fmtDate(c.updated) : ''}</p>`;
  app.innerHTML = html;

  const timers = {};
  ACT.back = () => go('list');
  ACT.edit = () => { if (canWrite()) go('edit', id); };
  ACT.copy = async t => {
    const v = vals[+t.dataset.i];
    try { await navigator.clipboard.writeText(v.raw); toast(`${v.label} copied`); } catch { toast('Couldn’t copy'); }
  };
  ACT.reveal = t => {
    const i = +t.dataset.i, v = vals[i], el = $('#v' + i), hidden = el.textContent === v.mask;
    el.textContent = hidden ? v.text : v.mask;
    t.innerHTML = hidden ? I.eyeOff : I.eye;
    t.setAttribute('aria-label', (hidden ? 'Hide ' : 'Show ') + v.label);
    clearTimeout(timers[i]);
    if (hidden) timers[i] = setTimeout(() => { if (document.body.contains(el)) { el.textContent = v.mask; t.innerHTML = I.eye; } }, 30000);
  };
}

// ---------- edit ----------
const xrow = (x = {}) => `<div class="xrow" data-secret="${x.secret ? 1 : 0}">
  <button type="button" class="rm" data-act="xdel" aria-label="Remove field"></button>
  <input class="finput xl" placeholder="Label" value="${esc(x.label)}" autocomplete="off" aria-label="Field label">
  <input class="finput xv${x.secret ? ' masked' : ''}" placeholder="Value" value="${esc(x.value)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Field value">
  <button type="button" class="ibtn" data-act="xsec" aria-label="Mark as secret">${x.secret ? I.lockSm : I.unlockSm}</button></div>`;

function fieldHTML(f, v) {
  const attrs = `data-k="${f.k}" aria-label="${esc(f.label)}" autocomplete="off" autocorrect="off" spellcheck="false"${f.up ? ' autocapitalize="characters"' : f.k === 'name' || f.k === 'address' || f.k === 'notes' || f.k === 'bankName' ? '' : ' autocapitalize="off"'}`;
  let input;
  if (f.kind === 'select') input = `<select class="finput" ${attrs}>${f.options.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.kind === 'textarea') input = `<textarea class="finput" ${attrs} placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  else {
    const type = f.input === 'tel' ? 'tel' : f.input === 'email' ? 'email' : f.input === 'date' ? 'date' : 'text';
    input = `<input class="finput${f.up ? ' up' : ''}${f.secret ? ' masked' : ''}" type="${type}" ${attrs}${f.input === 'numeric' ? ' inputmode="numeric"' : ''}${f.max ? ` maxlength="${f.max}"` : ''}${f.check ? ` data-check="${f.check}"` : ''} placeholder="${esc(f.ph || '')}" value="${esc(v)}">`;
  }
  return `<div class="frow">${f.bare ? '' : `<span class="flabel">${esc(f.label)}</span>`}${input}${
    f.secret ? `<button type="button" class="ibtn" data-act="mask" aria-label="Show or hide ${esc(f.label)}">${I.eye}</button>` : ''}${
    f.check ? `<div class="fwarn" hidden>${CHECK_MSG[f.check]}</div>` : ''}</div>`;
}

function renderEdit(id) {
  const orig = id && S.clients.find(x => x.id === id);
  const c = orig ? structuredClone(orig) : { type: 'Individual', custom: {}, extra: [] };
  let html = bar({ left: `<button class="nav-btn" data-act="cancel">Cancel</button>`, title: orig ? 'Edit Client' : 'New Client', right: `<button class="nav-btn strong" data-act="save">${orig ? 'Done' : 'Save'}</button>` });
  html += `<form id="form" autocomplete="off">`;
  for (const s of SECTIONS) html += `<div class="group-h">${esc(s.title)}</div><div class="group">${s.fields.map(f => fieldHTML(f, c[f.k] || '')).join('')}</div>`;
  if (S.meta.customFields.length) html += `<div class="group-h">Custom fields</div><div class="group">${S.meta.customFields.map(f =>
    `<div class="frow"><span class="flabel">${esc(f.label)}</span><input class="finput${f.secret ? ' masked' : ''}" data-c="${esc(f.id)}" value="${esc(c.custom[f.id] || '')}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="${esc(f.label)}">${f.secret ? `<button type="button" class="ibtn" data-act="mask" aria-label="Show or hide">${I.eye}</button>` : ''}</div>`).join('')}</div>`;
  html += `<div class="group-h">Other details</div><div class="group" id="xg">${c.extra.map(xrow).join('')}<button type="button" class="row addrow" data-act="xadd"><span class="plus">+</span>Add field</button></div>`;
  html += `<p class="foot">Use the lock icon to mark a value as secret — it stays hidden until you tap the eye.</p>`;
  if (orig) html += `<div class="group"><button type="button" class="row danger" data-act="del" style="justify-content:center">Delete Client</button></div>`;
  html += `</form>`;
  app.innerHTML = html;

  const form = $('#form');
  form.onsubmit = e => e.preventDefault();
  let dirty = false;
  const check = el => { const w = el.parentElement.querySelector('.fwarn'); const v = el.value.trim().toUpperCase(); w.hidden = !v || CHECKS[el.dataset.check](v); };
  form.addEventListener('input', e => { dirty = true; const el = e.target; if (el.dataset.check && !el.parentElement.querySelector('.fwarn').hidden) check(el); });
  form.addEventListener('focusout', e => { if (e.target.dataset?.check) check(e.target); });
  $$('[data-check]', form).forEach(el => el.value && check(el));
  if (!orig) setTimeout(() => $('[data-k="name"]').focus(), 50);

  ACT.cancel = () => { if (!dirty || confirm('Discard your changes?')) orig ? go('detail', id) : go('list'); };
  ACT.mask = t => { const el = t.parentElement.querySelector('.finput'); const m = el.classList.toggle('masked'); t.innerHTML = m ? I.eye : I.eyeOff; };
  ACT.xadd = t => { t.insertAdjacentHTML('beforebegin', xrow()); dirty = true; t.previousElementSibling.querySelector('.xl').focus(); };
  ACT.xdel = t => { t.closest('.xrow').remove(); dirty = true; };
  ACT.xsec = t => { const r = t.closest('.xrow'); const on = r.dataset.secret !== '1'; r.dataset.secret = on ? 1 : 0; $('.xv', r).classList.toggle('masked', on); t.innerHTML = on ? I.lockSm : I.unlockSm; dirty = true; };
  ACT.del = async () => {
    if (!canWrite() || !confirm(`Delete ${orig.name}? This can’t be undone.`)) return;
    try { await deleteClient(id); toast('Client deleted'); go('list'); } catch (e) { toast(errText(e)); }
  };
  ACT.save = async t => {
    if (!canWrite()) return;
    const d = { ...c, custom: {}, extra: [] };
    $$('[data-k]', form).forEach(el => { let v = el.value.trim(); if (UPPER.has(el.dataset.k)) v = v.toUpperCase(); if (v) d[el.dataset.k] = v; else delete d[el.dataset.k]; });
    $$('[data-c]', form).forEach(el => { const v = el.value.trim(); if (v) d.custom[el.dataset.c] = v; });
    d.extra = $$('.xrow', form).map(r => ({ label: $('.xl', r).value.trim(), value: $('.xv', r).value.trim(), secret: r.dataset.secret === '1' })).filter(x => x.label || x.value);
    if (!d.name) { toast('Name is required'); return $('[data-k="name"]').focus(); }
    if (!d.pan && d.gstin && CHECKS.gstin(d.gstin)) d.pan = d.gstin.slice(2, 12);
    if ($$('.fwarn', form).some(w => !w.hidden) && !confirm('Some IDs don’t look valid. Save anyway?')) return;
    if (d.pan) { const dup = S.clients.find(x => x.id !== c.id && x.pan === d.pan); if (dup && !confirm(`${dup.name} already has PAN ${d.pan}. Save anyway?`)) return; }
    const now = Date.now();
    if (!d.id) { d.id = uid(); d.created = now; }
    d.updated = now;
    t.disabled = true; t.textContent = 'Saving…';
    try { await saveClient(d); toast('Saved'); go('detail', d.id); }
    catch (e) { t.disabled = false; t.textContent = orig ? 'Done' : 'Save'; if (e instanceof AuthError) return signOut(e.message); toast(errText(e)); }
  };
}
const errText = e => e instanceof TypeError ? 'No internet connection — not saved.' : e.message || 'Something went wrong.';

// ---------- settings ----------
function renderSettings() {
  const lockOpts = [[0, 'When I leave the app'], [60, 'After 1 minute'], [300, 'After 5 minutes'], [900, 'After 15 minutes']];
  const cf = S.meta.customFields;
  app.innerHTML = bar({ left: backBtn('Clients', 'back'), title: 'Settings' }) + `
    <div class="group-h">Account</div>
    <div class="group">
      <div class="row"><span class="grow">${DB.demo ? 'Mode' : 'Signed in as'}</span><span class="val">${esc(DB.user.email)}</span></div>
      ${DB.demo ? '' : `<button class="row link" data-act="signout">Sign out of this device</button>`}
    </div>
    <div class="group-h">Security</div>
    <div class="group">
      <label class="row"><span class="grow">Auto-lock</span><select class="plain" id="lockAfter">${lockOpts.map(([v, l]) => `<option value="${v}"${settings.lockAfter === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="row link" data-act="changepw">Change master password</button>
      <button class="row link" data-act="lock">Lock now</button>
    </div>
    <div class="group-h">Custom fields</div>
    <div class="group">
      ${cf.map(f => `<div class="row"><span class="grow">${esc(f.label)}</span>${f.secret ? '<span class="tag">Secret</span>' : ''}<button class="nav-btn" style="color:var(--danger);min-height:0;padding:4px" data-act="cfdel" data-id="${esc(f.id)}">Remove</button></div>`).join('')}
      <div class="row"><input id="cfName" class="finput" placeholder="New field, e.g. MCA login" autocomplete="off" style="padding:0"><button class="toggle" data-act="cfsec" aria-pressed="false">Secret</button><button class="nav-btn strong" style="min-height:0;padding:4px" data-act="cfadd">Add</button></div>
    </div>
    <p class="foot">Custom fields appear on every client. For one-off details, use “Add field” inside a client.</p>
    <div class="group-h">Backup</div>
    <div class="group">
      <button class="row link" data-act="export">Export encrypted backup</button>
      <button class="row link" data-act="import">Import backup</button>
    </div>
    <p class="foot">${settings.lastBackup ? 'Last exported ' + fmtDate(settings.lastBackup) + '. ' : ''}A backup file is encrypted with the master password used when it was made. Keep one in iCloud Drive or Google Drive.</p>
    <p class="foot center" style="margin-top:0">${S.clients.length} client${S.clients.length === 1 ? '' : 's'} · AES-256 encrypted on this device before upload</p>
    <input type="file" id="file" accept=".json,application/json" hidden>`;

  $('#lockAfter').onchange = e => { settings.lockAfter = +e.target.value; saveSettings(); toast('Auto-lock updated'); };
  ACT.back = () => go('list');
  ACT.lock = () => lock();
  ACT.changepw = () => { if (canWrite()) go('changepw'); };
  ACT.signout = () => { if (confirm('Sign out of this device? You’ll need your account password to sign in again.')) signOut(); };
  ACT.cfsec = t => { const on = t.classList.toggle('on'); t.setAttribute('aria-pressed', on); };
  ACT.cfadd = async () => {
    const label = $('#cfName').value.trim();
    if (!label || !canWrite()) return label || $('#cfName').focus();
    if (cf.some(f => f.label.toLowerCase() === label.toLowerCase())) return toast('That field already exists');
    cf.push({ id: uid(), label, secret: $('[data-act="cfsec"]').classList.contains('on') });
    try { await saveMeta(); toast('Field added'); renderSettings(); } catch (e) { cf.pop(); toast(errText(e)); }
  };
  ACT.cfdel = async t => {
    const f = cf.find(x => x.id === t.dataset.id);
    if (!canWrite() || !confirm(`Remove “${f.label}” from all clients? Values already saved in it will be hidden.`)) return;
    S.meta.customFields = cf.filter(x => x !== f);
    try { await saveMeta(); renderSettings(); } catch (e) { S.meta.customFields = cf; toast(errText(e)); }
  };
  ACT.export = () => exportBackup();
  ACT.import = () => { suppressLock = true; $('#file').click(); };
  $('#file').onchange = async e => {
    suppressLock = false;
    const file = e.target.files[0]; if (!file) return;
    try {
      const b = JSON.parse(await file.text());
      if (b.app !== 'client-vault' || !b.vault?.wkey || !Array.isArray(b.clients)) throw 0;
      go('import', b);
    } catch { toast('That isn’t a Client Vault backup file'); }
  };
}

function exportBackup() {
  const data = { app: 'client-vault', v: 2, saved: Date.now(), vault: S.vault, clients: [...S.recs.values()] };
  const name = `client-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  const done = () => { settings.lastBackup = Date.now(); saveSettings(); if (cur.v === 'settings') renderSettings(); toast('Backup exported'); };
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    suppressLock = true;
    navigator.share({ files: [file], title: name }).then(done, err => { if (err.name !== 'AbortError') toast('Export failed'); }).finally(() => { suppressLock = false; });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    done();
  }
}

function renderChangePw() {
  app.innerHTML = bar({ left: backBtn('Settings', 'back'), title: 'Master Password' }) + `
    <form id="f" class="pad" autocomplete="off">
      <div class="stack" style="max-width:none">
        <input class="field" id="p0" type="password" placeholder="Current master password" autocomplete="current-password">
        <input class="field" id="p1" type="password" placeholder="New master password" autocomplete="new-password">
        <input class="field" id="p2" type="password" placeholder="Confirm new password" autocomplete="new-password">
        <button class="btn primary" id="go" type="submit">Change password</button>
        <p class="err" id="err" role="alert"></p>
        <p class="hint">Your other devices will need the new password next time they unlock. Old backup files still open with the old password.</p>
      </div>
    </form>`;
  ACT.back = () => go('settings');
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const err = $('#err'), btn = $('#go'), a = $('#p1').value;
    if (a.length < 10) return (err.textContent = 'Use at least 10 characters.');
    if (a !== $('#p2').value) return (err.textContent = 'New passwords don’t match.');
    btn.disabled = true; btn.textContent = 'Checking…';
    try { await unwrapDek($('#p0').value, S.vault); }
    catch { btn.disabled = false; btn.textContent = 'Change password'; return (err.textContent = 'Current password is wrong.'); }
    btn.textContent = 'Saving…';
    try {
      const w = await wrapDek(a, S.raw);
      await DB.putVault(w);
      Object.assign(S.vault, w); PV = { vault: S.vault, offline: false }; writeCache();
      toast('Master password changed'); go('settings');
    } catch (ex) { btn.disabled = false; btn.textContent = 'Change password'; err.textContent = errText(ex); }
  };
}

function renderImport(b) {
  app.innerHTML = bar({ left: backBtn('Settings', 'back'), title: 'Import Backup' }) + `
    <form id="f" class="pad" autocomplete="off">
      <div class="stack" style="max-width:none">
        <p class="hint" style="margin:0 2px 6px">Backup from ${fmtDate(b.saved)} with ${b.clients.length} client${b.clients.length === 1 ? '' : 's'}. Clients you already have are kept; the newer copy wins.</p>
        <input class="field" id="pw" type="password" placeholder="Master password used for this backup" autocomplete="off">
        <button class="btn primary" id="go" type="submit">Import</button>
        <p class="err" id="err" role="alert"></p>
      </div>
    </form>`;
  ACT.back = () => go('settings');
  $('#f').onsubmit = async e => {
    e.preventDefault();
    if (!canWrite()) return;
    const btn = $('#go'), err = $('#err');
    btn.disabled = true; btn.textContent = 'Decrypting…';
    let key;
    try { key = await dataKey(await unwrapDek($('#pw').value, b.vault)); }
    catch { btn.disabled = false; btn.textContent = 'Import'; return (err.textContent = 'Wrong password for this backup.'); }
    try {
      let n = 0;
      if (b.vault.metaCt) {
        const meta = await decJSON(key, { iv: b.vault.metaIv, ct: b.vault.metaCt });
        const have = new Set(S.meta.customFields.map(f => f.id)), add = (meta.customFields || []).filter(f => !have.has(f.id));
        if (add.length) { S.meta.customFields.push(...add); await saveMeta(); }
      }
      for (const r of b.clients) {
        const c = await decJSON(key, r); c.id = r.id; c.custom ||= {}; c.extra ||= [];
        const mine = S.clients.find(x => x.id === c.id);
        if (mine && (mine.updated || 0) >= (c.updated || 0)) continue;
        btn.textContent = `Importing ${++n}…`;
        await saveClient(c);
      }
      toast(n ? `Imported ${n} client${n === 1 ? '' : 's'}` : 'Nothing new to import');
      go('list');
    } catch (ex) { btn.disabled = false; btn.textContent = 'Import'; err.textContent = errText(ex); }
  };
}

// ---------- start ----------
addEventListener('unhandledrejection', e => { console.error(e.reason); toast(errText(e.reason || {})); });
if (!window.isSecureContext || !crypto.subtle) {
  app.innerHTML = `<main class="lock"><h1>Needs HTTPS</h1><p class="sub">Open this app from its https:// address.</p></main>`;
} else {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
  openVault();
}
})();
