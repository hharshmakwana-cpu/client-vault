// Every problem found in the October 2026 audit, checked again (demo mode, no server).
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8123/';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-audit-'));
const R = [], check = (n, ok, i = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`);

(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }), p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.CLIENT_VAULT_CONFIG={apiKey:""};' }));
  const wait = ms => p.waitForTimeout(ms || 500);
  await p.goto(BASE);
  // master password strength
  await p.fill('#p1', 'abcdefghij'); await p.fill('#p2', 'abcdefghij'); await p.click('#go'); await wait(300);
  check('weak master password refused', (await p.locator('#err').textContent()).length > 0 && await p.locator('#p1').isVisible());
  await p.fill('#p1', 'Master-pass-2026'); await p.fill('#p2', 'Master-pass-2026'); await p.click('#go'); await wait();
  await p.click('[data-act="skip"]'); await wait();
  await p.evaluate(() => saveClient({ ...tidy({ type: 'Individual' }), id: 'c1', name: 'Ramesh Patel', mobile: '9876543210', created: 1, updated: 1 })); await wait(300);

  // 1 amounts
  await p.evaluate(() => go('fees', 'c1')); await wait();
  for (const bad of ['12abc', '100.555', '1e5', '-50']) { await p.fill('#amt', bad); await p.click('[data-act="fadd"]'); await wait(250); }
  check('junk amounts refused', await p.evaluate(() => S.clients[0].fees.length) === 0);
  await p.fill('#amt', '2,500.50'); await p.click('[data-act="fadd"]'); await wait();
  check('2,500.50 accepted as 2500.5', JSON.stringify(await p.evaluate(() => S.clients[0].fees.map(e => e.amt))) === '[2500.5]');

  // 2 numbers never reused
  await p.fill('#amt', '1000'); await p.click('[data-act="fadd"]'); await wait();
  const nums = await p.evaluate(async () => {
    const c = S.clients[0], last = c.fees.find(e => e.no.endsWith('002'));
    go('doc', { id: c.id, e: last.id }); await new Promise(r => setTimeout(r, 300));
    await ACT.del(); await new Promise(r => setTimeout(r, 400));
    return { left: S.clients[0].fees.map(e => e.no), next: nextNo('bill', last.date) };
  });
  check('deleted invoice number not given out again', nums.next.endsWith('003') && nums.left.join() === 'INV/2026-27/001', JSON.stringify(nums));

  // 3 + 4 GST: unregistered client in another state, reverse charge, state code
  const gst = await p.evaluate(() => {
    const g = '24ABCPM1234F1Z'; S.meta.firm = 'Makwana & Associates';
    S.meta.firmInfo = { gstin: g + gstinCheckDigit(g), gstOn: true, state: 'Gujarat' };
    const c = { ...S.clients[0], address: '5 Marine Drive, Mumbai 400020, Maharashtra', state: '', gst: [], fees: [{ id: 'x', kind: 'bill', amt: 1180, date: '2026-10-24', no: 'INV/2026-27/009' }] };
    const m = docModel(c, c.fees[0]), extra = m.extra.find(x => x.label === 'GST details');
    const c2 = { ...c, address: 'Ahmedabad 380009', state: 'Gujarat' }, m2 = docModel(c2, c2.fees[0]);
    const c3 = { ...c, address: 'somewhere', state: '' }, m3 = docModel(c3, c3.fees[0]);
    return { taxes: m.totals.map(t => t.l), lines: extra?.lines, intra: m2.totals.map(t => t.l), unknown: m3.stateUnknown, toLines: m.to.lines };
  });
  check('other-state unregistered client gets IGST', gst.taxes.includes('IGST @ 18%') && !gst.taxes.some(t => t.startsWith('CGST')), gst.taxes.join(', '));
  check('place of supply = client’s state with code', gst.lines?.[0] === 'Place of supply: Maharashtra (27)', gst.lines?.[0]);
  check('reverse charge line printed', gst.lines?.[1] === 'Tax payable on reverse charge: No');
  check('same-state client gets CGST + SGST', gst.intra.includes('CGST @ 9%') && gst.intra.includes('SGST @ 9%'));
  check('unknown state is flagged', gst.unknown === true);
  check('client state printed under Bill to', gst.toLines.includes('State: Maharashtra (27)'));

  // 5 TDS / TCS GSTINs
  const g5 = await p.evaluate(() => {
    const d = (g => g + gstinCheckDigit(g))('24AHMR12345B1D'), cc = (g => g + gstinCheckDigit(g))('27AABCF1234D1C');
    return [RULES.gstin(d, { pan: '', tan: 'AHMR12345B', type: 'Government', gstins: [d] }), RULES.gstin(cc, { pan: 'AABCF1234D', type: 'Company', gstins: [cc] }),
      RULES.gstin(d, { pan: '', tan: 'AHMR99999Z', type: 'Government', gstins: [d] }), gstinPan(d), gstinPan(cc)];
  });
  check('TDS deductor GSTIN accepted', g5[0].level === 'ok', g5[0].msg);
  check('e-commerce (TCS) GSTIN accepted', g5[1].level === 'ok', g5[1].msg);
  check('TDS GSTIN checked against the TAN', g5[2].level === 'err');
  check('PAN not taken from a TAN-based GSTIN', g5[3] === '' && g5[4] === 'AABCF1234D');

  // 7 backup restores settings
  const restored = await p.evaluate(async () => {
    S.meta.firmInfo = { ...S.meta.firmInfo, addr1: '301 Shivalik Plaza', city: 'Ahmedabad', logo: null };
    S.meta.templates = [{ id: 't', name: 'Hi', text: 'Hello {name}' }]; S.meta.ext = { 'GSTR3BM|2026-09': '2026-10-31' };
    await saveMeta();
    const data = JSON.parse(JSON.stringify({ app: 'client-vault', v: 2, saved: Date.now(), vault: S.vault, clients: [...S.recs.values()] }));
    S.meta.firmInfo = {}; S.meta.templates = undefined; S.meta.ext = {}; S.meta.firm = ''; await saveMeta();
    go('import', data); await new Promise(r => setTimeout(r, 300));
    document.querySelector('#pw').value = 'Master-pass-2026';
    document.querySelector('#f').requestSubmit(); await new Promise(r => setTimeout(r, 2500));
    return { city: S.meta.firmInfo?.city, firm: S.meta.firm, tpl: S.meta.templates?.length, ext: Object.keys(S.meta.ext || {}).length };
  });
  check('backup restores firm details, messages and extensions', restored.city === 'Ahmedabad' && restored.firm === 'Makwana & Associates' && restored.tpl === 1 && restored.ext === 1, JSON.stringify(restored));

  // 8 bulk reminders with no messages
  const bulk = await p.evaluate(async () => {
    await updateClient(S.clients[0], d => { d.comp = { TDSPAY: '2026-08-01' }; });
    S.meta.templates = []; DUEF = 'open'; go('bulk');
    try { ACT.bsend(document.querySelector('[data-act="bsend"]')); return 'ok'; } catch (e) { return e.message; } finally { S.meta.templates = undefined; }
  });
  check('bulk reminders work even with no saved messages', bulk === 'ok', bulk);

  // 9 firm details checks
  const firm = await p.evaluate(async () => {
    const res = {};
    S.meta.firmInfo = { ...S.meta.firmInfo, gstOn: false };
    const tryWith = async vals => {
      go('firm'); await new Promise(r => setTimeout(r, 200));
      const set = (k, v) => { document.querySelector('#f_' + k).value = v; };
      set('name', 'Test'); set('pan', ''); set('gstin', ''); set('email', ''); set('phone', ''); set('sac', ''); set('invPrefix', 'INV'); set('rcptPrefix', 'RCPT');
      document.querySelector('#f_state').value = '';
      for (const [k, v] of Object.entries(vals)) k === 'state' ? (document.querySelector('#f_state').value = v) : set(k, v);
      toastMsg = ''; await ACT.save(document.querySelector('[data-act="save"]')); await new Promise(r => setTimeout(r, 200));
      return cur.v === 'firm' ? document.querySelector('#toast').textContent : 'SAVED';
    };
    var toastMsg;
    const g = (x => x + gstinCheckDigit(x))('24AAAAA1111A1Z');
    res.otherPan = await tryWith({ pan: 'ABCPM1234F', gstin: g });
    res.otherState = await tryWith({ gstin: g, state: 'Maharashtra' });
    res.email = await tryWith({ email: 'not-an-email' });
    res.phone = await tryWith({ phone: '12' });
    res.prefix = await tryWith({ invPrefix: 'IN#V' });
    res.longPrefix = await tryWith({ invPrefix: 'INVOICE' });
    res.sac = await tryWith({ sac: '12' });
    res.good = await tryWith({ gstin: g, email: 'office@firm.in', phone: '079-26580000', sac: '998222' });
    res.filled = { pan: S.meta.firmInfo.pan, state: S.meta.firmInfo.state };
    return res;
  });
  check('GSTIN of another PAN refused', firm.otherPan.includes('PAN'), firm.otherPan);
  check('state different from the GSTIN’s refused', firm.otherState.includes('Gujarat'), firm.otherState);
  check('bad email refused', firm.email.includes('email'), firm.email);
  check('2-digit phone refused', firm.phone.includes('Phone'), firm.phone);
  check('invoice prefix with symbols refused', firm.prefix.includes('prefix'), firm.prefix);
  check('invoice prefix longer than GST allows refused', firm.longPrefix.includes('prefix'), firm.longPrefix);
  check('bad SAC refused', firm.sac.includes('SAC'), firm.sac);
  check('valid details saved; PAN and state filled from GSTIN', firm.good === 'SAVED' && firm.filled.pan === 'AAAAA1111A' && firm.filled.state === 'Gujarat', JSON.stringify(firm.filled));

  // 11 + 12 due lists
  const due = await p.evaluate(() => { const L = dueLists(); go('due'); return { week: L.week.filter(t => t.due < L.today).length, later: document.querySelector('#app').textContent.includes('Later this month') }; });
  check('"Due this week" no longer includes overdue', due.week === 0);
  check('"Later this month" heading gone', !due.later);

  // 13 + 14 PDF: Indian scripts and long notes
  await p.evaluate(async () => {
    S.meta.firmInfo = { ...S.meta.firmInfo, terms: Array.from({ length: 45 }, (_, i) => `Note line ${i + 1}: payment within 15 days of the invoice date.`).join('\n') };
    await updateClient(S.clients[0], d => { d.name = 'રમેશ પટેલ (Ramesh Patel)'; d.fees.push({ id: 'g1', kind: 'bill', amt: 5000, date: '2026-10-24', desc: 'આવકવેરા રિટર્ન / आयकर रिटर्न', no: 'INV/2026-27/010' }); });
    go('doc', { id: 'c1', e: 'g1' });
  });
  await wait();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="dl"]')]);
  const file = path.join(OUT, 'indic.pdf'); await dl.saveAs(file);
  const pdf = fs.readFileSync(file, 'latin1');
  const pages = (pdf.match(/\/Type \/Page\b/g) || []).length, images = (pdf.match(/\/Subtype \/Image/g) || []).length;
  check('long notes continue on a second page', pages >= 2, `${pages} pages`);
  check('Gujarati / Hindi drawn as pictures, not "????"', images >= 2 && !/\(\?{3,}/.test(pdf), `${images} pictures`);
  fs.writeFileSync(path.join(OUT, 'path.txt'), file);

  // 16 unsaved form kept across an automatic lock
  await p.evaluate(() => go('edit', 'c1')); await wait();
  await p.fill('[data-k="email"]', 'kept@example.com');
  await p.evaluate(() => lock()); await wait(600);
  await p.fill('#pw', 'Master-pass-2026'); await p.click('#go'); await wait(1500);
  check('half-filled form comes back after unlocking', await p.evaluate(() => cur.v) === 'edit' && await p.inputValue('[data-k="email"]') === 'kept@example.com');
  await p.click('[data-act="cancel"]'); await wait();

  // client state from the address
  const st = await p.evaluate(async () => { go('edit', null); await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-act="more"]').click();
    document.querySelector('[data-k="name"]').value = 'Asha Mehta'; document.querySelector('[data-k="address"]').value = '14 Park Street, Kolkata 700016, West Bengal';
    await ACT.save(document.querySelector('[data-act="save"]')); await new Promise(r => setTimeout(r, 600));
    return S.clients.find(c => c.name === 'Asha Mehta')?.state; });
  check('client state picked up from the address', st === 'West Bengal', st);

  // DIR-3 KYC
  const dir3 = await p.evaluate(() => { const d = COMPS.DIR3; return [2026, 2027, 2028, 2029].flatMap(s => d.gen(s)).map(t => t.due); });
  check('DIR-3 KYC every 3 years by 30 June (2028, 2031…)', dir3.join() === '2028-06-30', dir3.join());

  // 17 tap targets
  const sizes = await p.evaluate(() => {
    go('detail', 'c1');
    const hit = el => { const r = el.getBoundingClientRect(), cs = ['::before', '::after'].map(ps => getComputedStyle(el, ps)); return Math.min(r.width, r.height) + Math.max(0, ...cs.filter(c => c.content !== 'none' && c.position === 'absolute').map(c => -2 * parseFloat(c.top || 0))); };
    return [...document.querySelectorAll('.ibtn, .linkbtn')].map(hit);
  });
  check('icon buttons and links have 44pt tap areas', sizes.length > 0 && sizes.every(s => s >= 44), sizes.join(','));

  check('no script errors', !errs.length, errs.join(' | '));
  console.log(R.join('\n')); console.log('PDF:', file); await b.close();
  process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
