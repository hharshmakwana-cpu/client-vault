'use strict';
// CSV (Excel) import and export.

// ---------- CSV (Excel) import / export ----------
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const CSV_COLS = {
  name: ['name', 'client name', 'full name', 'legal name', 'client'], type: ['status', 'type', 'client type', 'category', 'constitution'],
  fileNo: ['file no', 'file', 'file number'], group: ['group', 'family', 'group / family'], pan: ['pan', 'pan no', 'pan number'],
  aadhaar: ['aadhaar', 'aadhar', 'aadhaar no', 'aadhar no', 'aadhaar number'], mobile: ['mobile', 'phone', 'mobile no', 'contact no', 'contact', 'mobile number'],
  email: ['email', 'email id', 'e-mail'], dob: ['dob', 'date of birth', 'doi', 'date of incorporation', 'dob / doi'], address: ['address'],
  gstin: ['gstin', 'gst no', 'gst number', 'gst'], gstUser: ['gst username', 'gst user', 'gst user id'], gstPass: ['gst password'],
  itUser: ['it user id', 'income tax user id', 'it user'], itPass: ['it password', 'income tax password'],
  tracesUser: ['traces user id', 'traces user'], tracesPass: ['traces password'], tan: ['tan', 'tan no'],
  regNo: ['cin', 'llpin', 'cin / llpin', 'reg no', 'registration no'], contact: ['contact person'],
  bankName: ['bank', 'bank name'], bankAcc: ['account no', 'bank account', 'account number', 'bank account no'], ifsc: ['ifsc', 'ifsc code'],
  business: ['business name', 'trade name'], notes: ['notes', 'remarks'],
};
const TYPE_WORDS = [[/propriet|individual|person/i, 'Individual'], [/huf/i, 'HUF'], [/llp/i, 'LLP'], [/partner|firm/i, 'Partnership Firm'], [/company|pvt|private|limited|ltd/i, 'Company'], [/trust/i, 'Trust'], [/boi|body of ind/i, 'BOI'], [/aop|association|society/i, 'AOP']];
function csvDate(v) {
  if (!v) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(v);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000;
  const d = new Date(y, +m[2] - 1, +m[1]);
  return d.getMonth() === +m[2] - 1 ? ymd(y, +m[2], +m[1]) : null;
}
function csvToClients(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The file has no client rows.');
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' '));
  const col = Object.fromEntries(Object.entries(CSV_COLS).map(([k, names]) => [k, head.findIndex(h => names.includes(h))]));
  if (col.name < 0) throw new Error('Couldn’t find a “Name” column in the first row.');
  const seen = { pan: new Map(), gstin: new Map() };
  return rows.slice(1).map((r, i) => {
    const n = i + 2, get = k => col[k] >= 0 ? (r[col[k]] || '').trim() : '';
    const c = tidy({}), errors = [], warns = [];
    c.name = get('name').replace(/\s+/g, ' ');
    const pan = NORM.id(get('pan')), rawType = get('type');
    c.type = (TYPE_WORDS.find(([re]) => re.test(rawType)) || [])[1] || (PAN_RE.test(pan) && PAN_TO_TYPE[pan[3]]) || 'Individual';
    for (const k of ['fileNo', 'group', 'address', 'itPass', 'tracesPass', 'bankName', 'notes', 'contact']) { const v = get(k); if (v) c[k] = v; }
    if (pan) c.pan = pan;
    const set = (k, norm) => { const v = get(k); if (v) c[k] = NORM[norm](v); };
    set('aadhaar', 'aadhaar'); set('mobile', 'mobile'); set('email', 'lower'); set('tan', 'id'); set('regNo', 'id');
    set('itUser', 'id'); set('tracesUser', 'up'); set('bankAcc', 'digits'); set('ifsc', 'id');
    const dob = csvDate(get('dob'));
    if (dob === null) errors.push(`Date “${get('dob')}” isn’t a valid date (use DD/MM/YYYY)`); else if (dob) c.dob = dob;
    const gstins = get('gstin').split(/[;,\s]+/).map(NORM.id).filter(Boolean);
    c.gst = gstins.map((g, j) => ({ gstin: g, user: j ? '' : get('gstUser'), pass: j ? '' : get('gstPass') }));
    if (!gstins.length && (get('gstUser') || get('gstPass'))) c.gst = [{ gstin: '', user: get('gstUser'), pass: get('gstPass') }];
    if (get('business') && PERSONAL.has(c.type)) c.businesses = [{ name: get('business'), nature: '', same: true, address: '', udyam: '' }];
    if (!c.pan && gstins[0] && GSTIN_RE.test(gstins[0])) c.pan = gstins[0].slice(2, 12);
    for (const k of ['itPass', 'tracesPass']) if (c[k]) c.pwd[k === 'itPass' ? 'it' : 'traces'] = todayStr();
    c.gst.forEach(g => { if (g.pass && g.gstin) c.pwd['gst:' + g.gstin] = todayStr(); });
    // Same checks as the edit screen.
    const x = { type: c.type, name: c.name, pan: c.pan || '', dob: c.dob || '', self: undefined, biz: c.businesses.map(b => b.name), gstins };
    const check = (rule, v) => { if (!v || !RULES[rule]) return; const res = RULES[rule](v, x); if (res?.level === 'err') errors.push(res.msg); else if (res?.level === 'warn') warns.push(res.msg); };
    check('name', c.name || 'x'); if (!c.name) errors.push('Name is missing');
    check('pan', c.pan); check('aadhaar', PERSONAL.has(c.type) && c.aadhaar); check('mobile', c.mobile); check('email', c.email);
    check('dob', c.dob); check('tan', c.tan); check('regNo', c.regNo); check('ifsc', c.ifsc); check('bankAcc', c.bankAcc); check('itUser', c.itUser);
    gstins.forEach(g => check('gstin', g));
    if (c.pan) { if (seen.pan.has(c.pan)) errors.push(`Same PAN as row ${seen.pan.get(c.pan)}`); else seen.pan.set(c.pan, n); }
    gstins.forEach(g => { if (seen.gstin.has(g)) errors.push(`Same GSTIN as row ${seen.gstin.get(g)}`); else seen.gstin.set(g, n); });
    if (!PERSONAL.has(c.type)) delete c.aadhaar;
    return { n, c, errors: [...new Set(errors)], warns };
  });
}
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s; // stop Excel treating a value as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
function saveFile(name, text, type, done) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    suppressLock = true;
    navigator.share({ files: [file], title: name }).then(done, er => { if (er.name !== 'AbortError') toast('Couldn’t share the file'); }).finally(() => { suppressLock = false; });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    done?.();
  }
}
function exportClientsCSV() {
  const dmy = s => s ? s.split('-').reverse().join('/') : '';
  const head = ['Name', 'Status', 'File no', 'Group', 'PAN', 'Aadhaar (masked)', 'Mobile', 'Email', 'DOB / DOI', 'Address', 'GSTIN', 'TAN', 'CIN / LLPIN', 'Business names', 'Contact person', 'Fees outstanding'];
  const rows = [...S.clients].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => [
    c.name, c.type, c.fileNo, c.group, c.pan, c.aadhaar ? 'XXXX XXXX ' + aadhaarDigits(c.aadhaar).slice(-4) : '', c.mobile, c.email, dmy(c.dob),
    c.address, c.gst.map(g => g.gstin).filter(Boolean).join('; '), c.tan, c.regNo, c.businesses.map(b => b.name).filter(Boolean).join('; '), c.contact, feeTotals(c).due || '',
  ]);
  saveFile(`client-list-${todayStr()}.csv`, toCSV([head, ...rows]), 'text/csv', () => toast('Client list exported'));
}
function sampleCSV() {
  const rows = [
    ['Name', 'Status', 'PAN', 'Aadhaar', 'Mobile', 'Email', 'Date of birth', 'Address', 'GSTIN', 'GST username', 'GST password', 'IT password', 'TAN', 'CIN', 'Group', 'File no', 'Business name'],
    ['Ramesh Kumar Patel', 'Individual', '', '', '9876543210', 'ramesh@example.com', '15/08/1980', '12 MG Road, Ahmedabad 380001', '', '', '', '', '', '', 'Patel family', '101', 'Patel Traders'],
  ];
  saveFile('client-import-sample.csv', toCSV(rows), 'text/csv');
}
function renderCsvImport(a) {
  const good = a.rows.filter(r => !r.errors.length), bad = a.rows.filter(r => r.errors.length), warned = good.filter(r => r.warns.length);
  let html = bar({ left: `<button class="nav-btn" data-act="back">Cancel</button>`, title: 'Import clients' });
  html += `<div class="tiles"><div class="tile green"><b>${good.length}</b><span>Ready</span></div><div class="tile ${bad.length ? 'red' : ''}"><b>${bad.length}</b><span>Have errors</span></div><div class="tile ${warned.length ? 'amber' : ''}"><b>${warned.length}</b><span>Warnings</span></div></div>`;
  html += good.length ? `<div class="pad"><button class="btn primary" data-act="go">Import ${plural(good.length, 'client')}</button></div><p class="foot" style="margin-top:12px">Rows with errors are skipped. Fix them in Excel and import the file again — clients already saved are recognised by PAN.</p>`
    : `<p class="foot" style="margin-top:0">Nothing can be imported yet. Fix the rows below in Excel and try again.</p>`;
  if (bad.length) html += `<div class="group-h">Skipped</div><div class="group">${bad.slice(0, 150).map(r => `<div class="row"><span class="grow">Row ${r.n} · ${esc(r.c.name || 'No name')}<small class="errtext">${esc(r.errors.join(' · '))}</small></span></div>`).join('')}</div>`;
  if (warned.length) html += `<div class="group-h">Imported with warnings</div><div class="group">${warned.slice(0, 150).map(r => `<div class="row"><span class="grow">Row ${r.n} · ${esc(r.c.name)}<small class="warntext">${esc(r.warns.join(' · '))}</small></span></div>`).join('')}</div>`;
  app.innerHTML = html;
  ACT.back = backTo;
  ACT.go = async b => {
    b.disabled = true;
    let n = 0;
    try {
      for (const r of good) {
        const now = Date.now();
        await saveClient({ ...r.c, id: uid(), created: now, updated: now });
        b.textContent = `Importing ${++n} of ${good.length}…`;
      }
      toast(`Imported ${plural(n, 'client')}`); go('list');
    } catch (e) { b.disabled = false; b.textContent = `Import remaining clients`; toast(`${n} imported. ${errText(e)}`); good.splice(0, n); }
  };
}
