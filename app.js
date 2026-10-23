'use strict';
// Client Vault — all client data is encrypted in the browser (AES-256-GCM) before it is
// stored or uploaded. The server only ever sees ciphertext.
//
// Key design: a random 256-bit data key (DEK) encrypts every record. The DEK itself is
// encrypted ("wrapped") with a key derived from the master password (PBKDF2-SHA256).
// Changing the master password only re-wraps the DEK.
//
// Face ID / biometric unlock uses a passkey with the WebAuthn PRF extension: the passkey
// produces a secret only after Face ID succeeds, and that secret wraps a second copy of the
// DEK kept on this device. The master password is never stored.
(() => {
const CFG = window.CLIENT_VAULT_CONFIG || {};
const DEMO = !CFG.apiKey || CFG.apiKey === 'demo';
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const UA = navigator.userAgent;
const IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const BIO = IOS ? 'Face ID' : /Macintosh/.test(UA) ? 'Touch ID' : /Windows/.test(UA) ? 'Windows Hello' : 'fingerprint';

// ---------- small utils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const uid = () => [...rand(9)].map(b => b.toString(16).padStart(2, '0')).join('');
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function readLS(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function writeLS(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const fmtDate = t => t ? new Date(typeof t === 'string' ? t + 'T00:00:00' : t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const fmtTime = t => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800); }

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
  MISSING_PASSWORD: 'Enter your password.', USER_DISABLED: 'This account is disabled.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Try again in a few minutes.',
  EXPIRED_OOB_CODE: 'This reset link has expired. Request a new one from the sign-in screen.',
  INVALID_OOB_CODE: 'This reset link was already used or is incomplete. Request a new one from the sign-in screen.',
  WEAK_PASSWORD: 'Choose a stronger password (at least 8 characters).',
};

function firebaseBackend() {
  const FS = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(CFG.projectId)}/databases/(default)/documents`;
  const ID = 'https://identitytoolkit.googleapis.com/v1/accounts';
  let auth = readLS('cv-auth');
  const saveAuth = a => { auth = a; writeLS('cv-auth', a && { uid: a.uid, email: a.email, refreshToken: a.refreshToken }); };

  async function post(url, body, form) {
    const r = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body) : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const code = String(j.error?.message || r.status).split(' ')[0]; throw Object.assign(new Error(AUTH_MSG[code] || 'Something went wrong. Please try again.'), { code }); }
    return j;
  }
  async function token() {
    if (!auth) throw new AuthError('Please sign in.');
    if (auth.idToken && Date.now() < auth.exp - 60000) return auth.idToken;
    try {
      const j = await post(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`, { grant_type: 'refresh_token', refresh_token: auth.refreshToken }, true);
      saveAuth({ ...auth, idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + j.expires_in * 1000 });
      return auth.idToken;
    } catch (e) { if (e.code) throw new AuthError('Your session expired. Please sign in again.'); throw e; }
  }
  async function fs(method, path, body) {
    const r = await fetch(FS + path, { method,
      headers: { Authorization: 'Bearer ' + await token(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404 && method === 'GET') return null;
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new AuthError('Your session expired. Please sign in again.');
    if (r.status === 403) throw new Error('This account doesn’t have access to the vault.');
    if (!r.ok) throw new Error('Couldn’t reach the vault. Please try again.');
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
      const j = await post(`${ID}:signInWithPassword?key=${CFG.apiKey}`, { email, password, returnSecureToken: true });
      saveAuth({ uid: j.localId, email: j.email, refreshToken: j.refreshToken, idToken: j.idToken, exp: Date.now() + j.expiresIn * 1000 });
    },
    async resetPassword(email) { await post(`${ID}:sendOobCode?key=${CFG.apiKey}`, { requestType: 'PASSWORD_RESET', email }); },
    async checkResetCode(oobCode) { return (await post(`${ID}:resetPassword?key=${CFG.apiKey}`, { oobCode })).email; },
    async confirmReset(oobCode, newPassword) { await post(`${ID}:resetPassword?key=${CFG.apiKey}`, { oobCode, newPassword }); },
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

// Demo mode: same interface, stored in this browser only. Used when config.js is empty.
function demoBackend() {
  const noReset = async () => { throw new Error('Password reset isn’t available in demo mode.'); };
  return {
    demo: true,
    user: { uid: 'demo', email: 'Demo mode' },
    async signIn() {}, async resetPassword() {}, checkResetCode: noReset, confirmReset: noReset, signOut() {},
    async getVault() { return (await store.get('demo:vault')) || null; },
    async putVault(f) { await store.set('demo:vault', { ...((await store.get('demo:vault')) || {}), ...f }); },
    async listClients() { return Object.values((await store.get('demo:clients')) || {}); },
    async putClient(id, rec) { const m = (await store.get('demo:clients')) || {}; m[id] = { id, ...rec }; await store.set('demo:clients', m); },
    async delClient(id) { const m = (await store.get('demo:clients')) || {}; delete m[id]; await store.set('demo:clients', m); },
  };
}
const DB = DEMO ? demoBackend() : firebaseBackend();
const cacheKey = () => 'cache:' + DB.user.uid;

// ---------- reference data ----------
// Taxpayer status as per the Income-tax Act, and the 4th character of the PAN for each.
const TYPES = ['Individual', 'HUF', 'Partnership Firm', 'LLP', 'Company', 'Trust', 'AOP', 'BOI', 'Local Authority', 'Artificial Juridical Person', 'Government'];
const TYPE_PAN = { Individual: 'P', HUF: 'H', 'Partnership Firm': 'F', LLP: 'F', Company: 'C', Trust: 'T', AOP: 'A', BOI: 'B', 'Local Authority': 'L', 'Artificial Juridical Person': 'J', Government: 'G' };
const PAN_STATUS = { P: 'Individual', H: 'HUF', F: 'Firm / LLP', C: 'Company', T: 'Trust', A: 'AOP', B: 'BOI', L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government' };
const PAN_TO_TYPE = { P: 'Individual', H: 'HUF', F: 'Partnership Firm', C: 'Company', T: 'Trust', A: 'AOP', B: 'BOI', L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government' };
// Only individuals and HUFs carry on business under a trade name; every other status is itself the entity.
const PERSONAL = new Set(['Individual', 'HUF']);
const REG_LABEL = { Company: 'CIN', LLP: 'LLPIN', 'Partnership Firm': 'Firm reg. no.', Trust: 'Registration no.', AOP: 'Registration no.', BOI: 'Registration no.' };
const GST_STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '28': 'Andhra Pradesh (old)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction' };
const STATE2 = new Set('AN AP AR AS BR CH CG CT DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TG TN TR TS UK UP UR UT WB'.split(' '));
const CIN_CLASS = { PLC: 'Public company', PTC: 'Private company', OPC: 'One person company', NPL: 'Section 8 company', GOI: 'Central Govt. company', SGC: 'State Govt. company', FLC: 'Foreign subsidiary (public)', FTC: 'Foreign subsidiary (private)', GAP: 'Guarantee company (public)', GAT: 'Guarantee company (private)', ULL: 'Unlimited company (public)', ULT: 'Unlimited company (private)' };

// ---------- client fields ----------
const addrLabel = t => t === 'Individual' ? 'Home address' : t === 'HUF' ? 'HUF address' : 'Registered office';
const dobLabel = t => t === 'Individual' ? 'Date of birth' : t === 'Company' || t === 'LLP' ? 'Date of incorporation' : 'Date of formation';
const SECTIONS = [
  { title: 'Basic details', fields: [
    { k: 'name', label: t => PERSONAL.has(t) ? 'Name' : 'Legal name', rule: 'name', ph: 'Required — exactly as on PAN' },
    { k: 'type', label: 'Status', kind: 'select' },
    { k: 'fileNo', label: 'File no.', ph: 'Optional' },
    { k: 'contact', label: 'Contact person', ph: 'Director / partner / trustee', show: t => !PERSONAL.has(t) },
    { k: 'mobile', label: 'Mobile', input: 'tel', rule: 'mobile', norm: 'mobile', ph: '10-digit number', link: 'tel:' },
    { k: 'email', label: 'Email', input: 'email', rule: 'email', norm: 'lower', link: 'mailto:' },
    { k: 'dob', label: dobLabel, input: 'date', rule: 'dob' },
    { k: 'address', label: addrLabel, kind: 'textarea', rule: 'address', ph: 'Address with 6-digit PIN code' },
  ] },
  { title: 'Identity', fields: [
    { k: 'pan', label: 'PAN', up: true, max: 10, rule: 'pan', norm: 'id', ph: 'ABCPE1234F' },
    { k: 'aadhaar', label: t => t === 'HUF' ? 'Karta’s Aadhaar' : 'Aadhaar', input: 'numeric', max: 14, rule: 'aadhaar', norm: 'aadhaar', secret: true, ph: '12 digits', show: t => PERSONAL.has(t) },
    { k: 'regNo', label: t => REG_LABEL[t] || 'Registration no.', up: true, rule: 'regNo', norm: 'id', ph: t => t === 'Company' ? 'U74999GJ2015PTC123456' : t === 'LLP' ? 'AAB-1234' : 'If registered', show: t => !!REG_LABEL[t] },
    { k: 'tan', label: 'TAN', up: true, max: 10, rule: 'tan', norm: 'id', ph: 'If they deduct TDS' },
  ] },
  { title: 'Income Tax portal', url: 'https://eportal.incometax.gov.in/iec/foservices/#/login', fields: [
    { k: 'itUser', label: 'User ID', up: true, rule: 'itUser', norm: 'id', ph: 'The PAN' },
    { k: 'itPass', label: 'Password', secret: true },
  ] },
  { title: 'TRACES', url: 'https://www.tdscpc.gov.in/app/login.xhtml', fields: [
    { k: 'tracesUser', label: 'User ID', up: true, norm: 'up' },
    { k: 'tracesPass', label: 'Password', secret: true },
  ] },
  { title: 'Bank', fields: [
    { k: 'bankName', label: 'Bank' },
    { k: 'bankAcc', label: 'Account no.', input: 'numeric', rule: 'bankAcc', norm: 'digits' },
    { k: 'ifsc', label: 'IFSC', up: true, max: 11, rule: 'ifsc', norm: 'id', ph: 'SBIN0001234' },
  ] },
  { title: 'Notes', fields: [{ k: 'notes', label: 'Notes', kind: 'textarea', bare: true, ph: 'Anything else about this client' }] },
];
const FIELDS = SECTIONS.flatMap(s => s.fields);
const fnv = (v, t) => typeof v === 'function' ? v(t) : v;
const shows = (f, t) => !f.show || f.show(t);
const GST_URL = 'https://services.gst.gov.in/services/login';

// ---------- validation ----------
// Each rule gets the normalised value and the form context; returns null or {level, msg}.
// 'err' blocks saving, 'warn' asks before saving, 'ok' is just a confirmation.
const err = msg => ({ level: 'err', msg }), warn = msg => ({ level: 'warn', msg }), ok = msg => ({ level: 'ok', msg });
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const verhoeff = n => [...n].reverse().reduce((c, d, i) => VD[c][VP[i % 8][+d]], 0) === 0;
function gstinCheckDigit(g) {
  const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = cs.indexOf(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return cs[(36 - (sum % 36)) % 36];
}
function normMobile(v) {
  let d = v.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const initialsOf = s => (s || '').toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean).map(w => w[0]);
const others = c => S.clients.filter(x => x.id !== c.self);
const aadhaarDigits = v => (v || '').replace(/\D/g, '');
const RULES = {
  name: (v, c) => v.length < 2 ? err('Enter the full name')
    : c.type === 'Individual' && /\d/.test(v) ? warn('A person’s name usually has no numbers') : null,
  mobile: v => /^[6-9]\d{9}$/.test(normMobile(v)) ? null : err('Enter a 10-digit Indian mobile number (starts with 6–9)'),
  email: v => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v) ? null : err('Enter a valid email address'),
  dob: (v, c) => {
    const d = new Date(v + 'T00:00:00');
    if (isNaN(d)) return err('Enter a valid date');
    if (d > new Date()) return err('This date is in the future');
    if (d.getFullYear() < 1850) return err('Check the year');
    if (c.type === 'Individual' && (Date.now() - d) / 31557600000 > 110) return warn('That makes the person over 110 — check the year');
    return null;
  },
  address: v => /(^|\D)[1-9]\d{2}\s?\d{3}(\D|$)/.test(v) ? null : warn('Add the 6-digit PIN code'),
  pan: (v, c) => {
    if (!PAN_RE.test(v)) return err('PAN is 5 letters, 4 digits, 1 letter (e.g. ABCPE1234F)');
    const status = PAN_STATUS[v[3]];
    if (!status) return err(`4th letter “${v[3]}” isn’t a valid PAN status`);
    const exp = TYPE_PAN[c.type];
    if (exp && exp !== v[3]) {
      if (c.type === 'Trust' && v[3] === 'A') return warn('4th letter A means AOP — some trusts hold an AOP PAN, but please check');
      return err(`4th letter ${v[3]} means ${status}, but the status is ${c.type}`);
    }
    const dup = others(c).find(x => x.pan === v);
    if (dup) return err(`This PAN is already saved for ${dup.name}`);
    if (c.name && !initialsOf(c.name).includes(v[4])) return warn(`5th letter ${v[4]} should be the first letter of the ${c.type === 'Individual' ? 'surname' : 'name'} — check the name and PAN`);
    return ok(`Valid · ${status}`);
  },
  aadhaar: (v, c) => {
    const d = aadhaarDigits(v);
    if (!/^\d{12}$/.test(d)) return err('Aadhaar has 12 digits');
    if (!/^[2-9]/.test(d)) return err('Aadhaar never starts with 0 or 1');
    if (!verhoeff(d)) return err('This isn’t a valid Aadhaar number — check for a typo');
    const dup = others(c).find(x => x.type === c.type && aadhaarDigits(x.aadhaar) === d);
    if (dup) return err(`This Aadhaar is already saved for ${dup.name}`);
    return ok('Valid');
  },
  regNo: (v, c) => {
    if (c.type === 'Company') {
      const m = /^([LU])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})$/.exec(v);
      if (!m) return err('CIN has 21 characters (e.g. U74999GJ2015PTC123456)');
      if (!CIN_CLASS[m[5]]) return err(`“${m[5]}” isn’t a valid company class (PTC, PLC, OPC, NPL…)`);
      const y = +m[4];
      if (y < 1850 || y > new Date().getFullYear()) return err(`Year ${y} in the CIN isn’t possible`);
      const dup = others(c).find(x => x.regNo === v);
      if (dup) return err(`This CIN is already saved for ${dup.name}`);
      if (!STATE2.has(m[3])) return warn(`“${m[3]}” isn’t a state code we recognise`);
      if (c.dob && +c.dob.slice(0, 4) !== y) return warn(`CIN shows incorporation in ${y}, but the date entered is in ${c.dob.slice(0, 4)}`);
      return ok(`${m[1] === 'L' ? 'Listed' : 'Unlisted'} · ${CIN_CLASS[m[5]]} · ${y}`);
    }
    if (c.type === 'LLP') {
      if (!/^[A-Z]{3}-\d{4}$/.test(v)) return err('LLPIN is 3 letters, a hyphen and 4 digits (e.g. AAB-1234)');
      const dup = others(c).find(x => x.regNo === v);
      return dup ? err(`This LLPIN is already saved for ${dup.name}`) : null;
    }
    return null;
  },
  tan: (v, c) => {
    if (!/^[A-Z]{4}\d{5}[A-Z]$/.test(v)) return err('TAN is 4 letters, 5 digits, 1 letter (e.g. AHMR12345B)');
    const dup = others(c).find(x => x.tan === v);
    if (dup) return err(`This TAN is already saved for ${dup.name}`);
    const names = [c.name, ...c.biz].join(' ');
    if (names.trim() && !initialsOf(names).includes(v[3])) return warn(`TAN’s 4th letter ${v[3]} should be the first letter of the deductor’s name`);
    return null;
  },
  itUser: (v, c) => {
    if (PAN_RE.test(c.pan) && v !== c.pan) return warn('The Income Tax login ID is the PAN — this doesn’t match');
    if (!PAN_RE.test(v)) return warn('The Income Tax login ID is normally the PAN');
    return null;
  },
  gstin: (v, c) => {
    if (!GSTIN_RE.test(v)) return err('GSTIN is 15 characters: state code + PAN + entity no. + Z + check (e.g. 24ABCPE1234F1Z5)');
    const st = GST_STATES[v.slice(0, 2)];
    if (!st) return err(`${v.slice(0, 2)} isn’t a valid GST state code`);
    if (gstinCheckDigit(v) !== v[14]) return err('Last character (check digit) is wrong — check for a typo');
    const inner = v.slice(2, 12);
    if (PAN_RE.test(c.pan) && inner !== c.pan) return err(`This GSTIN is for PAN ${inner}, not ${c.pan}`);
    if (!PAN_RE.test(c.pan)) {
      if (!PAN_STATUS[inner[3]]) return err('The PAN inside this GSTIN isn’t valid');
      if (TYPE_PAN[c.type] && TYPE_PAN[c.type] !== inner[3]) return err(`This GSTIN is for ${PAN_STATUS[inner[3]]}, but the status is ${c.type}`);
    }
    if (c.gstins.filter(g => g === v).length > 1) return err('This GSTIN is entered twice');
    const dup = others(c).find(x => (x.gst || []).some(g => g.gstin === v));
    if (dup) return err(`This GSTIN is already saved for ${dup.name}`);
    return ok(`${st}${PAN_RE.test(c.pan) ? ' · PAN matches' : ''}`);
  },
  gstUser: v => /^[A-Za-z0-9._-]{8,15}$/.test(v) ? null : warn('GST portal usernames are usually 8–15 letters, numbers, . _ or -'),
  ifsc: v => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? null : err('IFSC is 4 letters, 0, then 6 letters/digits (e.g. SBIN0001234)'),
  bankAcc: v => /^\d{9,18}$/.test(v) ? null : err('Account number should be 9 to 18 digits'),
  udyam: v => {
    const m = /^UDYAM-([A-Z]{2})-(\d{2})-(\d{7})$/.exec(v);
    if (!m) return err('Udyam number looks like UDYAM-GJ-01-1234567');
    return STATE2.has(m[1]) ? null : warn(`“${m[1]}” isn’t a state code we recognise`);
  },
};
const NORM = {
  id: v => v.replace(/\s+/g, '').toUpperCase(),
  up: v => v.trim().toUpperCase(),
  lower: v => v.trim().toLowerCase(),
  digits: v => v.replace(/\D/g, ''),
  mobile: v => { const d = normMobile(v); return /^[6-9]\d{9}$/.test(d) ? d : v.trim(); },
  aadhaar: v => { const d = v.replace(/\D/g, ''); return d.length === 12 ? d.replace(/(\d{4})(?=\d)/g, '$1 ') : v.trim(); },
};

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
  face: '<svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15v-5a4 4 0 0 1 4-4h5M33 6h5a4 4 0 0 1 4 4v5M42 33v5a4 4 0 0 1-4 4h-5M15 42h-5a4 4 0 0 1-4-4v-5"/><path d="M17 18v3M31 18v3M24 18v8h-2M18 31c3.5 3 8.5 3 12 0"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.4 1.1 4.6 3 6.2L4.2 21l3.9-1.9c1.2.4 2.5.6 3.9.6 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>',
};

// ---------- session state ----------
// S = { key, raw, vault, meta:{customFields}, clients:[], recs:Map, offline, syncedAt }
let S = null, PV = null, Q = '', F = 'All', cur = { v: 'list' }, ACT = {};
const settings = Object.assign({ lockAfter: 60, lastBackup: 0, bioOffer: true }, readLS('cv-settings'));
const saveSettings = () => writeLS('cv-settings', settings);

app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && ACT[t.dataset.act]) { e.preventDefault(); ACT[t.dataset.act](t, e); }
});

