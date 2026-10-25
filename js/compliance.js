'use strict';
// Compliance calendar (statutory due dates), portal passwords, fee totals, WhatsApp templates.

// ---------- compliance calendar ----------
// Statutory due dates as notified. When CBDT/CBIC/MCA extend a date, add it once under Due dates →
// Extensions (S.meta.ext) and it applies to every client; one filing's date can also be changed on its screen.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const todayStr = () => { const t = new Date(); return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const fmtShort = s => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fyStart = s => { const d = new Date(s + 'T00:00:00'); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; };
const FY = s => `FY ${s}-${String(s + 1).slice(2)}`, AY = s => `AY ${s + 1}-${String(s + 2).slice(2)}`;
const nextMonth = (y, m) => m === 12 ? [y + 1, 1] : [y, m + 1];
const monthsOfFY = s => Array.from({ length: 12 }, (_, i) => { const m = (i + 3) % 12 + 1; return [m >= 4 ? s : s + 1, m]; });
const quartersOfFY = s => [[s, 4, 6], [s, 7, 9], [s, 10, 12], [s + 1, 1, 3]];
const monthly = (day, marchDue) => s => monthsOfFY(s).map(([y, m]) => {
  const [ny, nm] = nextMonth(y, m);
  return { p: ymd(y, m, 1).slice(0, 7), label: `${MON[m - 1]} ${y}`, due: marchDue && m === 3 ? ymd(y, 4, 30) : ymd(ny, nm, day) };
});
const quarterly = day => (s, c, g) => quartersOfFY(s).map(([y, a, b], i) => {
  const [ny, nm] = nextMonth(y, b);
  return { p: `${s}Q${i + 1}`, label: `${MON[a - 1]}–${MON[b - 1]} ${y}`, due: ymd(ny, nm, typeof day === 'function' ? day(g) : day) };
});
const yearly = (m, d, label = FY) => s => [{ p: `FY${s}`, label: label(s), due: ymd(s + 1, m, d) }];
const dated = list => s => list(s).map(([y, m, d, label], i) => ({ p: `${s}-${i + 1}`, label, due: ymd(y, m, d) }));
// QRMP GSTR-3B is due on the 22nd in these states/UTs (by GSTIN state code), on the 24th elsewhere.
const QRMP22 = new Set(['22', '23', '24', '25', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37']);
const qrmpDay = g => !g || QRMP22.has(g.slice(0, 2)) ? 22 : 24;
const NOT_CO = ['Individual', 'HUF', 'Partnership Firm', 'LLP', 'Trust', 'AOP', 'BOI', 'Local Authority', 'Artificial Juridical Person', 'Government'];
const COMP = [
  { code: 'ITR', group: 'Income Tax', name: 'ITR (non-audit)', due: '31 Jul', portal: 'it', types: NOT_CO, gen: yearly(7, 31, AY) },
  { code: 'ITR_A', group: 'Income Tax', name: 'ITR (audit / company)', due: '31 Oct', portal: 'it', gen: yearly(10, 31, AY) },
  { code: 'TAR', group: 'Income Tax', name: 'Tax audit report', due: '30 Sep', portal: 'it', gen: yearly(9, 30) },
  { code: 'ADV', group: 'Income Tax', name: 'Advance tax', due: '15 Jun · Sep · Dec · Mar', portal: 'it',
    gen: dated(s => [[s, 6, 15, `${FY(s)} · 1st instalment`], [s, 9, 15, `${FY(s)} · 2nd instalment`], [s, 12, 15, `${FY(s)} · 3rd instalment`], [s + 1, 3, 15, `${FY(s)} · 4th instalment`]]) },
  { code: 'GSTR1M', group: 'GST', gst: true, name: 'GSTR-1 (monthly)', due: '11th of next month', portal: 'gst', gen: monthly(11) },
  { code: 'GSTR3BM', group: 'GST', gst: true, name: 'GSTR-3B (monthly)', due: '20th of next month', portal: 'gst', gen: monthly(20) },
  { code: 'GSTR1Q', group: 'GST', gst: true, name: 'GSTR-1 (QRMP)', due: '13th after the quarter', portal: 'gst', gen: quarterly(13) },
  { code: 'GSTR3BQ', group: 'GST', gst: true, name: 'GSTR-3B (QRMP)', due: '22nd / 24th after the quarter', portal: 'gst', gen: quarterly(qrmpDay) },
  { code: 'CMP08', group: 'GST', gst: true, name: 'CMP-08 (composition)', due: '18th after the quarter', portal: 'gst', gen: quarterly(18) },
  { code: 'GSTR4', group: 'GST', gst: true, name: 'GSTR-4 (composition annual)', due: '30 Apr', portal: 'gst', gen: yearly(4, 30) },
  { code: 'GSTR9', group: 'GST', gst: true, name: 'GSTR-9 / 9C (annual)', due: '31 Dec', portal: 'gst', gen: yearly(12, 31) },
  { code: 'TDSPAY', group: 'TDS', name: 'TDS / TCS payment', due: '7th of next month (March: 30 Apr)', portal: 'it', gen: monthly(7, true) },
  { code: 'GSTR7', group: 'GST', gst: true, name: 'GSTR-7 (TDS under GST)', due: '10th of next month', portal: 'gst', gen: monthly(10) },
  { code: 'GSTR8', group: 'GST', gst: true, name: 'GSTR-8 (TCS by e-commerce operator)', due: '10th of next month', portal: 'gst', gen: monthly(10) },
  { code: 'TDSRET', group: 'TDS', name: 'TDS / TCS returns', due: '31 Jul · 31 Oct · 31 Jan · 31 May', portal: 'traces',
    gen: dated(s => [[s, 7, 31, `${FY(s)} · Q1`], [s, 10, 31, `${FY(s)} · Q2`], [s + 1, 1, 31, `${FY(s)} · Q3`], [s + 1, 5, 31, `${FY(s)} · Q4`]]) },
  { code: 'F16', group: 'TDS', name: 'Form 16 to employees', due: '15 Jun', portal: 'traces', gen: yearly(6, 15) },
  { code: 'F16A', group: 'TDS', name: 'Form 16A / 27D (non-salary certificates)', due: '15 Aug · 15 Nov · 15 Feb · 15 Jun', portal: 'traces',
    gen: dated(s => [[s, 8, 15, `${FY(s)} · Q1`], [s, 11, 15, `${FY(s)} · Q2`], [s + 1, 2, 15, `${FY(s)} · Q3`], [s + 1, 6, 15, `${FY(s)} · Q4`]]) },
  { code: 'PFESI', group: 'Payroll', name: 'PF & ESI', due: '15th of next month', gen: monthly(15) },
  { code: 'PT', group: 'Payroll', name: 'Professional tax (employer)', due: '15th of next month (varies by state)', gen: monthly(15) },
  { code: 'AOC4', group: 'ROC', types: ['Company'], name: 'AOC-4 (financial statements)', due: '30 Oct (AGM on 30 Sep)', gen: yearly(10, 30) },
  { code: 'MGT7', group: 'ROC', types: ['Company'], name: 'MGT-7 (annual return)', due: '29 Nov (AGM on 30 Sep)', gen: yearly(11, 29) },
  { code: 'ADT1', group: 'ROC', types: ['Company'], name: 'ADT-1 (auditor appointment)', due: '14 Oct (15 days after AGM on 30 Sep)', gen: yearly(10, 14) },
  { code: 'DPT3', group: 'ROC', types: ['Company'], name: 'DPT-3 (return of deposits)', due: '30 Jun', gen: yearly(6, 30) },
  { code: 'MSME1', group: 'ROC', types: ['Company'], name: 'MSME-1 (dues to MSMEs)', due: '31 Oct · 30 Apr',
    gen: dated(s => [[s, 10, 31, `Apr–Sep ${s}`], [s + 1, 4, 30, `Oct ${s} – Mar ${s + 1}`]]) },
  // Since 31 Mar 2026 (G.S.R. 943(E)): once every three financial years, by 30 June. Those who filed
  // in FY 2024-25 next file by 30 Jun 2028; a director on a different cycle can have the date changed.
  { code: 'DIR3', group: 'ROC', types: ['Company', 'LLP'], name: 'DIR-3 KYC (directors / partners)', due: '30 Jun, every 3 years (next 2028)',
    gen: s => (s + 1 - 2028) % 3 ? [] : [{ p: `FY${s}`, label: `Every 3 years · DINs as on 31 Mar ${s + 1}`, due: ymd(s + 1, 6, 30) }] },
  { code: 'LLP11', group: 'ROC', types: ['LLP'], name: 'LLP Form 11 (annual return)', due: '30 May', gen: yearly(5, 30) },
  { code: 'LLP8', group: 'ROC', types: ['LLP'], name: 'LLP Form 8 (accounts)', due: '30 Oct', gen: yearly(10, 30) },
];
const COMPS = Object.fromEntries(COMP.map(d => [d.code, d]));
const STATUS = [['pending', 'Pending'], ['docs', 'Docs received'], ['filed', 'Filed'], ['done', 'Completed']];
const STATUS_LABEL = Object.fromEntries(STATUS);
const DONE = new Set(['filed', 'done']);

// Due date extensions notified by the government, for every client: 'CODE|period' → 'YYYY-MM-DD'.
const extOf = (code, p) => S.meta.ext?.[`${code}|${p}`];

// Every filing for a client from when tracking started up to `until`, oldest first.
function tasksOf(c, until) {
  const out = [], gstins = c.gst.map(g => g.gstin).filter(g => GSTIN_RE.test(g));
  for (const [code, from] of Object.entries(c.comp)) {
    const def = COMPS[code];
    if (!def) continue;
    const regs = def.gst && gstins.length ? gstins : [''];
    for (let s = fyStart(from) - 1; s <= fyStart(until); s++) for (const g of regs) for (const t of def.gen(s, c, g)) {
      const key = `${code}|${t.p}${g ? '|' + g : ''}`, w = c.work[key] || {};
      const std = extOf(code, t.p) || t.due, due = w.due || std; // std: statutory date, or the extended one
      if (t.due < from || due > until) continue;
      const title = def.name + (g && gstins.length > 1 ? ` · ${GST_STATES[g.slice(0, 2)] || g}` : '');
      out.push({ kind: 'task', key, def, c, g, title, period: t.label, std, orig: t.due, due, w, status: w.s || 'pending' });
    }
  }
  return out.sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}

// ---------- portal passwords ----------
const pwDays = () => S.meta.pwDays ?? 180;
const PORTAL_URL = { it: 'https://eportal.incometax.gov.in/iec/foservices/#/login', traces: 'https://www.tdscpc.gov.in/app/login.xhtml', gst: GST_URL };
function portalsOf(c) {
  const list = [{ p: 'it', name: 'Income Tax', user: c.pan || '', pass: c.itPass || '', url: PORTAL_URL.it }];
  c.gst.forEach((g, i) => list.push({ p: 'gst:' + i, pw: 'gst:' + g.gstin, name: c.gst.length > 1 ? `GST · ${GST_STATES[g.gstin?.slice(0, 2)] || g.gstin}` : 'GST', user: g.user || '', pass: g.pass || '', url: PORTAL_URL.gst }));
  list.push({ p: 'traces', name: 'TRACES', user: c.tracesUser || '', pass: c.tracesPass || '', url: PORTAL_URL.traces });
  for (const x of list) x.pw ||= x.p;
  return list;
}
function pwTasks(c) {
  const days = pwDays();
  if (!days) return [];
  return portalsOf(c).filter(x => x.pass && c.pwd[x.pw]).map(x => ({
    kind: 'pw', key: 'pw|' + x.pw, c, title: `Change ${x.name} password`, period: `Last changed ${fmtDate(c.pwd[x.pw])}`,
    due: addDays(c.pwd[x.pw], days), status: 'pending', w: {},
  }));
}
function ago(s) {
  const n = daysBetween(s, todayStr());
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 60 ? `${n} days ago` : `${Math.round(n / 30)} months ago`;
}

// ---------- fees ----------
const inr = n => '₹' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN');
// Ledger entries: 'bill' (invoice), 'rcpt' (payment received), 'credit' (credit note against an
// invoice — lowers what was billed), 'refund' (money paid back — lowers what was received).
// What each entry does to the client's balance:
const feeSign = e => e.kind === 'bill' || e.kind === 'refund' ? 1 : -1;
function feeTotals(c) {
  let billed = 0, received = 0;
  for (const e of c.fees) {
    if (e.kind === 'bill') billed += +e.amt; else if (e.kind === 'credit') billed -= +e.amt;
    else if (e.kind === 'refund') received -= +e.amt; else received += +e.amt;
  }
  billed = Math.round(billed * 100) / 100; received = Math.round(received * 100) / 100;
  return { billed, received, due: Math.round((billed - received) * 100) / 100 };
}

// ---------- WhatsApp templates ----------
const DEFAULT_TPLS = [
  { id: 'itr', name: 'ITR documents request', text: 'Dear {name}, please share the following for filing your Income Tax Return for {ay}: Form 16 / salary details, bank statements and interest certificates, investment proofs (80C, 80D etc.), capital gains statements, and any other income details. — {firm}' },
  { id: 'gst', name: 'GST data request', text: 'Dear {name}, please share your sales and purchase details for {period} so we can file your GST returns. — {firm}' },
  { id: 'due', name: 'Due date reminder', text: 'Dear {name}, a reminder that your {return} for {period} is due on {due}. Please share the pending details at the earliest. — {firm}' },
  { id: 'filed', name: 'Return filed', text: 'Dear {name}, your {return} for {period} has been filed on {filed}. Acknowledgement no.: {ack}. — {firm}' },
  { id: 'fees', name: 'Fees reminder', text: 'Dear {name}, a balance of {balance} is pending towards our professional fees. Kindly arrange the payment at your convenience. — {firm}' },
];
const tpls = () => S.meta.templates?.length ? S.meta.templates : DEFAULT_TPLS;
const TPL_TAGS = ['name', 'pan', 'gstin', 'ay', 'fy', 'return', 'period', 'due', 'filed', 'ack', 'balance', 'firm'];
function fillTpl(text, c, t) {
  const last = new Date(); last.setDate(1); last.setMonth(last.getMonth() - 1);
  const prevFY = fyStart(todayStr()) - 1;
  const v = {
    name: c.name, pan: c.pan || '', gstin: t?.g || c.gst[0]?.gstin || '', ay: AY(prevFY), fy: FY(prevFY),
    return: t?.title || '', period: t?.period || `${MON[last.getMonth()]} ${last.getFullYear()}`,
    due: t ? fmtDate(t.due) : '', filed: t?.w?.on ? fmtDate(t.w.on) : '', ack: t?.w?.ack || '',
    balance: inr(feeTotals(c).due), firm: S.meta.firm || '',
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m).replace(/\s*—\s*$/, '').trim();
}
const mobileOf = c => { const m = normMobile(c.mobile || ''); return /^[6-9]\d{9}$/.test(m) ? m : ''; };
// Leaving for WhatsApp or a portal shouldn't lock the app if it's set to lock on leaving.
let graceUntil = 0;
function openWhatsApp(c, text) {
  const m = mobileOf(c);
  if (!m) return toast('Add a 10-digit mobile number first');
  graceUntil = Date.now() + 120000;
  window.open(`https://wa.me/91${m}${text ? '?text=' + encodeURIComponent(text) : ''}`, '_blank', 'noopener');
}

// ---------- shared bits ----------
const related = c => c.group ? S.clients.filter(x => x.id !== c.id && x.group && x.group.toLowerCase() === c.group.toLowerCase()) : [];
const clientRow = x => `<button class="row lrow" data-act="open" data-id="${esc(x.id)}">${avatar(x.name)}<span class="lt"><b>${esc(x.name)}</b><small>${esc([x.type, x.pan].filter(Boolean).join(' · '))}</small></span><span class="chev">${I.chev}</span></button>`;
function dueChip(t) {
  if (DONE.has(t.status)) return `<span class="duechip okc">${t.w.on ? 'Filed ' + fmtShort(t.w.on) : 'Filed'}</span>`;
  const n = daysBetween(todayStr(), t.due);
  const txt = n < 0 ? `${-n}d overdue` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtShort(t.due);
  return `<span class="duechip ${n < 0 ? 'late' : n <= 7 ? 'soon' : ''}">${txt}</span>`;
}
const taskRow = (t, withClient = true) => `<button class="row ${withClient ? 'lrow' : 'trow'}" data-act="${t.kind === 'pw' ? 'pwtask' : 'task'}" data-id="${esc(t.c.id)}" data-k="${esc(t.key)}">
  ${withClient ? avatar(t.c.name) : `<span class="sdot s-${t.status}" aria-hidden="true"></span>`}
  <span class="lt"><b>${esc(withClient ? t.c.name : t.title)}</b><small>${esc(withClient ? `${t.title} · ${t.period}` : `${t.period}${t.kind === 'task' ? ' · ' + STATUS_LABEL[t.status] : ''}`)}</small></span>
  ${dueChip(t)}</button>`;
function collectDue(until) {
  return S.clients.flatMap(c => [...tasksOf(c, until), ...pwTasks(c).filter(t => t.due <= until)]).sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}
function dueLists() {
  const today = todayStr(), wk = addDays(today, 7), all = collectDue(addDays(today, 30));
  const open = all.filter(t => !DONE.has(t.status));
  return {
    today, all,
    open,
    overdue: open.filter(t => t.due < today),
    week: open.filter(t => t.due >= today && t.due <= wk), // overdue ones are counted separately
    filed: all.filter(t => DONE.has(t.status) && (t.w.on || t.due) >= addDays(today, -60)).reverse(),
  };
}
const findTask = a => { const c = S.clients.find(x => x.id === a.id); return c && tasksOf(c, addDays(todayStr(), 800)).find(t => t.key === a.key); };
const backTo = () => { const p = PARENT[cur.v](cur.arg); goBack(p.v, p.arg); };
async function updateClient(c, change) {
  const d = structuredClone(c);
  change(d);
  d.updated = Date.now();
  await saveClient(d);
  return d;
}
