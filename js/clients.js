'use strict';
// Client screens: list, detail, edit.

// ---------- list ----------
function haystack(c) {
  const parts = [c.name, c.pan, c.mobile, c.email, c.fileNo, c.tan, c.type, c.regNo, c.group];
  for (const p of c.contacts) parts.push(p.name, p.role, p.mobile, p.email);
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
  else if (S.offline) banner = `<button class="banner" data-act="sync">${OUT.size
    ? `You’re offline. ${plural(OUT.size, 'change')} saved on this device will upload when you’re back online.`
    : 'You’re offline. Changes you make are saved on this device and upload when you’re back online.'} Tap to retry.</button>`;
  else if (OUT.size) banner = `<button class="banner" data-act="sync">${plural(OUT.size, 'change')} not uploaded yet. Tap to retry.</button>`;
  if (S.unreadable) banner = `<div class="banner"><span class="grow">${plural(S.unreadable, 'client record')} couldn’t be opened with this vault’s key — ${S.unreadable === 1 ? 'it may be' : 'they may be'} damaged. ${S.unreadable === 1 ? 'It’s' : 'They’re'} left as ${S.unreadable === 1 ? 'it is' : 'they are'}; restoring a backup can bring ${S.unreadable === 1 ? 'it' : 'them'} back.</span></div>` + banner;
  if (!banner && BIO_OK && !bioRecord() && settings.bioOffer) banner = bioPending
    ? `<div class="banner info"><span class="grow">Almost done — confirm ${esc(BIO)} once more.</span><button class="bbtn" data-act="bioOn">Confirm</button></div>`
    : `<div class="banner info"><span class="grow">Unlock faster with ${esc(BIO)}.</span><button class="bbtn" data-act="bioOn">Turn on</button><button class="bx" data-act="bioNo" aria-label="Dismiss">×</button></div>`;
  const logo = logoOf();
  app.innerHTML = bar({
    left: logo || S.meta.firm ? `<button class="mini-brand" data-act="firmd" aria-label="Firm details">${logo ? logoImg(logo, '') : ''}<span>${esc(S.meta.firm || '')}</span></button>` : '',
    title: 'Clients', big: true,
    right: `<button class="nav-btn" data-act="add" aria-label="Add client">${I.plus}</button>`,
  }) + `
    <h1 class="large" data-big>Clients</h1>
    ${S.clients.some(c => Object.keys(c.comp).length || c.fees.length) ? statTiles() : ''}
    ${guideHTML()}
    <div class="search"${S.clients.length ? '' : ' hidden'}>${I.search}<input id="q" type="search" placeholder="Name, PAN, GSTIN, mobile, group…" value="${esc(Q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search clients"></div>
    <div class="chips" id="chips" role="tablist" aria-label="Filter by status"></div>
    ${banner}<div id="list"></div>`;
  drawList();
  $('#q').oninput = e => { Q = e.target.value; drawList(); };
  ACT.due = t => { DUEF = t.dataset.f; go('due'); };
  ACT.dash = () => go('dash');
  ACT.add = () => go('edit', null);
  ACT.open = t => go('detail', t.dataset.id);
  ACT.filter = t => { F = t.dataset.f; drawList(); };
  ACT.clearq = () => { Q = ''; F = 'All'; $('#q').value = ''; drawList(); $('#q').focus(); };
  ACT.sync = () => sync();
  ACT.bioOn = () => bioTurnOn(() => renderList());
  ACT.firmd = () => go('firm', { from: 'list' });
  ACT.csv = () => pickCsvFile();
  ACT.sample = () => sampleCSV();
  bindGuide();
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
  if (!all.length) {
    el.innerHTML = `<div class="empty"><b>No clients yet</b>Add clients one at a time, or bring in your whole list from Excel.
      <div class="stack empty-actions"><button class="btn primary" data-act="add">Add a client</button><button class="btn plainbtn" data-act="csv">Import from Excel (CSV)</button>
      <button class="linkbtn small" data-act="sample">Download a sample Excel file</button></div></div>`;
    return;
  }
  if (!shown.length) {
    el.innerHTML = `<div class="empty"><b>No matches</b>${q ? `Nothing found for “${esc(Q.trim())}”${F !== 'All' ? ` among ${esc(F)} clients` : ''}.` : 'No clients with this status.'}
      <div class="stack empty-actions"><button class="btn plainbtn" data-act="clearq">${q ? 'Clear search' : 'Show all clients'}</button></div></div>`;
    return;
  }
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
  html += section(c.contacts.length > 1 ? 'Contact persons' : 'Contact person', c.contacts.map((p, i) => {
    const m = normMobile(p.mobile || ''), ok = /^[6-9]\d{9}$/.test(m);
    return `<div class="row"><div class="dcol"><div class="dval">${esc(p.name || 'Contact')}</div><div class="dnote">${esc([p.role, p.mobile, p.email].filter(Boolean).join(' · '))}</div></div>${
      p.mobile ? `<a class="ibtn" href="tel:${esc(p.mobile)}" aria-label="Call ${esc(p.name)}">${I.phone}</a>` : ''}${
      ok ? `<button class="ibtn" data-act="cwa" data-i="${i}" aria-label="WhatsApp ${esc(p.name)}">${I.chat}</button>` : ''}${
      p.email ? `<a class="ibtn" href="mailto:${esc(p.email)}" aria-label="Email ${esc(p.name)}">${I.mail}</a>` : ''}</div>`;
  }));
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
  html += section(SECTIONS[2].title, [...(c.pan ? [row('User ID', c.pan, { mono: true, note: 'Same as the PAN' })] : []), ...fieldRows(SECTIONS[2])], loginBtn('it'));
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
  ACT.edit = () => go('edit', id);
  ACT.wa = () => go('wa', { id, back: 'detail' });
  ACT.comp = () => go('comp', id);
  ACT.fees = () => go('fees', id);
  ACT.task = t => go('task', { id, key: t.dataset.k, back: 'detail' });
  ACT.pwtask = () => go('edit', id);
  ACT.alldue = () => { DUEF = 'open'; go('due'); };
  ACT.login = t => go('login', { id, p: t.dataset.p, back: 'detail' });
  ACT.open = t => go('detail', t.dataset.id);
  ACT.cwa = t => openWhatsApp(c.contacts[+t.dataset.i], '');
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
const msgDiv = '<div class="fmsg" hidden aria-live="polite"></div>';
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

const contactBlock = p => `<div data-contact>
  <div class="group-h"><span class="ct">Contact person</span><button type="button" class="linkbtn danger" data-act="cdel">Remove</button></div>
  <div class="group">
    <div class="frow"><span class="flabel">Name</span><input class="finput" data-cf="name" value="${esc(p.name)}" placeholder="e.g. Suresh Patel" autocomplete="off" aria-label="Contact name"></div>
    <div class="frow"><span class="flabel">Role</span><input class="finput" data-cf="role" value="${esc(p.role)}" placeholder="Director, partner, accountant…" autocomplete="off" aria-label="Contact role"></div>
    <div class="frow"><span class="flabel">Mobile</span><input class="finput" type="tel" data-cf="mobile" data-rule="mobile" data-norm="mobile" value="${esc(p.mobile)}" placeholder="10-digit number" ${inputAttrs} aria-label="Contact mobile">${msgDiv}</div>
    <div class="frow"><span class="flabel">Email</span><input class="finput" type="email" data-cf="email" data-rule="email" data-norm="lower" value="${esc(p.email)}" autocapitalize="off" ${inputAttrs} aria-label="Contact email">${msgDiv}</div>
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
    f.up ? ' autocapitalize="characters"' : ['name', 'address', 'notes', 'bankName'].includes(f.k) ? '' : ' autocapitalize="off"'}`;
  let input;
  if (f.kind === 'state') {
    input = `<select class="finput" ${attrs}><option value="">Choose</option>${STATES.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (f.kind === 'select') {
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

// a: the client id (null for a new client), or { id, draft } to reopen unsaved changes.
function renderEdit(a) {
  const id = a?.id ?? (typeof a === 'string' ? a : null), draft = a?.draft;
  const orig = id && S.clients.find(x => x.id === id);
  const c = draft ? tidy(structuredClone(draft)) : orig ? structuredClone(orig) : tidy({ type: 'Individual' });
  // A new client starts with just the basics; everything else opens with "Add more details".
  const BASIC = ['name', 'type', 'mobile', 'email', 'pan'];
  const fieldsOf = keys => keys.map(k => FIELDS.find(f => f.k === k));
  const sec = (title, fields) => fields.length ? `<div class="group-h">${esc(title)}</div><div class="group">${fields.map(f => fieldHTML(f, c[f.k] || '', c.type)).join('')}</div>` : '';
  const rest = s => s.fields.filter(f => !BASIC.includes(f.k));
  const gstFirst = handles('GST') || c.gst.length; // GST is a basic detail for practices that do GST work
  const gstHTML = `<div id="gsts">${c.gst.map(gstBlock).join('')}</div>
    <div class="group"><button type="button" class="row addrow" data-act="gadd"><span class="plus">+</span><span id="gaddLabel"></span></button></div>
    <p class="foot">Add one entry per GST registration (one per state).</p>`;
  const expanded = !!orig && (FIELDS.some(f => !BASIC.includes(f.k) && c[f.k]) || c.businesses.length || c.extra.length || Object.keys(c.custom).length || (!gstFirst && c.gst.length));
  let html = bar({ left: `<button class="nav-btn" data-act="cancel">Cancel</button>`, title: orig ? 'Edit Client' : 'New Client', right: `<button class="nav-btn strong" data-act="save">${orig ? 'Done' : 'Save'}</button>` });
  html += `<form id="form" autocomplete="off" novalidate>`;
  html += sec('Basic details', fieldsOf(BASIC));
  if (gstFirst) html += gstHTML;
  html += `<div id="contacts">${c.contacts.map(contactBlock).join('')}</div>
    <div class="group"><button type="button" class="row addrow" data-act="cadd"><span class="plus">+</span><span id="caddLabel"></span></button></div>
    <p class="foot" id="cfoot">Someone you deal with for this client — a director, partner, family member or their accountant.</p>`;
  html += `<div class="group" id="moreBtn"${expanded ? ' hidden' : ''}><button type="button" class="row addrow" data-act="more"><span class="plus">+</span><span class="grow">Add more details<small>Address, Aadhaar, date of birth, business, portal logins, bank…</small></span></button></div>`;
  if (!orig) html += `<p class="foot"${expanded ? ' hidden' : ''} id="moreFoot">Only the name is needed. You can add the rest any time.</p>`;
  html += `<div id="more"${expanded ? '' : ' hidden'}>`;
  html += sec('More about the client', rest(SECTIONS[0]));
  html += `<div id="bizSec"${PERSONAL.has(c.type) ? '' : ' hidden'}><div id="bizs">${c.businesses.map(b => bizBlock(b, c.type)).join('')}</div>
    <div class="group"><button type="button" class="row addrow" data-act="badd"><span class="plus">+</span><span id="baddLabel"></span></button></div>
    <p class="foot">For a proprietary business or trade name run by this ${c.type === 'HUF' ? 'HUF' : 'person'}, with its address if it’s different.</p></div>`;
  html += sec('Identity', rest(SECTIONS[1]));
  // The Income Tax login ID is always the PAN, so it's shown, not typed.
  html += `<div class="group-h">${esc(SECTIONS[2].title)}</div><div class="group"><div class="frow"><span class="flabel">User ID</span><span class="finput mono itid" id="itUserShow"></span></div>${SECTIONS[2].fields.map(f => fieldHTML(f, c[f.k] || '', c.type)).join('')}</div>
    <p class="foot">The login ID is the PAN, filled in from above.</p>`;
  if (!gstFirst) html += gstHTML;
  for (const s of SECTIONS.slice(3, -1)) html += sec(s.title, s.fields);
  if (S.meta.customFields.length) html += `<div class="group-h">Custom fields</div><div class="group">${S.meta.customFields.map(f =>
    `<div class="frow"><span class="flabel">${esc(f.label)}</span><input class="finput${f.secret ? ' masked' : ''}" data-c="${esc(f.id)}" value="${esc(c.custom[f.id] || '')}" ${inputAttrs} autocapitalize="off" aria-label="${esc(f.label)}">${f.secret ? eyeBtn(f.label) : ''}</div>`).join('')}</div>`;
  html += `<div class="group-h">Other details</div><div class="group" id="xg">${c.extra.map(xrow).join('')}<button type="button" class="row addrow" data-act="xadd"><span class="plus">+</span>Add field</button></div>`;
  html += `<p class="foot">Use the lock icon to keep a value hidden until you tap the eye.</p>`;
  const notes = SECTIONS[SECTIONS.length - 1];
  html += sec(notes.title, notes.fields) + `</div>`;
  if (orig) html += `<div class="group"><button type="button" class="row danger" data-act="del">Delete Client</button></div>`;
  const groups = [...new Set(S.clients.map(x => x.group).filter(Boolean))].sort();
  html += `<datalist id="dl-group">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></form>`;
  app.innerHTML = html;

  const form = $('#form');
  form.onsubmit = e => e.preventDefault();
  let dirty = !!draft, typeTouched = !!orig || !!draft;
  const typeSel = $('[data-k="type"]', form);
  const val = k => $(`[data-k="${k}"]`, form).value.trim();
  const ctx = () => ({
    type: typeSel.value, name: val('name'), pan: NORM.id(val('pan')), dob: val('dob'), self: c.id,
    biz: PERSONAL.has(typeSel.value) ? $$('[data-bf="name"]', form).map(i => i.value.trim()).filter(Boolean) : [],
    gstins: $$('[data-gf="gstin"]', form).map(i => NORM.id(i.value)).filter(Boolean), tan: NORM.id(val('tan')),
  });
  const showMsg = (el, res) => {
    const row = el.closest('.frow'), m = $('.fmsg', row);
    if (!m) return;
    m.hidden = !res; m.textContent = res?.msg || ''; m.className = 'fmsg ' + (res?.level || '');
    row.classList.toggle('bad', res?.level === 'err');
    // Screen readers read the message with the field it belongs to.
    m.id ||= 'msg-' + uid();
    res ? el.setAttribute('aria-describedby', m.id) : el.removeAttribute('aria-describedby');
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
  const showItId = () => {
    const pan = NORM.id(val('pan')), el = $('#itUserShow');
    el.textContent = pan || 'Enter the PAN above';
    el.classList.toggle('muted', !PAN_RE.test(pan));
  };
  form.addEventListener('input', e => { if (e.target.dataset.k === 'pan') showItId(); });
  // Pressing a button on the form shouldn't first take focus away from the field being typed in:
  // that shows the field's check message, which pushes the button down and the tap misses it.
  form.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
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
    const nc = $$('[data-contact]', form).length;
    $$('[data-contact]', form).forEach((b, i) => { $('.ct', b).textContent = nc > 1 ? `Contact person ${i + 1}` : 'Contact person'; });
    $('#caddLabel').textContent = nc ? 'Add another contact person' : 'Add contact person';
    $('#cfoot').hidden = nc > 0;
    showItId();
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
  EDIT_DRAFT = () => dirty ? { ...collect(), id: c.id } : null;
  ACT.more = () => {
    $('#more').hidden = false; $('#moreBtn').hidden = true; if ($('#moreFoot')) $('#moreFoot').hidden = true;
    $('#more .finput:not([hidden])')?.focus({ preventScroll: true });
    $('#more').scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
  };
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
  ACT.cadd = () => { $('#contacts').insertAdjacentHTML('beforeend', contactBlock({})); dirty = true; relabel(); $('#contacts [data-contact]:last-child [data-cf="name"]').focus(); };
  ACT.cdel = t => {
    const b = t.closest('[data-contact]');
    if ($$('[data-cf]', b).some(i => i.value.trim()) && !confirm('Remove this contact person?')) return;
    b.remove(); dirty = true; relabel();
  };
  ACT.gadd = () => { $('#gsts').insertAdjacentHTML('beforeend', gstBlock({})); dirty = true; relabel(); $('#gsts [data-gst]:last-child [data-gf="gstin"]').focus(); };
  ACT.gdel = t => {
    const g = t.closest('[data-gst]');
    if ($$('[data-gf]', g).some(i => i.value.trim()) && !confirm('Remove this GST registration?')) return;
    g.remove(); dirty = true; relabel(); validateAll();
  };
  ACT.del = async () => {
    if (!confirm(`Delete ${orig.name}? You can restore them from Settings → Recently deleted for ${TRASH_DAYS} days.`)) return;
    try {
      await updateClient(orig, d => { d.deleted = Date.now(); });
      go('list');
      toast(savedMsg(`${orig.name} deleted`), { label: 'Undo', fn: () => restoreClient(id) });
    } catch (e) { toast(errText(e)); }
  };
  // Everything on the form, as a client record (not yet checked).
  const collect = () => {
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
    d._biz = !PERSONAL.has(type) && biz.length > 0;
    d.businesses = PERSONAL.has(type) ? biz : [];
    d.gst = $$('[data-gst]', form).map(g => {
      const v = k => $(`[data-gf="${k}"]`, g).value.trim();
      return { gstin: v('gstin'), user: v('user'), pass: v('pass') };
    }).filter(g => g.gstin || g.user || g.pass);
    const firstPan = d.gst.map(g => gstinPan(g.gstin)).find(Boolean);
    if (!d.pan && firstPan) d.pan = firstPan;
    // The state decides CGST + SGST or IGST on invoices: from the GSTIN, else from the address.
    if (!d.state) {
      const fromGst = GST_STATES[d.gst.find(g => GSTIN_RE.test(g.gstin))?.gstin.slice(0, 2)];
      d.state = STATE_CODE[fromGst] ? fromGst : stateInText(d.address);
      if (!d.state) delete d.state;
    }
    d.contacts = $$('[data-contact]', form).map(b => {
      const g = k => $(`[data-cf="${k}"]`, b).value.trim();
      return { name: g('name'), role: g('role'), mobile: g('mobile'), email: g('email') };
    }).filter(p => p.name || p.mobile || p.email);
    delete d.itUser;
    return d;
  };
  ACT.save = async t => {
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
    const d = collect();
    const type = d.type;
    if (!PERSONAL.has(type) && d._biz && !confirm(`A ${type} is itself the business, so the business / trade name entries will be removed. Continue?`)) return;
    delete d._biz;
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
    try {
      await saveClient(d);
      // A new client goes straight to choosing returns, with the usual ones already ticked.
      if (!orig && suggestComp(d).size) { toast(savedMsg('Client added')); go('comp', { id: d.id, fresh: true }); }
      else { toast(savedMsg('Saved')); go('detail', d.id); }
    }
    catch (e) { t.disabled = false; t.textContent = orig ? 'Done' : 'Save'; if (e instanceof AuthError) return signOut(e.message); toast(errText(e)); }
  };
}
const errText = e => isNet(e) ? 'Couldn’t reach the vault — not saved.' : e.message || 'Something went wrong.';