const bar = ({ left = '', title = '', right = '' }) =>
  `<header class="bar"><div class="bar-row"><div>${left}</div><div class="bar-t">${esc(title)}</div><div class="bar-r">${right}</div></div></header>`;
const backBtn = (label, act) => `<button class="nav-btn back" data-act="${act}">${I.back}<span>${esc(label)}</span></button>`;
const sw = (on, act, extra = '') => `<button type="button" class="switch" role="switch" aria-checked="${!!on}" data-act="${act}"${extra}></button>`;
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
// Brings records saved by older versions of the app up to the current shape.
function tidy(c) {
  c.custom ||= {}; c.extra ||= []; c.businesses ||= [];
  if (!c.gst) c.gst = c.gstin || c.gstUser || c.gstPass ? [{ gstin: c.gstin || '', user: c.gstUser || '', pass: c.gstPass || '' }] : [];
  delete c.gstin; delete c.gstUser; delete c.gstPass;
  if (c.type === 'Proprietorship') c.type = 'Individual';
  if (c.type === 'AOP / BOI') c.type = c.pan?.[3] === 'B' ? 'BOI' : 'AOP';
  return c;
}
async function applyRecs(recs) {
  const prev = new Map(S.clients.map(c => [c.id, c]));
  const clients = [], map = new Map();
  for (const r of recs) {
    map.set(r.id, r);
    const old = prev.get(r.id), oldRec = S.recs.get(r.id);
    if (old && oldRec && oldRec.ct === r.ct) { clients.push(old); continue; }
    try { const c = await decJSON(S.key, r); c.id = r.id; clients.push(tidy(c)); }
    catch { console.warn('Could not decrypt record', r.id); }
  }
  S.clients = clients; S.recs = map;
}
const writeCache = () => store.set(cacheKey(), { vault: S.vault, clients: [...S.recs.values()] }).catch(() => {});
function canWrite() { if (S.offline) { toast('You’re offline — changes can’t be saved right now.'); return false; } return true; }

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

