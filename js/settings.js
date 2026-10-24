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
    </div>
    <div class="group-h">Security</div>
    <div class="group">
      <div class="row"><span class="grow">Unlock with ${esc(BIO)}${BIO_OK ? '' : '<small>Not available on this device</small>'}</span>${sw(bioOn, 'bio', BIO_OK || bioOn ? '' : ' disabled')}</div>
      ${bioPending ? `<button class="row link" data-act="bioFinish">Finish setting up ${esc(BIO)}</button>` : ''}
      <label class="row"><span class="grow">Auto-lock</span><select class="plain" id="lockAfter">${lockOpts.map(([v, l]) => `<option value="${v}"${settings.lockAfter === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="row link" data-act="changepw">Change master password</button>
      <button class="row link" data-act="lock">Lock now</button>
    </div>
    <div class="group-h">Backup</div>
    <div class="group">
      <button class="row link" data-act="export">Export encrypted backup</button>
      <button class="row link" data-act="import">Import backup</button>
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
    <p class="foot center" style="margin-top:-12px">${plural(S.clients.length, 'client')} · End-to-end encrypted</p>
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
    try { await saveMeta(); toast('Field added'); renderSettings(); } catch (e) { cf.pop(); toast(errText(e)); }
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
    try { await saveMeta(); toast('Reminder updated'); } catch (er) { S.meta.pwDays = prev; toast(errText(er)); }
  };
  ACT.adv = t => {
    settings.advOpen = !settings.advOpen; saveSettings();
    $('#adv').hidden = !settings.advOpen; t.setAttribute('aria-expanded', settings.advOpen); $('.chev', t).classList.toggle('open', settings.advOpen);
  };
  ACT.work = () => go('welcome', { edit: true });
  ACT.guide = () => { settings.guideHidden = false; saveSettings(); go('list'); };
  ACT.templates = () => go('templates');
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
