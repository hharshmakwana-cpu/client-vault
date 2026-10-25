'use strict';
// Unlocked vault state: decrypting, saving and syncing records, biometric unlock, auto-lock.

// ---------- vault data helpers ----------
async function applyMeta() {
  S.meta = S.vault.metaCt ? await decJSON(S.key, { iv: S.vault.metaIv, ct: S.vault.metaCt }) : {};
  S.meta.customFields = Array.isArray(S.meta.customFields) ? S.meta.customFields : [];
  cacheBrand();
}
// Brings records saved by older versions of the app up to the current shape.
function tidy(c) {
  c.custom ||= {}; c.extra ||= []; c.businesses ||= [];
  c.comp ||= {}; c.work ||= {}; c.fees ||= []; c.pwd ||= {}; // returns tracked, filing status, fee ledger, password dates
  // Contact persons used to be one text field; the Income Tax login ID is always the PAN.
  if (!c.contacts) c.contacts = c.contact ? [{ name: c.contact, role: '', mobile: '', email: '' }] : [];
  delete c.contact; delete c.itUser;
  if (!c.gst) c.gst = c.gstin || c.gstUser || c.gstPass ? [{ gstin: c.gstin || '', user: c.gstUser || '', pass: c.gstPass || '' }] : [];
  delete c.gstin; delete c.gstUser; delete c.gstPass;
  if (c.type === 'Proprietorship') c.type = 'Individual';
  if (c.type === 'AOP / BOI') c.type = c.pan?.[3] === 'B' ? 'BOI' : 'AOP';
  return c;
}
// Clients in use are in S.clients; deleted ones stay in S.trash for 30 days ("Recently deleted").
// A record that can't be decrypted (damaged, or from another vault) is left untouched on the
// server and counted in S.unreadable, so the list can say so instead of silently hiding it.
const TRASH_DAYS = 30;
function placeClient(c) {
  S.clients = S.clients.filter(x => x.id !== c.id); S.trash = S.trash.filter(x => x.id !== c.id);
  (c.deleted ? S.trash : S.clients).push(c);
}
function dropClient(id) { S.clients = S.clients.filter(x => x.id !== id); S.trash = S.trash.filter(x => x.id !== id); }
async function applyRecs(recs) {
  const prev = new Map([...S.clients, ...S.trash].map(c => [c.id, c]));
  const clients = [], trash = [], map = new Map();
  let unreadable = 0;
  for (const r of recs) {
    map.set(r.id, r);
    const old = prev.get(r.id), oldRec = S.recs.get(r.id);
    let c = old && oldRec && oldRec.ct === r.ct ? old : null;
    if (!c) {
      try { c = await decJSON(S.key, r); if (!c || typeof c !== 'object') throw 0; c.id = r.id; c = tidy(c); }
      catch { unreadable++; continue; }
    }
    (c.deleted ? trash : clients).push(c);
  }
  S.clients = clients; S.trash = trash; S.recs = map; S.unreadable = unreadable;
}
// Keeps a copy on this device for offline use. If the device's storage is full, say so (once).
let cacheWarned = false;
const writeCache = () => store.set(cacheKey(), { vault: S.vault, clients: [...S.recs.values()] }).then(() => { cacheWarned = false; }, () => {
  if (!cacheWarned) { cacheWarned = true; toast('This device’s storage is full — the offline copy couldn’t be updated. Free up some space.'); }
});
// The few actions that must reach the server straight away.
function needOnline() { if (S.offline) { toast('You’re offline — this needs an internet connection.'); return false; } return true; }

// What to say after a save: whether it reached the vault, or is kept on this device for now.
const savedMsg = (msg = 'Saved') => OUT.size ? `${msg} on this device — it uploads when you’re back online` : msg;

