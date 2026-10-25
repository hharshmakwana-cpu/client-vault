'use strict';
// Account screens: the owner's "Team access" (approve people who signed up), and erasing all
// data or deleting the account.

// ---------- team access (owner only) ----------
function renderTeam() {
  let html = bar({ left: backBtn('Settings', 'back'), title: 'Team access' });
  html += `<p class="foot" style="margin:0 34px 16px">People sign up from the sign-in screen. Once you approve them, each gets their own separate, encrypted vault — they never see your clients, and you never see theirs.</p>`;
  html += `<div id="team"><div class="empty"><div class="spinner" style="margin:0 auto 12px"></div>Loading…</div></div>`;
  html += `<div class="group-h">Approve an email in advance</div><form id="tf" class="group" autocomplete="off">
    <div class="row"><input class="finput" id="temail" type="email" placeholder="name@example.com" autocapitalize="off" autocorrect="off" spellcheck="false" style="padding:0" aria-label="Email to approve"><button class="nav-btn strong" style="min-height:0;padding:4px" data-act="add">Approve</button></div></form>
  <p class="foot">They can then sign up with this email and get in straight after verifying it.</p>`;
  app.innerHTML = html;
  $('#tf').onsubmit = e => { e.preventDefault(); ACT.add(); };
  ACT.back = backTo;
  const draw = async () => {
    let reqs, ok;
    try { [reqs, ok] = await Promise.all([DB.listRequests(), DB.listApproved()]); }
    catch (e) { if (cur.v === 'team') $('#team').innerHTML = `<div class="empty"><b>Couldn’t load</b>${esc(isNet(e) ? 'No internet connection.' : e.message)}</div>`; return; }
    if (cur.v !== 'team') return;
    reqs.sort((a, b) => (b.at || 0) - (a.at || 0));
    ok.sort((a, b) => a.id.localeCompare(b.id));
    const mine = (DB.user.email || '').toLowerCase();
    let h = `<div class="group-h">Waiting for approval</div>`;
    h += reqs.length ? `<div class="group">${reqs.map(r => `<div class="row"><span class="grow">${esc(r.name || r.id)}<small>${esc(r.id)}${r.at ? ' · asked ' + fmtDate(r.at) : ''}</small></span>
        <button class="linkbtn" style="color:var(--danger)" data-act="reject" data-e="${esc(r.id)}">Reject</button><button class="sendbtn" data-act="approve" data-e="${esc(r.id)}">Approve</button></div>`).join('')}</div>`
      : `<div class="group"><div class="row"><span class="grow muted">No one is waiting</span></div></div>`;
    const others = ok.filter(x => x.id !== mine);
    h += `<div class="group-h">Approved</div>`;
    h += others.length ? `<div class="group">${others.map(x => `<div class="row"><span class="grow">${esc(x.id)}${x.at ? `<small>since ${fmtDate(x.at)}</small>` : ''}</span><button class="linkbtn" style="color:var(--danger)" data-act="remove" data-e="${esc(x.id)}">Remove</button></div>`).join('')}</div>
      <p class="foot">Removing someone stops them opening their vault. Their encrypted data stays until they delete it, and comes back if you approve them again.</p>`
      : `<div class="group"><div class="row"><span class="grow muted">Only you so far</span></div></div>`;
    $('#team').innerHTML = h;
  };
  const act = async (b, fn, msg) => {
    b.disabled = true;
    try { await fn(); toast(msg); draw(); }
    catch (e) { b.disabled = false; toast(isNet(e) ? 'No internet connection.' : e.message); }
  };
  ACT.approve = b => act(b, () => DB.approve(b.dataset.e), `Approved ${b.dataset.e}`);
  ACT.reject = b => { if (confirm(`Reject ${b.dataset.e}? They can ask again later.`)) act(b, () => DB.reject(b.dataset.e), 'Request rejected'); };
  ACT.remove = b => { if (confirm(`Remove access for ${b.dataset.e}?`)) act(b, () => DB.unapprove(b.dataset.e), 'Access removed'); };
  ACT.add = b => {
    const el = $('#temail'), email = el.value.trim().toLowerCase();
    if (RULES.email(email)) { toast('Enter a valid email address'); return el.focus(); }
    act(b || $('[data-act="add"]'), async () => { await DB.approve(email); el.value = ''; }, `Approved ${email}`);
  };
  draw();
}

