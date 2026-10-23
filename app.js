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
    { k: 'group', label: 'Group', ph: 'Family or group, e.g. Patel family', list: true },
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
  { title: 'Income Tax portal', portal: 'it', fields: [
    { k: 'itUser', label: 'User ID', up: true, rule: 'itUser', norm: 'id', ph: 'The PAN' },
    { k: 'itPass', label: 'Password', secret: true },
  ] },
  { title: 'TRACES', portal: 'traces', fields: [
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
  check: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
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

// big: the page has its own large title; the small one fades into the bar once that scrolls away.
const bar = ({ left = '', title = '', right = '', big = false }) =>
  `<header class="bar${big ? ' has-big' : ''}"><div class="bar-row"><div>${left}</div><div class="bar-t">${esc(title)}</div><div class="bar-r">${right}</div></div></header>`;
const backBtn = (label, act) => `<button class="nav-btn back" data-act="${act}">${I.back}<span>${esc(label)}</span></button>`;
const sw = (on, act, extra = '') => `<button type="button" class="switch" role="switch" aria-checked="${!!on}" data-act="${act}"${extra}></button>`;
const initials = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const hue = n => { let h = 0; for (const ch of n || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const avatar = (n, big) => `<div class="avatar${big ? ' big' : ''}" style="--h:${hue(n)}" aria-hidden="true">${esc(initials(n))}</div>`;

// ---------- navigation ----------
// Like iOS: a deeper screen slides in from the right over the previous one ("push") and slides
// back out ("pop"); the edit screen rises as a sheet ("present") and drops away ("dismiss").
// The outgoing screen is copied into a layer so both are visible while they move.
const DEPTH = { list: 0, due: 1, dash: 1, settings: 1, detail: 2, bulk: 2, templates: 2, csvimport: 2, changepw: 2, import: 2, edit: 3, task: 3, comp: 3, fees: 3, wa: 4, login: 4 };
// Where "back" (and swipe-back) goes from each screen.
const toDetailOr = (a, v, arg) => a.back === v ? { v, arg } : { v: 'detail', arg: a.id };
const PARENT = {
  detail: () => ({ v: DETAIL_BACK }), due: () => ({ v: 'list' }), dash: () => ({ v: 'list' }), settings: () => ({ v: 'list' }),
  edit: id => id ? { v: 'detail', arg: id } : { v: 'list' }, comp: id => ({ v: 'detail', arg: id }), fees: id => ({ v: 'detail', arg: id }),
  task: a => a.back === 'detail' ? { v: 'detail', arg: a.id } : { v: 'due' }, bulk: () => ({ v: 'due' }),
  wa: a => a.back === 'task' ? { v: 'task', arg: a.task } : toDetailOr(a, 'fees', a.id),
  login: a => a.back === 'task' ? { v: 'task', arg: a.task } : { v: 'detail', arg: a.id },
  changepw: () => ({ v: 'settings' }), import: () => ({ v: 'settings' }), templates: () => ({ v: 'settings' }), csvimport: () => ({ v: 'settings' }),
};
let DETAIL_BACK = 'list';
const snaps = {}; // last look of each screen, shown underneath while swiping back
const EASE = 'cubic-bezier(.32,.72,0,1)', DUR = 460;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let skipAnim = false, finishTransition = null;

function makeLayer(kind, nodes) {
  const layer = document.createElement('div');
  layer.className = 'layer ' + kind;
  layer.setAttribute('aria-hidden', 'true');
  const inner = document.createElement('div');
  inner.className = 'layer-in';
  inner.append(...nodes);
  // The copy is just a picture: drop ids so lookups like $('#list') can't land in it.
  inner.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  const dim = document.createElement('div');
  dim.className = 'dim';
  layer.append(inner, dim);
  return layer;
}
// cloneNode keeps what was typed into inputs, so a closing form doesn't flash old values.
const copyOfApp = kind => makeLayer(kind, [...app.childNodes].map(n => n.cloneNode(true)));

function transition(mode, layer, y) {
  finishTransition?.();
  const below = mode === 'push' || mode === 'present';
  document.body.insertBefore(layer, below ? app : app.nextSibling);
  layer.scrollTop = y;
  if (mode === 'dismiss') layer.classList.add('sheet');
  // Scale around the middle of what's on screen, not the middle of a long page.
  app.style.transformOrigin = `50% ${scrollY + innerHeight / 2}px`;
  const o = { duration: DUR, easing: EASE };
  const move = (el, a, b) => el.animate([{ transform: a }, { transform: b }], o);
  const fade = (el, a, b) => el.animate([{ opacity: a }, { opacity: b }], o);
  const dim = layer.lastChild;
  const anims =
    mode === 'push' ? [move(app, 'translateX(100%)', 'none'), move(layer, 'none', 'translateX(-30%)'), fade(dim, 0, .1)]
    : mode === 'pop' ? [move(app, 'translateX(-30%)', 'none'), move(layer, 'none', 'translateX(100%)')]
    : mode === 'present' ? [move(app, 'translateY(100%)', 'none'), move(layer, 'none', 'scale(.94)'), fade(dim, 0, .2)]
    : [move(layer, 'none', 'translateY(100%)'), move(app, 'scale(.94)', 'none')];
  document.body.classList.add('animating', 'anim-' + mode);
  const done = () => {
    finishTransition = null;
    anims.forEach(a => a.cancel());
    layer.remove();
    app.style.transformOrigin = '';
    document.body.classList.remove('animating', 'anim-' + mode);
  };
  finishTransition = done;
  const end = () => { if (finishTransition === done) done(); };
  Promise.all(anims.map(a => a.finished)).then(end, () => {});
  setTimeout(end, DUR + 400); // never leave the screen untappable if the animation is paused
}

function go(v, arg, keepScroll) {
  const from = cur.v, live = !!(from && app.querySelector('.bar'));
  if (live) snaps[from] = { html: app.innerHTML, y: scrollY, arg: cur.arg };
  const mode = !live || keepScroll || skipAnim || from === v || reduceMotion() ? ''
    : v === 'edit' ? 'present' : from === 'edit' ? 'dismiss'
    : DEPTH[v] > DEPTH[from] ? 'push' : DEPTH[v] < DEPTH[from] ? 'pop' : '';
  const layer = mode && copyOfApp(mode === 'push' || mode === 'present' ? 'under' : 'over'), y = scrollY;
  if (v === 'detail' && DETAIL_BACK_LABEL[from]) DETAIL_BACK = from;
  cur = { v, arg }; ACT = {};
  ({ list: renderList, detail: renderDetail, edit: renderEdit, settings: renderSettings, changepw: renderChangePw, import: renderImport,
    due: renderDue, task: renderTask, comp: renderComp, fees: renderFees, wa: renderWa, bulk: renderBulk, login: renderLogin,
    templates: renderTemplates, csvimport: renderCsvImport, dash: renderDash })[v](arg);
  if (!keepScroll) scrollTo(0, 0);
  // Start after any scroll restore by goBack(), but before the browser paints.
  queueMicrotask(() => { if (layer) transition(mode, layer, y); updateBar(); });
}
// Going back returns to where you were scrolled, e.g. the same spot in a long client list.
function goBack(v, arg) {
  const s = snaps[v];
  go(v, arg);
  if (s && s.arg === arg) scrollTo(0, s.y);
}

// Hairline under the bar once content scrolls beneath it, and the small title once the large one is gone.
function updateBar() {
  const b = app.querySelector('.bar');
  if (!b) return;
  b.classList.toggle('edge', scrollY > 1);
  const big = app.querySelector('[data-big]');
  if (big) b.classList.toggle('collapsed', big.getBoundingClientRect().bottom < b.getBoundingClientRect().bottom + 4);
}
addEventListener('scroll', updateBar, { passive: true });

// Swipe right from the left edge to go back, with the previous screen showing underneath.
let swipe = null;
addEventListener('touchstart', e => {
  swipe = null;
  const t = e.touches[0];
  if (!S || e.touches.length !== 1 || t.clientX > 28 || !PARENT[cur.v] || !(ACT.back || ACT.cancel)) return;
  swipe = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, dir: null, layer: null };
}, { passive: true });
addEventListener('touchmove', e => {
  const s = swipe;
  if (!s) return;
  const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
  if (!s.dir) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    s.dir = dx > Math.abs(dy) ? 'h' : 'v';
    if (s.dir === 'v') { swipe = null; return; }
    startSwipe(s);
  }
  e.preventDefault();
  s.dx = Math.max(0, dx);
  paintSwipe(s, s.dx, false);
}, { passive: false });
addEventListener('touchend', endSwipe);
addEventListener('touchcancel', endSwipe);
function startSwipe(s) {
  finishTransition?.();
  const target = PARENT[cur.v](cur.arg), snap = snaps[target.v];
  const ok = snap && (target.arg === undefined || snap.arg === target.arg);
  const tpl = document.createElement('template');
  tpl.innerHTML = ok ? snap.html : '';
  s.layer = makeLayer('under', [...tpl.content.childNodes]);
  document.body.insertBefore(s.layer, app);
  if (ok) s.layer.scrollTop = snap.y;
  document.body.classList.add('swiping');
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}
function paintSwipe(s, dx, animate) {
  const p = Math.min(1, dx / innerWidth), tr = animate ? `transform .35s ${EASE}, opacity .35s` : 'none';
  app.style.transition = tr; app.style.transform = `translateX(${dx}px)`;
  s.layer.style.transition = tr; s.layer.style.transform = `translateX(${(p - 1) * 30}%)`;
  s.layer.lastChild.style.transition = tr; s.layer.lastChild.style.opacity = (0.1 * (1 - p)).toFixed(3);
}
function endSwipe() {
  const s = swipe;
  swipe = null;
  if (!s || s.dir !== 'h') return;
  const speed = s.dx / Math.max(1, Date.now() - s.t);
  const done = s.dx > innerWidth * 0.35 || (speed > 0.45 && s.dx > 30);
  paintSwipe(s, done ? innerWidth : 0, true);
  setTimeout(() => {
    s.layer.remove(); document.body.classList.remove('swiping');
    if (done) { const back = ACT.back || ACT.cancel; skipAnim = true; try { back?.(); } finally { skipAnim = false; } }
    app.style.transition = ''; app.style.transform = '';
  }, 350);
}

// ---------- vault data helpers ----------
async function applyMeta() {
  S.meta = S.vault.metaCt ? await decJSON(S.key, { iv: S.vault.metaIv, ct: S.vault.metaCt }) : {};
  S.meta.customFields = Array.isArray(S.meta.customFields) ? S.meta.customFields : [];
}
// Brings records saved by older versions of the app up to the current shape.
function tidy(c) {
  c.custom ||= {}; c.extra ||= []; c.businesses ||= [];
  c.comp ||= {}; c.work ||= {}; c.fees ||= []; c.pwd ||= {}; // returns tracked, filing status, fee ledger, password dates
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
    if (suppressLock || Date.now() < graceUntil) return;
    document.body.classList.add('cover');
    if (settings.lockAfter === 0) lock();
  } else {
    document.body.classList.remove('cover');
    if (suppressLock || Date.now() < graceUntil) { suppressLock = false; return; }
    if (Date.now() - hiddenAt >= settings.lockAfter * 1000) lock();
    else if (cur.v !== 'edit') sync();
  }
});
function lock() {
  finishTransition?.();
  S = null; Q = ''; ACT = {}; bioPending = null; cur = { v: null };
  for (const k in snaps) delete snaps[k]; // snapshots contain client data — drop them on lock
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
  const parts = [c.name, c.pan, c.mobile, c.email, c.fileNo, c.tan, c.itUser, c.type, c.regNo, c.contact, c.group];
  for (const g of c.gst) parts.push(g.gstin, g.user);
  for (const b of c.businesses) parts.push(b.name, b.nature, b.udyam);
  for (const f of S.meta.customFields) if (!f.secret && c.custom[f.id]) parts.push(c.custom[f.id]);
  for (const x of c.extra) if (!x.secret) parts.push(x.label, x.value);
  return parts.filter(Boolean).join(' ').toLowerCase();
}
// Overdue / due-this-week / fees at a glance on the home screen.
function statTiles() {
  const L = dueLists(), fees = S.clients.reduce((s, c) => s + Math.max(0, feeTotals(c).due), 0);
  return `<div class="tiles">
    <button class="tile ${L.overdue.length ? 'red' : ''}" data-act="due" data-f="overdue"><b>${L.overdue.length}</b><span>Overdue</span></button>
    <button class="tile ${L.week.length ? 'amber' : ''}" data-act="due" data-f="week"><b>${L.week.length}</b><span>Due this week</span></button>
    <button class="tile blue" data-act="dash"><b>${inr(fees)}</b><span>Fees due</span></button></div>`;
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
    title: 'Clients', big: true,
    right: `<button class="nav-btn" data-act="add" aria-label="Add client">${I.plus}</button>`,
  }) + `
    <h1 class="large" data-big>Clients</h1>
    ${S.clients.length ? statTiles() : ''}
    <div class="search">${I.search}<input id="q" type="search" placeholder="Name, PAN, GSTIN, mobile, group…" value="${esc(Q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search clients"></div>
    <div class="chips" id="chips" role="tablist" aria-label="Filter by status"></div>
    ${banner}<div id="list"></div>`;
  drawList();
  $('#q').oninput = e => { Q = e.target.value; drawList(); };
  ACT.due = t => { DUEF = t.dataset.f; go('due'); };
  ACT.dash = () => go('dash');
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
const DETAIL_BACK_LABEL = { list: 'Clients', dash: 'Overview', due: 'Due dates' };
function renderDetail(id) {
  const c = S.clients.find(x => x.id === id);
  if (!c) return go('list');
  const vals = [];
  const row = (label, value, o = {}) => {
    const i = vals.push({ label, raw: value, text: o.text ?? value, mask: o.secret ? o.mask || '••••••••' : null }) - 1;
    const shown = o.secret ? esc(vals[i].mask) : o.link ? `<a href="${esc(o.link + value)}">${esc(vals[i].text)}</a>` : esc(vals[i].text);
    return `<div class="row"><div class="dcol"><div class="dlabel">${esc(label)}</div><div class="dval${o.mono ? ' mono' : ''}${o.muted ? ' muted' : ''}" id="v${i}">${shown}</div>${o.note ? `<div class="dnote">${esc(o.note)}</div>` : ''}</div>${
      o.secret ? `<button class="ibtn" data-act="reveal" data-i="${i}" aria-label="Show ${esc(label)}">${I.eye}</button>` : ''
    }${value ? `<button class="ibtn" data-act="copy" data-i="${i}" aria-label="Copy ${esc(label)}">${I.copy}</button>` : ''}</div>`;
  };
  const section = (title, rows, extra = '') => rows.length
    ? `<div class="group-h"><span>${esc(title)}</span>${extra}</div><div class="group">${rows.join('')}</div>` : '';
  const loginBtn = p => `<button class="linkbtn" data-act="login" data-p="${p}">Log in ${I.ext}</button>`;
  const pwNote = k => pwDays() && c.pwd[k] ? `Changed ${ago(c.pwd[k])}` : '';
  const fieldRows = s => s.fields.filter(f => !['name', 'type', 'fileNo', 'group'].includes(f.k) && c[f.k] && shows(f, c.type)).map(f => {
    const v = c[f.k], o = { secret: f.secret, mono: f.up || f.rule === 'aadhaar' || f.input === 'numeric' || f.input === 'tel', link: f.link };
    if (f.k === 'aadhaar') { const d = aadhaarDigits(v); if (d.length === 12) { o.text = d.replace(/(\d{4})(?=\d)/g, '$1 '); o.mask = '•••• •••• ' + d.slice(-4); } }
    if (f.input === 'date') o.text = fmtDate(v);
    if (f.k === 'itPass') o.note = pwNote('it');
    if (f.k === 'tracesPass') o.note = pwNote('traces');
    return row(fnv(f.label, c.type), v, o);
  });

  const m = mobileOf(c), today = todayStr();
  let html = bar({ left: backBtn(DETAIL_BACK_LABEL[DETAIL_BACK] || 'Clients', 'back'), title: c.name, big: true, right: `<button class="nav-btn" data-act="edit">Edit</button>` });
  html += `<div class="hero">${avatar(c.name, true)}<h2 data-big>${esc(c.name)}</h2><p>${esc([c.type, c.fileNo && 'File ' + c.fileNo, c.group].filter(Boolean).join(' · '))}</p></div>`;
  html += `<nav class="qa" aria-label="Contact">
    <a ${c.mobile ? `href="tel:${esc(c.mobile)}"` : 'aria-disabled="true"'}>${I.phone}<span>Call</span></a>
    <a href="#" ${m ? 'data-act="wa"' : 'aria-disabled="true"'}>${I.chat}<span>WhatsApp</span></a>
    <a ${c.email ? `href="mailto:${esc(c.email)}"` : 'aria-disabled="true"'}>${I.mail}<span>Email</span></a>
  </nav>`;

  // Compliance: what's open in the next 45 days
  const open = [...tasksOf(c, addDays(today, 45)), ...pwTasks(c).filter(t => t.due <= addDays(today, 45))]
    .filter(t => !DONE.has(t.status)).sort((a, b) => a.due < b.due ? -1 : 1);
  const tracked = Object.keys(c.comp).length;
  const compRows = open.slice(0, 6).map(t => taskRow(t, false));
  if (open.length > 6) compRows.push(`<button class="row link" data-act="alldue">${open.length - 6} more…</button>`);
  if (!tracked) compRows.push(`<button class="row link" data-act="comp">Choose returns to track</button>`);
  else if (!open.length) compRows.push(`<div class="row"><span class="grow muted">Nothing due in the next 45 days</span></div>`);
  html += section('Compliance', compRows, tracked ? `<button class="linkbtn" data-act="comp">Manage</button>` : '');

  const f = feeTotals(c);
  html += section('Fees', [`<button class="row" data-act="fees"><span class="grow">${f.due > 0 ? 'Outstanding' : f.billed ? 'All paid' : 'No fees recorded'}<small>Billed ${inr(f.billed)} · Received ${inr(f.received)}</small></span><span class="amt${f.due > 0 ? ' due' : ''}">${inr(f.due)}</span><span class="chev">${I.chev}</span></button>`]);

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
  html += section(SECTIONS[2].title, fieldRows(SECTIONS[2]), loginBtn('it'));
  c.gst.forEach((g, i) => {
    const rows = [];
    if (g.gstin) rows.push(row('GSTIN', g.gstin, { mono: true }));
    if (g.user) rows.push(row('Username', g.user));
    if (g.pass) rows.push(row('Password', g.pass, { secret: true, note: pwNote('gst:' + g.gstin) }));
    html += section(`GST · ${GST_STATES[g.gstin?.slice(0, 2)] || 'Registration'}`, rows, loginBtn('gst:' + i));
  });
  for (const s of SECTIONS.slice(3)) html += section(s.title, fieldRows(s), s.portal ? loginBtn(s.portal) : '');
  html += section('Other details', [
    ...S.meta.customFields.filter(x => c.custom[x.id]).map(x => row(x.label, c.custom[x.id], { secret: x.secret })),
    ...c.extra.filter(x => x.value).map(x => row(x.label || 'Other', x.value, { secret: x.secret })),
  ]);
  const rel = related(c);
  if (rel.length) html += section(`${c.group} · related`, rel.map(clientRow));
  html += `<p class="meta">Added ${fmtDate(c.created)}${c.updated && c.updated !== c.created ? ' · Updated ' + fmtDate(c.updated) : ''}</p>`;
  app.innerHTML = html;

  const timers = {};
  ACT.back = () => goBack(DETAIL_BACK);
  ACT.edit = () => { if (canWrite()) go('edit', id); };
  ACT.wa = () => go('wa', { id, back: 'detail' });
  ACT.comp = () => { if (canWrite()) go('comp', id); };
  ACT.fees = () => go('fees', id);
  ACT.task = t => go('task', { id, key: t.dataset.k, back: 'detail' });
  ACT.pwtask = () => { if (canWrite()) go('edit', id); };
  ACT.alldue = () => { DUEF = 'open'; go('due'); };
  ACT.login = t => go('login', { id, p: t.dataset.p, back: 'detail' });
  ACT.open = t => go('detail', t.dataset.id);
  ACT.copy = async t => {
    const v = vals[+t.dataset.i];
    try {
      await navigator.clipboard.writeText(v.raw);
      toast(`${v.label} copied`);
      t.innerHTML = I.check; t.classList.add('done');
      setTimeout(() => { t.innerHTML = I.copy; t.classList.remove('done'); }, 1400);
    } catch { toast('Couldn’t copy'); }
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
    input = `<input class="finput${f.up ? ' up' : ''}${f.secret ? ' masked' : ''}" type="${t}" ${attrs}${f.input === 'numeric' ? ' inputmode="numeric"' : ''}${f.max ? ` maxlength="${f.max + 4}"` : ''}${f.input === 'date' ? ` max="${new Date().toISOString().slice(0, 10)}"` : ''} data-ph="${f.k}"${f.list ? ` list="dl-${f.k}"` : ''} placeholder="${esc(fnv(f.ph, type) || '')}" value="${esc(v)}">`;
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
  const groups = [...new Set(S.clients.map(x => x.group).filter(Boolean))].sort();
  html += `<datalist id="dl-group">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></form>`;
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

  ACT.cancel = () => { if (!dirty || confirm('Discard your changes?')) orig ? goBack('detail', id) : goBack('list'); };
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
    // Remember when each portal password was last changed, for the change reminders.
    d.pwd = { ...c.pwd };
    const stamp = (k, before, now) => { if (!now) delete d.pwd[k]; else if (now !== before || !d.pwd[k]) d.pwd[k] = todayStr(); };
    stamp('it', orig?.itPass, d.itPass);
    stamp('traces', orig?.tracesPass, d.tracesPass);
    for (const k of Object.keys(d.pwd)) if (k.startsWith('gst:') && !d.gst.some(g => 'gst:' + g.gstin === k)) delete d.pwd[k];
    d.gst.forEach(g => { if (g.gstin) stamp('gst:' + g.gstin, orig?.gst.find(x => x.gstin === g.gstin)?.pass, g.pass); });
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
    <div class="group-h">Practice</div>
    <div class="group">
      <button class="row" data-act="dash"><span class="grow">Overview</span><span class="chev">${I.chev}</span></button>
      <button class="row" data-act="due"><span class="grow">Due dates</span><span class="chev">${I.chev}</span></button>
      <button class="row" data-act="templates"><span class="grow">WhatsApp messages</span><span class="chev">${I.chev}</span></button>
      <label class="row"><span class="grow">Password change reminder</span><select class="plain" id="pwDays">${[[0, 'Off'], [90, 'Every 90 days'], [120, 'Every 120 days'], [180, 'Every 180 days'], [365, 'Every year']].map(([v, l]) => `<option value="${v}"${pwDays() === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <p class="foot">Reminds you to change each portal password this long after it was last changed in the app.</p>
    <div class="group-h">Excel</div>
    <div class="group">
      <button class="row link" data-act="csvin">Import clients from Excel (CSV)</button>
      <button class="row link" data-act="csvout">Export client list (CSV)</button>
      <button class="row link" data-act="csvsample">Download sample import file</button>
    </div>
    <p class="foot">In Excel, use File → Save As → CSV. Exported lists leave out passwords and show only the last 4 digits of Aadhaar.</p>
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
    <input type="file" id="file" accept=".json,application/json" hidden>
    <input type="file" id="csvfile" accept=".csv,text/csv,text/comma-separated-values" hidden>`;

  $('#lockAfter').onchange = e => { settings.lockAfter = +e.target.value; saveSettings(); toast('Auto-lock updated'); };
  ACT.back = () => goBack('list');
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
  $('#pwDays').onchange = async e => {
    if (!canWrite()) return;
    const prev = S.meta.pwDays;
    S.meta.pwDays = +e.target.value;
    try { await saveMeta(); toast('Reminder updated'); } catch (er) { S.meta.pwDays = prev; toast(errText(er)); }
  };
  ACT.dash = () => go('dash');
  ACT.due = () => { DUEF = 'open'; go('due'); };
  ACT.templates = () => go('templates');
  ACT.csvout = () => exportClientsCSV();
  ACT.csvsample = () => sampleCSV();
  ACT.csvin = () => { if (canWrite()) { suppressLock = true; $('#csvfile').click(); } };
  $('#csvfile').onchange = async e => {
    suppressLock = false;
    const file = e.target.files[0]; if (!file) return;
    try { go('csvimport', { rows: csvToClients(await file.text()) }); }
    catch (er) { toast(er.message || 'Couldn’t read that file'); }
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
  ACT.back = () => goBack('settings');
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
  ACT.back = () => goBack('settings');
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

// ---------- compliance calendar ----------
// Statutory due dates as notified. Extensions announced later by CBDT/CBIC/MCA are not applied
// automatically; any single filing's due date can be changed on its screen.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const todayStr = () => { const t = new Date(); return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const fmtShort = s => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fyStart = s => { const d = new Date(s + 'T00:00:00'); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; };
const FY = s => `FY ${s}-${String(s + 1).slice(2)}`, AY = s => `AY ${s + 1}-${String(s + 2).slice(2)}`;
const nextMonth = (y, m) => m === 12 ? [y + 1, 1] : [y, m + 1];
const monthsOfFY = s => Array.from({ length: 12 }, (_, i) => { const m = (i + 3) % 12 + 1; return [m >= 4 ? s : s + 1, m]; });
const quartersOfFY = s => [[s, 4, 6], [s, 7, 9], [s, 10, 12], [s + 1, 1, 3]];
const monthly = (day, marchDue) => s => monthsOfFY(s).map(([y, m]) => {
  const [ny, nm] = nextMonth(y, m);
  return { p: ymd(y, m, 1).slice(0, 7), label: `${MON[m - 1]} ${y}`, due: marchDue && m === 3 ? ymd(y, 4, 30) : ymd(ny, nm, day) };
});
const quarterly = day => (s, c, g) => quartersOfFY(s).map(([y, a, b], i) => {
  const [ny, nm] = nextMonth(y, b);
  return { p: `${s}Q${i + 1}`, label: `${MON[a - 1]}–${MON[b - 1]} ${y}`, due: ymd(ny, nm, typeof day === 'function' ? day(g) : day) };
});
const yearly = (m, d, label = FY) => s => [{ p: `FY${s}`, label: label(s), due: ymd(s + 1, m, d) }];
const dated = list => s => list(s).map(([y, m, d, label], i) => ({ p: `${s}-${i + 1}`, label, due: ymd(y, m, d) }));
// QRMP GSTR-3B is due on the 22nd in these states/UTs (by GSTIN state code), on the 24th elsewhere.
const QRMP22 = new Set(['22', '23', '24', '25', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37']);
const qrmpDay = g => !g || QRMP22.has(g.slice(0, 2)) ? 22 : 24;
const NOT_CO = ['Individual', 'HUF', 'Partnership Firm', 'LLP', 'Trust', 'AOP', 'BOI', 'Local Authority', 'Artificial Juridical Person', 'Government'];
const COMP = [
  { code: 'ITR', group: 'Income Tax', name: 'ITR (non-audit)', due: '31 Jul', portal: 'it', types: NOT_CO, gen: yearly(7, 31, AY) },
  { code: 'ITR_A', group: 'Income Tax', name: 'ITR (audit / company)', due: '31 Oct', portal: 'it', gen: yearly(10, 31, AY) },
  { code: 'TAR', group: 'Income Tax', name: 'Tax audit report', due: '30 Sep', portal: 'it', gen: yearly(9, 30) },
  { code: 'ADV', group: 'Income Tax', name: 'Advance tax', due: '15 Jun · Sep · Dec · Mar', portal: 'it',
    gen: dated(s => [[s, 6, 15, `${FY(s)} · 1st instalment`], [s, 9, 15, `${FY(s)} · 2nd instalment`], [s, 12, 15, `${FY(s)} · 3rd instalment`], [s + 1, 3, 15, `${FY(s)} · 4th instalment`]]) },
  { code: 'GSTR1M', group: 'GST', gst: true, name: 'GSTR-1 (monthly)', due: '11th of next month', portal: 'gst', gen: monthly(11) },
  { code: 'GSTR3BM', group: 'GST', gst: true, name: 'GSTR-3B (monthly)', due: '20th of next month', portal: 'gst', gen: monthly(20) },
  { code: 'GSTR1Q', group: 'GST', gst: true, name: 'GSTR-1 (QRMP)', due: '13th after the quarter', portal: 'gst', gen: quarterly(13) },
  { code: 'GSTR3BQ', group: 'GST', gst: true, name: 'GSTR-3B (QRMP)', due: '22nd / 24th after the quarter', portal: 'gst', gen: quarterly(qrmpDay) },
  { code: 'CMP08', group: 'GST', gst: true, name: 'CMP-08 (composition)', due: '18th after the quarter', portal: 'gst', gen: quarterly(18) },
  { code: 'GSTR4', group: 'GST', gst: true, name: 'GSTR-4 (composition annual)', due: '30 Apr', portal: 'gst', gen: yearly(4, 30) },
  { code: 'GSTR9', group: 'GST', gst: true, name: 'GSTR-9 / 9C (annual)', due: '31 Dec', portal: 'gst', gen: yearly(12, 31) },
  { code: 'TDSPAY', group: 'TDS', name: 'TDS / TCS payment', due: '7th of next month (March: 30 Apr)', portal: 'it', gen: monthly(7, true) },
  { code: 'TDSRET', group: 'TDS', name: 'TDS / TCS returns', due: '31 Jul · 31 Oct · 31 Jan · 31 May', portal: 'traces',
    gen: dated(s => [[s, 7, 31, `${FY(s)} · Q1`], [s, 10, 31, `${FY(s)} · Q2`], [s + 1, 1, 31, `${FY(s)} · Q3`], [s + 1, 5, 31, `${FY(s)} · Q4`]]) },
  { code: 'PFESI', group: 'Payroll', name: 'PF & ESI', due: '15th of next month', gen: monthly(15) },
  { code: 'AOC4', group: 'ROC', types: ['Company'], name: 'AOC-4 (financial statements)', due: '30 Oct (AGM on 30 Sep)', gen: yearly(10, 30) },
  { code: 'MGT7', group: 'ROC', types: ['Company'], name: 'MGT-7 (annual return)', due: '29 Nov (AGM on 30 Sep)', gen: yearly(11, 29) },
  { code: 'LLP11', group: 'ROC', types: ['LLP'], name: 'LLP Form 11 (annual return)', due: '30 May', gen: yearly(5, 30) },
  { code: 'LLP8', group: 'ROC', types: ['LLP'], name: 'LLP Form 8 (accounts)', due: '30 Oct', gen: yearly(10, 30) },
];
const COMPS = Object.fromEntries(COMP.map(d => [d.code, d]));
const STATUS = [['pending', 'Pending'], ['docs', 'Docs received'], ['filed', 'Filed'], ['done', 'Completed']];
const STATUS_LABEL = Object.fromEntries(STATUS);
const DONE = new Set(['filed', 'done']);

// Every filing for a client from when tracking started up to `until`, oldest first.
function tasksOf(c, until) {
  const out = [], gstins = c.gst.map(g => g.gstin).filter(g => GSTIN_RE.test(g));
  for (const [code, from] of Object.entries(c.comp)) {
    const def = COMPS[code];
    if (!def) continue;
    const regs = def.gst && gstins.length ? gstins : [''];
    for (let s = fyStart(from) - 1; s <= fyStart(until); s++) for (const g of regs) for (const t of def.gen(s, c, g)) {
      const key = `${code}|${t.p}${g ? '|' + g : ''}`, w = c.work[key] || {}, due = w.due || t.due;
      if (t.due < from || due > until) continue;
      const title = def.name + (g && gstins.length > 1 ? ` · ${GST_STATES[g.slice(0, 2)] || g}` : '');
      out.push({ kind: 'task', key, def, c, g, title, period: t.label, std: t.due, due, w, status: w.s || 'pending' });
    }
  }
  return out.sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}

// ---------- portal passwords ----------
const pwDays = () => S.meta.pwDays ?? 180;
const PORTAL_URL = { it: 'https://eportal.incometax.gov.in/iec/foservices/#/login', traces: 'https://www.tdscpc.gov.in/app/login.xhtml', gst: GST_URL };
function portalsOf(c) {
  const list = [{ p: 'it', name: 'Income Tax', user: c.itUser || c.pan || '', pass: c.itPass || '', url: PORTAL_URL.it }];
  c.gst.forEach((g, i) => list.push({ p: 'gst:' + i, pw: 'gst:' + g.gstin, name: c.gst.length > 1 ? `GST · ${GST_STATES[g.gstin?.slice(0, 2)] || g.gstin}` : 'GST', user: g.user || '', pass: g.pass || '', url: PORTAL_URL.gst }));
  list.push({ p: 'traces', name: 'TRACES', user: c.tracesUser || '', pass: c.tracesPass || '', url: PORTAL_URL.traces });
  for (const x of list) x.pw ||= x.p;
  return list;
}
function pwTasks(c) {
  const days = pwDays();
  if (!days) return [];
  return portalsOf(c).filter(x => x.pass && c.pwd[x.pw]).map(x => ({
    kind: 'pw', key: 'pw|' + x.pw, c, title: `Change ${x.name} password`, period: `Last changed ${fmtDate(c.pwd[x.pw])}`,
    due: addDays(c.pwd[x.pw], days), status: 'pending', w: {},
  }));
}
function ago(s) {
  const n = daysBetween(s, todayStr());
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 60 ? `${n} days ago` : `${Math.round(n / 30)} months ago`;
}

// ---------- fees ----------
const inr = n => '₹' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN');
function feeTotals(c) {
  let billed = 0, received = 0;
  for (const e of c.fees) e.kind === 'bill' ? (billed += +e.amt) : (received += +e.amt);
  return { billed, received, due: Math.round((billed - received) * 100) / 100 };
}

// ---------- WhatsApp templates ----------
const DEFAULT_TPLS = [
  { id: 'itr', name: 'ITR documents request', text: 'Dear {name}, please share the following for filing your Income Tax Return for {ay}: Form 16 / salary details, bank statements and interest certificates, investment proofs (80C, 80D etc.), capital gains statements, and any other income details. — {firm}' },
  { id: 'gst', name: 'GST data request', text: 'Dear {name}, please share your sales and purchase details for {period} so we can file your GST returns. — {firm}' },
  { id: 'due', name: 'Due date reminder', text: 'Dear {name}, a reminder that your {return} for {period} is due on {due}. Please share the pending details at the earliest. — {firm}' },
  { id: 'filed', name: 'Return filed', text: 'Dear {name}, your {return} for {period} has been filed on {filed}. Acknowledgement no.: {ack}. — {firm}' },
  { id: 'fees', name: 'Fees reminder', text: 'Dear {name}, a balance of {balance} is pending towards our professional fees. Kindly arrange the payment at your convenience. — {firm}' },
];
const tpls = () => S.meta.templates || DEFAULT_TPLS;
const TPL_TAGS = ['name', 'pan', 'gstin', 'ay', 'fy', 'return', 'period', 'due', 'filed', 'ack', 'balance', 'firm'];
function fillTpl(text, c, t) {
  const last = new Date(); last.setDate(1); last.setMonth(last.getMonth() - 1);
  const prevFY = fyStart(todayStr()) - 1;
  const v = {
    name: c.name, pan: c.pan || '', gstin: t?.g || c.gst[0]?.gstin || '', ay: AY(prevFY), fy: FY(prevFY),
    return: t?.title || '', period: t?.period || `${MON[last.getMonth()]} ${last.getFullYear()}`,
    due: t ? fmtDate(t.due) : '', filed: t?.w?.on ? fmtDate(t.w.on) : '', ack: t?.w?.ack || '',
    balance: inr(feeTotals(c).due), firm: S.meta.firm || '',
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m).replace(/\s*—\s*$/, '').trim();
}
const mobileOf = c => { const m = normMobile(c.mobile || ''); return /^[6-9]\d{9}$/.test(m) ? m : ''; };
// Leaving for WhatsApp or a portal shouldn't lock the app if it's set to lock on leaving.
let graceUntil = 0;
function openWhatsApp(c, text) {
  const m = mobileOf(c);
  if (!m) return toast('Add a 10-digit mobile number first');
  graceUntil = Date.now() + 120000;
  window.open(`https://wa.me/91${m}${text ? '?text=' + encodeURIComponent(text) : ''}`, '_blank', 'noopener');
}

// ---------- shared bits ----------
const related = c => c.group ? S.clients.filter(x => x.id !== c.id && x.group && x.group.toLowerCase() === c.group.toLowerCase()) : [];
const clientRow = x => `<button class="row lrow" data-act="open" data-id="${esc(x.id)}">${avatar(x.name)}<span class="lt"><b>${esc(x.name)}</b><small>${esc([x.type, x.pan].filter(Boolean).join(' · '))}</small></span><span class="chev">${I.chev}</span></button>`;
function dueChip(t) {
  if (DONE.has(t.status)) return `<span class="duechip okc">${t.w.on ? 'Filed ' + fmtShort(t.w.on) : 'Filed'}</span>`;
  const n = daysBetween(todayStr(), t.due);
  const txt = n < 0 ? `${-n}d overdue` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtShort(t.due);
  return `<span class="duechip ${n < 0 ? 'late' : n <= 7 ? 'soon' : ''}">${txt}</span>`;
}
const taskRow = (t, withClient = true) => `<button class="row ${withClient ? 'lrow' : 'trow'}" data-act="${t.kind === 'pw' ? 'pwtask' : 'task'}" data-id="${esc(t.c.id)}" data-k="${esc(t.key)}">
  ${withClient ? avatar(t.c.name) : `<span class="sdot s-${t.status}" aria-hidden="true"></span>`}
  <span class="lt"><b>${esc(withClient ? t.c.name : t.title)}</b><small>${esc(withClient ? `${t.title} · ${t.period}` : `${t.period}${t.kind === 'task' ? ' · ' + STATUS_LABEL[t.status] : ''}`)}</small></span>
  ${dueChip(t)}</button>`;
function collectDue(until) {
  return S.clients.flatMap(c => [...tasksOf(c, until), ...pwTasks(c).filter(t => t.due <= until)]).sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}
function dueLists() {
  const today = todayStr(), wk = addDays(today, 7), all = collectDue(addDays(today, 30));
  const open = all.filter(t => !DONE.has(t.status));
  return {
    today, all,
    open,
    overdue: open.filter(t => t.due < today),
    week: open.filter(t => t.due <= wk),
    filed: all.filter(t => DONE.has(t.status) && (t.w.on || t.due) >= addDays(today, -60)).reverse(),
  };
}
const findTask = a => { const c = S.clients.find(x => x.id === a.id); return c && tasksOf(c, addDays(todayStr(), 800)).find(t => t.key === a.key); };
const backTo = () => { const p = PARENT[cur.v](cur.arg); goBack(p.v, p.arg); };
async function updateClient(c, change) {
  const d = structuredClone(c);
  change(d);
  d.updated = Date.now();
  await saveClient(d);
  return d;
}

// ---------- due dates screen ----------
let DUEF = 'open';
function renderDue() {
  const L = dueLists(), list = L[DUEF];
  const tabs = [['open', 'All open'], ['overdue', 'Overdue'], ['week', 'This week'], ['filed', 'Filed']];
  let html = bar({ left: backBtn('Clients', 'back'), title: 'Due dates', right: list.length && DUEF !== 'filed' ? `<button class="nav-btn" data-act="bulk">Remind</button>` : '' });
  html += `<div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${DUEF === k}" class="${DUEF === k ? 'on' : ''}" data-act="duef" data-f="${k}">${l}${k !== 'filed' ? ` <b>${L[k].length}</b>` : ''}</button>`).join('')}</div>`;
  if (!list.length) {
    const any = S.clients.some(c => Object.keys(c.comp).length);
    html += `<div class="empty"><b>${any ? 'All clear' : 'Nothing tracked yet'}</b>${any ? 'Nothing here right now.' : 'Open a client, then Compliance → Choose returns to track their due dates.'}</div>`;
  } else if (DUEF === 'filed') {
    html += `<div class="group-h">Filed in the last 60 days</div><div class="group">${list.map(t => taskRow(t)).join('')}</div>`;
  } else {
    const wk = addDays(L.today, 7);
    const groups = [['Overdue', t => t.due < L.today], ['Today', t => t.due === L.today], ['This week', t => t.due > L.today && t.due <= wk], ['Later this month', t => t.due > wk]];
    for (const [h, f] of groups) { const g = list.filter(f); if (g.length) html += `<div class="group-h">${h}</div><div class="group">${g.map(t => taskRow(t)).join('')}</div>`; }
  }
  html += `<p class="foot center" style="margin-top:-12px">Statutory due dates. Extensions notified later aren’t applied automatically — change a filing’s date on its screen.</p>`;
  app.innerHTML = html;
  ACT.back = () => goBack('list');
  ACT.duef = t => { DUEF = t.dataset.f; go('due', undefined, true); };
  ACT.task = t => go('task', { id: t.dataset.id, key: t.dataset.k, back: 'due' });
  ACT.pwtask = t => { if (canWrite()) go('edit', t.dataset.id); };
  ACT.bulk = () => { BULK_SENT.clear(); go('bulk'); };
}

// ---------- one filing ----------
function renderTask(a) {
  const t = findTask(a);
  if (!t) return backTo();
  const c = t.c, w = t.w, today = todayStr();
  let st = t.status;
  const n = daysBetween(today, t.due);
  const when = DONE.has(st) ? 'Filed' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'Due today' : `Due in ${n} day${n === 1 ? '' : 's'}`;
  let html = bar({ left: backBtn(a.back === 'detail' ? c.name.split(' ')[0] : 'Due dates', 'back'), title: t.title, right: `<button class="nav-btn strong" data-act="save">Done</button>` });
  html += `<div class="hero task-hero"><p class="eyebrow">${esc(t.period)}</p><h2 data-big>${esc(t.title)}</h2><p>${esc(c.name)}</p>
    <span class="duechip big ${DONE.has(st) ? 'okc' : n < 0 ? 'late' : n <= 7 ? 'soon' : ''}">${when} · ${fmtDate(t.due)}</span></div>`;
  html += `<div class="seg" role="radiogroup" aria-label="Status">${STATUS.map(([k, l]) => `<button role="radio" aria-checked="${st === k}" class="${st === k ? 'on' : ''}" data-act="st" data-s="${k}">${l}</button>`).join('')}</div>`;
  html += `<form id="tf" autocomplete="off"><div class="group">
    <label class="frow" id="onRow"${DONE.has(st) ? '' : ' hidden'}><span class="flabel">Filed on</span><input class="finput" type="date" id="on" value="${esc(w.on || today)}" max="${today}"></label>
    <label class="frow"><span class="flabel">Ack / ARN</span><input class="finput mono" id="ack" value="${esc(w.ack || '')}" placeholder="Acknowledgement number" autocapitalize="characters" autocorrect="off" spellcheck="false"></label>
    <label class="frow"><span class="flabel">Due date</span><input class="finput" type="date" id="due" value="${esc(t.due)}"></label>
    ${w.bill ? '' : `<label class="frow"><span class="flabel">Fee (₹)</span><input class="finput" id="fee" inputmode="decimal" placeholder="Optional — adds a bill"></label>`}
    <label class="frow bare"><textarea class="finput" id="note" placeholder="Notes for this filing">${esc(w.note || '')}</textarea></label>
  </div></form>`;
  if (t.due !== t.std) html += `<p class="foot">Statutory due date: ${fmtDate(t.std)}.</p>`;
  const portal = t.def.portal && portalsOf(c).find(x => t.def.portal === 'gst' ? x.p.startsWith('gst:') && (!t.g || c.gst[+x.p.slice(4)]?.gstin === t.g) : x.p === t.def.portal);
  html += `<div class="group">
    ${portal ? `<button class="row link" data-act="login" data-p="${portal.p}">Log in to ${esc(portal.name)} portal</button>` : ''}
    <button class="row link" data-act="remind">Send WhatsApp message</button>
    ${a.back === 'detail' ? '' : `<button class="row link" data-act="client">Open ${esc(c.name)}</button>`}
  </div>`;
  app.innerHTML = html;
  $('#tf').onsubmit = e => e.preventDefault();
  ACT.back = backTo;
  ACT.st = b => {
    st = b.dataset.s;
    $$('.seg button', app).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    $('#onRow').hidden = !DONE.has(st);
  };
  ACT.login = b => go('login', { id: c.id, p: b.dataset.p, back: 'task', task: a });
  ACT.remind = () => go('wa', { id: c.id, key: t.key, back: 'task', task: a, pick: DONE.has(st) ? 'filed' : 'due' });
  ACT.client = () => go('detail', c.id);
  ACT.save = async b => {
    if (!canWrite()) return;
    const fee = parseFloat(($('#fee')?.value || '').replace(/[,\s₹]/g, ''));
    if ($('#fee')?.value.trim() && !(fee > 0)) return toast('Enter the fee as a number');
    const due = $('#due').value || t.std;
    const nw = { s: st, ack: $('#ack').value.trim().toUpperCase(), note: $('#note').value.trim() };
    if (DONE.has(st)) nw.on = $('#on').value || today;
    if (due !== t.std) nw.due = due;
    if (w.bill) nw.bill = w.bill;
    b.disabled = true;
    try {
      await updateClient(c, d => {
        if (fee > 0) { const e = { id: uid(), date: nw.on || today, kind: 'bill', amt: fee, desc: `${t.title} · ${t.period}` }; d.fees.push(e); nw.bill = e.id; }
        for (const k of Object.keys(nw)) if (nw[k] === '' || nw[k] == null) delete nw[k];
        d.work[t.key] = nw;
      });
      toast('Saved'); backTo();
    } catch (e) { b.disabled = false; toast(errText(e)); }
  };
}

// ---------- choose returns to track ----------
function renderComp(id) {
  const c = S.clients.find(x => x.id === id);
  if (!c) return go('list');
  const sel = new Set(Object.keys(c.comp)), noGst = !c.gst.some(g => GSTIN_RE.test(g.gstin));
  let html = bar({ left: `<button class="nav-btn" data-act="back">Cancel</button>`, title: 'Returns to track', right: `<button class="nav-btn strong" data-act="save">Done</button>` });
  html += `<p class="foot" style="margin:0 34px 16px">${esc(c.name)} · ${esc(c.type)}</p>`;
  for (const g of ['Income Tax', 'GST', 'TDS', 'Payroll', 'ROC']) {
    const defs = COMP.filter(d => d.group === g && (!d.types || d.types.includes(c.type)));
    if (!defs.length) continue;
    html += `<div class="group-h">${g}</div><div class="group">${defs.map(d => `<div class="row"><span class="grow">${esc(d.name)}<small>Due ${esc(d.due)}</small></span>${sw(sel.has(d.code), 'tog', ` data-c="${d.code}" aria-label="${esc(d.name)}"`)}</div>`).join('')}</div>`;
    if (g === 'GST' && noGst) html += `<p class="foot">Add a GSTIN to this client so GST filings show the right state and due dates.</p>`;
  }
  html += `<p class="foot">Tracking starts with filings due in the last 60 days. Extensions notified later aren’t applied automatically.</p>`;
  app.innerHTML = html;
  ACT.back = backTo;
  ACT.tog = t => { const on = t.getAttribute('aria-checked') !== 'true'; t.setAttribute('aria-checked', on); on ? sel.add(t.dataset.c) : sel.delete(t.dataset.c); };
  ACT.save = async b => {
    if (!canWrite()) return;
    const start = addDays(todayStr(), -60);
    b.disabled = true;
    try {
      await updateClient(c, d => { d.comp = Object.fromEntries([...sel].map(k => [k, c.comp[k] || start])); });
      toast('Saved'); backTo();
    } catch (e) { b.disabled = false; toast(errText(e)); }
  };
}

// ---------- fees ledger ----------
function renderFees(id) {
  const c = S.clients.find(x => x.id === id);
  if (!c) return go('list');
  const f = feeTotals(c), today = todayStr();
  let kind = 'bill';
  let html = bar({ left: backBtn(c.name.split(' ')[0], 'back'), title: 'Fees' });
  html += `<div class="tiles"><div class="tile"><b>${inr(f.billed)}</b><span>Billed</span></div><div class="tile"><b>${inr(f.received)}</b><span>Received</span></div><div class="tile ${f.due > 0 ? 'red' : 'green'}"><b>${inr(f.due)}</b><span>Outstanding</span></div></div>`;
  html += `<div class="seg" role="radiogroup" aria-label="Entry type"><button class="on" role="radio" aria-checked="true" data-act="kind" data-k="bill">Bill</button><button role="radio" aria-checked="false" data-act="kind" data-k="rcpt">Payment received</button></div>`;
  html += `<form id="ff" autocomplete="off"><div class="group">
    <label class="frow"><span class="flabel">Amount (₹)</span><input class="finput" id="amt" inputmode="decimal" placeholder="0"></label>
    <label class="frow"><span class="flabel">Date</span><input class="finput" type="date" id="fdate" value="${today}" max="${today}"></label>
    <label class="frow"><span class="flabel">For</span><input class="finput" id="fdesc" placeholder="e.g. ITR AY 2026-27"></label>
    <button type="button" class="row link" data-act="fadd" style="justify-content:center;font-weight:600">Add entry</button>
  </div></form>`;
  const entries = [...c.fees].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  html += entries.length ? `<div class="group-h">Ledger</div><div class="group">${entries.map(e => `<button class="row" data-act="fdel" data-i="${esc(e.id)}"><span class="grow">${esc(e.desc || (e.kind === 'bill' ? 'Professional fees' : 'Payment received'))}<small>${fmtDate(e.date)} · ${e.kind === 'bill' ? 'Bill' : 'Payment'}</small></span><span class="amt${e.kind === 'bill' ? '' : ' in'}">${e.kind === 'bill' ? '' : '−'}${inr(e.amt)}</span></button>`).join('')}</div>
    <p class="foot">Tap an entry to delete it.</p>` : `<div class="empty"><b>No entries yet</b>Add a bill when you agree a fee, and a payment when it’s received.</div>`;
  if (f.due > 0) html += `<div class="group"><button class="row link" data-act="remindfee">Send fees reminder on WhatsApp</button></div>`;
  app.innerHTML = html;
  $('#ff').onsubmit = e => e.preventDefault();
  ACT.back = backTo;
  ACT.kind = b => { kind = b.dataset.k; $$('.seg button', app).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); };
  ACT.fadd = async b => {
    if (!canWrite()) return;
    const amt = parseFloat($('#amt').value.replace(/[,\s₹]/g, ''));
    if (!(amt > 0)) { toast('Enter an amount'); return $('#amt').focus(); }
    const date = $('#fdate').value || today;
    if (date > today) return toast('The date can’t be in the future');
    b.disabled = true;
    try {
      await updateClient(c, d => d.fees.push({ id: uid(), date, kind, amt, desc: $('#fdesc').value.trim() }));
      toast(kind === 'bill' ? 'Bill added' : 'Payment recorded'); go('fees', id, true);
    } catch (e) { b.disabled = false; toast(errText(e)); }
  };
  ACT.fdel = async b => {
    const e = c.fees.find(x => x.id === b.dataset.i);
    if (!e || !canWrite() || !confirm(`Delete this ${e.kind === 'bill' ? 'bill' : 'payment'} of ${inr(e.amt)}?`)) return;
    try {
      await updateClient(c, d => {
        d.fees = d.fees.filter(x => x.id !== e.id);
        for (const w of Object.values(d.work)) if (w.bill === e.id) delete w.bill;
      });
      toast('Entry deleted'); go('fees', id, true);
    } catch (er) { toast(errText(er)); }
  };
  ACT.remindfee = () => go('wa', { id, back: 'fees', pick: 'fees' });
}

// ---------- WhatsApp message picker ----------
function renderWa(a) {
  const c = S.clients.find(x => x.id === a.id);
  if (!c) return go('list');
  const t = a.key ? findTask(a) : null, m = mobileOf(c);
  const list = [...tpls()].sort((x, y) => (y.id === a.pick) - (x.id === a.pick));
  let html = bar({ left: backBtn('Back', 'back'), title: 'WhatsApp' });
  html += `<p class="foot" style="margin:0 34px 16px">To ${esc(c.name)}${m ? ' · +91 ' + m : ''}</p>`;
  if (!m) html += `<div class="banner">Add a 10-digit mobile number to this client to send WhatsApp messages.</div>`;
  html += `<div class="group">${list.map(x => `<button class="row" data-act="send" data-t="${esc(x.id)}"${m ? '' : ' disabled'}><span class="grow"><b class="tname">${esc(x.name)}</b><span class="preview">${esc(fillTpl(x.text, c, t))}</span></span><span class="chev">${I.chev}</span></button>`).join('')}
    <button class="row link" data-act="send" data-t=""${m ? '' : ' disabled'}>Open chat without a message</button></div>
  <p class="foot">Edit these messages in Settings → WhatsApp messages.</p>`;
  app.innerHTML = html;
  ACT.back = backTo;
  ACT.send = b => { const x = tpls().find(y => y.id === b.dataset.t); openWhatsApp(c, x ? fillTpl(x.text, c, t) : ''); };
}

// ---------- bulk reminders ----------
const BULK_SENT = new Set();
let BULK_TPL = 'due';
function renderBulk() {
  const L = dueLists(), list = (L[DUEF] || L.open).filter(t => t.kind === 'task' && !DONE.has(t.status));
  let html = bar({ left: backBtn('Due dates', 'back'), title: 'Send reminders' });
  html += `<div class="group"><label class="row"><span class="grow">Message</span><select class="plain" id="btpl">${tpls().map(x => `<option value="${esc(x.id)}"${x.id === BULK_TPL ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>`;
  html += `<p class="foot">Each tap opens WhatsApp with the message filled in for that client. Send it, come back, and tap the next one.</p>`;
  html += list.length ? `<div class="group">${list.map(t => {
    const sent = BULK_SENT.has(t.c.id + '|' + t.key), m = mobileOf(t.c);
    return `<div class="row lrow">${avatar(t.c.name)}<span class="lt"><b>${esc(t.c.name)}</b><small>${esc(t.title)} · ${esc(t.period)} · due ${fmtShort(t.due)}</small></span>${
      m ? `<button class="sendbtn${sent ? ' sent' : ''}" data-act="bsend" data-k="${esc(t.key)}" data-id="${esc(t.c.id)}">${sent ? 'Sent' : 'Send'}</button>` : '<span class="tag">No mobile</span>'}</div>`;
  }).join('')}</div>` : `<div class="empty"><b>No one to remind</b>There are no open filings in this list.</div>`;
  app.innerHTML = html;
  $('#btpl').onchange = e => { BULK_TPL = e.target.value; };
  ACT.back = backTo;
  ACT.bsend = b => {
    const t = list.find(x => x.key === b.dataset.k && x.c.id === b.dataset.id), x = tpls().find(y => y.id === BULK_TPL) || tpls()[0];
    if (!t) return;
    openWhatsApp(t.c, fillTpl(x.text, t.c, t));
    BULK_SENT.add(t.c.id + '|' + t.key); b.textContent = 'Sent'; b.classList.add('sent');
  };
}

// ---------- portal login helper ----------
function renderLogin(a) {
  const c = S.clients.find(x => x.id === a.id);
  const p = c && portalsOf(c).find(x => x.p === a.p);
  if (!p) return backTo();
  graceUntil = Date.now() + 180000;
  let html = bar({ left: backBtn('Back', 'back'), title: `${p.name} login` });
  html += `<div class="hero task-hero"><p class="eyebrow">${esc(c.name)}</p><h2 data-big>${esc(p.name)} portal</h2></div>`;
  html += `<div class="group">
    <div class="row"><div class="dcol"><div class="dlabel">User ID</div><div class="dval mono">${esc(p.user || 'Not saved')}</div></div>${p.user ? `<button class="copybtn" data-act="cp" data-w="user">Copy</button>` : ''}</div>
    <div class="row"><div class="dcol"><div class="dlabel">Password</div><div class="dval" id="pv">${p.pass ? '••••••••' : 'Not saved'}</div></div>${p.pass ? `<button class="ibtn" data-act="peek" aria-label="Show password">${I.eye}</button><button class="copybtn" data-act="cp" data-w="pass">Copy</button>` : ''}</div>
  </div>`;
  html += `<div class="pad"><a class="btn primary" href="${p.url}" target="_blank" rel="noopener noreferrer" data-act="open">Open ${esc(p.name)} portal</a></div>`;
  html += `<p class="foot" style="margin-top:16px">Copy the user ID, open the portal and paste it. Come back here, copy the password and paste that too. The app stays unlocked for 3 minutes while you switch.</p>`;
  if (pwDays() && p.pass && c.pwd[p.pw]) html += `<p class="foot">Password last changed ${ago(c.pwd[p.pw])}.</p>`;
  app.innerHTML = html;
  ACT.back = () => { graceUntil = 0; backTo(); };
  ACT.cp = async b => {
    try { await navigator.clipboard.writeText(b.dataset.w === 'user' ? p.user : p.pass); b.textContent = 'Copied'; b.classList.add('done'); setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 1500); }
    catch { toast('Couldn’t copy'); }
  };
  ACT.peek = b => { const el = $('#pv'), hid = el.textContent.startsWith('•'); el.textContent = hid ? p.pass : '••••••••'; b.innerHTML = hid ? I.eyeOff : I.eye; };
  // The link opens the portal itself; this just keeps the app unlocked meanwhile.
  app.querySelector('[data-act="open"]').addEventListener('click', () => { graceUntil = Date.now() + 180000; }, true);
}

// ---------- message templates ----------
function renderTemplates() {
  const list = tpls().map(x => ({ ...x }));
  const block = x => `<div data-tpl="${esc(x.id)}"><div class="group-h"><span>Message</span><button type="button" class="linkbtn danger" data-act="tdel">Remove</button></div><div class="group">
    <label class="frow"><span class="flabel">Name</span><input class="finput" data-f="name" value="${esc(x.name)}"></label>
    <label class="frow bare"><textarea class="finput" data-f="text" rows="4">${esc(x.text)}</textarea></label></div></div>`;
  let html = bar({ left: `<button class="nav-btn" data-act="back">Cancel</button>`, title: 'WhatsApp messages', right: `<button class="nav-btn strong" data-act="save">Done</button>` });
  html += `<div class="group-h">Signature</div><div class="group"><label class="frow"><span class="flabel">Firm name</span><input class="finput" id="firm" value="${esc(S.meta.firm || '')}" placeholder="e.g. Harshad Makwana & Co."></label></div>`;
  html += `<p class="foot">Used for {firm} at the end of each message.</p>`;
  html += `<div id="tl">${list.map(block).join('')}</div><div class="group"><button class="row addrow" data-act="tadd"><span class="plus">+</span>Add message</button></div>`;
  html += `<p class="foot">Words in curly brackets are filled in for each client: ${TPL_TAGS.map(t => `{${t}}`).join(' ')}</p>`;
  app.innerHTML = html;
  ACT.back = backTo;
  ACT.tadd = () => { $('#tl').insertAdjacentHTML('beforeend', block({ id: uid(), name: 'New message', text: 'Dear {name}, ' })); $('#tl [data-tpl]:last-child textarea').focus(); };
  ACT.tdel = b => { if (confirm('Remove this message?')) b.closest('[data-tpl]').remove(); };
  ACT.save = async b => {
    if (!canWrite()) return;
    const out = $$('[data-tpl]', app).map(el => ({ id: el.dataset.tpl, name: $('[data-f="name"]', el).value.trim() || 'Message', text: $('[data-f="text"]', el).value.trim() })).filter(x => x.text);
    const prev = { templates: S.meta.templates, firm: S.meta.firm };
    S.meta.templates = out; S.meta.firm = $('#firm').value.trim();
    b.disabled = true;
    try { await saveMeta(); toast('Saved'); backTo(); }
    catch (e) { Object.assign(S.meta, prev); b.disabled = false; toast(errText(e)); }
  };
}

// ---------- CSV (Excel) import / export ----------
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const CSV_COLS = {
  name: ['name', 'client name', 'full name', 'legal name', 'client'], type: ['status', 'type', 'client type', 'category', 'constitution'],
  fileNo: ['file no', 'file', 'file number'], group: ['group', 'family', 'group / family'], pan: ['pan', 'pan no', 'pan number'],
  aadhaar: ['aadhaar', 'aadhar', 'aadhaar no', 'aadhar no', 'aadhaar number'], mobile: ['mobile', 'phone', 'mobile no', 'contact no', 'contact', 'mobile number'],
  email: ['email', 'email id', 'e-mail'], dob: ['dob', 'date of birth', 'doi', 'date of incorporation', 'dob / doi'], address: ['address'],
  gstin: ['gstin', 'gst no', 'gst number', 'gst'], gstUser: ['gst username', 'gst user', 'gst user id'], gstPass: ['gst password'],
  itUser: ['it user id', 'income tax user id', 'it user'], itPass: ['it password', 'income tax password'],
  tracesUser: ['traces user id', 'traces user'], tracesPass: ['traces password'], tan: ['tan', 'tan no'],
  regNo: ['cin', 'llpin', 'cin / llpin', 'reg no', 'registration no'], contact: ['contact person'],
  bankName: ['bank', 'bank name'], bankAcc: ['account no', 'bank account', 'account number', 'bank account no'], ifsc: ['ifsc', 'ifsc code'],
  business: ['business name', 'trade name'], notes: ['notes', 'remarks'],
};
const TYPE_WORDS = [[/propriet|individual|person/i, 'Individual'], [/huf/i, 'HUF'], [/llp/i, 'LLP'], [/partner|firm/i, 'Partnership Firm'], [/company|pvt|private|limited|ltd/i, 'Company'], [/trust/i, 'Trust'], [/boi|body of ind/i, 'BOI'], [/aop|association|society/i, 'AOP']];
function csvDate(v) {
  if (!v) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(v);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000;
  const d = new Date(y, +m[2] - 1, +m[1]);
  return d.getMonth() === +m[2] - 1 ? ymd(y, +m[2], +m[1]) : null;
}
function csvToClients(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The file has no client rows.');
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' '));
  const col = Object.fromEntries(Object.entries(CSV_COLS).map(([k, names]) => [k, head.findIndex(h => names.includes(h))]));
  if (col.name < 0) throw new Error('Couldn’t find a “Name” column in the first row.');
  const seen = { pan: new Map(), gstin: new Map() };
  return rows.slice(1).map((r, i) => {
    const n = i + 2, get = k => col[k] >= 0 ? (r[col[k]] || '').trim() : '';
    const c = tidy({}), errors = [], warns = [];
    c.name = get('name').replace(/\s+/g, ' ');
    const pan = NORM.id(get('pan')), rawType = get('type');
    c.type = (TYPE_WORDS.find(([re]) => re.test(rawType)) || [])[1] || (PAN_RE.test(pan) && PAN_TO_TYPE[pan[3]]) || 'Individual';
    for (const k of ['fileNo', 'group', 'address', 'itPass', 'tracesPass', 'bankName', 'notes', 'contact']) { const v = get(k); if (v) c[k] = v; }
    if (pan) c.pan = pan;
    const set = (k, norm) => { const v = get(k); if (v) c[k] = NORM[norm](v); };
    set('aadhaar', 'aadhaar'); set('mobile', 'mobile'); set('email', 'lower'); set('tan', 'id'); set('regNo', 'id');
    set('itUser', 'id'); set('tracesUser', 'up'); set('bankAcc', 'digits'); set('ifsc', 'id');
    const dob = csvDate(get('dob'));
    if (dob === null) errors.push(`Date “${get('dob')}” isn’t a valid date (use DD/MM/YYYY)`); else if (dob) c.dob = dob;
    const gstins = get('gstin').split(/[;,\s]+/).map(NORM.id).filter(Boolean);
    c.gst = gstins.map((g, j) => ({ gstin: g, user: j ? '' : get('gstUser'), pass: j ? '' : get('gstPass') }));
    if (!gstins.length && (get('gstUser') || get('gstPass'))) c.gst = [{ gstin: '', user: get('gstUser'), pass: get('gstPass') }];
    if (get('business') && PERSONAL.has(c.type)) c.businesses = [{ name: get('business'), nature: '', same: true, address: '', udyam: '' }];
    if (!c.pan && gstins[0] && GSTIN_RE.test(gstins[0])) c.pan = gstins[0].slice(2, 12);
    for (const k of ['itPass', 'tracesPass']) if (c[k]) c.pwd[k === 'itPass' ? 'it' : 'traces'] = todayStr();
    c.gst.forEach(g => { if (g.pass && g.gstin) c.pwd['gst:' + g.gstin] = todayStr(); });
    // Same checks as the edit screen.
    const x = { type: c.type, name: c.name, pan: c.pan || '', dob: c.dob || '', self: undefined, biz: c.businesses.map(b => b.name), gstins };
    const check = (rule, v) => { if (!v || !RULES[rule]) return; const res = RULES[rule](v, x); if (res?.level === 'err') errors.push(res.msg); else if (res?.level === 'warn') warns.push(res.msg); };
    check('name', c.name || 'x'); if (!c.name) errors.push('Name is missing');
    check('pan', c.pan); check('aadhaar', PERSONAL.has(c.type) && c.aadhaar); check('mobile', c.mobile); check('email', c.email);
    check('dob', c.dob); check('tan', c.tan); check('regNo', c.regNo); check('ifsc', c.ifsc); check('bankAcc', c.bankAcc); check('itUser', c.itUser);
    gstins.forEach(g => check('gstin', g));
    if (c.pan) { if (seen.pan.has(c.pan)) errors.push(`Same PAN as row ${seen.pan.get(c.pan)}`); else seen.pan.set(c.pan, n); }
    gstins.forEach(g => { if (seen.gstin.has(g)) errors.push(`Same GSTIN as row ${seen.gstin.get(g)}`); else seen.gstin.set(g, n); });
    if (!PERSONAL.has(c.type)) delete c.aadhaar;
    return { n, c, errors: [...new Set(errors)], warns };
  });
}
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s; // stop Excel treating a value as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
function saveFile(name, text, type, done) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    suppressLock = true;
    navigator.share({ files: [file], title: name }).then(done, er => { if (er.name !== 'AbortError') toast('Couldn’t share the file'); }).finally(() => { suppressLock = false; });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    done?.();
  }
}
function exportClientsCSV() {
  const dmy = s => s ? s.split('-').reverse().join('/') : '';
  const head = ['Name', 'Status', 'File no', 'Group', 'PAN', 'Aadhaar (masked)', 'Mobile', 'Email', 'DOB / DOI', 'Address', 'GSTIN', 'TAN', 'CIN / LLPIN', 'Business names', 'Contact person', 'Fees outstanding'];
  const rows = [...S.clients].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => [
    c.name, c.type, c.fileNo, c.group, c.pan, c.aadhaar ? 'XXXX XXXX ' + aadhaarDigits(c.aadhaar).slice(-4) : '', c.mobile, c.email, dmy(c.dob),
    c.address, c.gst.map(g => g.gstin).filter(Boolean).join('; '), c.tan, c.regNo, c.businesses.map(b => b.name).filter(Boolean).join('; '), c.contact, feeTotals(c).due || '',
  ]);
  saveFile(`client-list-${todayStr()}.csv`, toCSV([head, ...rows]), 'text/csv', () => toast('Client list exported'));
}
function sampleCSV() {
  const rows = [
    ['Name', 'Status', 'PAN', 'Aadhaar', 'Mobile', 'Email', 'Date of birth', 'Address', 'GSTIN', 'GST username', 'GST password', 'IT password', 'TAN', 'CIN', 'Group', 'File no', 'Business name'],
    ['Ramesh Kumar Patel', 'Individual', '', '', '9876543210', 'ramesh@example.com', '15/08/1980', '12 MG Road, Ahmedabad 380001', '', '', '', '', '', '', 'Patel family', '101', 'Patel Traders'],
  ];
  saveFile('client-import-sample.csv', toCSV(rows), 'text/csv');
}
function renderCsvImport(a) {
  const good = a.rows.filter(r => !r.errors.length), bad = a.rows.filter(r => r.errors.length), warned = good.filter(r => r.warns.length);
  let html = bar({ left: `<button class="nav-btn" data-act="back">Cancel</button>`, title: 'Import clients' });
  html += `<div class="tiles"><div class="tile green"><b>${good.length}</b><span>Ready</span></div><div class="tile ${bad.length ? 'red' : ''}"><b>${bad.length}</b><span>Have errors</span></div><div class="tile ${warned.length ? 'amber' : ''}"><b>${warned.length}</b><span>Warnings</span></div></div>`;
  html += good.length ? `<div class="pad"><button class="btn primary" data-act="go">Import ${plural(good.length, 'client')}</button></div><p class="foot" style="margin-top:12px">Rows with errors are skipped. Fix them in Excel and import the file again — clients already saved are recognised by PAN.</p>`
    : `<p class="foot" style="margin-top:0">Nothing can be imported yet. Fix the rows below in Excel and try again.</p>`;
  if (bad.length) html += `<div class="group-h">Skipped</div><div class="group">${bad.slice(0, 150).map(r => `<div class="row"><span class="grow">Row ${r.n} · ${esc(r.c.name || 'No name')}<small class="errtext">${esc(r.errors.join(' · '))}</small></span></div>`).join('')}</div>`;
  if (warned.length) html += `<div class="group-h">Imported with warnings</div><div class="group">${warned.slice(0, 150).map(r => `<div class="row"><span class="grow">Row ${r.n} · ${esc(r.c.name)}<small class="warntext">${esc(r.warns.join(' · '))}</small></span></div>`).join('')}</div>`;
  app.innerHTML = html;
  ACT.back = backTo;
  ACT.go = async b => {
    if (!canWrite()) return;
    b.disabled = true;
    let n = 0;
    try {
      for (const r of good) {
        const now = Date.now();
        await saveClient({ ...r.c, id: uid(), created: now, updated: now });
        b.textContent = `Importing ${++n} of ${good.length}…`;
      }
      toast(`Imported ${plural(n, 'client')}`); go('list');
    } catch (e) { b.disabled = false; b.textContent = `Import remaining clients`; toast(`${n} imported. ${errText(e)}`); good.splice(0, n); }
  };
}

// ---------- dashboard ----------
function renderDash() {
  const L = dueLists(), today = L.today, monthEnd = ymd(+today.slice(0, 4), +today.slice(5, 7), new Date(+today.slice(0, 4), +today.slice(5, 7), 0).getDate());
  const fees = S.clients.map(c => [c, feeTotals(c)]), outstanding = fees.reduce((s, [, f]) => s + Math.max(0, f.due), 0);
  const pw = L.open.filter(t => t.kind === 'pw' && t.due <= addDays(today, 7));
  let html = bar({ left: backBtn('Clients', 'back'), title: 'Overview', big: true });
  html += `<h1 class="large" data-big>Overview</h1>`;
  html += `<div class="tiles two">
    <button class="tile" data-act="list"><b>${S.clients.length}</b><span>Clients</span></button>
    <button class="tile red" data-act="due" data-f="overdue"><b>${L.overdue.length}</b><span>Overdue filings</span></button>
    <button class="tile amber" data-act="due" data-f="week"><b>${L.week.length}</b><span>Due this week</span></button>
    <div class="tile blue"><b>${inr(outstanding)}</b><span>Fees outstanding</span></div></div>`;
  if (pw.length) html += `<button class="banner" data-act="due" data-f="open">${plural(pw.length, 'portal password')} due for a change.</button>`;
  // filings due this month, by return
  const month = collectDue(monthEnd).filter(t => t.kind === 'task' && t.due.slice(0, 7) === today.slice(0, 7));
  const byRet = {};
  for (const t of month) { const k = t.def.name; (byRet[k] ||= { done: 0, total: 0 }).total++; if (DONE.has(t.status)) byRet[k].done++; }
  const rets = Object.entries(byRet);
  if (rets.length) html += `<div class="group-h">${MON[+today.slice(5, 7) - 1]} filings</div><div class="group">${rets.map(([k, v]) => `<div class="row stat"><span class="grow">${esc(k)}<span class="bar-track"><span class="bar-fill" style="width:${Math.round(v.done / v.total * 100)}%"></span></span></span><span class="amt">${v.done}/${v.total}</span></div>`).join('')}</div>`;
  // clients by status
  const counts = {}; S.clients.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  html += `<div class="group-h">Clients by status</div><div class="group">${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="row stat"><span class="grow">${esc(k)}<span class="bar-track"><span class="bar-fill" style="width:${Math.round(v / max * 100)}%"></span></span></span><span class="amt">${v}</span></div>`).join('') || '<div class="row"><span class="grow">No clients yet</span></div>'}</div>`;
  const top = fees.filter(([, f]) => f.due > 0).sort((a, b) => b[1].due - a[1].due).slice(0, 5);
  if (top.length) html += `<div class="group-h">Highest outstanding fees</div><div class="group">${top.map(([c, f]) => `<button class="row lrow" data-act="open" data-id="${esc(c.id)}">${avatar(c.name)}<span class="lt"><b>${esc(c.name)}</b><small>Billed ${inr(f.billed)}</small></span><span class="amt due">${inr(f.due)}</span></button>`).join('')}</div>`;
  const recent = [...S.clients].sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 5);
  if (recent.length) html += `<div class="group-h">Recently updated</div><div class="group">${recent.map(c => `<button class="row lrow" data-act="open" data-id="${esc(c.id)}">${avatar(c.name)}<span class="lt"><b>${esc(c.name)}</b><small>${fmtDate(c.updated)}</small></span><span class="chev">${I.chev}</span></button>`).join('')}</div>`;
  app.innerHTML = html;
  ACT.back = () => goBack('list');
  ACT.list = () => goBack('list');
  ACT.due = b => { DUEF = b.dataset.f; go('due'); };
  ACT.open = b => go('detail', b.dataset.id);
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