// ---------- biometric unlock (passkey + PRF) ----------
let BIO_OK = false, bioPending = null;
const bioKey = () => 'cv-bio:' + DB.user.uid;
const bioRecord = () => DB.user ? readLS(bioKey()) : null;
async function bioAvailable() {
  try {
    if (!window.PublicKeyCredential || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return false;
    if (PublicKeyCredential.getClientCapabilities) {
      const caps = await PublicKeyCredential.getClientCapabilities();
      if (caps['extension:prf'] === false) return false;
    }
    return true;
  } catch { return false; }
}
async function prfKey(out) {
  const base = await crypto.subtle.importKey('raw', out, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('client-vault/bio'), info: enc.encode('dek-wrap') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function prfGet(id, salt) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: rand(32), allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', timeout: 60000,
    extensions: { prf: { eval: { first: salt } } } } });
  const out = a.getClientExtensionResults().prf?.results?.first;
  if (!out) throw new Error('unsupported');
  return out;
}
async function bioSave(id, salt, out) {
  const k = await prfKey(out), iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, S.raw));
  writeLS(bioKey(), { id: toB64(new Uint8Array(id)), salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) });
}
async function bioEnable() {
  const salt = rand(32);
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'Client Vault' },
    user: { id: rand(16), name: DB.demo ? 'Client Vault' : DB.user.email, displayName: 'Client Vault' },
    challenge: rand(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
  const prf = cred.getClientExtensionResults().prf;
  if (!prf || prf.enabled === false) throw new Error('unsupported');
  if (prf.results?.first) { await bioSave(cred.rawId, salt, prf.results.first); return true; }
  // Some devices only return the PRF secret on sign-in, which needs one more tap.
  bioPending = { id: cred.rawId, salt };
  return false;
}
async function bioFinish() {
  const out = await prfGet(bioPending.id, bioPending.salt);
  await bioSave(bioPending.id, bioPending.salt, out);
  bioPending = null;
}
async function bioUnlockRaw() {
  const r = bioRecord();
  const out = await prfGet(fromB64(r.id), fromB64(r.salt));
  const k = await prfKey(out);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(r.iv) }, k, fromB64(r.ct)));
}
const bioErr = e => e.message === 'unsupported'
  ? `This device can’t use ${BIO} for this app yet. On iPhone it needs iOS 18 or newer.`
  : `Couldn’t turn on ${BIO}. Please try again.`;