// ---------- erase all data / delete account ----------
// a.account: also delete the sign-in account. Both need the master password and typing DELETE;
// deleting the account also needs the sign-in password (Firebase asks for a recent sign-in).
function renderErase(a = {}) {
  const account = !!a.account;
  let html = bar({ left: `<button class="nav-btn" data-act="back">Cancel</button>`, title: account ? 'Delete account' : 'Erase all data' });
  html += `<div class="hero task-hero"><p class="eyebrow" style="color:var(--danger)">Can’t be undone</p><h2>${account ? 'Delete your account' : 'Erase all data and start fresh'}</h2></div>`;
  html += `<div class="group"><div class="row"><span class="grow">This permanently deletes:<small class="wrap2" style="white-space:normal">
    ${S.clients.length === 1 ? 'Your 1 client' : `All ${plural(S.clients.length, 'client')}`} with their returns, fees and invoices · firm details and logo · message templates and settings${account ? ' · your sign-in account' : ''}</small></span></div></div>
    <p class="foot">${account ? 'You’ll be signed out. To use the app again you’d need to sign up and be approved again.' : 'You stay signed in and can create a new master password and start again.'} Export a backup first if you might need anything later.</p>`;
  html += `<div class="pad"><button class="btn plainbtn" data-act="backup" style="margin-bottom:16px">Export a backup first</button></div>`;
  html += `<form id="ef" class="group" autocomplete="off">
    <label class="frow"><span class="flabel">Master password</span><input class="finput" id="emp" type="password" autocomplete="current-password" placeholder="Required"></label>
    ${account && !DB.demo ? `<label class="frow"><span class="flabel">Sign-in password</span><input class="finput" id="esp" type="password" autocomplete="current-password" placeholder="Required"></label>` : ''}
    <label class="frow"><span class="flabel">Type DELETE</span><input class="finput" id="ety" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="DELETE"></label>
  </form>
  <div class="pad" style="margin-top:16px"><button class="btn danger-btn" id="ego" data-act="go">${account ? 'Delete my account' : 'Erase everything'}</button><p class="err" id="err" role="alert"></p></div>`;
  app.innerHTML = html;
  $('#ef').onsubmit = e => e.preventDefault();
  ACT.back = backTo;
  ACT.backup = () => exportBackup();
  ACT.go = async b => {
    const er = $('#err');
    er.textContent = '';
    if ($('#ety').value.trim().toUpperCase() !== 'DELETE') { er.textContent = 'Type DELETE to confirm.'; return $('#ety').focus(); }
    if (!needOnline()) return;
    b.disabled = true; b.textContent = 'Checking…';
    const fail = msg => { b.disabled = false; b.textContent = account ? 'Delete my account' : 'Erase everything'; er.textContent = msg; };
    try { await unwrapDek($('#emp').value, S.vault); }
    catch { return fail('Wrong master password.'); }
    if (account && !DB.demo) {
      try { await DB.reauth($('#esp').value); }
      catch (e) { return fail(isNet(e) ? 'No internet connection.' : 'Wrong sign-in password.'); }
    }
    try {
      // Pending offline changes would only recreate what's being deleted.
      OUT = new Map(); await saveOutbox();
      const recs = await DB.listClients();
      let n = 0;
      for (const r of recs) { b.textContent = `Deleting ${++n} of ${recs.length}…`; await DB.delClient(r.id); }
      b.textContent = 'Finishing…';
      await DB.delVault();
      if (account) { await DB.withdrawRequest?.(); }
      // Local copies on this device.
      await store.del(cacheKey()).catch(() => {});
      await store.del(outboxKey()).catch(() => {});
      writeLS(bioKey(), null); writeLS('cv-brand', null);
      Object.assign(settings, { guideHidden: false, advOpen: false, lastBackup: 0 }); saveSettings();
      if (account) await DB.deleteAccount();
    } catch (e) {
      // Whatever was deleted stays deleted; trying again finishes the rest.
      return fail(`Stopped part-way: ${isNet(e) ? 'no internet connection' : e.message}. Try again to finish.`);
    }
    for (const k in snaps) delete snaps[k];
    S = null; PV = null; cur = { v: null };
    if (account) { DB.signOut(); renderSignIn('Your account and all its data have been deleted.'); }
    else { toast('All data erased'); openVault(); }
  };
}

// ---------- recently deleted ----------
// A deleted client (with its invoices and payments) stays here for TRASH_DAYS days and can be
// restored; after that it's removed for good the next time the app is opened.
async function restoreClient(id) {
  const c = S.trash.find(x => x.id === id);
  if (!c) return;
  try {
    const d = await updateClient(c, x => { delete x.deleted; });
    const dup = d.pan && S.clients.find(x => x.id !== d.id && x.pan === d.pan);
    toast(savedMsg(dup ? `${d.name} restored — note: ${dup.name} has the same PAN` : `${d.name} restored`));
    if (cur.v === 'list' || cur.v === 'trash') go(cur.v, cur.arg, true);
  } catch (e) { toast(errText(e)); }
}
function purgeTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 864e5;
  for (const c of S.trash.filter(x => x.deleted < cutoff)) deleteClient(c.id).catch(() => {});
}
function renderTrash() {
  const list = [...S.trash].sort((a, b) => b.deleted - a.deleted);
  let html = bar({ left: backBtn('Settings', 'back'), title: 'Recently deleted' });
  html += `<p class="foot" style="margin:0 34px 16px">Deleted clients stay here for ${TRASH_DAYS} days, with their invoices and payments. Restore one to bring everything back.</p>`;
  html += list.length ? `<div class="group">${list.map(c => {
    const gone = fmtDate(c.deleted + TRASH_DAYS * 864e5), fees = feeTotals(c);
    return `<div class="row lrow">${avatar(c.name)}<span class="lt"><b>${esc(c.name)}</b><small>Deleted ${ago(ymdOf(c.deleted))} · removed for good on ${gone}${c.fees.length ? ` · ${plural(c.fees.length, 'fee entry')}` : ''}${fees.due > 0 ? ` · ${inr(fees.due)} due` : ''}</small></span>
      <button class="sendbtn" data-act="restore" data-id="${esc(c.id)}">Restore</button></div>`;
  }).join('')}</div>
  <div class="group"><button class="row danger" data-act="purge">Delete all of these now</button></div>`
    : `<div class="empty"><b>Nothing here</b>Clients you delete appear here for ${TRASH_DAYS} days.</div>`;
  app.innerHTML = html;
  ACT.back = backTo;
  ACT.restore = b => { b.disabled = true; restoreClient(b.dataset.id); };
  ACT.purge = async b => {
    if (!confirm(`Permanently delete ${plural(list.length, 'client')}, with their invoices and payments? This can’t be undone.`)) return;
    b.disabled = true;
    try { for (const c of list) await deleteClient(c.id); toast(savedMsg('Deleted for good')); go('trash', undefined, true); }
    catch (e) { b.disabled = false; toast(errText(e)); }
  };
}
