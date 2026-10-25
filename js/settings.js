'use strict';
// Settings, encrypted backup export/import, master password change.

// ---------- settings ----------
function renderSettings() {
  const lockOpts = [[0, 'When I leave the app'], [60, 'After 1 minute'], [300, 'After 5 minutes'], [900, 'After 15 minutes']];
  const cf = S.meta.customFields, bioOn = !!bioRecord();
  // Everyday settings first; the rest is one tap away under "More options".
  const adv = settings.advOpen;
  app.innerHTML = bar({ title: 'Settings', big: true }) + `<h1 class="large" data-big>Settings</h1>` + `
    <div class="group-h">Your practice</div>
    <div class="group">
      <button class="row" data-act="firm">${logoOf() ? `<span class="logo-box has">${logoImg(logoOf(), 'logo-thumb')}</span>` : ''}<span class="grow">Firm details<small>Name, address, GST and bank details for invoices</small></span><span class="chev">${I.chev}</span></button>
      <button class="row" data-act="work"><span class="grow">Work you handle<small>${esc(SERVICES.filter(x => handles(x[0])).map(x => x[1]).join(', '))}</small></span><span class="chev">${I.chev}</span></button>
      <button class="row" data-act="templates"><span class="grow">WhatsApp messages</span><span class="chev">${I.chev}</span></button>
      ${isOwner() ? `<button class="row" data-act="team"><span class="grow">Team access<small>Approve people who sign up</small></span><span class="chev">${I.chev}</span></button>` : ''}
    </div>
    <div class="group-h">Security</div>
    <div class="group">
      <div class="row"><span class="grow">Unlock with ${esc(BIO)}${BIO_OK ? '' : '<small>Not available on this device</small>'}</span>${sw(bioOn, 'bio', ` aria-label="Unlock with ${esc(BIO)}"${BIO_OK || bioOn ? '' : ' disabled'}`)}</div>
      ${bioPending ? `<button class="row link" data-act="bioFinish">Finish setting up ${esc(BIO)}</button>` : ''}
      <label class="row"><span class="grow">Auto-lock</span><select class="plain" id="lockAfter">${lockOpts.map(([v, l]) => `<option value="${v}"${settings.lockAfter === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="row link" data-act="changepw">Change master password</button>
      <button class="row link" data-act="lock">Lock now</button>
    </div>
    <div class="group-h">Backup</div>
    <div class="group">
      <button class="row link" data-act="export">Export encrypted backup</button>
      <button class="row link" data-act="import">Restore from a backup</button>
      <button class="row" data-act="trash"><span class="grow">Recently deleted</span>${S.trash.length ? `<span class="val">${S.trash.length}</span>` : ''}<span class="chev">${I.chev}</span></button>
    </div>
    <p class="foot">${settings.lastBackup ? 'Last exported ' + fmtDate(settings.lastBackup) + '. ' : ''}A backup opens only with the master password used when it was made. Keep one in iCloud Drive or Google Drive.</p>
    <div class="group"><button class="row" data-act="adv" aria-expanded="${!!adv}"><span class="grow">More options<small>Excel import/export, due date extensions, custom fields, password reminders</small></span><span class="chev${adv ? ' open' : ''}">${I.chev}</span></button></div>
    <div id="adv"${adv ? '' : ' hidden'}>
    <div class="group-h">Excel</div>
    <div class="group">
      <button class="row link" data-act="csvin">Import clients from Excel (CSV)</button>
      <button class="row link" data-act="csvout">Export client list (CSV)</button>
      <button class="row link" data-act="csvsample">Download sample import file</button>
    </div>
    <p class="foot">In Excel, use File → Save As → CSV. Exported lists leave out passwords and show only the last 4 digits of Aadhaar.</p>
    <div class="group-h">Due dates</div>
    <div class="group">
      <button class="row" data-act="ext"><span class="grow">Due date extensions</span><span class="chev">${I.chev}</span></button>
      <label class="row"><span class="grow">Password change reminder</span><select class="plain" id="pwDays">${[[0, 'Off'], [90, 'Every 90 days'], [120, 'Every 120 days'], [180, 'Every 180 days'], [365, 'Every year']].map(([v, l]) => `<option value="${v}"${pwDays() === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <p class="foot">The reminder asks you to change each portal password this long after it was last changed in the app.</p>
    <div class="group-h">Custom fields</div>
    <div class="group">
      ${cf.map(f => `<div class="row"><span class="grow">${esc(f.label)}</span>${f.secret ? '<span class="tag">Secret</span>' : ''}<button class="nav-btn" style="color:var(--danger);min-height:0;padding:4px" data-act="cfdel" data-id="${esc(f.id)}">Remove</button></div>`).join('')}
      <div class="row"><input id="cfName" class="finput" placeholder="New field, e.g. MCA login" autocomplete="off" style="padding:0" aria-label="New custom field name"><button class="toggle" data-act="cfsec" aria-pressed="false">Secret</button><button class="nav-btn strong" style="min-height:0;padding:4px" data-act="cfadd">Add</button></div>
    </div>
    <p class="foot">Custom fields appear on every client. For one-off details, use “Add field” inside a client.</p>
    <div class="group"><button class="row link" data-act="guide">Show the “Get started” checklist again</button></div>
    </div>
    <div class="group-h">Account</div>
    <div class="group">
      <div class="row"><span class="grow">${DB.demo ? 'Mode' : 'Signed in as'}</span><span class="val">${esc(DB.user.email)}</span></div>
      ${DB.demo ? '' : `<button class="row link" data-act="signout">Sign out of this device</button>`}
    </div>
    <div class="group-h">Delete</div>
    <div class="group">
      <button class="row link danger-link" data-act="erase">Erase all data and start fresh</button>
      ${DB.demo ? '' : isOwner() ? `<div class="row"><span class="grow muted">Delete my account<small>Not available for the owner account — it’s the one that approves everyone else.</small></span></div>`
        : `<button class="row link danger-link" data-act="delacct">Delete my account</button>`}
    </div>
    <p class="foot">Both ask for your master password and can’t be undone.</p>
    <p class="foot center" style="margin-top:4px">${plural(S.clients.length, 'client')} · End-to-end encrypted</p>
    <input type="file" id="file" accept=".json,application/json" hidden>`;

  $('#lockAfter').onchange = e => { settings.lockAfter = +e.target.value; saveSettings(); toast('Auto-lock updated'); };
  ACT.lock = () => lock();
  ACT.bio = () => {
    if (bioRecord()) { writeLS(bioKey(), null); toast(`${BIO} unlock is off`); return renderSettings(); }
    bioTurnOn(() => renderSettings());
  };
  ACT.bioFinish = () => bioTurnOn(() => renderSettings());
  ACT.changepw = () => { if (needOnline()) go('changepw'); };
  ACT.signout = () => {
    const lose = OUT.size ? `\n\n${plural(OUT.size, 'change')} made offline haven’t uploaded yet and will be lost.` : '';
    if (confirm(`Sign out of this device? You’ll need your email and password to sign in again.${lose}`)) signOut();
  };
  ACT.cfsec = t => { const on = t.classList.toggle('on'); t.setAttribute('aria-pressed', on); };
  ACT.cfadd = async () => {
    const label = $('#cfName').value.trim();
    if (!label) return $('#cfName').focus();
    if (cf.some(f => f.label.toLowerCase() === label.toLowerCase())) return toast('That field already exists');
    cf.push({ id: uid(), label, secret: $('[data-act="cfsec"]').classList.contains('on') });
    try { await saveMeta(); toast(savedMsg('Field added')); renderSettings(); } catch (e) { cf.pop(); toast(errText(e)); }
  };
  ACT.cfdel = async t => {
    const f = cf.find(x => x.id === t.dataset.id);
    if (!confirm(`Remove “${f.label}” from all clients? Values already saved in it will be hidden.`)) return;
    S.meta.customFields = cf.filter(x => x !== f);
    try { await saveMeta(); renderSettings(); } catch (e) { S.meta.customFields = cf; toast(errText(e)); }
  };
  $('#pwDays').onchange = async e => {
    const prev = S.meta.pwDays;
    S.meta.pwDays = +e.target.value;
    try { await saveMeta(); toast(savedMsg('Reminder updated')); } catch (er) { S.meta.pwDays = prev; toast(errText(er)); }
  };
  ACT.adv = t => {
    settings.advOpen = !settings.advOpen; saveSettings();
    $('#adv').hidden = !settings.advOpen; t.setAttribute('aria-expanded', settings.advOpen); $('.chev', t).classList.toggle('open', settings.advOpen);
  };
  ACT.work = () => go('welcome', { edit: true });
  ACT.guide = () => { settings.guideHidden = false; saveSettings(); go('list'); };
  ACT.templates = () => go('templates');
  ACT.team = () => { if (needOnline()) go('team'); };
  ACT.erase = () => go('erase');
  ACT.trash = () => go('trash');
  ACT.delacct = () => go('erase', { account: true });
  ACT.firm = () => go('firm');
  ACT.ext = () => go('ext', { back: 'settings' });
  ACT.csvout = () => exportClientsCSV();
  ACT.csvsample = () => sampleCSV();
  ACT.csvin = () => pickCsvFile();
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
    if (pwWeak(a)) return (er.textContent = pwWeak(a));
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

// Restoring a backup: everything is opened and checked first, then a preview shows what will
// change, and only then is anything written. A damaged backup changes nothing. Clients you
// already have stay; where the backup holds a newer copy of one, that copy replaces yours.
const BACKUP_VERSIONS = [undefined, 1, 2];
function renderImport(b) {
  const bar_ = bar({ left: backBtn('Settings', 'back'), title: 'Restore backup' });
  ACT.back = () => goBack('settings');
  if (!BACKUP_VERSIONS.includes(b.v)) {
    app.innerHTML = bar_ + `<div class="empty"><b>Can’t open this backup</b>It was made by a newer version of the app. Reload the app to update it, then try again.</div>`;
    return;
  }
  app.innerHTML = bar_ + `
    <form id="f" class="pad" autocomplete="off">
      <div class="stack" style="max-width:none">
        <p class="hint" style="margin:0 2px 6px">Backup from ${fmtDate(b.saved)} with ${plural(b.clients.length, 'client')}. Nothing changes until you’ve seen what it contains and tapped Restore.</p>
        <input class="field" id="pw" type="password" placeholder="Master password used for this backup" autocomplete="off">
        <button class="btn primary" id="go" type="submit">Open backup</button>
        <p class="err" id="err" role="alert"></p>
      </div>
    </form>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#go'), er = $('#err');
    btn.disabled = true; btn.textContent = 'Opening…';
    const fail = msg => { btn.disabled = false; btn.textContent = 'Open backup'; er.textContent = msg; };
    let key;
    try { key = await dataKey(await unwrapDek($('#pw').value, b.vault)); }
    catch { return fail('Wrong password for this backup.'); }
    // Open everything before changing anything.
    let meta = null;
    const items = [], damaged = [];
    try { if (b.vault.metaCt) meta = await decJSON(key, { iv: b.vault.metaIv, ct: b.vault.metaCt }); }
    catch { return fail('This backup’s settings are damaged, so nothing was restored.'); }
    for (const r of b.clients) {
      try {
        if (!r || typeof r.id !== 'string' || typeof r.iv !== 'string' || typeof r.ct !== 'string') throw 0;
        const c = await decJSON(key, r);
        if (!isObj(c) || typeof c.name !== 'string' || !c.name.trim()) throw 0;
        c.id = r.id; items.push(tidy(c));
      } catch { damaged.push(r?.id || '?'); }
    }
    if (damaged.length) return fail(`${plural(damaged.length, 'client')} in this backup ${damaged.length === 1 ? 'is' : 'are'} damaged, so nothing was restored. Try another backup file.`);
    const all = [...S.clients, ...S.trash];
    const plan = items.map(c => { const mine = all.find(x => x.id === c.id); return { c, kind: !mine ? 'new' : (c.updated || 0) > (mine.updated || 0) ? 'newer' : 'same' }; });
    const count = k => plan.filter(x => x.kind === k).length, nNew = count('new'), nNewer = count('newer'), nSame = count('same');
    renderPreview(key, meta, plan, nNew, nNewer, nSame);
  };
  function renderPreview(key, meta, plan, nNew, nNewer, nSame) {
    const todo = plan.filter(x => x.kind !== 'same');
    app.innerHTML = bar_ + `<div class="tiles"><div class="tile green"><b>${nNew}</b><span>New clients</span></div><div class="tile blue"><b>${nNewer}</b><span>Newer copies</span></div><div class="tile"><b>${nSame}</b><span>Already up to date</span></div></div>
      <p class="foot" style="margin:0 34px 16px">New clients are added. Where the backup has a newer copy of a client, it replaces yours. Nothing else is changed or removed. Settings missing here (firm details, logo, messages, extensions) are filled in from the backup.</p>
      ${todo.length ? `<div class="group-h">Will change</div><div class="group">${todo.slice(0, 50).map(x => `<div class="row"><span class="grow">${esc(x.c.name)}<small>${x.kind === 'new' ? 'New' : 'Newer copy from ' + fmtDate(x.c.updated)}</small></span></div>`).join('')}${todo.length > 50 ? `<div class="row"><span class="grow muted">and ${todo.length - 50} more</span></div>` : ''}</div>` : ''}
      <div class="pad"><button class="btn primary" id="go" data-act="restore">${todo.length ? `Restore ${plural(todo.length, 'client')}` : 'Restore settings only'}</button><p class="err" id="err" role="alert"></p></div>`;
    ACT.restore = async btn => {
      btn.disabled = true;
      let done = 0;
      try {
        if (meta) await mergeBackupMeta(meta);
        for (const x of todo) { btn.textContent = `Restoring ${done + 1} of ${todo.length}…`; await saveClient(x.c); done++; }
        // Check the result against the backup.
        const have = [...S.clients, ...S.trash];
        const missing = todo.filter(x => !have.some(c => c.id === x.c.id && c.name === x.c.name));
        if (missing.length) throw new Error(`${plural(missing.length, 'client')} didn’t restore`);
        toast(savedMsg(todo.length ? `Restored ${plural(todo.length, 'client')}` : 'Settings restored'));
        go('list');
      } catch (ex) {
        btn.disabled = false; btn.textContent = 'Try again';
        $('#err').textContent = `${done ? `${done} restored, then it stopped: ` : ''}${errText(ex)}. Trying again is safe — clients already restored are skipped.`;
      }
    };
  }
}
// Settings from a backup fill in whatever isn't set here: firm details (with the logo), messages,
// due date extensions, work handled, invoice numbering. Anything already set here is kept.
async function mergeBackupMeta(meta) {
  const M = S.meta, before = stable(M);
  const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
  const have = new Set(M.customFields.map(f => f.id));
  M.customFields.push(...(meta.customFields || []).filter(f => !have.has(f.id)));
  M.ext = { ...meta.ext, ...M.ext };
  const seq = { ...meta.seq };
  for (const [k, n] of Object.entries(M.seq || {})) seq[k] = Math.max(n, seq[k] || 0);
  M.seq = seq;
  if (isObj(meta.firmInfo)) { M.firmInfo ||= {}; for (const [k, v] of Object.entries(meta.firmInfo)) if (empty(M.firmInfo[k]) && !empty(v)) M.firmInfo[k] = v; }
  for (const k of ['firm', 'templates', 'services', 'pwDays', 'setupDone']) if (empty(M[k]) && !empty(meta[k])) M[k] = meta[k];
  if (stable(M) !== before) { await saveMeta(); cacheBrand(); }
}
