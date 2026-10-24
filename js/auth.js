'use strict';
// Entry screens: sign in, password reset, create vault, unlock.

// ---------- entry screens ----------
function lockScreen(title, sub, inner) {
  ACT = {}; cur = { v: null }; updateTabs();
  app.innerHTML = `<main class="lock"><div class="lock-icon">${I.lock}</div><h1>${esc(title)}</h1><p class="sub">${sub}</p>${inner}</main>`;
}
function renderLoading(msg) {
  ACT = {}; cur = { v: null }; updateTabs();
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
      $('#err').textContent = isNet(ex) ? 'No internet connection.' : ex.message;
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
    } catch (ex) { $('#err').textContent = isNet(ex) ? 'No internet connection.' : ex.message; t.disabled = false; }
  };
}

// Opened from the link in a password-reset email (?mode=resetPassword&oobCode=…).
async function renderReset(code) {
  const done = () => { history.replaceState(null, '', location.pathname); DB.user ? openVault() : renderSignIn(); };
  renderLoading('Checking your reset link…');
  let email;
  try { email = await DB.checkResetCode(code); }
  catch (e) {
    lockScreen('Link not valid', esc(isNet(e) ? 'No internet connection.' : e.message), `<div class="stack"><button class="btn primary" data-act="done">Back to sign in</button></div>`);
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
    } catch (ex) { btn.disabled = false; btn.textContent = 'Save new password'; er.textContent = isNet(ex) ? 'No internet connection.' : ex.message; }
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
    if (!c) return renderError(isNet(e) ? 'No internet connection, and this device has no saved copy yet.' : e.message, openVault);
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
      er.textContent = isNet(ex) ? 'No internet connection.' : ex.message;
    }
  };
}

async function finishUnlock(raw) {
  renderLoading('Opening your vault…');
  let offline = PV.offline, recs = null;
  await loadOutbox();
  if (!offline) {
    try {
      // Upload changes made offline last time first, so the list below already includes them.
      if (OUT.size) { await flushOutbox(); PV.vault = (await DB.getVault()) || PV.vault; }
      recs = await DB.listClients();
    } catch (ex) { if (ex instanceof AuthError) return signOut(ex.message); offline = true; }
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
