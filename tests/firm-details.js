const BASE = process.env.BASE || 'http://localhost:8123/';
const { chromium } = require('playwright');
const OUT = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'cv-test-')), R = [];
const check = (n, ok, i = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.CLIENT_VAULT_CONFIG={apiKey:""};' }));
  const wait = ms => p.waitForTimeout(ms || 650);
  await p.goto(BASE);
  await p.fill('#p1', 'testpassword123'); await p.fill('#p2', 'testpassword123'); await p.click('#go'); await wait();
  await p.click('[data-act="skip"]'); await wait();
  // details saved by the previous version, as one block of text
  const split = await p.evaluate(() => [
    splitOldFirm({ address: '301, Shivalik Plaza, Ashram Road\nAhmedabad 380009', bank: 'HDFC Bank · A/c 50100123456789 · IFSC HDFC0000123' }),
    splitOldFirm({ address: '12 MG Road, Navrangpura, Ahmedabad 380001, Gujarat' }),
    splitOldFirm({ address: 'Office 5\nNear Station\nSurat - 395003\nGujarat', bank: 'Bank: State Bank of India\nAccount 12345678901\nsbin0001234', gstin: '' }),
  ]);
  console.log(JSON.stringify(split, null, 1));
  check('old two-line address split', split[0].addr1 === '301, Shivalik Plaza, Ashram Road' && split[0].city === 'Ahmedabad' && split[0].pin === '380009');
  check('old bank text split', split[0].bankName === 'HDFC Bank' && split[0].accNo === '50100123456789' && split[0].ifsc === 'HDFC0000123');
  check('one-line address with state split', split[1].addr1 === '12 MG Road, Navrangpura' && split[1].city === 'Ahmedabad' && split[1].pin === '380001' && split[1].state === 'Gujarat');
  check('multi-line address split', split[2].addr1 === 'Office 5' && split[2].addr2 === 'Near Station' && split[2].city === 'Surat' && split[2].pin === '395003' && split[2].state === 'Gujarat');
  check('lower-case IFSC fixed', split[2].ifsc === 'SBIN0001234' && split[2].bankName === 'State Bank of India' && split[2].accNo === '12345678901');
  // an existing user's saved details show up already split on the form
  await p.evaluate(async () => { S.meta.firm = 'Makwana & Associates'; S.meta.firmInfo = { address: '301, Shivalik Plaza, Ashram Road\nAhmedabad 380009', bank: 'HDFC Bank · A/c 50100123456789 · IFSC HDFC0000123', upi: 'makwana@okhdfcbank' }; await saveMeta(); });
  await p.evaluate(() => go('firm')); await wait();
  check('form prefilled from old details', await p.inputValue('#f_city') === 'Ahmedabad' && await p.inputValue('#f_accNo') === '50100123456789');
  await p.selectOption('#f_state', 'Gujarat'); await p.fill('#f_accName', 'Makwana and Associates'); await p.fill('#f_branch', 'Ashram Road');
  await p.fill('#f_pin', '080009'); await p.click('[data-act="save"]'); await wait(400);
  check('bad PIN refused', (await p.locator('#toast').textContent()).includes('PIN') && await p.evaluate(() => cur.v) === 'firm');
  await p.fill('#f_pin', '380009'); await p.fill('#f_ifsc', 'HDFC123'); await p.click('[data-act="save"]'); await wait(400);
  check('bad IFSC refused', (await p.locator('#toast').textContent()).includes('IFSC'));
  await p.fill('#f_ifsc', 'hdfc0000123'); await p.fill('#f_accNo', '1234'); await p.click('[data-act="save"]'); await wait(400);
  check('bad account no. refused', (await p.locator('#toast').textContent()).toLowerCase().includes('account'));
  await p.fill('#f_accNo', '50100123456789');
  await p.screenshot({ path: OUT + '/f1-form.png', fullPage: true });
  await p.click('[data-act="save"]'); await wait();
  const saved = await p.evaluate(() => S.meta.firmInfo);
  check('saved as separate fields, old text dropped', saved.city === 'Ahmedabad' && saved.state === 'Gujarat' && saved.ifsc === 'HDFC0000123' && !('address' in saved) && !('bank' in saved), JSON.stringify(saved));
  // invoice shows them
  await p.evaluate(() => saveClient({ ...tidy({ type: 'Individual' }), id: 'c1', name: 'Ramesh Patel', created: 1, updated: 1, fees: [{ id: 'f1', kind: 'bill', amt: 5000, date: '2026-10-24', desc: 'ITR filing' }] })); await wait();
  await p.evaluate(() => go('doc', { id: 'c1', e: 'f1' })); await wait();
  const t = await p.locator('.paper').innerText();
  check('invoice shows address lines', t.includes('301, Shivalik Plaza, Ashram Road') && t.includes('Ahmedabad - 380009, Gujarat'));
  check('invoice shows bank lines', t.includes('HDFC Bank, Ashram Road') && t.includes('A/c name: Makwana and Associates') && t.includes('A/c no. 50100123456789 · IFSC HDFC0000123') && t.includes('UPI: makwana@okhdfcbank'));
  await p.screenshot({ path: OUT + '/f2-invoice.png', fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="dl"]')]); await dl.saveAs(OUT + '/f-invoice.pdf');
  check('no script errors', !errs.length, errs.join(' | '));
  console.log(R.join('\n')); await b.close(); process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
