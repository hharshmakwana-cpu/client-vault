'use strict';
// Fee invoices and payment receipts: firm details, numbering, an on-screen preview and a PDF.
// The PDF is written directly (no library), using the PDF standard fonts Helvetica and
// Helvetica-Bold. Those fonts have no ₹ sign, so the PDF writes amounts as "Rs.".

// ---------- firm details ----------
const firmInfo = () => {
  const F = { invPrefix: 'INV', rcptPrefix: 'RCPT', terms: 'Thank you for your business.', ...S.meta.firmInfo, name: S.meta.firm || '' };
  return { ...splitOldFirm(F), ...F };
};
// Address and bank details are separate fields. Earlier versions kept each as one block of
// text ("address", "bank"); this fills the separate fields from that text until it's saved again.
function splitOldFirm(F) {
  const o = {};
  if (F.address && !F.addr1 && !F.city) {
    let t = F.address.trim();
    const pin = /\b([1-9]\d{2})\s?(\d{3})\b/.exec(t);
    if (pin) { o.pin = pin[1] + pin[2]; t = t.slice(0, pin.index) + t.slice(pin.index + pin[0].length); }
    let lines = t.split('\n').map(s => s.replace(/^[\s,\-–]+|[\s,\-–]+$/g, '')).filter(Boolean);
    const st = STATES.find(n => new RegExp(`(^|[\\s,])${n.replace(/[^\w\s]/g, '.')}$`, 'i').test(lines[lines.length - 1] || ''));
    if (st) { o.state = st; lines[lines.length - 1] = lines[lines.length - 1].slice(0, -st.length).replace(/[\s,\-–]+$/, ''); lines = lines.filter(Boolean); }
    if (lines.length === 1 && lines[0].includes(',')) { const parts = lines[0].split(','); o.city = parts.pop().trim(); lines = [parts.join(',').trim()]; }
    else if (lines.length > 1) o.city = lines.pop();
    o.addr1 = lines.shift() || ''; o.addr2 = lines.join(', ');
  }
  if (!F.state && !o.state && GSTIN_RE.test(F.gstin || '')) o.state = GST_STATES[F.gstin.slice(0, 2)] || '';
  if (F.bank && !F.accNo && !F.bankName) {
    const ifsc = /\b[A-Z]{4}0[A-Z0-9]{6}\b/i.exec(F.bank), acc = /\b\d{9,18}\b/.exec(F.bank);
    if (ifsc) o.ifsc = ifsc[0].toUpperCase();
    if (acc) o.accNo = acc[0];
    const name = F.bank.split(/[\n·|,]/).map(s => s.trim()).find(s => s && !/\d/.test(s) && !/^(a\/?c|account|ifsc|branch)\b/i.test(s));
    if (name) o.bankName = name.replace(/^bank\s*[:\-]\s*/i, '');
  }
  return o;
}
const firmHasAddress = F => !!(F.addr1 || F.city);
function firmAddressLines(F) {
  const cityLine = [F.city, F.pin].filter(Boolean).join(' - ') + (F.state ? (F.city || F.pin ? ', ' : '') + F.state : '');
  return [F.addr1, F.addr2, cityLine].map(s => (s || '').trim()).filter(Boolean);
}
function firmBankLines(F) {
  return [
    [F.bankName, F.branch].filter(Boolean).join(', '),
    F.accName && 'A/c name: ' + F.accName,
    [F.accNo && 'A/c no. ' + F.accNo, F.ifsc && 'IFSC ' + F.ifsc].filter(Boolean).join(' · '),
    F.upi && 'UPI: ' + F.upi,
  ].filter(Boolean);
}
// The firm's logo: a JPEG (data URL) with its pixel size, made from the picture the user picked.
// Kept as JPEG so the PDF can embed it as-is. Anything else (e.g. from an odd backup) is ignored.
const LOGO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const logoOf = () => { const l = S.meta.firmInfo?.logo; return l && LOGO_RE.test(l.src) && l.w > 0 && l.h > 0 ? l : null; };
const logoImg = (l, cls) => l && LOGO_RE.test(l.src) ? `<img class="${cls}" src="${l.src}" alt="">` : '';
// Shrinks the picked image (max 480×240), puts it on white (logos with transparency) and makes a JPEG.
function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('Choose a picture (PNG or JPG)'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Couldn’t read that picture'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Couldn’t open that picture — try a PNG or JPG'));
      img.onload = () => {
        const k = Math.min(1, 480 / img.naturalWidth, 240 / img.naturalHeight);
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
        resolve({ src: cv.toDataURL('image/jpeg', 0.9), w, h });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
// Firm name + logo are also kept on this device (not secret) to show on the unlock screen.
function cacheBrand() {
  const F = firmInfo(), l = logoOf();
  writeLS('cv-brand', F.name || l ? { name: F.name, logo: l?.src || '' } : null);
}
const fyLabel = s => `${s}-${String(s + 1).slice(2)}`;
// Numbers run per financial year, e.g. INV/2026-27/001. The highest number ever given in each
// series is also kept in the settings (S.meta.seq), so a deleted invoice's number is never reused.
const seriesOf = (kind, date) => { const F = firmInfo(); return `${kind === 'bill' ? F.invPrefix : F.rcptPrefix}/${fyLabel(fyStart(date))}/`; };
function nextNo(kind, date) {
  const pre = seriesOf(kind, date);
  let max = S.meta.seq?.[pre] || 0;
  for (const c of S.clients) for (const e of c.fees) if (e.no?.startsWith(pre)) max = Math.max(max, parseInt(e.no.slice(pre.length), 10) || 0);
  return pre + String(max + 1).padStart(3, '0');
}
// Records a number as given out (call after saving the entry that carries it).
function noteNo(no) {
  const i = no.lastIndexOf('/') + 1, pre = no.slice(0, i), n = parseInt(no.slice(i), 10) || 0;
  if ((S.meta.seq?.[pre] || 0) >= n) return Promise.resolve();
  S.meta.seq = { ...S.meta.seq, [pre]: n };
  return saveMeta().catch(() => {});
}
// Amounts typed by hand: digits with up to 2 decimals (commas, spaces and ₹ allowed). Anything else → NaN.
function parseAmount(v) {
  const s = String(v ?? '').replace(/[,\s₹]/g, '');
  return /^\d{1,10}(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
}
const PAY_MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Card'];

// ---------- amounts ----------
const round2 = n => Math.round((+n || 0) * 100) / 100;
const money = n => round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const words99 = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
const words999 = n => [n >= 100 && ONES[Math.floor(n / 100)] + ' Hundred', n % 100 && words99(n % 100)].filter(Boolean).join(' ');
// Indian numbering: crore, lakh, thousand.
function wordsIN(n) {
  if (!n) return 'Zero';
  const parts = [];
  if (n >= 1e7) { parts.push(wordsIN(Math.floor(n / 1e7)) + ' Crore'); n %= 1e7; }
  if (n >= 1e5) { parts.push(words99(Math.floor(n / 1e5)) + ' Lakh'); n %= 1e5; }
  if (n >= 1e3) { parts.push(words99(Math.floor(n / 1e3)) + ' Thousand'); n %= 1e3; }
  if (n) parts.push(words999(n));
  return parts.join(' ');
}
function amountInWords(n) {
  const r = Math.floor(round2(n)), p = Math.round((round2(n) - r) * 100);
  return `Rupees ${wordsIN(r)}${p ? ` and ${words99(p)} Paise` : ''} Only`;
}
// What the client owed after all entries up to and including this one.
function balanceAfter(c, e) {
  let bal = 0;
  const order = [...c.fees].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const x of order) { bal += x.kind === 'bill' ? +x.amt : -x.amt; if (x.id === e.id) break; }
  return round2(bal);
}

// ---------- the document, independent of how it is drawn ----------
function docModel(c, e) {
  const F = firmInfo(), bill = e.kind === 'bill', amt = round2(e.amt);
  const firmGst = GSTIN_RE.test(F.gstin || '') ? F.gstin : '', gst = bill && F.gstOn && firmGst;
  const clientGst = c.gst.find(g => GSTIN_RE.test(g.gstin))?.gstin || '';
  const firmLines = [...firmAddressLines(F), [F.phone, F.email].filter(Boolean).join(' · '),
    [F.pan && 'PAN ' + F.pan, firmGst && 'GSTIN ' + firmGst].filter(Boolean).join(' · ')].map(s => s.trim()).filter(Boolean);
  // The client's state decides CGST + SGST (same state as the firm) or IGST; for a client without a
  // GSTIN it's the state saved with them, else one named in their address.
  const toState = clientGst ? GST_STATES[clientGst.slice(0, 2)] : (c.state || stateInText(c.address));
  const firmState = GST_STATES[firmGst.slice(0, 2)] || F.state || '';
  const toLines = [...(c.address || '').split('\n'), !clientGst && toState && `State: ${toState}${STATE_CODE[toState] ? ` (${STATE_CODE[toState]})` : ''}`,
    [c.pan && 'PAN ' + c.pan, clientGst && 'GSTIN ' + clientGst].filter(Boolean).join(' · ')]
    .map(s => (s || '').trim()).filter(Boolean);
  const m = {
    title: bill ? (gst ? 'TAX INVOICE' : 'INVOICE') : 'RECEIPT', no: e.no || nextNo(e.kind, e.date), date: fmtDate(e.date),
    firm: { name: F.name || 'Your firm name', lines: firmLines }, toLabel: bill ? 'Bill to' : 'Received from', to: { name: c.name, lines: toLines },
    rows: [], totals: [], words: amountInWords(amt), extra: [], signFor: F.name, signatory: F.signatory || '', logo: logoOf(),
    stateUnknown: !!gst && !toState,
  };
  if (bill) {
    const desc = e.desc || 'Professional fees';
    if (gst) {
      // Amounts in the ledger include GST at 18%. Same state → CGST + SGST, else IGST.
      const taxable = round2(amt / 1.18), tax = round2(amt - taxable);
      const intra = toState ? toState === firmState : true;
      m.rows.push({ d: desc + (F.sac ? ` (SAC ${F.sac})` : ''), amt: taxable });
      m.totals.push({ l: 'Taxable value', amt: taxable });
      if (intra) { const half = round2(tax / 2); m.totals.push({ l: 'CGST @ 9%', amt: half }, { l: 'SGST @ 9%', amt: round2(tax - half) }); }
      else m.totals.push({ l: 'IGST @ 18%', amt: tax });
      const pos = toState || firmState;
      m.extra.push({ label: 'GST details', lines: [`Place of supply: ${pos}${STATE_CODE[pos] ? ` (${STATE_CODE[pos]})` : ''}`, 'Tax payable on reverse charge: No'] });
    } else m.rows.push({ d: desc, amt });
    m.totals.push({ l: 'Total', amt, strong: true });
    const bal = balanceAfter(c, e);
    if (bal > amt) m.totals.push({ l: 'Total outstanding incl. this invoice', amt: bal });
    const pay = firmBankLines(F);
    if (pay.length) m.extra.push({ label: 'Payment details', lines: pay });
  } else {
    m.rows.push({ d: `Received towards ${e.desc || 'professional fees'}`, amt });
    m.totals.push({ l: 'Amount received', amt, strong: true });
    const bal = balanceAfter(c, e);
    if (bal > 0) m.totals.push({ l: `Balance due after this payment`, amt: bal });
    const how = [e.mode && 'Paid by ' + e.mode, e.ref && 'Ref. ' + e.ref].filter(Boolean).join(' · ');
    if (how) m.extra.push({ label: 'Payment', lines: [how] });
  }
  if (F.terms) m.extra.push({ label: 'Notes', lines: F.terms.split('\n').map(s => s.trim()).filter(Boolean) });
  return m;
}
const docName = (c, m) => `${m.no.replace(/[^\w-]+/g, '-')}-${(c.name || 'client').replace(/[^\w]+/g, '-').slice(0, 40)}.pdf`.replace(/-+/g, '-');

// ---------- on-screen preview ----------
function paperHTML(m) {
  const lines = a => a.map(esc).join('<br>');
  return `<div class="pp-head">${logoImg(m.logo, 'pp-logo')}<div class="pp-from"><b class="pp-firm">${esc(m.firm.name)}</b><small>${lines(m.firm.lines)}</small></div>
    <div class="pp-r"><b class="pp-title">${esc(m.title)}</b><small>No. ${esc(m.no)}<br>Date ${esc(m.date)}</small></div></div>
  <div class="pp-to"><span class="pp-l">${esc(m.toLabel)}</span><b>${esc(m.to.name)}</b><small>${lines(m.to.lines)}</small></div>
  <table class="pp-t"><thead><tr><th>Description</th><th>Amount (₹)</th></tr></thead>
    <tbody>${m.rows.map(r => `<tr><td>${esc(r.d)}</td><td>${money(r.amt)}</td></tr>`).join('')}</tbody>
    <tfoot>${m.totals.map(t => `<tr class="${t.strong ? 'strong' : ''}"><td>${esc(t.l)}</td><td>${money(t.amt)}</td></tr>`).join('')}</tfoot></table>
  <p class="pp-words">${esc(m.words)}</p>
  ${m.extra.map(x => `<div class="pp-x"><span class="pp-l">${esc(x.label)}</span>${lines(x.lines)}</div>`).join('')}
  <div class="pp-sign">${m.signFor ? `For ${esc(m.signFor)}` : ''}<span>${m.signatory ? esc(m.signatory) + '<br>' : ''}Authorised signatory</span></div>`;
}

// ---------- PDF ----------
// Character widths (per 1000 units of font size) for ASCII 32–126, from the standard font metrics.
const HELV = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number);
const HELVB = '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584'.split(' ').map(Number);
// Unicode → the fonts' WinAnsi encoding. Text the fonts can't show at all (Gujarati, Hindi and
// other Indian scripts) is drawn by the browser into a picture instead — see makePDF.
const WINANSI = { '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153 };
const toAnsi = s => String(s ?? '').replace(/₹\s?/g, 'Rs. ').replace(/[^\x20-\x7e\xa0-\xff]/g, ch => WINANSI[ch] ? String.fromCharCode(WINANSI[ch]) : ch === '\n' ? ' ' : '?');
const needsPicture = s => /[^\x20-\x7e\xa0-\xff\n₹€‚„…‘’“”•–—™]/.test(s);
const PDF_FONT = (size, bold) => `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, "Noto Sans", "Noto Sans Gujarati", "Noto Sans Devanagari", sans-serif`;
let measureCtx;
function textWidth(s, size, bold) {
  if (needsPicture(s)) { measureCtx ||= document.createElement('canvas').getContext('2d'); measureCtx.font = PDF_FONT(size, bold); return measureCtx.measureText(s).width; }
  s = toAnsi(s);
  const w = bold ? HELVB : HELV;
  let t = 0;
  for (const ch of s) { const i = ch.charCodeAt(0) - 32; t += i >= 0 && i < w.length ? w[i] : 556; }
  return t * size / 1000;
}
function wrapText(s, width, size, bold) {
  const out = [];
  for (const para of String(s ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? line + ' ' + word : word;
      if (textWidth(tryLine, size, bold) <= width || !line) line = tryLine;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}
// pages: each page's drawing commands; imgs: JPEGs {src, w, h} named Im1, Im2… in that order.
function buildPDF(pages, title, imgs) {
  const W = 595.28, H = 841.89, n = imgs.length;
  const pdfStr = s => '(' + s.replace(/[\\()]/g, '\\$&') + ')';
  // 1 catalog, 2 page list, 3–4 fonts, 5 info, then the pictures, then a page + its content per page
  const pageNo = i => 6 + n + i * 2;
  const xobj = n ? ` /XObject << ${imgs.map((_, i) => `/Im${i + 1} ${6 + i} 0 R`).join(' ')} >>` : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNo(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${pdfStr(toAnsi(title))} /Producer (Client Vault) >>`,
    ...imgs.map(img => { // the JPEG goes in unchanged; atob gives its bytes as characters 0–255
      const bin = atob(img.src.split(',')[1]);
      return `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n${bin}\nendstream`;
    }),
    ...pages.flatMap((content, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj} >> /Contents ${pageNo(i) + 1} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ]),
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, ch => ch.charCodeAt(0)); // every character is below 256, so one byte each
}
// Draws the document on A4 pages (more pages when it doesn't fit). Positions are measured from
// the top of the page.
function makePDF(m) {
  const H = 841.89, L = 48, R = 547, TOP = 56, BOTTOM = 790;
  const pages = [[]], imgs = [];
  let ops = pages[0];
  const newPage = () => { ops = []; pages.push(ops); return TOP; };
  const fit = (y, h) => y + h > BOTTOM ? newPage() : y; // keep a block together; start a new page if it won't fit
  const col = c => c.map(v => v.toFixed(3)).join(' ');
  const INK = [0.07, 0.07, 0.09], GREY = [0.42, 0.42, 0.45], ACCENT = [0.04, 0.4, 0.85], RULE = [0.85, 0.85, 0.87];
  const image = (img, x, top, w, h) => { const i = imgs.push(img); ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(H - top - h).toFixed(2)} cm /Im${i} Do Q`); };
  const text = (x, y, s, { size = 10, bold = false, color = INK, align = 'left' } = {}) => {
    const w = textWidth(s, size, bold), x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    if (needsPicture(s)) {
      // Drawn 4× larger than printed so it stays sharp; the baseline lines up with the other text.
      const k = 4, cv = document.createElement('canvas'), hpt = size * 1.45;
      cv.width = Math.ceil((w + 2) * k); cv.height = Math.ceil(hpt * k);
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = `rgb(${color.map(v => Math.round(v * 255)).join(',')})`; g.font = PDF_FONT(size * k, bold); g.textBaseline = 'alphabetic';
      g.fillText(s, k, size * 1.08 * k);
      image({ src: cv.toDataURL('image/jpeg', 0.92), w: cv.width, h: cv.height }, x0 - 1, y - size * 1.08, cv.width / k, cv.height / k);
      return;
    }
    s = toAnsi(s);
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${col(color)} rg 1 0 0 1 ${x0.toFixed(2)} ${(H - y).toFixed(2)} Tm (${s.replace(/[\\()]/g, '\\$&')}) Tj ET`);
  };
  const rule = (y, x1 = L, x2 = R, color = RULE, w = 0.6) => ops.push(`${col(color)} RG ${w} w ${x1} ${(H - y).toFixed(2)} m ${x2} ${(H - y).toFixed(2)} l S`);
  const box = (x, y, w, h, color) => ops.push(`${col(color)} rg ${x} ${(H - y - h).toFixed(2)} ${w} ${h} re f`);
  const lineH = size => size * 1.35;
  const block = (x, y, lines, size, width, opt = {}) => {
    for (const l of lines) for (const w of wrapText(l, width, size, opt.bold)) { y = fit(y, lineH(size)); text(x, y, w, { size, ...opt }); y += lineH(size); }
    return y;
  };

  // header: logo (up to 56pt tall, 130pt wide) and firm on the left, document title and number on the right
  let fx = L, y = 64, logoBottom = 0;
  if (m.logo) {
    const k = Math.min(56 / m.logo.h, 130 / m.logo.w), lw = m.logo.w * k, lh = m.logo.h * k;
    image(m.logo, L, 44, lw, lh);
    fx = L + lw + 14; logoBottom = 44 + lh;
  }
  const fw = 290 - (fx - L);
  for (const w of wrapText(m.firm.name, fw, 17, true)) { text(fx, y, w, { size: 17, bold: true }); y += 21; }
  y = Math.max(block(fx, y, m.firm.lines, 9, fw, { color: GREY }), logoBottom + 8);
  let ry = 64;
  text(R, ry, m.title, { size: 19, bold: true, color: ACCENT, align: 'right' }); ry += 20;
  text(R, ry, 'No. ' + m.no, { size: 10, align: 'right' }); ry += 14;
  text(R, ry, 'Date ' + m.date, { size: 10, align: 'right', color: GREY }); ry += 14;
  y = Math.max(y, ry) + 10;
  rule(y, L, R, ACCENT, 1.2);

  // billed to / received from
  y += 24;
  text(L, y, m.toLabel.toUpperCase(), { size: 8, bold: true, color: GREY }); y += 15;
  for (const w of wrapText(m.to.name, 420, 12, true)) { text(L, y, w, { size: 12, bold: true }); y += 15; }
  y = block(L, y, m.to.lines, 9.5, 420, { color: GREY }) + 14;

  // table
  const head = () => {
    box(L, y, R - L, 24, [0.95, 0.96, 0.98]);
    text(L + 10, y + 15.5, 'Description', { size: 9, bold: true, color: GREY });
    text(R - 10, y + 15.5, 'Amount (Rs.)', { size: 9, bold: true, color: GREY, align: 'right' });
    y += 24;
  };
  y = fit(y, 24 + 40); head();
  for (const r of m.rows) {
    const ls = wrapText(r.d, 360, 10);
    const yy = fit(y, ls.length * 14 + 10);
    if (yy !== y) { y = yy; head(); }
    let ty = y + 18;
    for (const w of ls) { text(L + 10, ty, w, { size: 10 }); ty += 14; }
    text(R - 10, y + 18, money(r.amt), { size: 10, align: 'right' });
    y = ty + 4; rule(y);
  }
  y = fit(y, 6 + m.totals.length * 20 + 26) + 6;
  for (const t of m.totals) {
    y += t.strong ? 20 : 16;
    if (t.strong) rule(y - 13, 330, R, INK, 0.8);
    text(R - 130, y, t.l, { size: t.strong ? 11 : 9.5, bold: !!t.strong, color: t.strong ? INK : GREY, align: 'right' });
    text(R - 10, y, money(t.amt), { size: t.strong ? 11 : 9.5, bold: !!t.strong, align: 'right' });
  }
  y += 26;
  y = block(L, y, [m.words], 9.5, R - L, { bold: true }) + 10;

  // GST details, payment details, notes
  for (const x of m.extra) {
    y = fit(y, 13 + lineH(9.5) * Math.min(3, x.lines.length));
    text(L, y, x.label.toUpperCase(), { size: 8, bold: true, color: GREY }); y += 13;
    y = block(L, y, x.lines, 9.5, R - L) + 10;
  }

  // signature: low on the last page, or on a new page if there's no room
  let sy = y + 30;
  if (sy + 64 > BOTTOM) sy = newPage() + 20;
  else if (pages.length === 1) sy = Math.max(sy, 700);
  if (m.signFor) text(R, sy, 'For ' + m.signFor, { size: 10, bold: true, align: 'right' });
  if (m.signatory) text(R, sy + 46, m.signatory, { size: 9.5, align: 'right' });
  text(R, sy + 60, 'Authorised signatory', { size: 9, color: GREY, align: 'right' });
  // footer on every page
  pages.forEach((pg, i) => {
    ops = pg;
    const note = 'This is a computer-generated document.' + (pages.length > 1 ? `   Page ${i + 1} of ${pages.length}` : '');
    text(297.6, 815, note, { size: 7.5, color: GREY, align: 'center' });
  });
  return buildPDF(pages.map(pg => pg.join('\n')), `${m.title} ${m.no}`, imgs);
}

// ---------- invoice / receipt screen ----------
function renderDoc(a) {
  let c = S.clients.find(x => x.id === a.id), e = c?.fees.find(x => x.id === a.e);
  if (!e) return backTo();
  const bill = e.kind === 'bill', F = firmInfo(), m = docModel(c, e);
  let html = bar({ left: backBtn('Fees', 'back'), title: bill ? 'Invoice' : 'Receipt' });
  if (!F.name || !firmHasAddress(F)) html += `<button class="banner" data-act="firm"><span class="grow">Add your firm’s name and address so they appear on ${bill ? 'invoices' : 'receipts'}.</span><b class="bbtn">Set up</b></button>`;
  if (m.stateUnknown) html += `<button class="banner" data-act="editc"><span class="grow">Add ${esc(c.name)}’s state, so GST is split correctly (CGST + SGST or IGST).</span><b class="bbtn">Add</b></button>`;
  html += `<div class="paper" aria-label="${esc(m.title)} preview">${paperHTML(m)}</div>`;
  html += `<div class="pad"><button class="btn primary" data-act="share">Share PDF</button></div>`;
  html += `<div class="group" style="margin-top:16px">
    <button class="row link" data-act="wa">Send on WhatsApp</button>
    <button class="row link" data-act="dl">Download PDF</button>
    <button class="row" data-act="firm"><span class="grow">Firm details</span><span class="chev">${I.chev}</span></button></div>`;
  if (!e.no) html += `<p class="foot">Number ${esc(m.no)} is given to this ${bill ? 'invoice' : 'receipt'} when you first share or download it.</p>`;
  html += `<div class="group"><button class="row danger" data-act="del">Delete ${bill ? 'invoice' : 'payment'}</button></div>`;
  app.innerHTML = html;
  ACT.back = backTo;
  ACT.firm = () => go('firm', { back: a });
  ACT.editc = () => go('edit', c.id);
  // Builds the file right away (sharing must start straight from the tap) and saves the number
  // in the background the first time.
  const file = () => {
    if (!e.no) {
      const no = m.no;
      e = { ...e, no };
      updateClient(c, d => { const x = d.fees.find(y => y.id === e.id); if (x) x.no = no; }).then(d => { c = d; return noteNo(no); }, er => toast(errText(er)));
    }
    return new File([makePDF(docModel(c, e))], docName(c, m), { type: 'application/pdf' });
  };
  const msg = () => fillTpl(bill
    ? `Dear {name}, please find attached our invoice ${m.no} dated ${m.date} for ${inr(e.amt)}. — {firm}`
    : `Dear {name}, thank you for your payment of ${inr(e.amt)}. Our receipt ${m.no} is attached. — {firm}`, c);
  const download = f => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(f); link.download = f.name; document.body.append(link); link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  };
  const share = (f, text) => {
    suppressLock = true; graceUntil = Date.now() + 120000;
    return navigator.share({ files: [f], title: f.name, ...(text ? { text } : {}) })
      .catch(er => { if (er.name !== 'AbortError') toast('Couldn’t share the file'); })
      .finally(() => { suppressLock = false; });
  };
  const canShare = f => navigator.canShare && navigator.canShare({ files: [f] });
  ACT.share = () => { const f = file(); if (canShare(f)) share(f); else { download(f); toast('PDF downloaded'); } };
  ACT.dl = () => { download(file()); toast('PDF downloaded'); };
  ACT.wa = () => {
    const f = file();
    if (canShare(f)) return share(f, msg()); // the share sheet lists WhatsApp and attaches the PDF
    if (!mobileOf(c)) return toast('Add a 10-digit mobile number to this client first');
    download(f); toast('PDF downloaded — attach it in the WhatsApp chat');
    openWhatsApp(c, msg());
  };
  ACT.del = async () => {
    if (!confirm(`Delete this ${bill ? 'invoice' : 'payment'} of ${inr(e.amt)}?${e.no ? ` Its number ${e.no} won’t be given to another ${bill ? 'invoice' : 'receipt'}.` : ''}`)) return;
    if (e.no) await noteNo(e.no);
    try {
      await updateClient(c, d => {
        d.fees = d.fees.filter(x => x.id !== e.id);
        for (const w of Object.values(d.work)) if (w.bill === e.id) delete w.bill;
      });
      toast('Entry deleted'); backTo();
    } catch (er) { toast(errText(er)); }
  };
}

// ---------- firm details screen ----------
function renderFirm(a = {}) {
  const F = firmInfo();
  const fld = (k, label, ph, o = {}) => `<label class="frow"><span class="flabel">${esc(label)}</span>${o.area
    ? `<textarea class="finput" id="f_${k}" placeholder="${esc(ph)}">${esc(F[k] || '')}</textarea>`
    : `<input class="finput${o.up ? ' up' : ''}${o.num ? ' mono' : ''}" id="f_${k}" value="${esc(F[k] || '')}" placeholder="${esc(ph)}"${o.type ? ` type="${o.type}"` : ''}${o.up ? ' autocapitalize="characters"' : ''}${o.num ? ` inputmode="numeric" maxlength="${o.num}"` : ''}${o.max ? ` maxlength="${o.max}"` : ''} autocomplete="off" autocorrect="off" spellcheck="false">`}</label>`;
  let html = bar({ left: `<button class="nav-btn" data-act="back">Cancel</button>`, title: 'Firm details', right: `<button class="nav-btn strong" data-act="save">Done</button>` });
  html += `<form id="ff" autocomplete="off"><div class="group-h">Your firm</div><div class="group">
    <div class="row logo-row"><span class="logo-box" id="logoBox"></span><span class="grow">Logo<small>PNG or JPG. Printed on invoices and receipts, and shown in the app.</small></span>
      <button type="button" class="linkbtn" data-act="logo" id="logoBtn"></button><button type="button" class="linkbtn danger" data-act="logoDel" id="logoDel" style="color:var(--danger)">Remove</button></div>
    ${fld('name', 'Firm name', 'e.g. Makwana & Associates')}
    ${fld('phone', 'Phone', 'Optional', { type: 'tel' })}
    ${fld('email', 'Email', 'Optional', { type: 'email' })}
    ${fld('pan', 'PAN', 'Optional', { up: true })}
    ${fld('gstin', 'GSTIN', 'If registered under GST', { up: true })}
    ${fld('signatory', 'Signatory', 'e.g. CA Harsh Makwana, Proprietor')}
  </div>
  <div class="group-h">Office address</div><div class="group">
    ${fld('addr1', 'Address line 1', 'Office / building, street')}
    ${fld('addr2', 'Address line 2', 'Area, landmark (optional)')}
    ${fld('city', 'City', 'e.g. Ahmedabad')}
    <label class="row"><span class="grow">State</span><select class="plain" id="f_state"><option value="">Choose</option>${STATES.map(n => `<option${n === F.state ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    ${fld('pin', 'PIN code', '6 digits', { num: 6 })}
  </div>
  <div class="group-h">GST on fees</div><div class="group">
    <div class="row"><span class="grow">Fees include GST at 18%<small>Invoices become tax invoices with CGST + SGST, or IGST for other states</small></span>${sw(F.gstOn, 'gston', ' aria-label="Fees include GST"')}</div>
    ${fld('sac', 'SAC code', 'e.g. 998231 — shown on tax invoices')}
  </div>
  <p class="foot">Needs your GSTIN above. The amount you enter for a bill is treated as the total including GST.</p>
  <div class="group-h">Payment details on invoices</div><div class="group">
    ${fld('accName', 'Account name', 'Name on the bank account')}
    ${fld('bankName', 'Bank', 'e.g. HDFC Bank')}
    ${fld('branch', 'Branch', 'e.g. Ashram Road (optional)')}
    ${fld('accNo', 'Account no.', '9 to 18 digits', { num: 18 })}
    ${fld('ifsc', 'IFSC', 'e.g. HDFC0000123', { up: true, max: 11 })}
    ${fld('upi', 'UPI ID', 'e.g. firm@okhdfcbank (optional)')}
  </div>
  <div class="group-h">Numbering and notes</div><div class="group">
    ${fld('invPrefix', 'Invoice prefix', 'INV', { up: true })}
    ${fld('rcptPrefix', 'Receipt prefix', 'RCPT', { up: true })}
    ${fld('terms', 'Notes', 'Printed at the bottom', { area: true })}
  </div>
  <p class="foot">Numbers look like ${esc(F.invPrefix)}/${fyLabel(fyStart(todayStr()))}/001 and start again at 001 each financial year.</p></form>`;
  app.innerHTML = html;
  $('#ff').onsubmit = e => e.preventDefault();
  let gstOn = !!F.gstOn, logo = logoOf();
  const showLogo = () => {
    $('#logoBox').innerHTML = logo ? logoImg(logo, 'logo-thumb') : 'Logo';
    $('#logoBox').classList.toggle('has', !!logo);
    $('#logoBtn').textContent = logo ? 'Change' : 'Add';
    $('#logoDel').hidden = !logo;
  };
  showLogo();
  ACT.logo = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      suppressLock = false;
      const f = input.files[0]; if (!f) return;
      if (f.size > 8e6) return toast('That picture is too large — use one under 8 MB');
      try { logo = await readLogo(f); showLogo(); toast('Logo added — tap Done to save'); } catch (e) { toast(e.message); }
    };
    suppressLock = true; input.click();
  };
  ACT.logoDel = () => { logo = null; showLogo(); };
  ACT.back = backTo;
  ACT.gston = t => { gstOn = !gstOn; t.setAttribute('aria-checked', gstOn); };
  ACT.save = async b => {
    const v = k => $('#f_' + k).value.trim();
    const info = { phone: v('phone'), email: v('email'), pan: NORM.id(v('pan')), gstin: NORM.id(v('gstin')), signatory: v('signatory'),
      addr1: v('addr1'), addr2: v('addr2'), city: v('city'), state: $('#f_state').value, pin: NORM.digits(v('pin')),
      accName: v('accName'), bankName: v('bankName'), branch: v('branch'), accNo: NORM.digits(v('accNo')), ifsc: NORM.id(v('ifsc')), upi: v('upi').replace(/\s+/g, ''),
      gstOn, sac: v('sac'), invPrefix: NORM.id(v('invPrefix')).replace(/\//g, '') || 'INV',
      rcptPrefix: NORM.id(v('rcptPrefix')).replace(/\//g, '') || 'RCPT', terms: v('terms'), ...(logo ? { logo } : {}) };
    if (!info.state && GSTIN_RE.test(info.gstin)) info.state = GST_STATES[info.gstin.slice(0, 2)] || '';
    const bad = (k, msg) => { toast(msg); $('#f_' + k).focus(); };
    if (info.pin && !/^[1-9]\d{5}$/.test(info.pin)) return bad('pin', 'PIN code is 6 digits and doesn’t start with 0');
    if (info.accNo && RULES.bankAcc(info.accNo)) return bad('accNo', RULES.bankAcc(info.accNo).msg);
    if (info.ifsc && RULES.ifsc(info.ifsc)) return bad('ifsc', RULES.ifsc(info.ifsc).msg);
    if (info.upi && !/^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/.test(info.upi)) return bad('upi', 'UPI ID looks like name@bank');
    if (info.email && RULES.email(info.email)) return bad('email', 'Enter a valid email address');
    if (info.phone) {
      const d = info.phone.replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
      if (d.length !== 10) return bad('phone', 'Phone number: 10 digits (add the STD code for a landline)');
    }
    if (info.pan && !PAN_RE.test(info.pan)) return bad('pan', 'PAN is 5 letters, 4 digits, 1 letter');
    if (info.gstin) {
      if (!GSTIN_RE.test(info.gstin) || gstinCheckDigit(info.gstin) !== info.gstin[14]) return bad('gstin', 'That GSTIN isn’t valid — check for a typo');
      if (info.gstin[13] !== 'Z') return bad('gstin', 'Enter your firm’s regular GSTIN (the 14th character is Z)');
      const gPan = info.gstin.slice(2, 12), gState = GST_STATES[info.gstin.slice(0, 2)];
      if (info.pan && info.pan !== gPan) return bad('gstin', `This GSTIN is for PAN ${gPan}, not your PAN ${info.pan}`);
      if (!info.pan) info.pan = gPan;
      if (STATE_CODE[gState]) {
        if (info.state && info.state !== gState) return bad('state', `Your GSTIN is registered in ${gState} — choose ${gState} as the state`);
        info.state = gState;
      }
    }
    if (gstOn && !info.gstin) return bad('gstin', 'Add your GSTIN to charge GST on invoices');
    if (info.sac && !/^99\d{4}$/.test(info.sac)) return bad('sac', 'SAC codes for services are 6 digits starting with 99 (e.g. 998222)');
    // GST invoice numbers: at most 16 characters, only letters, digits, - and /.
    if (!/^[A-Z0-9-]{1,3}$/.test(info.invPrefix)) return bad('invPrefix', 'Invoice prefix: up to 3 letters or digits, so numbers stay within GST’s 16-character limit');
    if (!/^[A-Z0-9-]{1,8}$/.test(info.rcptPrefix)) return bad('rcptPrefix', 'Receipt prefix: up to 8 letters or digits');
    if (info.invPrefix === info.rcptPrefix) return bad('rcptPrefix', 'Use different prefixes for invoices and receipts');
    const prev = { firmInfo: S.meta.firmInfo, firm: S.meta.firm };
    S.meta.firmInfo = info; S.meta.firm = v('name');
    b.disabled = true;
    try { await saveMeta(); cacheBrand(); updateTabs(); toast('Saved'); backTo(); }
    catch (e) { Object.assign(S.meta, prev); b.disabled = false; toast(errText(e)); }
  };
}