// ---------- merging changes from two devices ----------
// Each save says which server version it was based on. If another device saved in between, the
// server refuses (ConflictError); the app then fetches that version and merges: whatever only one
// side changed is kept, so both edits survive. If both changed the very same thing, this device's
// change wins. Fees are matched by id, so bills and payments added on two devices are all kept.
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x);
const same = (a, b) => stable(a) === stable(b);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const byId = a => Array.isArray(a) && a.length > 0 && a.every(x => isObj(x) && typeof x.id === 'string');
function merge3(base, mine, theirs) {
  if (same(mine, theirs)) return mine;
  if (same(base, mine)) return theirs;
  if (same(base, theirs)) return mine;
  if (isObj(mine) && isObj(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge3(isObj(base) ? base[k] : undefined, mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if ((byId(mine) || byId(theirs)) && [mine, theirs].every(a => Array.isArray(a) && (!a.length || byId(a)))) {
    const find = (a, id) => (Array.isArray(a) ? a : []).find(x => x.id === id);
    const ids = [...new Set([...mine.map(x => x.id), ...theirs.map(x => x.id)])];
    return ids.map(id => merge3(find(base, id), find(mine, id), find(theirs, id))).filter(x => x !== undefined);
  }
  return mine;
}

// ---------- offline outbox ----------
// Every change is applied on this device first. If the vault can't be reached, the change —
// already encrypted — waits here (in IndexedDB, so it survives closing the app) and is uploaded
// once the connection is back. One entry per document: a newer change to the same document
// replaces the waiting one but keeps the version it was originally based on.
// Entries: 'c:<id>' → {t:'put', id, rec, base, pre} | {t:'del', id}; 'vault' → {t:'vault', f, base, pre}.
// base: the encrypted version the change started from; pre: that version's server updateTime.
let OUT = new Map(), writeGen = 0, flushing = null;
const outboxKey = () => 'outbox:' + DB.user.uid;
async function loadOutbox() { OUT = new Map((await store.get(outboxKey()).catch(() => null)) || []); }
const saveOutbox = () => store.set(outboxKey(), [...OUT]).then(() => true, () => false);
const sendOp = op => op.t === 'put' ? putClientMerged(op) : op.t === 'del' ? DB.delClient(op.id) : putVaultMerged(op);
async function putClientMerged(op) {
  let rec = op.rec, pre = op.pre;
  for (let i = 0; i < 4; i++) {
    try {
      const t = await DB.putClient(op.id, rec, pre);
      if (S) {
        const merged = rec !== op.rec;
        S.recs.set(op.id, { id: op.id, ...rec, _t: t });
        if (merged) { const c = tidy(await decJSON(S.key, rec)); c.id = op.id; placeClient(c); }
        writeCache();
      }
      return;
    } catch (e) {
      if (!(e instanceof ConflictError) || !S) throw e;
      const theirs = await DB.getClient(op.id);
      const mine = await decJSON(S.key, rec);
      let next = mine;
      if (theirs) {
        const base = op.base ? await decJSON(S.key, op.base) : null;
        next = merge3(base, mine, await decJSON(S.key, theirs));
        next.updated = Date.now();
      }
      const x = await encJSON(S.key, next);
      rec = { iv: x.iv, ct: x.ct, updated: next.updated };
      pre = theirs ? theirs._t : null;
      S.merged = (S.merged || 0) + 1;
    }
  }
  throw new Error('This client keeps changing on another device — please try again.');
}
async function putVaultMerged(op) {
  let f = op.f, pre = op.pre;
  for (let i = 0; i < 4; i++) {
    try {
      const t = await DB.putVault(f, pre);
      if (S) {
        const merged = f !== op.f;
        Object.assign(S.vault, f, { _t: t });
        if (merged) await applyMeta();
        writeCache();
      }
      return;
    } catch (e) {
      if (!(e instanceof ConflictError) || !S) throw e;
      const theirs = await DB.getVault();
      if (theirs?.metaCt && f.metaCt) {
        const base = op.base ? await decJSON(S.key, op.base) : null;
        const merged = merge3(base, await decJSON(S.key, { iv: f.metaIv, ct: f.metaCt }), await decJSON(S.key, { iv: theirs.metaIv, ct: theirs.metaCt }));
        const x = await encJSON(S.key, merged);
        f = { ...f, metaIv: x.iv, metaCt: x.ct };
      }
      pre = theirs ? theirs._t : null;
      S.merged = (S.merged || 0) + 1;
    }
  }
  throw new Error('Settings keep changing on another device — please try again.');
}
async function push(k, op) {
  writeGen++;
  const old = OUT.get(k);
  if (old && old.t === op.t && op.t !== 'del') {
    op = { ...op, base: old.base, pre: old.pre }; // still based on the version the first waiting change started from
    if (op.t === 'vault') op.f = { ...old.f, ...op.f };
  }
  if (!OUT.size && !S.offline) {
    try { return await sendOp(op); }
    catch (e) { if (!isNet(e)) throw e; setOffline(true); }
  }
  const before = OUT.get(k);
  OUT.delete(k); OUT.set(k, op); // re-insert, so the queue keeps the order the changes were made in
  if (!(await saveOutbox())) {
    // Couldn't keep it on this device either: undo, so the app never claims a change it can't keep.
    OUT.delete(k); if (before) OUT.set(k, before);
    throw new Error('Not saved: you’re offline and this device’s storage is full. Free up some space and try again.');
  }
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

// Saves on this device straight away, then uploads (or queues the upload). If the upload is
// refused for a reason other than the connection, the change is undone here too.
async function saveClient(c) {
  const e = await encJSON(S.key, c), prev = S.recs.get(c.id), prevClient = [...S.clients, ...S.trash].find(x => x.id === c.id);
  const rec = { iv: e.iv, ct: e.ct, updated: c.updated };
  const put = (r, cl) => {
    r ? S.recs.set(c.id, r) : S.recs.delete(c.id);
    cl ? placeClient(cl) : dropClient(c.id);
  };
  put({ id: c.id, ...rec, _t: prev?._t }, c);
  writeCache();
  try { await push('c:' + c.id, { t: 'put', id: c.id, rec, base: prev ? { iv: prev.iv, ct: prev.ct } : null, pre: prev ? prev._t : null }); }
  catch (er) { put(prev, prevClient); writeCache(); throw er; }
}
async function deleteClient(id) {
  await push('c:' + id, { t: 'del', id });
  S.recs.delete(id); dropClient(id);
  writeCache();
}
async function saveMeta() {
  const e = await encJSON(S.key, S.meta), prev = { metaIv: S.vault.metaIv, metaCt: S.vault.metaCt };
  Object.assign(S.vault, { metaIv: e.iv, metaCt: e.ct });
  writeCache();
  try { await push('vault', { t: 'vault', f: { metaIv: e.iv, metaCt: e.ct }, base: prev.metaCt ? { iv: prev.metaIv, ct: prev.metaCt } : null, pre: S.vault._t }); }
  catch (er) { Object.assign(S.vault, prev); writeCache(); throw er; }
}

let syncing = false;
async function sync() {
  if (!S || syncing || S.loading) return;
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
    if (S.merged) { toast('Changes from another device were combined with yours'); S.merged = 0; }
    else if (hadPending) toast(`${plural(hadPending, 'change')} uploaded`);
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
    keepDraft();
    if (suppressLock || Date.now() < graceUntil) return;
    document.body.classList.add('cover');
    if (settings.lockAfter === 0) lock(true);
  } else {
    document.body.classList.remove('cover');
    if (suppressLock || Date.now() < graceUntil) { suppressLock = false; return; }
    if (Date.now() - hiddenAt >= settings.lockAfter * 1000) lock(true);
    else if (cur.v !== 'edit') sync();
  }
});
// Face ID starts by itself only when the app is opened or brought back — not right after
// "Lock now" or an idle lock while the screen is on, which would just ask again at once.
let bioAuto = true;
// A half-filled client form is kept when the app locks, is closed or is reloaded — encrypted with
// the vault key, in memory and on this device — and opened again after unlocking (for up to a week).
// Leaving the form normally, or signing out, drops it.
let DRAFT = null, EDIT_DRAFT = null;
const draftKey = () => 'draft:' + DB.user.uid;
function keepDraft() {
  const d = S && cur.v === 'edit' && EDIT_DRAFT?.();
  if (!d) return;
  encJSON(S.key, d).then(x => { DRAFT = { ...x, at: Date.now() }; return store.set(draftKey(), DRAFT); }).catch(() => {});
}
const dropDraft = () => { DRAFT = null; if (DB.user) store.del(draftKey()).catch(() => {}); };
async function restoreDraft() {
  const x = DRAFT || await store.get(draftKey()).catch(() => null);
  dropDraft();
  if (!x || Date.now() - (x.at || 0) > 7 * 864e5) return false;
  try { const d = await decJSON(S.key, x); go('edit', { id: d.id, draft: d }); toast('Your unsaved changes are back'); return true; }
  catch { return false; }
}
addEventListener('pagehide', keepDraft);
function lock(auto = false) {
  keepDraft();
  bioAuto = auto;
  finishTransition?.();
  S = null; Q = ''; ACT = {}; bioPending = null; cur = { v: null };
  for (const k in snaps) delete snaps[k]; // snapshots contain client data — drop them on lock
  document.body.classList.remove('cover');
  openVault();
}
// A session that expired (msg set) keeps waiting changes, so they upload after signing in again.
async function signOut(msg) {
  if (DB.user) { await store.del(cacheKey()).catch(() => {}); writeLS(bioKey(), null); if (!msg) await store.del(outboxKey()).catch(() => {}); }
  if (DB.user) dropDraft();
  OUT = new Map(); writeLS('cv-brand', null);
  S = null; PV = null;
  DB.signOut();
  renderSignIn(msg);
}