async function bioTurnOn(after) {
  try {
    if (bioPending) { await bioFinish(); toast(`${BIO} unlock is on`); }
    else if (await bioEnable()) toast(`${BIO} unlock is on`);
    else toast(`Tap “Finish setting up ${BIO}” to complete`);
  } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(bioErr(e)); }
  after();
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
  S = null; Q = ''; ACT = {}; bioPending = null;
  document.body.classList.remove('cover');
  openVault();
}
async function signOut(msg) {
  if (DB.user) { await store.del(cacheKey()).catch(() => {}); writeLS(bioKey(), null); }
  S = null; PV = null;
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
  lockScreen('Client Vault', 'Sign in to open your client records on this device.', `
    <form id="f" class="stack" autocomplete="on">
      <input class="field" id="em" type="email" placeholder="Email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(readLS('cv-email') || '')}" required>
      <input class="field" id="pw" type="password" placeholder="Password" autocomplete="current-password" required>
      <button class="btn primary" id="go" type="submit">Sign in</button>
      <button class="btn plainbtn" type="button" data-act="forgot">Forgot password?</button>
      <p class="err" id="err" role="alert">${esc(msg || '')}</p>
      <p class="hint center" id="hint" aria-live="polite"></p>
    </form>`);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#go'), email = $('#em').value.trim();
    btn.disabled = true; btn.textContent = 'Signing in…';
    try { await DB.signIn(email, $('#pw').value); writeLS('cv-email', email); openVault(); }
    catch (ex) {
      btn.disabled = false; btn.textContent = 'Sign in';
      $('#err').textContent = ex instanceof TypeError ? 'No internet connection.' : ex.message;
    }
  };
  ACT.forgot = async t => {
    const email = $('#em').value.trim();
    if (!email || RULES.email(email)) { $('#err').textContent = 'Enter your email above first.'; return $('#em').focus(); }
    t.disabled = true;
    try {
      await DB.resetPassword(email);
      $('#err').textContent = '';
      $('#hint').textContent = 'Reset link sent — check your inbox and spam folder. Open the newest email only: each new request cancels the earlier links.';
      // Each new email invalidates the previous link, so don't let repeated taps send more.
      let s = 60;
      const tick = () => { if (!document.body.contains(t)) return; if (--s > 0) { t.textContent = `Resend link in ${s}s`; setTimeout(tick, 1000); } else { t.textContent = 'Forgot password?'; t.disabled = false; } };
      tick();
    } catch (ex) { $('#err').textContent = ex instanceof TypeError ? 'No internet connection.' : ex.message; t.disabled = false; }
  };
}

// Opened from the link in a password-reset email (?mode=resetPassword&oobCode=…).
async function renderReset(code) {
  const done = () => { history.replaceState(null, '', location.pathname); DB.user ? openVault() : renderSignIn(); };
  renderLoading('Checking your reset link…');
  let email;
  try { email = await DB.checkResetCode(code); }
  catch (e) {
    lockScreen('Link not valid', esc(e instanceof TypeError ? 'No internet connection.' : e.message), `<div class="stack"><button class="btn primary" data-act="done">Back to sign in</button></div>`);
    ACT.done = done; return;
  }
  lockScreen('Choose a new password', `For ${esc(email)}`, `
    <form id="f" class="stack" autocomplete="off">
      <input type="email" autocomplete="username" value="${esc(email)}" hidden>
      <input class="field" id="p1" type="password" placeholder="New sign-in password" autocomplete="new-password">
      <input class="field" id="p2" type="password" placeholder="Confirm new password" autocomplete="new-password">
      <button class="btn primary" id="go" type="submit">Save new password</button>
      <p class="err" id="err" role="alert"></p>
      <p class="hint">This changes the password you sign in with. Your master password and client data are not affected.</p>
    </form>`);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const a = $('#p1').value, er = $('#err'), btn = $('#go');
    if (a.length < 8) return (er.textContent = 'Use at least 8 characters.');
    if (a !== $('#p2').value) return (er.textContent = 'Passwords don’t match.');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await DB.confirmReset(code, a);
      writeLS('cv-email', email);
      DB.signOut();
      toast('Password changed. Sign in with your new password.');
      done();
    } catch (ex) { btn.disabled = false; btn.textContent = 'Save new password'; er.textContent = ex instanceof TypeError ? 'No internet connection.' : ex.message; }
  };
}

async function openVault() {
  if (!DB.user) return renderSignIn();
  renderLoading('Opening your vault…');
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
  lockScreen('Create master password', 'Your master password encrypts every client record before it leaves this device. Without it, nobody can read your data.', `
    <form id="f" class="stack" autocomplete="off">
      <input class="field" id="p1" type="password" placeholder="Master password" autocomplete="new-password">
      <input class="field" id="p2" type="password" placeholder="Confirm master password" autocomplete="new-password">
      <button class="btn primary" id="go" type="submit">Create vault</button>
      <p class="err" id="err" role="alert"></p>
      <p class="hint">Use at least 10 characters, different from your sign-in password. <b>It can’t be recovered</b> — write it down and keep it safe.</p>
    </form>`);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const a = $('#p1').value, b = $('#p2').value, er = $('#err');
    if (a.length < 10) return (er.textContent = 'Use at least 10 characters.');
    if (a !== b) return (er.textContent = 'Passwords don’t match.');
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
      er.textContent = ex instanceof TypeError ? 'No internet connection.' : ex.message;
    }
  };
}

async function finishUnlock(raw) {
  renderLoading('Opening your vault…');
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
}

let fails = +readLS('cv-fails') || 0, until = +readLS('cv-until') || 0;
function renderUnlock(mode) {
  const rec = bioRecord();
  const who = DB.demo ? 'Demo mode' : esc(DB.user.email);
  if (rec && mode !== 'pw') {
    lockScreen('Client Vault', who, `
      <div class="stack" style="text-align:center">
        <button class="facebtn" data-act="bio"><span class="ring">${I.face}</span>Unlock with ${esc(BIO)}</button>
        <button class="btn plainbtn" data-act="pw">Use master password</button>
        <p class="err" id="err" role="alert"></p>
      </div>`);
    ACT.pw = () => renderUnlock('pw');
    ACT.bio = async () => {
      let raw;
      try { raw = await bioUnlockRaw(); }
      catch (e) {
        if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
        if (e.name === 'OperationError') writeLS(bioKey(), null);
        return renderUnlockMsg(`${BIO} didn’t work this time. Use your master password.`);
      }
      finishUnlock(raw);
    };
    return;
  }
  lockScreen('Client Vault', who, `
    <form id="f" class="stack" autocomplete="off">
      <input class="field" id="pw" type="password" placeholder="Master password" autocomplete="current-password" enterkeyhint="go">
      <button class="btn primary" id="go" type="submit">Unlock</button>
      ${rec ? `<button class="btn plainbtn" type="button" data-act="bioback">Use ${esc(BIO)} instead</button>` : ''}
      <p class="err" id="err" role="alert"></p>
    </form>`);
  ACT.bioback = () => renderUnlock();
  const pw = $('#pw'), btn = $('#go'), er = $('#err');
  const wait = () => {
    if (!document.body.contains(btn)) return;
    const s = Math.ceil((until - Date.now()) / 1000);
    if (s > 0) { btn.disabled = true; er.textContent = `Too many wrong attempts. Try again in ${s}s.`; setTimeout(wait, 1000); }
    else if (btn.disabled && btn.textContent === 'Unlock') { btn.disabled = false; er.textContent = ''; }
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
      pw.value = ''; btn.textContent = 'Unlock'; btn.disabled = false; er.textContent = 'Wrong master password.';
      return wait();
    }
    fails = 0; until = 0; writeLS('cv-fails', 0); writeLS('cv-until', 0);
    finishUnlock(raw);
  };
}
function renderUnlockMsg(msg) { renderUnlock('pw'); $('#err').textContent = msg; }

