'use strict';
// Unlocked vault state: decrypting, saving and syncing records, biometric unlock, auto-lock.

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
// The few actions that must reach the server straight away.
function needOnline() { if (S.offline) { toast('You’re offline — this needs an internet connection.'); return false; } return true; }

// ---------- offline outbox ----------
// Every change is applied on this device first. If the vault can't be reached, the change —
// already encrypted — waits here (in IndexedDB, so it survives closing the app) and is uploaded
// once the connection is back. One entry per document: a newer change to the same client
// replaces the waiting one. Entries: 'c:<id>' → {t:'put', id, rec} | {t:'del', id}; 'vault' → {t:'vault', f}.
let OUT = new Map(), writeGen = 0, flushing = null;
const outboxKey = () => 'outbox:' + DB.user.uid;
async function loadOutbox() { OUT = new Map((await store.get(outboxKey()).catch(() => null)) || []); }
const saveOutbox = () => store.set(outboxKey(), [...OUT]).catch(() => {});
const sendOp = op => op.t === 'put' ? DB.putClient(op.id, op.rec) : op.t === 'del' ? DB.delClient(op.id) : DB.putVault(op.f);
async function push(k, op) {
  writeGen++;
  if (!OUT.size && !S.offline) {
    try { return await sendOp(op); }
    catch (e) { if (!isNet(e)) throw e; setOffline(true); }
  }
  if (op.t === 'vault' && OUT.has(k)) op = { t: 'vault', f: { ...OUT.get(k).f, ...op.f } };
  OUT.delete(k); OUT.set(k, op); // re-insert, so the queue keeps the order the changes were made in
  await saveOutbox();
}
// Uploads waiting changes in order. Stops at the first failure and leaves the rest queued.
function flushOutbox() {
  return flushing ||= (async () => {
    try {
      for (const [k, op] of [...OUT]) {
        await sendOp(op);
        if (OUT.get(k) === op) OUT.delete(k); // unless it was changed again meanwhile
        await saveOutbox();
      }
    } finally { flushing = null; }
  })();
}
function setOffline(on) {
  if (!S || S.offline === on) return;
  S.offline = on;
  if (cur.v === 'list') go('list', undefined, true);
}

async function saveClient(c) {
  const e = await encJSON(S.key, c);
  const rec = { iv: e.iv, ct: e.ct, updated: c.updated };
  await push('c:' + c.id, { t: 'put', id: c.id, rec });
  S.recs.set(c.id, { id: c.id, ...rec });
  const i = S.clients.findIndex(x => x.id === c.id);
  i < 0 ? S.clients.push(c) : (S.clients[i] = c);
  writeCache();
}
async function deleteClient(id) {
  await push('c:' + id, { t: 'del', id });
  S.recs.delete(id); S.clients = S.clients.filter(c => c.id !== id);
  writeCache();
}
async function saveMeta() {
  const e = await encJSON(S.key, S.meta);
  await push('vault', { t: 'vault', f: { metaIv: e.iv, metaCt: e.ct } });
  Object.assign(S.vault, { metaIv: e.iv, metaCt: e.ct });
  writeCache();
}

let syncing = false;
async function sync() {
  if (!S || syncing) return;
  syncing = true;
  const hadPending = OUT.size;
  try {
    if (OUT.size) await flushOutbox();
    const gen = writeGen;
    const [v, recs] = await Promise.all([DB.getVault(), DB.listClients()]);
    if (!S) return;
    // A change saved while this was loading isn't in what came back; take the server copy next time.
    if (gen === writeGen) {
      if (v) { S.vault = v; await applyMeta(); }
      await applyRecs(recs);
      S.syncedAt = Date.now(); writeCache();
    }
    S.offline = false;
    if (hadPending) toast(`${plural(hadPending, 'change')} uploaded`);
    if (cur.v === 'list' || cur.v === 'detail') go(cur.v, cur.arg, true);
  } catch (e) {
    if (e instanceof AuthError) return signOut(e.message);
    if (isNet(e)) setOffline(true);
    else if (OUT.size) toast(`Couldn’t upload ${plural(OUT.size, 'change')}: ${e.message}`);
  } finally { syncing = false; }
}
// Upload as soon as the connection is back, and keep retrying while anything is waiting.
addEventListener('online', () => sync());
addEventListener('offline', () => setOffline(true));
setInterval(() => { if (S && (S.offline || OUT.size) && navigator.onLine !== false && !document.hidden) sync(); }, 30000);

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
// A session that expired (msg set) keeps waiting changes, so they upload after signing in again.
async function signOut(msg) {
  if (DB.user) { await store.del(cacheKey()).catch(() => {}); writeLS(bioKey(), null); if (!msg) await store.del(outboxKey()).catch(() => {}); }
  OUT = new Map();
  S = null; PV = null;
  DB.signOut();
  renderSignIn(msg);
}
