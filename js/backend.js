'use strict';
// Talking to Firebase (sign-in + Firestore), or to this browser only in demo mode.

// ---------- backends ----------
class AuthError extends Error {}
// The server couldn't be reached (no connection, timeout, or a temporary server error).
// Changes made meanwhile are kept on this device and uploaded later — see the outbox in vault.js.
class NetError extends Error {}
// Signed in, but this account may not open a vault (email not verified, or not approved yet).
class AccessError extends Error {}
const isNet = e => e instanceof TypeError || e instanceof NetError || e?.name === 'TimeoutError';
const NET_WAIT = 20000; // a request that takes longer than this counts as offline
const timeout = () => AbortSignal.timeout?.(NET_WAIT);
const AUTH_MSG = {
  EMAIL_NOT_FOUND: 'Wrong email or password.', INVALID_PASSWORD: 'Wrong email or password.',
  INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.', INVALID_EMAIL: 'That email address looks wrong.',
  MISSING_PASSWORD: 'Enter your password.', USER_DISABLED: 'This account is disabled.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Try again in a few minutes.',
  EXPIRED_OOB_CODE: 'This reset link has expired. Request a new one from the sign-in screen.',
  INVALID_OOB_CODE: 'This reset link was already used or is incomplete. Request a new one from the sign-in screen.',
  WEAK_PASSWORD: 'Choose a stronger password (at least 8 characters).',
  EMAIL_EXISTS: 'An account with this email already exists — sign in instead.',
  OPERATION_NOT_ALLOWED: 'New accounts can’t be created right now. Please contact the app owner.',
  ADMIN_ONLY_OPERATION: 'New accounts can’t be created right now. Please contact the app owner.',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'For safety, please sign in again and retry.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Try again in a few minutes.',
};
// The account that approves new people (the same one named in firebase/firestore.rules).
const isOwner = () => !DB.demo && !!CFG.ownerUid && DB.user?.uid === CFG.ownerUid;