// ---------- list ----------
function haystack(c) {
  const parts = [c.name, c.pan, c.mobile, c.email, c.fileNo, c.tan, c.itUser, c.type, c.regNo, c.contact];
  for (const g of c.gst) parts.push(g.gstin, g.user);
  for (const b of c.businesses) parts.push(b.name, b.nature, b.udyam);
  for (const f of S.meta.customFields) if (!f.secret && c.custom[f.id]) parts.push(c.custom[f.id]);
  for (const x of c.extra) if (!x.secret) parts.push(x.label, x.value);
  return parts.filter(Boolean).join(' ').toLowerCase();
}
function renderList() {
  let banner = '';
  if (DB.demo) banner = `<div class="banner info">Demo mode — clients are kept in this browser only.</div>`;
  else if (S.offline) banner = `<button class="banner" data-act="sync">You’re offline — showing the saved copy. Changes can’t be saved. Tap to retry.</button>`;
  if (!banner && BIO_OK && !bioRecord() && settings.bioOffer) banner = bioPending
    ? `<div class="banner info"><span class="grow">Almost done — confirm ${esc(BIO)} once more.</span><button class="bbtn" data-act="bioOn">Confirm</button></div>`
    : `<div class="banner info"><span class="grow">Unlock faster with ${esc(BIO)}.</span><button class="bbtn" data-act="bioOn">Turn on</button><button class="bx" data-act="bioNo" aria-label="Dismiss">×</button></div>`;
  app.innerHTML = bar({
    left: `<button class="nav-btn" data-act="settings">Settings</button>`,
    right: `<button class="nav-btn" data-act="add" aria-label="Add client">${I.plus}</button>`,
  }) + `
    <h1 class="large">Clients</h1>
    <div class="search">${I.search}<input id="q" type="search" placeholder="Name, PAN, GSTIN, mobile, business…" value="${esc(Q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search clients"></div>
    <div class="chips" id="chips" role="tablist" aria-label="Filter by status"></div>
    ${banner}<div id="list"></div>`;
  drawList();
  $('#q').oninput = e => { Q = e.target.value; drawList(); };
  ACT.settings = () => go('settings');
  ACT.add = () => { if (canWrite()) go('edit', null); };
  ACT.open = t => go('detail', t.dataset.id);
  ACT.filter = t => { F = t.dataset.f; drawList(); };
  ACT.sync = () => sync();
  ACT.bioOn = () => bioTurnOn(() => renderList());
  ACT.bioNo = () => { settings.bioOffer = false; saveSettings(); renderList(); toast(`You can turn on ${BIO} later in Settings`); };
}
function drawList() {
  const q = Q.trim().toLowerCase();
  const all = [...S.clients].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
  const counts = {}; all.forEach(c => { counts[c.type || 'Other'] = (counts[c.type || 'Other'] || 0) + 1; });
  const types = [...TYPES, ...Object.keys(counts).filter(t => !TYPES.includes(t))].filter(t => counts[t]);
  if (F !== 'All' && !counts[F]) F = 'All';
  $('#chips').hidden = types.length < 2;
  $('#chips').innerHTML = [['All', all.length], ...types.map(t => [t, counts[t]])].map(([t, n]) =>
    `<button class="chip${F === t ? ' on' : ''}" role="tab" aria-selected="${F === t}" data-act="filter" data-f="${esc(t)}">${esc(t)}<b>${n}</b></button>`).join('');
  const shown = all.filter(c => (F === 'All' || (c.type || 'Other') === F) && (!q || haystack(c).includes(q)));
  const el = $('#list');
  if (!all.length) { el.innerHTML = `<div class="empty"><b>No clients yet</b>Tap + to add your first client.</div>`; return; }
  if (!shown.length) { el.innerHTML = `<div class="empty"><b>No matches</b>${q ? `Nothing found for “${esc(Q)}”.` : 'No clients with this status.'}</div>`; return; }
  const groups = new Map();
  for (const c of shown) { const L = /[A-Z]/i.test(c.name?.[0]) ? c.name[0].toUpperCase() : '#'; (groups.get(L) || groups.set(L, []).get(L)).push(c); }
  let html = '';
  for (const [L, cs] of groups) {
    html += `<div class="group-h">${esc(L)}</div><div class="group">` + cs.map(c => {
      const sub = [c.businesses[0]?.name, c.pan || c.gst[0]?.gstin].filter(Boolean).join(' · ') || c.mobile || '';
      return `<button class="row lrow" data-act="open" data-id="${esc(c.id)}">${avatar(c.name)}<span class="lt"><b>${esc(c.name)}</b><small>${esc(sub || c.type || '')}</small></span>${F === 'All' && c.type && c.type !== 'Individual' ? `<span class="badge">${esc(c.type)}</span>` : ''}<span class="chev">${I.chev}</span></button>`;
    }).join('') + `</div>`;
  }
  const synced = S.syncedAt && !DB.demo ? ` · updated ${fmtTime(S.syncedAt)}` : '';
  html += `<p class="foot center" style="margin-top:-12px">${shown.length === all.length ? plural(all.length, 'client') : `${shown.length} of ${plural(all.length, 'client')}`}${synced}</p>`;
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
    return `<div class="row"><div class="dcol"><div class="dlabel">${esc(label)}</div><div class="dval${o.mono ? ' mono' : ''}${o.muted ? ' muted' : ''}" id="v${i}">${shown}</div></div>${
      o.secret ? `<button class="ibtn" data-act="reveal" data-i="${i}" aria-label="Show ${esc(label)}">${I.eye}</button>` : ''
    }${value ? `<button class="ibtn" data-act="copy" data-i="${i}" aria-label="Copy ${esc(label)}">${I.copy}</button>` : ''}</div>`;
  };
  const section = (title, rows, url) => rows.length
    ? `<div class="group-h"><span>${esc(title)}</span>${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">Open portal ${I.ext}</a>` : ''}</div><div class="group">${rows.join('')}</div>` : '';
  const fieldRows = s => s.fields.filter(f => !['name', 'type', 'fileNo'].includes(f.k) && c[f.k] && shows(f, c.type)).map(f => {
    const v = c[f.k], o = { secret: f.secret, mono: f.up || f.rule === 'aadhaar' || f.input === 'numeric' || f.input === 'tel', link: f.link };
    if (f.k === 'aadhaar') { const d = aadhaarDigits(v); if (d.length === 12) { o.text = d.replace(/(\d{4})(?=\d)/g, '$1 '); o.mask = '•••• •••• ' + d.slice(-4); } }
    if (f.input === 'date') o.text = fmtDate(v);
    return row(fnv(f.label, c.type), v, o);
  });

  const mob = normMobile(c.mobile || '');
  let html = bar({ left: backBtn('Clients', 'back'), right: `<button class="nav-btn" data-act="edit">Edit</button>` });
  html += `<div class="hero">${avatar(c.name, true)}<h2>${esc(c.name)}</h2><p>${esc([c.type, c.fileNo && 'File ' + c.fileNo].filter(Boolean).join(' · '))}</p></div>`;
  html += `<nav class="qa" aria-label="Contact">
    <a ${c.mobile ? `href="tel:${esc(c.mobile)}"` : 'aria-disabled="true"'}>${I.phone}<span>Call</span></a>
    <a ${/^[6-9]\d{9}$/.test(mob) ? `href="https://wa.me/91${mob}" target="_blank" rel="noopener noreferrer"` : 'aria-disabled="true"'}>${I.chat}<span>WhatsApp</span></a>
    <a ${c.email ? `href="mailto:${esc(c.email)}"` : 'aria-disabled="true"'}>${I.mail}<span>Email</span></a>
  </nav>`;
  html += section(SECTIONS[0].title, fieldRows(SECTIONS[0]));
  if (PERSONAL.has(c.type)) c.businesses.forEach((b, i) => {
    const rows = [];
    if (b.name) rows.push(row('Trade name', b.name));
    if (b.nature) rows.push(row('Nature of business', b.nature));
    if (b.same) rows.push(row('Business address', c.address || '', { text: `Same as ${addrLabel(c.type).toLowerCase()}`, muted: true }));
    else if (b.address) rows.push(row('Business address', b.address));
    if (b.udyam) rows.push(row('Udyam registration', b.udyam, { mono: true }));
    html += section(c.businesses.length > 1 ? `Business ${i + 1}` : 'Business', rows);
  });
  html += section(SECTIONS[1].title, fieldRows(SECTIONS[1]));
  html += section(SECTIONS[2].title, fieldRows(SECTIONS[2]), SECTIONS[2].url);
  c.gst.forEach(g => {
    const rows = [];
    if (g.gstin) rows.push(row('GSTIN', g.gstin, { mono: true }));
    if (g.user) rows.push(row('Username', g.user));
    if (g.pass) rows.push(row('Password', g.pass, { secret: true }));
    html += section(`GST · ${GST_STATES[g.gstin?.slice(0, 2)] || 'Registration'}`, rows, GST_URL);
  });
  for (const s of SECTIONS.slice(3)) html += section(s.title, fieldRows(s), s.url);
  html += section('Other details', [
    ...S.meta.customFields.filter(f => c.custom[f.id]).map(f => row(f.label, c.custom[f.id], { secret: f.secret })),
    ...c.extra.filter(x => x.value).map(x => row(x.label || 'Other', x.value, { secret: x.secret })),
  ]);
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
const msgDiv = '<div class="fmsg" hidden></div>';
const inputAttrs = 'autocomplete="off" autocorrect="off" spellcheck="false"';
const eyeBtn = label => `<button type="button" class="ibtn" data-act="mask" aria-label="Show or hide ${esc(label)}">${I.eye}</button>`;
const xrow = (x = {}) => `<div class="xrow" data-secret="${x.secret ? 1 : 0}">
  <button type="button" class="rm" data-act="xdel" aria-label="Remove field"></button>
  <input class="finput xl" placeholder="Label" value="${esc(x.label)}" autocomplete="off" aria-label="Field label">
  <input class="finput xv${x.secret ? ' masked' : ''}" placeholder="Value" value="${esc(x.value)}" ${inputAttrs} autocapitalize="off" aria-label="Field value">
  <button type="button" class="ibtn" data-act="xsec" aria-label="Mark as secret">${x.secret ? I.lockSm : I.unlockSm}</button></div>`;

const bizBlock = (b, type) => `<div data-biz>
  <div class="group-h"><span class="bt">Business</span><button type="button" class="linkbtn danger" data-act="bdel">Remove</button></div>
  <div class="group">
    <div class="frow"><span class="flabel">Trade name</span><input class="finput" data-bf="name" value="${esc(b.name)}" placeholder="e.g. Patel Traders" autocomplete="off" aria-label="Trade name"></div>
    <div class="frow"><span class="flabel">Nature</span><input class="finput" data-bf="nature" value="${esc(b.nature)}" placeholder="e.g. Retail – textiles" autocomplete="off" aria-label="Nature of business"></div>
    <div class="row"><span class="grow" data-same-label>Same as ${esc(addrLabel(type).toLowerCase())}</span>${sw(b.same, 'bsame', ' aria-label="Business address is the same"')}</div>
    <div class="frow" data-baddr${b.same ? ' hidden' : ''}><span class="flabel">Address</span><textarea class="finput" data-bf="address" data-rule="address" placeholder="Business address with PIN code" aria-label="Business address">${esc(b.address)}</textarea>${msgDiv}</div>
    <div class="frow"><span class="flabel">Udyam no.</span><input class="finput up" data-bf="udyam" data-rule="udyam" data-norm="id" value="${esc(b.udyam)}" placeholder="UDYAM-GJ-01-1234567" autocapitalize="characters" ${inputAttrs} aria-label="Udyam registration number">${msgDiv}</div>
  </div></div>`;

const gstBlock = g => `<div data-gst>
  <div class="group-h"><span class="gt">GST registration</span><button type="button" class="linkbtn danger" data-act="gdel">Remove</button></div>
  <div class="group">
    <div class="frow"><span class="flabel">GSTIN</span><input class="finput up" data-gf="gstin" data-rule="gstin" data-norm="id" maxlength="19" value="${esc(g.gstin)}" placeholder="24ABCPE1234F1Z5" autocapitalize="characters" ${inputAttrs} aria-label="GSTIN">${msgDiv}</div>
    <div class="frow"><span class="flabel">Username</span><input class="finput" data-gf="user" data-rule="gstUser" value="${esc(g.user)}" placeholder="GST portal username" autocapitalize="off" ${inputAttrs} aria-label="GST username">${msgDiv}</div>
    <div class="frow"><span class="flabel">Password</span><input class="finput masked" data-gf="pass" value="${esc(g.pass)}" autocapitalize="off" ${inputAttrs} aria-label="GST password">${eyeBtn('GST password')}</div>
  </div></div>`;

function fieldHTML(f, v, type) {
  const name = fnv(f.label, type);
  const attrs = `data-k="${f.k}" aria-label="${esc(name)}" ${inputAttrs}${
    f.rule ? ` data-rule="${f.rule}"` : ''}${f.norm ? ` data-norm="${f.norm}"` : ''}${
    f.up ? ' autocapitalize="characters"' : ['name', 'address', 'notes', 'bankName', 'contact'].includes(f.k) ? '' : ' autocapitalize="off"'}`;
  let input;
  if (f.kind === 'select') {
    const opts = TYPES.includes(v) || !v ? TYPES : [...TYPES, v];
    input = `<select class="finput" ${attrs}>${opts.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (f.kind === 'textarea') input = `<textarea class="finput" ${attrs} placeholder="${esc(fnv(f.ph, type) || '')}">${esc(v)}</textarea>`;
  else {
    const t = f.input === 'tel' ? 'tel' : f.input === 'email' ? 'email' : f.input === 'date' ? 'date' : 'text';
    input = `<input class="finput${f.up ? ' up' : ''}${f.secret ? ' masked' : ''}" type="${t}" ${attrs}${f.input === 'numeric' ? ' inputmode="numeric"' : ''}${f.max ? ` maxlength="${f.max + 4}"` : ''}${f.input === 'date' ? ` max="${new Date().toISOString().slice(0, 10)}"` : ''} data-ph="${f.k}" placeholder="${esc(fnv(f.ph, type) || '')}" value="${esc(v)}">`;
  }
  return `<div class="frow${f.bare ? ' bare' : ''}" data-row="${f.k}"${shows(f, type) ? '' : ' hidden'}>${f.bare ? '' : `<span class="flabel" data-lab="${f.k}">${esc(name)}</span>`}${input}${
    f.secret ? eyeBtn(name) : ''}${f.rule ? msgDiv : ''}</div>`;
}

