'use strict';
// Practice screens: due dates, one filing, returns to track, fees, WhatsApp, reminders, portal login, templates.

// ---------- due dates screen ----------
let DUEF = 'open';
function renderDue() {
  const L = dueLists(), list = L[DUEF];
  const tabs = [['open', 'All open'], ['overdue', 'Overdue'], ['week', 'This week'], ['filed', 'Filed']];
  let html = bar({ title: 'Due dates', right: list.length && DUEF !== 'filed' ? `<button class="nav-btn" data-act="bulk">Remind</button>` : '' });
  html += `<div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${DUEF === k}" class="${DUEF === k ? 'on' : ''}" data-act="duef" data-f="${k}">${l}${k !== 'filed' ? ` <b>${L[k].length}</b>` : ''}</button>`).join('')}</div>`;
  if (!list.length) {
    const any = S.clients.some(c => Object.keys(c.comp).length);
    html += any ? `<div class="empty"><b>All clear</b>Nothing here right now.</div>`
      : `<div class="empty"><b>No due dates yet</b>Choose which returns each client files, and every due date shows up here, with reminders.
        <div class="stack empty-actions"><button class="btn primary" data-act="pickc">${S.clients.length ? 'Choose returns for a client' : 'Add your first client'}</button></div></div>`;
  } else if (DUEF === 'filed') {
    html += `<div class="group-h">Filed in the last 60 days</div><div class="group">${list.map(t => taskRow(t)).join('')}</div>`;
  } else {
    const wk = addDays(L.today, 7);
    const groups = [['Overdue', t => t.due < L.today], ['Today', t => t.due === L.today], ['This week', t => t.due > L.today && t.due <= wk], ['Later this month', t => t.due > wk]];
    for (const [h, f] of groups) { const g = list.filter(f); if (g.length) html += `<div class="group-h">${h}</div><div class="group">${g.map(t => taskRow(t)).join('')}</div>`; }
  }
  const nExt = Object.keys(S.meta.ext || {}).length;
  html += `<div class="group"><button class="row" data-act="ext"><span class="grow">Due date extensions</span>${nExt ? `<span class="val">${nExt}</span>` : ''}<span class="chev">${I.chev}</span></button></div>`;
  html += `<p class="foot">Government extended a due date? Add it once under Due date extensions and it applies to every client.</p>`;
  app.innerHTML = html;
  ACT.duef = t => { DUEF = t.dataset.f; go('due', undefined, true); };
  ACT.task = t => go('task', { id: t.dataset.id, key: t.dataset.k, back: 'due' });
  ACT.pwtask = t => go('edit', t.dataset.id);
  ACT.bulk = () => { BULK_SENT.clear(); go('bulk'); };
  ACT.ext = () => go('ext');
  ACT.pickc = () => { const c = S.clients.find(x => !Object.keys(x.comp).length) || S.clients[0]; c ? go('comp', { id: c.id, fresh: true }) : go('edit', null); };
}

// ---------- due date extensions (all clients) ----------
const periodsOf = (def, a, b) => { const out = []; for (let s = a; s <= b; s++) out.push(...def.gen(s, null, '')); return out; };
// Periods of a return that can still be extended: roughly the last year to the next.
function extPeriods(def) {
  const fy = fyStart(todayStr()), from = addDays(todayStr(), -400);
  return periodsOf(def, fy - 1, fy + 1).filter(t => t.due >= from);
}
function renderExt(a = {}) {
  const ext = S.meta.ext || {};
  const list = Object.entries(ext).map(([k, to]) => {
    const [code, p] = k.split('|'), def = COMPS[code], fy = fyStart(todayStr()), t = def && periodsOf(def, fy - 2, fy + 1).find(x => x.p === p);
    return { k, to, name: def?.name || code, label: t?.label || p, from: t?.due };
  }).sort((a, b) => a.to < b.to ? 1 : -1);
  let html = bar({ left: backBtn(a.back === 'settings' ? 'Settings' : 'Due dates', 'back'), title: 'Extensions' });
  html += `<p class="foot" style="margin:0 34px 16px">When CBDT, CBIC or MCA extends a due date, add it here once. It applies to every client who tracks that return. A date you change on a single filing still wins.</p>`;
  html += `<div class="group-h">Add extension</div><form id="xf" class="group" autocomplete="off">
    <label class="row"><span class="grow">Return</span><select class="plain" id="xcode">${['Income Tax', 'GST', 'TDS', 'Payroll', 'ROC'].map(g =>
      `<optgroup label="${g}">${COMP.filter(d => d.group === g).map(d => `<option value="${d.code}">${esc(d.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <label class="row"><span class="grow">Period</span><select class="plain" id="xp"></select></label>
    <label class="frow"><span class="flabel">New due date</span><input class="finput" type="date" id="xto"></label>
    <button type="button" class="row link" data-act="xadd" style="justify-content:center;font-weight:600">Add extension</button>
  </form>`;
  html += list.length ? `<div class="group-h">Extensions in use</div><div class="group">${list.map(x => `<div class="row"><span class="grow">${esc(x.name)}<small>${esc(x.label)} · ${x.from ? fmtDate(x.from) + ' → ' : ''}${fmtDate(x.to)}</small></span><button class="linkbtn danger" data-act="xdel" data-k="${esc(x.k)}" style="color:var(--danger)">Remove</button></div>`).join('')}</div>`
    : `<div class="empty"><b>No extensions</b>Every client follows the statutory due dates.</div>`;
  app.innerHTML = html;
  const code = $('#xcode'), per = $('#xp'), to = $('#xto');
  const fill = () => {
    const today = todayStr(), ps = extPeriods(COMPS[code.value]);
    per.innerHTML = ps.map(t => `<option value="${esc(t.p)}" data-due="${t.due}">${esc(t.label)} · due ${fmtShort(t.due)}</option>`).join('');
    const next = ps.find(t => t.due >= today) || ps[ps.length - 1]; // the one coming up is the one usually extended
    if (next) per.value = next.p;
    to.value = ''; to.min = per.selectedOptions[0]?.dataset.due || '';
  };
  code.onchange = fill;
  per.onchange = () => { to.min = per.selectedOptions[0]?.dataset.due || ''; };
  fill();
  $('#xf').onsubmit = e => e.preventDefault();
  ACT.back = backTo;
  const save = async (next, msg) => {
    const prev = S.meta.ext;
    S.meta.ext = next;
    try { await saveMeta(); toast(msg); go('ext', a, true); } catch (e) { S.meta.ext = prev; toast(errText(e)); }
  };
  ACT.xadd = () => {
    const o = per.selectedOptions[0];
    if (!o) return toast('Choose a period');
    if (!to.value) { toast('Choose the new due date'); return to.focus(); }
    if (to.value <= o.dataset.due) return toast('The new date should be after the original due date');
    save({ ...ext, [`${code.value}|${per.value}`]: to.value }, `Extended to ${fmtDate(to.value)} for all clients`);
  };
  ACT.xdel = b => {
    if (!confirm('Remove this extension? Clients go back to the statutory due date.')) return;
    const next = { ...ext }; delete next[b.dataset.k];
    save(next, 'Extension removed');
  };
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
  const notes = [];
  if (t.std !== t.orig) notes.push(`Extended for all clients from ${fmtDate(t.orig)} to ${fmtDate(t.std)}.`);
  if (t.due !== t.std) notes.push(`${t.std !== t.orig ? 'Extended' : 'Statutory'} due date: ${fmtDate(t.std)}.`);
  if (notes.length) html += `<p class="foot">${notes.join(' ')}</p>`;
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
        if (fee > 0) { const date = nw.on || today, e = { id: uid(), date, kind: 'bill', amt: fee, desc: `${t.title} · ${t.period}`, no: nextNo('bill', date) }; d.fees.push(e); nw.bill = e.id; }
        for (const k of Object.keys(nw)) if (nw[k] === '' || nw[k] == null) delete nw[k];
        d.work[t.key] = nw;
      });
      toast('Saved'); backTo();
    } catch (e) { b.disabled = false; toast(errText(e)); }
  };
}

// ---------- choose returns to track ----------
// a: the client id, or { id, fresh } right after adding a client — then the usual returns are pre-ticked.
function renderComp(a) {
  const id = a?.id ?? a, fresh = !!a?.fresh;
  const c = S.clients.find(x => x.id === id);
  if (!c) return go('list');
  const suggested = fresh && !Object.keys(c.comp).length ? suggestComp(c) : null;
  const sel = new Set(suggested || Object.keys(c.comp)), noGst = !c.gst.some(g => GSTIN_RE.test(g.gstin));
  let html = bar({ left: `<button class="nav-btn" data-act="back">${fresh ? 'Skip' : 'Cancel'}</button>`, title: 'Returns to track', right: `<button class="nav-btn strong" data-act="save">Done</button>` });
  html += `<p class="foot" style="margin:0 34px 16px">${esc(c.name)} · ${esc(c.type)}</p>`;
  if (suggested?.size) html += `<div class="banner info">We’ve switched on the returns a ${esc(c.type === 'Individual' ? 'person' : c.type)} like this usually files. Change anything, then tap Done.</div>`;
  const group = g => {
    const defs = COMP.filter(d => d.group === g && (!d.types || d.types.includes(c.type)));
    if (!defs.length) return '';
    let h = `<div class="group-h">${esc(SERVICES.find(x => x[0] === g)?.[1] || g)}</div><div class="group">${defs.map(d => `<div class="row"><span class="grow">${esc(d.name)}<small>Due ${esc(d.due)}</small></span>${sw(sel.has(d.code), 'tog', ` data-c="${d.code}" aria-label="${esc(d.name)}"`)}</div>`).join('')}</div>`;
    if (g === 'GST' && noGst) h += `<p class="foot">Add a GSTIN to this client so GST filings show the right state and due dates.</p>`;
    else if (g === 'GST' && suggested?.has('GSTR3BM')) h += `<p class="foot">Files quarterly under QRMP? Switch on the QRMP returns instead of the monthly ones.</p>`;
    return h;
  };
  // Work the practice doesn't handle stays tucked away, unless this client already tracks some of it.
  const groups = ['Income Tax', 'GST', 'TDS', 'Payroll', 'ROC'];
  const main = groups.filter(g => handles(g) || COMP.some(d => d.group === g && sel.has(d.code)));
  const other = groups.filter(g => !main.includes(g)).map(group).join('');
  html += main.map(group).join('');
  if (other) html += `<div class="group" id="otherBtn"><button class="row link" data-act="others">Show all returns</button></div><div id="others" hidden>${other}</div>`;
  html += `<p class="foot">Tracking starts with filings due in the last 60 days. You can change these any time from the client’s page.</p>`;
  app.innerHTML = html;
  ACT.back = backTo;
  ACT.others = () => { $('#others').hidden = false; $('#otherBtn').hidden = true; };
  ACT.tog = t => { const on = t.getAttribute('aria-checked') !== 'true'; t.setAttribute('aria-checked', on); on ? sel.add(t.dataset.c) : sel.delete(t.dataset.c); };
  ACT.save = async b => {
    const start = addDays(todayStr(), -60);
    b.disabled = true;
    try {
      await updateClient(c, d => { d.comp = Object.fromEntries([...sel].map(k => [k, c.comp[k] || start])); });
      toast(sel.size ? `Tracking ${plural(sel.size, 'return')}` : 'Saved'); backTo();
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
    <label class="row" data-rcpt hidden><span class="grow">Paid by</span><select class="plain" id="fmode"><option value="">—</option>${PAY_MODES.map(x => `<option>${x}</option>`).join('')}</select></label>
    <label class="frow" data-rcpt hidden><span class="flabel">Reference</span><input class="finput" id="fref" placeholder="UTR / cheque no. (optional)" autocomplete="off" autocorrect="off" spellcheck="false"></label>
    <button type="button" class="row link" data-act="fadd" style="justify-content:center;font-weight:600">Add entry</button>
  </div></form>`;
  const entries = [...c.fees].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  html += entries.length ? `<div class="group-h">Ledger</div><div class="group">${entries.map(e => `<button class="row" data-act="doc" data-i="${esc(e.id)}"><span class="grow">${esc(e.desc || (e.kind === 'bill' ? 'Professional fees' : 'Payment received'))}<small>${fmtDate(e.date)} · ${e.kind === 'bill' ? 'Bill' : 'Payment'}${e.no ? ' · ' + esc(e.no) : ''}${e.mode ? ' · ' + esc(e.mode) : ''}</small></span><span class="amt${e.kind === 'bill' ? '' : ' in'}">${e.kind === 'bill' ? '' : '−'}${inr(e.amt)}</span><span class="chev">${I.chev}</span></button>`).join('')}</div>
    <p class="foot">Tap an entry for its invoice or receipt — share it as a PDF, or delete the entry.</p>` : `<div class="empty"><b>No entries yet</b>Add a bill when you agree a fee, and a payment when it’s received.</div>`;
  if (f.due > 0) html += `<div class="group"><button class="row link" data-act="remindfee">Send fees reminder on WhatsApp</button></div>`;
  app.innerHTML = html;
  $('#ff').onsubmit = e => e.preventDefault();
  ACT.back = backTo;
  ACT.kind = b => {
    kind = b.dataset.k;
    $$('.seg button', app).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    $$('[data-rcpt]', app).forEach(r => { r.hidden = kind !== 'rcpt'; });
  };
  ACT.fadd = async b => {
    const amt = parseFloat($('#amt').value.replace(/[,\s₹]/g, ''));
    if (!(amt > 0)) { toast('Enter an amount'); return $('#amt').focus(); }
    const date = $('#fdate').value || today;
    if (date > today) return toast('The date can’t be in the future');
    b.disabled = true;
    try {
      const e = { id: uid(), date, kind, amt, desc: $('#fdesc').value.trim(), no: nextNo(kind, date) };
      if (kind === 'rcpt') { if ($('#fmode').value) e.mode = $('#fmode').value; if ($('#fref').value.trim()) e.ref = $('#fref').value.trim(); }
      await updateClient(c, d => d.fees.push(e));
      toast(`${kind === 'bill' ? 'Bill' : 'Payment'} ${e.no} added`); go('fees', id, true);
    } catch (e) { b.disabled = false; toast(errText(e)); }
  };
  ACT.doc = b => go('doc', { id, e: b.dataset.i });
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
    const out = $$('[data-tpl]', app).map(el => ({ id: el.dataset.tpl, name: $('[data-f="name"]', el).value.trim() || 'Message', text: $('[data-f="text"]', el).value.trim() })).filter(x => x.text);
    const prev = { templates: S.meta.templates, firm: S.meta.firm };
    S.meta.templates = out; S.meta.firm = $('#firm').value.trim();
    b.disabled = true;
    try { await saveMeta(); toast('Saved'); backTo(); }
    catch (e) { Object.assign(S.meta, prev); b.disabled = false; toast(errText(e)); }
  };
}
