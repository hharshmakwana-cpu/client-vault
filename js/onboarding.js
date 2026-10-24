'use strict';
// Making the app easy on day one: a welcome screen, the work the practice handles (which trims
// what the app shows), suggested returns for a new client, and a "Get started" checklist.

// ---------- work the practice handles ----------
// Groups of returns, matching COMP[].group. Only these are offered first when choosing returns.
const SERVICES = [
  ['Income Tax', 'Income Tax', 'ITR, advance tax, tax audit'],
  ['GST', 'GST', 'GSTR-1, GSTR-3B, annual return'],
  ['TDS', 'TDS', 'TDS payments, returns, Form 16'],
  ['ROC', 'Company / LLP filings', 'AOC-4, MGT-7, LLP forms, DIR-3 KYC'],
  ['Payroll', 'Payroll', 'PF, ESI, professional tax'],
];
const services = () => S.meta.services || SERVICES.map(s => s[0]);
const handles = g => services().includes(g);
// A brand-new vault starts with the welcome screen; existing ones never see it.
const needsWelcome = () => !S.meta.setupDone && !S.clients.length;

// The returns a client of this kind usually files, limited to the work the practice handles.
function suggestComp(c) {
  const out = new Set(), add = (g, ...codes) => { if (handles(g)) codes.forEach(x => out.add(x)); };
  const company = c.type === 'Company', llp = c.type === 'LLP';
  add('Income Tax', company ? 'ITR_A' : 'ITR');
  if (c.gst.some(g => GSTIN_RE.test(g.gstin))) add('GST', 'GSTR1M', 'GSTR3BM', 'GSTR9');
  if (c.tan) add('TDS', 'TDSPAY', 'TDSRET');
  if (company) add('ROC', 'AOC4', 'MGT7', 'DIR3');
  if (llp) add('ROC', 'LLP11', 'LLP8', 'DIR3');
  return out;
}

// ---------- welcome / "work you handle" screen ----------
// First run (no arg): firm name + work handled, then the client list.
// From Settings ({ edit: true }): just the work handled.
function renderWelcome(a = {}) {
  const sel = new Set(services());
  let html = a.edit
    ? bar({ left: `<button class="nav-btn" data-act="back">Cancel</button>`, title: 'Work you handle', right: `<button class="nav-btn strong" data-act="go">Done</button>` })
    : bar({ right: `<button class="nav-btn" data-act="skip">Skip</button>` }) + `<div class="hero welcome"><div class="lock-icon">${I.lock}</div>
        <h2>Welcome to Client Vault</h2><p>Two quick questions to set things up. You can change both later in Settings.</p></div>
      <div class="group-h">1 · Your firm’s name</div>
      <div class="group"><label class="frow bare"><input class="finput" id="wfirm" value="${esc(S.meta.firm || '')}" placeholder="e.g. Makwana & Associates" autocomplete="organization"></label></div>
      <p class="foot">Used at the end of WhatsApp messages and on invoices.</p>`;
  html += `<div class="group-h">${a.edit ? 'Returns you file for clients' : '2 · What work do you handle?'}</div><div class="group">${SERVICES.map(([g, name, hint]) =>
    `<div class="row"><span class="grow">${esc(name)}<small>${esc(hint)}</small></span>${sw(sel.has(g), 'svc', ` data-g="${g}" aria-label="${esc(name)}"`)}</div>`).join('')}</div>
    <p class="foot">The app suggests and shows only these when you choose a client’s returns. Others stay available under “Show all returns”.</p>`;
  if (!a.edit) html += `<div class="pad"><button class="btn primary" data-act="go">Get started</button></div>`;
  app.innerHTML = html;
  ACT.svc = t => { const on = !sel.has(t.dataset.g); on ? sel.add(t.dataset.g) : sel.delete(t.dataset.g); t.setAttribute('aria-checked', on); };
  if (a.edit) ACT.back = backTo;
  const done = async (b, data) => {
    const prev = { ...S.meta };
    Object.assign(S.meta, data, { setupDone: true });
    if (b) b.disabled = true;
    try { await saveMeta(); cacheBrand(); a.edit ? (toast('Saved'), backTo()) : go('list'); }
    catch (e) { S.meta = prev; if (b) b.disabled = false; toast(errText(e)); }
  };
  ACT.skip = () => done(null, {});
  ACT.go = b => {
    if (!sel.size) return toast('Choose at least one');
    const data = { services: SERVICES.map(s => s[0]).filter(g => sel.has(g)) };
    if (!a.edit) data.firm = $('#wfirm').value.trim();
    done(b, data);
  };
}

// ---------- "Get started" checklist on the client list ----------
function guideSteps() {
  const F = firmInfo(), first = S.clients[0];
  return [
    { k: 'firm', t: 'Add your firm details', s: 'Name and address for invoices and messages', done: !!(F.name && firmHasAddress(F)) },
    { k: 'add', t: 'Add your first client', s: 'Or import your whole list from Excel', done: !!first },
    { k: 'track', t: 'Choose returns to track', s: 'The app then reminds you of every due date', done: S.clients.some(c => Object.keys(c.comp).length) },
    { k: 'fee', t: 'Record a fee', s: 'Then share the invoice as a PDF', done: S.clients.some(c => c.fees.length) },
  ];
}
function guideHTML() {
  if (settings.guideHidden) return '';
  const steps = guideSteps(), n = steps.filter(s => s.done).length;
  if (n === steps.length) return '';
  const next = steps.find(s => !s.done);
  return `<div class="guide"><div class="guide-h"><b>Get started</b><span>${n} of ${steps.length} done</span><button class="bx" data-act="gx" aria-label="Hide checklist">×</button></div>
    <div class="guide-bar"><i style="width:${n / steps.length * 100}%"></i></div>
    ${steps.map(s => `<button class="row grow-row${s === next ? ' next' : ''}" data-act="g-${s.k}"${s.done ? ' disabled' : ''}><span class="gcheck${s.done ? ' on' : ''}" aria-hidden="true">${s.done ? I.check : ''}</span><span class="grow">${esc(s.t)}<small>${esc(s.s)}</small></span>${s.done ? '' : `<span class="chev">${I.chev}</span>`}</button>`).join('')}</div>`;
}
function bindGuide() {
  const pick = test => S.clients.find(test) || S.clients[0];
  ACT['g-firm'] = () => go('firm', { from: 'list' });
  ACT['g-add'] = () => go('edit', null);
  ACT['g-track'] = () => { const c = pick(c => !Object.keys(c.comp).length); c ? go('comp', { id: c.id, fresh: true }) : go('edit', null); };
  ACT['g-fee'] = () => { const c = pick(c => !c.fees.length); c ? go('fees', c.id) : go('edit', null); };
  ACT.gx = () => { settings.guideHidden = true; saveSettings(); renderList(); toast('Checklist hidden'); };
}

// ---------- pick a CSV file from anywhere ----------
function pickCsvFile() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv,text/csv,text/comma-separated-values';
  input.onchange = async () => {
    suppressLock = false;
    const file = input.files[0]; if (!file) return;
    try { go('csvimport', { rows: csvToClients(await file.text()) }); }
    catch (er) { toast(er.message || 'Couldn’t read that file'); }
  };
  suppressLock = true;
  input.click();
}