function renderEdit(id) {
  const orig = id && S.clients.find(x => x.id === id);
  const c = orig ? structuredClone(orig) : tidy({ type: 'Individual' });
  const sec = s => `<div class="group-h">${esc(s.title)}</div><div class="group">${s.fields.map(f => fieldHTML(f, c[f.k] || '', c.type)).join('')}</div>`;
  let html = bar({ left: `<button class="nav-btn" data-act="cancel">Cancel</button>`, title: orig ? 'Edit Client' : 'New Client', right: `<button class="nav-btn strong" data-act="save">${orig ? 'Done' : 'Save'}</button>` });
  html += `<form id="form" autocomplete="off" novalidate>`;
  html += sec(SECTIONS[0]);
  html += `<div id="bizSec"${PERSONAL.has(c.type) ? '' : ' hidden'}><div id="bizs">${c.businesses.map(b => bizBlock(b, c.type)).join('')}</div>
    <div class="group"><button type="button" class="row addrow" data-act="badd"><span class="plus">+</span><span id="baddLabel"></span></button></div>
    <p class="foot">For a proprietary business or trade name run by this ${c.type === 'HUF' ? 'HUF' : 'person'}, with its address if it’s different.</p></div>`;
  html += sec(SECTIONS[1]) + sec(SECTIONS[2]);
  html += `<div id="gsts">${c.gst.map(gstBlock).join('')}</div>
    <div class="group"><button type="button" class="row addrow" data-act="gadd"><span class="plus">+</span><span id="gaddLabel"></span></button></div>
    <p class="foot">Add one entry per GST registration (one per state).</p>`;
  for (const s of SECTIONS.slice(3, -1)) html += sec(s);
  if (S.meta.customFields.length) html += `<div class="group-h">Custom fields</div><div class="group">${S.meta.customFields.map(f =>
    `<div class="frow"><span class="flabel">${esc(f.label)}</span><input class="finput${f.secret ? ' masked' : ''}" data-c="${esc(f.id)}" value="${esc(c.custom[f.id] || '')}" ${inputAttrs} autocapitalize="off" aria-label="${esc(f.label)}">${f.secret ? eyeBtn(f.label) : ''}</div>`).join('')}</div>`;
  html += `<div class="group-h">Other details</div><div class="group" id="xg">${c.extra.map(xrow).join('')}<button type="button" class="row addrow" data-act="xadd"><span class="plus">+</span>Add field</button></div>`;
  html += `<p class="foot">Use the lock icon to keep a value hidden until you tap the eye.</p>`;
  html += sec(SECTIONS[SECTIONS.length - 1]);
  if (orig) html += `<div class="group"><button type="button" class="row danger" data-act="del">Delete Client</button></div>`;
  html += `</form>`;
  app.innerHTML = html;

  const form = $('#form');
  form.onsubmit = e => e.preventDefault();
  let dirty = false, typeTouched = !!orig;
  const typeSel = $('[data-k="type"]', form);
  const val = k => $(`[data-k="${k}"]`, form).value.trim();
  const ctx = () => ({
    type: typeSel.value, name: val('name'), pan: NORM.id(val('pan')), dob: val('dob'), self: c.id,
    biz: PERSONAL.has(typeSel.value) ? $$('[data-bf="name"]', form).map(i => i.value.trim()).filter(Boolean) : [],
    gstins: $$('[data-gf="gstin"]', form).map(i => NORM.id(i.value)).filter(Boolean),
  });
  const showMsg = (el, res) => {
    const row = el.closest('.frow'), m = $('.fmsg', row);
    if (!m) return;
    m.hidden = !res; m.textContent = res?.msg || ''; m.className = 'fmsg ' + (res?.level || '');
    row.classList.toggle('bad', res?.level === 'err');
    el.setAttribute('aria-invalid', res?.level === 'err' ? 'true' : 'false');
  };
  const check = (el, x) => {
    const v = el.value.trim(), rule = RULES[el.dataset.rule];
    const res = v && rule ? rule(el.dataset.norm ? NORM[el.dataset.norm](v) : v, x) : null;
    showMsg(el, res);
    return res;
  };
  const visible = el => !el.closest('[hidden]');
  const normalise = el => { if (el.dataset.norm && el.value.trim()) el.value = NORM[el.dataset.norm](el.value); };
  // Re-checks every filled, visible field, because many rules depend on each other (status ↔ PAN ↔ GSTIN ↔ name).
  const validateAll = () => {
    const x = ctx();
    return $$('[data-rule]', form).map(el => {
      if (!visible(el)) { showMsg(el, null); return null; }
      const r = check(el, x);
      return r && [el, r];
    }).filter(Boolean);
  };
  const relabel = () => {
    const t = typeSel.value;
    for (const f of FIELDS) {
      const row = $(`[data-row="${f.k}"]`, form);
      row.hidden = !shows(f, t);
      const l = $(`[data-lab="${f.k}"]`, form); if (l) l.textContent = fnv(f.label, t);
      const p = $(`[data-ph="${f.k}"]`, form); if (p) p.placeholder = fnv(f.ph, t) || '';
    }
    $('#bizSec').hidden = !PERSONAL.has(t);
    $$('[data-same-label]', form).forEach(s => { s.textContent = `Same as ${addrLabel(t).toLowerCase()}`; });
    const nb = $$('[data-biz]', form).length, ng = $$('[data-gst]', form).length;
    $$('[data-biz]', form).forEach((b, i) => { $('.bt', b).textContent = nb > 1 ? `Business ${i + 1}` : 'Business'; });
    $$('[data-gst]', form).forEach((g, i) => { $('.gt', g).textContent = ng > 1 ? `GST registration ${i + 1}` : 'GST registration'; });
    $('#baddLabel').textContent = nb ? 'Add another business' : 'Add business / trade name';
    $('#gaddLabel').textContent = ng ? 'Add another GST registration' : 'Add GST registration';
  };
  relabel();
  if (orig) validateAll();
  form.addEventListener('input', e => {
    dirty = true;
    const el = e.target, m = el.dataset.rule && $('.fmsg', el.closest('.frow'));
    if (m && !m.hidden && !m.classList.contains('ok')) check(el, ctx());
  });
  form.addEventListener('focusout', e => {
    const el = e.target;
    if (!el.dataset) return;
    normalise(el);
    // On a new client, set the status from the PAN's 4th letter until the user picks one.
    if (el.dataset.k === 'pan' && !typeTouched && PAN_RE.test(el.value) && PAN_TO_TYPE[el.value[3]] && typeSel.value !== PAN_TO_TYPE[el.value[3]]) {
      typeSel.value = PAN_TO_TYPE[el.value[3]]; relabel();
      toast(el.value[3] === 'F' ? 'Status set to Partnership Firm from the PAN — change to LLP if needed' : `Status set to ${typeSel.value} from the PAN`);
    }
    validateAll();
  });
  typeSel.addEventListener('change', () => { typeTouched = true; relabel(); validateAll(); });

  ACT.cancel = () => { if (!dirty || confirm('Discard your changes?')) orig ? go('detail', id) : go('list'); };
  ACT.mask = t => { const el = t.parentElement.querySelector('.finput'); const m = el.classList.toggle('masked'); t.innerHTML = m ? I.eye : I.eyeOff; };
  ACT.xadd = t => { t.insertAdjacentHTML('beforebegin', xrow()); dirty = true; t.previousElementSibling.querySelector('.xl').focus(); };
  ACT.xdel = t => { t.closest('.xrow').remove(); dirty = true; };
  ACT.xsec = t => { const r = t.closest('.xrow'); const on = r.dataset.secret !== '1'; r.dataset.secret = on ? 1 : 0; $('.xv', r).classList.toggle('masked', on); t.innerHTML = on ? I.lockSm : I.unlockSm; dirty = true; };
  ACT.badd = () => { $('#bizs').insertAdjacentHTML('beforeend', bizBlock({}, typeSel.value)); dirty = true; relabel(); $('#bizs [data-biz]:last-child [data-bf="name"]').focus(); };
  ACT.bdel = t => {
    const b = t.closest('[data-biz]');
    if ($$('[data-bf]', b).some(i => i.value.trim()) && !confirm('Remove this business?')) return;
    b.remove(); dirty = true; relabel();
  };
  ACT.bsame = t => { const on = t.getAttribute('aria-checked') !== 'true'; t.setAttribute('aria-checked', on); t.closest('[data-biz]').querySelector('[data-baddr]').hidden = on; dirty = true; };
  ACT.gadd = () => { $('#gsts').insertAdjacentHTML('beforeend', gstBlock({})); dirty = true; relabel(); $('#gsts [data-gst]:last-child [data-gf="gstin"]').focus(); };
  ACT.gdel = t => {
    const g = t.closest('[data-gst]');
    if ($$('[data-gf]', g).some(i => i.value.trim()) && !confirm('Remove this GST registration?')) return;
    g.remove(); dirty = true; relabel(); validateAll();
  };
  ACT.del = async () => {
    if (!canWrite() || !confirm(`Delete ${orig.name}? This can’t be undone.`)) return;
    try { await deleteClient(id); toast('Client deleted'); go('list'); } catch (e) { toast(errText(e)); }
  };
  ACT.save = async t => {
    if (!canWrite()) return;
    $$('[data-norm]', form).forEach(normalise);
    const results = validateAll();
    const nameEl = $('[data-k="name"]', form);
    if (!nameEl.value.trim()) { const r = err('Name is required'); showMsg(nameEl, r); results.unshift([nameEl, r]); }
    const errors = results.filter(([, r]) => r.level === 'err');
    if (errors.length) {
      toast(errors.length === 1 ? 'Please fix the highlighted field' : `Please fix ${errors.length} highlighted fields`);
      errors[0][0].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return errors[0][0].focus({ preventScroll: true });
    }
    const type = typeSel.value;
    const d = { ...c, type, custom: {}, extra: [] };
    for (const f of FIELDS) {
      const v = val(f.k);
      if (v && shows(f, type)) d[f.k] = v; else delete d[f.k];
    }
    $$('[data-c]', form).forEach(el => { const v = el.value.trim(); if (v) d.custom[el.dataset.c] = v; });
    d.extra = $$('.xrow', form).map(r => ({ label: $('.xl', r).value.trim(), value: $('.xv', r).value.trim(), secret: r.dataset.secret === '1' })).filter(x => x.label || x.value);
    const biz = $$('[data-biz]', form).map(b => {
      const g = k => $(`[data-bf="${k}"]`, b).value.trim();
      const same = $('.switch', b).getAttribute('aria-checked') === 'true';
      return { name: g('name'), nature: g('nature'), same, address: same ? '' : g('address'), udyam: g('udyam') };
    }).filter(b => b.name || b.nature || b.address || b.udyam);
    if (!PERSONAL.has(type) && biz.length && !confirm(`A ${type} is itself the business, so the business / trade name entries will be removed. Continue?`)) return;
    d.businesses = PERSONAL.has(type) ? biz : [];
    d.gst = $$('[data-gst]', form).map(g => {
      const v = k => $(`[data-gf="${k}"]`, g).value.trim();
      return { gstin: v('gstin'), user: v('user'), pass: v('pass') };
    }).filter(g => g.gstin || g.user || g.pass);
    const firstGstin = d.gst.find(g => GSTIN_RE.test(g.gstin))?.gstin;
    if (!d.pan && firstGstin) d.pan = firstGstin.slice(2, 12);
    if (d.itPass && !d.itUser && d.pan) d.itUser = d.pan;
    const warnings = results.filter(([, r]) => r.level === 'warn').map(([, r]) => '• ' + r.msg);
    if (warnings.length && !confirm(`Please check:\n${warnings.join('\n')}\n\nSave anyway?`)) return;
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
  const cf = S.meta.customFields, bioOn = !!bioRecord();
  app.innerHTML = bar({ left: backBtn('Clients', 'back'), title: 'Settings' }) + `
    <div class="group-h">Security</div>
    <div class="group">
      <div class="row"><span class="grow">Unlock with ${esc(BIO)}${BIO_OK ? '' : '<small>Not available on this device</small>'}</span>${sw(bioOn, 'bio', BIO_OK || bioOn ? '' : ' disabled')}</div>
      ${bioPending ? `<button class="row link" data-act="bioFinish">Finish setting up ${esc(BIO)}</button>` : ''}
      <label class="row"><span class="grow">Auto-lock</span><select class="plain" id="lockAfter">${lockOpts.map(([v, l]) => `<option value="${v}"${settings.lockAfter === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="row link" data-act="changepw">Change master password</button>
      <button class="row link" data-act="lock">Lock now</button>
    </div>
    <div class="group-h">Custom fields</div>
    <div class="group">
      ${cf.map(f => `<div class="row"><span class="grow">${esc(f.label)}</span>${f.secret ? '<span class="tag">Secret</span>' : ''}<button class="nav-btn" style="color:var(--danger);min-height:0;padding:4px" data-act="cfdel" data-id="${esc(f.id)}">Remove</button></div>`).join('')}
      <div class="row"><input id="cfName" class="finput" placeholder="New field, e.g. MCA login" autocomplete="off" style="padding:0" aria-label="New custom field name"><button class="toggle" data-act="cfsec" aria-pressed="false">Secret</button><button class="nav-btn strong" style="min-height:0;padding:4px" data-act="cfadd">Add</button></div>
    </div>
    <p class="foot">Custom fields appear on every client. For one-off details, use “Add field” inside a client.</p>
    <div class="group-h">Backup</div>
    <div class="group">
      <button class="row link" data-act="export">Export encrypted backup</button>
      <button class="row link" data-act="import">Import backup</button>
    </div>
    <p class="foot">${settings.lastBackup ? 'Last exported ' + fmtDate(settings.lastBackup) + '. ' : ''}A backup opens only with the master password used when it was made. Keep one in iCloud Drive or Google Drive.</p>
    <div class="group-h">Account</div>
    <div class="group">
      <div class="row"><span class="grow">${DB.demo ? 'Mode' : 'Signed in as'}</span><span class="val">${esc(DB.user.email)}</span></div>
      ${DB.demo ? '' : `<button class="row link" data-act="signout">Sign out of this device</button>`}
    </div>
    <p class="foot center" style="margin-top:-12px">${plural(S.clients.length, 'client')} · End-to-end encrypted</p>
    <input type="file" id="file" accept=".json,application/json" hidden>`;

  $('#lockAfter').onchange = e => { settings.lockAfter = +e.target.value; saveSettings(); toast('Auto-lock updated'); };
  ACT.back = () => go('list');
  ACT.lock = () => lock();
  ACT.bio = () => {
    if (bioRecord()) { writeLS(bioKey(), null); toast(`${BIO} unlock is off`); return renderSettings(); }
    bioTurnOn(() => renderSettings());
  };
  ACT.bioFinish = () => bioTurnOn(() => renderSettings());
  ACT.changepw = () => { if (canWrite()) go('changepw'); };
  ACT.signout = () => { if (confirm('Sign out of this device? You’ll need your email and password to sign in again.')) signOut(); };
  ACT.cfsec = t => { const on = t.classList.toggle('on'); t.setAttribute('aria-pressed', on); };
  ACT.cfadd = async () => {
    const label = $('#cfName').value.trim();
    if (!label) return $('#cfName').focus();
    if (!canWrite()) return;
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
    navigator.share({ files: [file], title: name }).then(done, er => { if (er.name !== 'AbortError') toast('Export failed'); }).finally(() => { suppressLock = false; });
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
        <p class="hint">Your other devices will ask for the new password next time. ${esc(BIO)} keeps working. Old backup files still open with the old password.</p>
      </div>
    </form>`;
  ACT.back = () => go('settings');
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const er = $('#err'), btn = $('#go'), a = $('#p1').value;
    if (a.length < 10) return (er.textContent = 'Use at least 10 characters.');
    if (a !== $('#p2').value) return (er.textContent = 'New passwords don’t match.');
    btn.disabled = true; btn.textContent = 'Checking…';
    try { await unwrapDek($('#p0').value, S.vault); }
    catch { btn.disabled = false; btn.textContent = 'Change password'; return (er.textContent = 'Current password is wrong.'); }
    btn.textContent = 'Saving…';
    try {
      const w = await wrapDek(a, S.raw);
      await DB.putVault(w);
      Object.assign(S.vault, w); PV = { vault: S.vault, offline: false }; writeCache();
      toast('Master password changed'); go('settings');
    } catch (ex) { btn.disabled = false; btn.textContent = 'Change password'; er.textContent = errText(ex); }
  };
}

function renderImport(b) {
  app.innerHTML = bar({ left: backBtn('Settings', 'back'), title: 'Import Backup' }) + `
    <form id="f" class="pad" autocomplete="off">
      <div class="stack" style="max-width:none">
        <p class="hint" style="margin:0 2px 6px">Backup from ${fmtDate(b.saved)} with ${plural(b.clients.length, 'client')}. Clients you already have are kept; the newer copy wins.</p>
        <input class="field" id="pw" type="password" placeholder="Master password used for this backup" autocomplete="off">
        <button class="btn primary" id="go" type="submit">Import</button>
        <p class="err" id="err" role="alert"></p>
      </div>
    </form>`;
  ACT.back = () => go('settings');
  $('#f').onsubmit = async e => {
    e.preventDefault();
    if (!canWrite()) return;
    const btn = $('#go'), er = $('#err');
    btn.disabled = true; btn.textContent = 'Decrypting…';
    let key;
    try { key = await dataKey(await unwrapDek($('#pw').value, b.vault)); }
    catch { btn.disabled = false; btn.textContent = 'Import'; return (er.textContent = 'Wrong password for this backup.'); }
    try {
      let n = 0;
      if (b.vault.metaCt) {
        const meta = await decJSON(key, { iv: b.vault.metaIv, ct: b.vault.metaCt });
        const have = new Set(S.meta.customFields.map(f => f.id)), add = (meta.customFields || []).filter(f => !have.has(f.id));
        if (add.length) { S.meta.customFields.push(...add); await saveMeta(); }
      }
      for (const r of b.clients) {
        const c = tidy(await decJSON(key, r)); c.id = r.id;
        const mine = S.clients.find(x => x.id === c.id);
        if (mine && (mine.updated || 0) >= (c.updated || 0)) continue;
        btn.textContent = `Importing ${++n}…`;
        await saveClient(c);
      }
      toast(n ? `Imported ${plural(n, 'client')}` : 'Nothing new to import');
      go('list');
    } catch (ex) { btn.disabled = false; btn.textContent = 'Import'; er.textContent = errText(ex); }
  };
}

// ---------- start ----------
addEventListener('unhandledrejection', e => { console.error(e.reason); toast(errText(e.reason || {})); });
if (!window.isSecureContext || !crypto.subtle) {
  app.innerHTML = `<main class="lock"><h1>Needs a secure connection</h1><p class="sub">Open this app from its https:// address.</p></main>`;
} else {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
  bioAvailable().then(ok_ => { BIO_OK = ok_; if (S && cur.v === 'list') renderList(); });
  const qs = new URLSearchParams(location.search);
  if (qs.get('mode') === 'resetPassword' && qs.get('oobCode')) renderReset(qs.get('oobCode'));
  else openVault();
}
})();