function firebaseBackend() {
  const FS = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(CFG.projectId)}/databases/(default)/documents`;
  const ID = 'https://identitytoolkit.googleapis.com/v1/accounts';
  let auth = readLS('cv-auth');
  const saveAuth = a => { auth = a; writeLS('cv-auth', a && { uid: a.uid, email: a.email, name: a.name, refreshToken: a.refreshToken }); };

  async function post(url, body, form) {
    const r = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body) : JSON.stringify(body), signal: timeout() });
    if (r.status >= 500) throw new NetError('The server isn’t responding. Please try again.');
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
      body: body ? JSON.stringify(body) : undefined, signal: timeout() });
    if (r.status === 404 && method === 'GET') return null;
    if (r.status >= 500 || r.status === 429) throw new NetError('Couldn’t reach the vault. Please try again.');
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new AuthError('Your session expired. Please sign in again.');
    if (r.status === 403) throw new AccessError('This account doesn’t have access to the vault yet.');
    if (!r.ok) throw Object.assign(new Error('Couldn’t reach the vault. Please try again.'), { status: r.status });
    return j;
  }
  const toFields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) }]));
  const fromDoc = d => { const o = { id: d.name.split('/').pop() }; for (const [k, v] of Object.entries(d.fields || {})) o[k] = v.integerValue !== undefined ? +v.integerValue : v.stringValue; return o; };
  const mask = keys => keys.map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const base = () => `/users/${encodeURIComponent(auth.uid)}`;
  const emailKey = e => encodeURIComponent(String(e || '').toLowerCase());
  const listAll = async path => {
    const out = []; let pt = '';
    do {
      const j = await fs('GET', `${path}?pageSize=300${pt ? '&pageToken=' + encodeURIComponent(pt) : ''}`);
      (j?.documents || []).forEach(d => out.push(fromDoc(d))); pt = j?.nextPageToken;
    } while (pt);
    return out;
  };

  return {
    demo: false,
    get user() { return auth; },
    async signIn(email, password) {
      const j = await post(`${ID}:signInWithPassword?key=${CFG.apiKey}`, { email, password, returnSecureToken: true });
      saveAuth({ uid: j.localId, email: j.email, refreshToken: j.refreshToken, idToken: j.idToken, exp: Date.now() + j.expiresIn * 1000 });
    },
    // New account: create it, then email a verification link (approval needs a verified email).
    async signUp(name, email, password) {
      const j = await post(`${ID}:signUp?key=${CFG.apiKey}`, { email, password, returnSecureToken: true });
      saveAuth({ uid: j.localId, email: j.email, name, refreshToken: j.refreshToken, idToken: j.idToken, exp: Date.now() + j.expiresIn * 1000 });
      await post(`${ID}:update?key=${CFG.apiKey}`, { idToken: j.idToken, displayName: name }).catch(() => {});
      await this.sendVerify();
    },
    async sendVerify() { await post(`${ID}:sendOobCode?key=${CFG.apiKey}`, { requestType: 'VERIFY_EMAIL', idToken: await token() }); },
    async applyVerify(oobCode) { await post(`${ID}:update?key=${CFG.apiKey}`, { oobCode }); },
    // Fresh sign-in token (picks up a just-verified email) and whether the email is verified.
    async checkUser() {
      auth = { ...auth, exp: 0 };
      const t = await token();
      const u = (await post(`${ID}:lookup?key=${CFG.apiKey}`, { idToken: t })).users?.[0] || {};
      if (u.displayName && !auth.name) saveAuth({ ...auth, name: u.displayName });
      return { verified: !!u.emailVerified, name: u.displayName || auth.name || '' };
    },
    // Confirms the sign-in password again (needed just before deleting the account).
    async reauth(password) {
      const j = await post(`${ID}:signInWithPassword?key=${CFG.apiKey}`, { email: auth.email, password, returnSecureToken: true });
      if (j.localId !== auth.uid) throw new Error('That’s a different account.');
      saveAuth({ ...auth, refreshToken: j.refreshToken, idToken: j.idToken, exp: Date.now() + j.expiresIn * 1000 });
    },
    async deleteAccount() { await post(`${ID}:delete?key=${CFG.apiKey}`, { idToken: await token() }); saveAuth(null); },
    // Access requests and approvals (see firebase/firestore.rules).
    async myApproval() { return !!(await fs('GET', `/approved/${emailKey(auth.email)}`)); },
    async myRequest() { return !!(await fs('GET', `/requests/${emailKey(auth.email)}`)); },
    async requestAccess(name) {
      try { await fs('PATCH', `/requests/${emailKey(auth.email)}?currentDocument.exists=false`, { fields: toFields({ name: String(name || '').slice(0, 80), at: Date.now() }) }); }
      catch (e) { if (e.status !== 400 && e.status !== 409) throw e; } // already asked
    },
    async withdrawRequest() { await fs('DELETE', `/requests/${emailKey(auth.email)}`).catch(() => {}); },
    listRequests: () => listAll('/requests'),
    listApproved: () => listAll('/approved'),
    async approve(email) {
      await fs('PATCH', `/approved/${emailKey(email)}`, { fields: toFields({ at: Date.now() }) });
      await fs('DELETE', `/requests/${emailKey(email)}`).catch(() => {});
    },
    async unapprove(email) { await fs('DELETE', `/approved/${emailKey(email)}`); },
    async reject(email) { await fs('DELETE', `/requests/${emailKey(email)}`); },
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
    async delVault() { await fs('DELETE', base()); },
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
    async delVault() { await store.del('demo:vault'); await store.del('demo:clients'); },
    async reauth() {}, async deleteAccount() {},
  };
}
const DB = DEMO ? demoBackend() : firebaseBackend();
const cacheKey = () => 'cache:' + DB.user.uid;
