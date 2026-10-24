'use strict';
// Reference data (taxpayer statuses, states), the client form fields, and field validation.

// ---------- reference data ----------
// Taxpayer status as per the Income-tax Act, and the 4th character of the PAN for each.
const TYPES = ['Individual', 'HUF', 'Partnership Firm', 'LLP', 'Company', 'Trust', 'AOP', 'BOI', 'Local Authority', 'Artificial Juridical Person', 'Government'];
const TYPE_PAN = { Individual: 'P', HUF: 'H', 'Partnership Firm': 'F', LLP: 'F', Company: 'C', Trust: 'T', AOP: 'A', BOI: 'B', 'Local Authority': 'L', 'Artificial Juridical Person': 'J', Government: 'G' };
const PAN_STATUS = { P: 'Individual', H: 'HUF', F: 'Firm / LLP', C: 'Company', T: 'Trust', A: 'AOP', B: 'BOI', L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government' };
const PAN_TO_TYPE = { P: 'Individual', H: 'HUF', F: 'Partnership Firm', C: 'Company', T: 'Trust', A: 'AOP', B: 'BOI', L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government' };
// Only individuals and HUFs carry on business under a trade name; every other status is itself the entity.
const PERSONAL = new Set(['Individual', 'HUF']);
const REG_LABEL = { Company: 'CIN', LLP: 'LLPIN', 'Partnership Firm': 'Firm reg. no.', Trust: 'Registration no.', AOP: 'Registration no.', BOI: 'Registration no.' };
const GST_STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '28': 'Andhra Pradesh (old)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction' };
// States and UTs to pick from (current GST codes only), and each one's GST state code.
const STATE_CODE = Object.fromEntries(Object.entries(GST_STATES).filter(([k]) => !['25', '28', '97', '99'].includes(k)).map(([k, v]) => [v, k]));
const STATES = Object.keys(STATE_CODE).sort();
// The state named in a free-text address, if any (longest names first, so "Andhra Pradesh" isn't read as "Pradesh").
const stateInText = t => [...STATES].sort((a, b) => b.length - a.length).find(n => new RegExp(`(^|[^a-z])${n.replace(/[^\w\s]/g, '.')}([^a-z]|$)`, 'i').test(t || '')) || '';
const STATE2 = new Set('AN AP AR AS BR CH CG CT DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TG TN TR TS UK UP UR UT WB'.split(' '));
const CIN_CLASS = { PLC: 'Public company', PTC: 'Private company', OPC: 'One person company', NPL: 'Section 8 company', GOI: 'Central Govt. company', SGC: 'State Govt. company', FLC: 'Foreign subsidiary (public)', FTC: 'Foreign subsidiary (private)', GAP: 'Guarantee company (public)', GAT: 'Guarantee company (private)', ULL: 'Unlimited company (public)', ULT: 'Unlimited company (private)' };

// ---------- client fields ----------
const addrLabel = t => t === 'Individual' ? 'Home address' : t === 'HUF' ? 'HUF address' : 'Registered office';
const dobLabel = t => t === 'Individual' ? 'Date of birth' : t === 'Company' || t === 'LLP' ? 'Date of incorporation' : 'Date of formation';
const SECTIONS = [
  { title: 'Basic details', fields: [
    { k: 'name', label: t => PERSONAL.has(t) ? 'Name' : 'Legal name', rule: 'name', ph: 'Required — exactly as on PAN' },
    { k: 'type', label: 'Status', kind: 'select' },
    { k: 'fileNo', label: 'File no.', ph: 'Optional' },
    { k: 'group', label: 'Group', ph: 'Family or group, e.g. Patel family', list: true },
    { k: 'mobile', label: 'Mobile', input: 'tel', rule: 'mobile', norm: 'mobile', ph: '10-digit number', link: 'tel:' },
    { k: 'email', label: 'Email', input: 'email', rule: 'email', norm: 'lower', link: 'mailto:' },
    { k: 'dob', label: dobLabel, input: 'date', rule: 'dob' },
    { k: 'address', label: addrLabel, kind: 'textarea', rule: 'address', ph: 'Address with 6-digit PIN code' },
    { k: 'state', label: 'State', kind: 'state' },
  ] },
  { title: 'Identity', fields: [
    { k: 'pan', label: 'PAN', up: true, max: 10, rule: 'pan', norm: 'id', ph: 'ABCPE1234F' },
    { k: 'aadhaar', label: t => t === 'HUF' ? 'Karta’s Aadhaar' : 'Aadhaar', input: 'numeric', max: 14, rule: 'aadhaar', norm: 'aadhaar', secret: true, ph: '12 digits', show: t => PERSONAL.has(t) },
    { k: 'regNo', label: t => REG_LABEL[t] || 'Registration no.', up: true, rule: 'regNo', norm: 'id', ph: t => t === 'Company' ? 'U74999GJ2015PTC123456' : t === 'LLP' ? 'AAB-1234' : 'If registered', show: t => !!REG_LABEL[t] },
    { k: 'tan', label: 'TAN', up: true, max: 10, rule: 'tan', norm: 'id', ph: 'If they deduct TDS' },
  ] },
  { title: 'Income Tax portal', portal: 'it', fields: [
    { k: 'itPass', label: 'Password', secret: true },
  ] },
  { title: 'TRACES', portal: 'traces', fields: [
    { k: 'tracesUser', label: 'User ID', up: true, norm: 'up' },
    { k: 'tracesPass', label: 'Password', secret: true },
  ] },
  { title: 'Bank', fields: [
    { k: 'bankName', label: 'Bank' },
    { k: 'bankAcc', label: 'Account no.', input: 'numeric', rule: 'bankAcc', norm: 'digits' },
    { k: 'ifsc', label: 'IFSC', up: true, max: 11, rule: 'ifsc', norm: 'id', ph: 'SBIN0001234' },
  ] },
  { title: 'Notes', fields: [{ k: 'notes', label: 'Notes', kind: 'textarea', bare: true, ph: 'Anything else about this client' }] },
];
const FIELDS = SECTIONS.flatMap(s => s.fields);
const fnv = (v, t) => typeof v === 'function' ? v(t) : v;
const shows = (f, t) => !f.show || f.show(t);
const GST_URL = 'https://services.gst.gov.in/services/login';

// ---------- validation ----------
// Each rule gets the normalised value and the form context; returns null or {level, msg}.
// 'err' blocks saving, 'warn' asks before saving, 'ok' is just a confirmation.
const err = msg => ({ level: 'err', msg }), warn = msg => ({ level: 'warn', msg }), ok = msg => ({ level: 'ok', msg });
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const verhoeff = n => [...n].reverse().reduce((c, d, i) => VD[c][VP[i % 8][+d]], 0) === 0;
function gstinCheckDigit(g) {
  const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = cs.indexOf(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return cs[(36 - (sum % 36)) % 36];
}
function normMobile(v) {
  let d = v.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
// GSTIN: state code + PAN + entity no. + Z (normal) or C (e-commerce operator collecting TCS) + check
// character; or state code + TAN + entity no. + D + check for a TDS deductor registration.
const GSTIN_RE = /^\d{2}(?:[A-Z]{5}\d{4}[A-Z][1-9A-Z][ZC]|[A-Z]{4}\d{5}[A-Z][1-9A-Z]D)[0-9A-Z]$/;
const gstinPan = g => GSTIN_RE.test(g || '') && g[13] !== 'D' ? g.slice(2, 12) : '';
// Master password: long, or a little shorter with a mix of letters, numbers and symbols.
function pwWeak(p) {
  if (p.length < 10) return 'Use at least 10 characters.';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(p)).length;
  if (/^(.)\1+$/.test(p) || /^(?:0123456789|1234567890|password|qwerty)/i.test(p)) return 'That password is too easy to guess.';
  if (p.length < 14 && kinds < 3) return 'Mix capital and small letters, numbers or symbols — or use 14+ characters.';
  return '';
}
const initialsOf = s => (s || '').toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean).map(w => w[0]);
const others = c => S.clients.filter(x => x.id !== c.self);
const aadhaarDigits = v => (v || '').replace(/\D/g, '');
const RULES = {
  name: (v, c) => v.length < 2 ? err('Enter the full name')
    : c.type === 'Individual' && /\d/.test(v) ? warn('A person’s name usually has no numbers') : null,
  mobile: v => /^[6-9]\d{9}$/.test(normMobile(v)) ? null : err('Enter a 10-digit Indian mobile number (starts with 6–9)'),
  email: v => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v) ? null : err('Enter a valid email address'),
  dob: (v, c) => {
    const d = new Date(v + 'T00:00:00');
    if (isNaN(d)) return err('Enter a valid date');
    if (d > new Date()) return err('This date is in the future');
    if (d.getFullYear() < 1850) return err('Check the year');
    if (c.type === 'Individual' && (Date.now() - d) / 31557600000 > 110) return warn('That makes the person over 110 — check the year');
    return null;
  },
  address: v => /(^|\D)[1-9]\d{2}\s?\d{3}(\D|$)/.test(v) ? null : warn('Add the 6-digit PIN code'),
  pan: (v, c) => {
    if (!PAN_RE.test(v)) return err('PAN is 5 letters, 4 digits, 1 letter (e.g. ABCPE1234F)');
    const status = PAN_STATUS[v[3]];
    if (!status) return err(`4th letter “${v[3]}” isn’t a valid PAN status`);
    const exp = TYPE_PAN[c.type];
    if (exp && exp !== v[3]) {
      if (c.type === 'Trust' && v[3] === 'A') return warn('4th letter A means AOP — some trusts hold an AOP PAN, but please check');
      return err(`4th letter ${v[3]} means ${status}, but the status is ${c.type}`);
    }
    const dup = others(c).find(x => x.pan === v);
    if (dup) return err(`This PAN is already saved for ${dup.name}`);
    if (c.name && !initialsOf(c.name).includes(v[4])) return warn(`5th letter ${v[4]} should be the first letter of the ${c.type === 'Individual' ? 'surname' : 'name'} — check the name and PAN`);
    return ok(`Valid · ${status}`);
  },
  aadhaar: (v, c) => {
    const d = aadhaarDigits(v);
    if (!/^\d{12}$/.test(d)) return err('Aadhaar has 12 digits');
    if (!/^[2-9]/.test(d)) return err('Aadhaar never starts with 0 or 1');
    if (!verhoeff(d)) return err('This isn’t a valid Aadhaar number — check for a typo');
    const dup = others(c).find(x => x.type === c.type && aadhaarDigits(x.aadhaar) === d);
    if (dup) return err(`This Aadhaar is already saved for ${dup.name}`);
    return ok('Valid');
  },
  regNo: (v, c) => {
    if (c.type === 'Company') {
      const m = /^([LU])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})$/.exec(v);
      if (!m) return err('CIN has 21 characters (e.g. U74999GJ2015PTC123456)');
      if (!CIN_CLASS[m[5]]) return err(`“${m[5]}” isn’t a valid company class (PTC, PLC, OPC, NPL…)`);
      const y = +m[4];
      if (y < 1850 || y > new Date().getFullYear()) return err(`Year ${y} in the CIN isn’t possible`);
      const dup = others(c).find(x => x.regNo === v);
      if (dup) return err(`This CIN is already saved for ${dup.name}`);
      if (!STATE2.has(m[3])) return warn(`“${m[3]}” isn’t a state code we recognise`);
      if (c.dob && +c.dob.slice(0, 4) !== y) return warn(`CIN shows incorporation in ${y}, but the date entered is in ${c.dob.slice(0, 4)}`);
      return ok(`${m[1] === 'L' ? 'Listed' : 'Unlisted'} · ${CIN_CLASS[m[5]]} · ${y}`);
    }
    if (c.type === 'LLP') {
      if (!/^[A-Z]{3}-\d{4}$/.test(v)) return err('LLPIN is 3 letters, a hyphen and 4 digits (e.g. AAB-1234)');
      const dup = others(c).find(x => x.regNo === v);
      return dup ? err(`This LLPIN is already saved for ${dup.name}`) : null;
    }
    return null;
  },
  tan: (v, c) => {
    if (!/^[A-Z]{4}\d{5}[A-Z]$/.test(v)) return err('TAN is 4 letters, 5 digits, 1 letter (e.g. AHMR12345B)');
    const dup = others(c).find(x => x.tan === v);
    if (dup) return err(`This TAN is already saved for ${dup.name}`);
    const names = [c.name, ...c.biz].join(' ');
    if (names.trim() && !initialsOf(names).includes(v[3])) return warn(`TAN’s 4th letter ${v[3]} should be the first letter of the deductor’s name`);
    return null;
  },
  gstin: (v, c) => {
    if (!GSTIN_RE.test(v)) return err('GSTIN is 15 characters: state code + PAN + entity no. + Z + check (e.g. 24ABCPE1234F1Z5)');
    const st = GST_STATES[v.slice(0, 2)];
    if (!st) return err(`${v.slice(0, 2)} isn’t a valid GST state code`);
    if (gstinCheckDigit(v) !== v[14]) return err('Last character (check digit) is wrong — check for a typo');
    if (c.gstins.filter(g => g === v).length > 1) return err('This GSTIN is entered twice');
    if (v[13] === 'D') { // TDS deductor registration: built on the TAN
      const tan = v.slice(2, 12);
      if (c.tan && tan !== c.tan) return err(`This GSTIN is for TAN ${tan}, not ${c.tan}`);
      const dup = others(c).find(x => (x.gst || []).some(g => g.gstin === v));
      return dup ? err(`This GSTIN is already saved for ${dup.name}`) : ok(`${st} · TDS deductor registration`);
    }
    const inner = v.slice(2, 12);
    if (PAN_RE.test(c.pan) && inner !== c.pan) return err(`This GSTIN is for PAN ${inner}, not ${c.pan}`);
    if (!PAN_RE.test(c.pan)) {
      if (!PAN_STATUS[inner[3]]) return err('The PAN inside this GSTIN isn’t valid');
      if (TYPE_PAN[c.type] && TYPE_PAN[c.type] !== inner[3]) return err(`This GSTIN is for ${PAN_STATUS[inner[3]]}, but the status is ${c.type}`);
    }
    const dup = others(c).find(x => (x.gst || []).some(g => g.gstin === v));
    if (dup) return err(`This GSTIN is already saved for ${dup.name}`);
    return ok(`${st}${v[13] === 'C' ? ' · e-commerce (TCS)' : ''}${PAN_RE.test(c.pan) ? ' · PAN matches' : ''}`);
  },
  gstUser: v => /^[A-Za-z0-9._-]{8,15}$/.test(v) ? null : warn('GST portal usernames are usually 8–15 letters, numbers, . _ or -'),
  ifsc: v => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? null : err('IFSC is 4 letters, 0, then 6 letters/digits (e.g. SBIN0001234)'),
  bankAcc: v => /^\d{9,18}$/.test(v) ? null : err('Account number should be 9 to 18 digits'),
  udyam: v => {
    const m = /^UDYAM-([A-Z]{2})-(\d{2})-(\d{7})$/.exec(v);
    if (!m) return err('Udyam number looks like UDYAM-GJ-01-1234567');
    return STATE2.has(m[1]) ? null : warn(`“${m[1]}” isn’t a state code we recognise`);
  },
};
const NORM = {
  id: v => v.replace(/\s+/g, '').toUpperCase(),
  up: v => v.trim().toUpperCase(),
  lower: v => v.trim().toLowerCase(),
  digits: v => v.replace(/\D/g, ''),
  mobile: v => { const d = normMobile(v); return /^[6-9]\d{9}$/.test(d) ? d : v.trim(); },
  aadhaar: v => { const d = v.replace(/\D/g, ''); return d.length === 12 ? d.replace(/(\d{4})(?=\d)/g, '$1 ') : v.trim(); },
};
