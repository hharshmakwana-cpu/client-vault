const BASE = process.env.BASE || 'http://localhost:8123/';
// End-to-end check of the app in demo mode: phone + desktop layouts, new filings, extensions,
// GST invoices, tab navigation and keyboard shortcuts.
const { chromium } = require('playwright');
const OUT = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'cv-test-'));
const results = [];
const check = (name, ok, info = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.CLIENT_VAULT_CONFIG={apiKey:""};' }));
  const wait = ms => p.waitForTimeout(ms || 650);
  await p.goto(BASE);
  await p.fill('#p1', 'testpassword123'); await p.fill('#p2', 'testpassword123'); await p.click('#go');
  await p.waitForSelector('[data-act="skip"]'); await p.click('[data-act="skip"]');
  await p.waitForSelector('#list');
  check('tab bar visible on client list', await p.locator('#tabs').isVisible());

  const gstFirm = await p.evaluate(() => { const g = '24ABCPM1234F1Z'; return g + gstinCheckDigit(g); });
  const gstClient = await p.evaluate(() => { const g = '27AABCS1234D1Z'; return g + gstinCheckDigit(g); });

  // firm details with GST
  await p.click('[data-tab="settings"]'); await wait();
  check('settings opens from tab', (await p.locator('h1.large').textContent()) === 'Settings');
  await p.click('[data-act="firm"]'); await wait();
  check('tab bar hidden on a form', !(await p.locator('#tabs').isVisible()));
  await p.fill('#f_name', 'Makwana & Associates');
  await p.fill('#f_addr1', '301, Shivalik Plaza, Ashram Road'); await p.fill('#f_city', 'Ahmedabad'); await p.fill('#f_pin', '380009');
  await p.fill('#f_phone', '9825012345'); await p.fill('#f_email', 'office@makwana.example');
  await p.fill('#f_pan', 'ABCPM1234F'); await p.fill('#f_gstin', gstFirm);
  await p.fill('#f_signatory', 'CA Harsh Makwana');
  await p.click('[data-act="gston"]'); await p.fill('#f_sac', '998231');
  await p.fill('#f_bankName', 'HDFC Bank'); await p.fill('#f_accNo', '50100123456789'); await p.fill('#f_ifsc', 'HDFC0000123'); await p.fill('#f_upi', 'makwana@okhdfcbank');
  await p.screenshot({ path: OUT + '/p-firm.png' });
  await p.click('[data-act="save"]'); await wait();
  check('firm details saved', await p.evaluate(() => S.meta.firm === 'Makwana & Associates' && S.meta.firmInfo.gstOn === true));

  // a company client in Maharashtra with GST
  await p.click('[data-tab="list"]'); await wait();
  await p.click('[data-act="add"]'); await wait();
  await p.selectOption('[data-k="type"]', 'Company');
  await p.fill('[data-k="name"]', 'Shree Sai Textiles Private Limited');
  await p.fill('[data-k="pan"]', 'AABCS1234D');
  await p.fill('[data-k="mobile"]', '9876543210');
  await p.click('[data-act="more"]'); await p.waitForTimeout(300);
  await p.fill('[data-k="address"]', 'Plot 14, MIDC Bhiwandi, Thane 421302');
  await p.click('[data-act="gadd"]');
  await p.fill('[data-gf="gstin"]', gstClient);
  await p.click('[data-act="save"]'); await wait(900);
  check('new company goes to suggested returns', await p.evaluate(() => cur.v) === 'comp');
  await p.click('[data-act="back"]'); await wait(700); // Skip
  const cid = await p.evaluate(() => S.clients.find(c => c.type === 'Company').id);
  check('company client saved', !!cid);

  // track returns, including the new ones
  await p.click('[data-act="comp"]'); await wait();
  const newCodes = ['GSTR7', 'GSTR8', 'F16', 'F16A', 'PT', 'ADT1', 'DPT3', 'MSME1', 'DIR3'];
  const shown = await p.evaluate(codes => codes.filter(c => document.querySelector(`[data-act="tog"][data-c="${c}"]`)), newCodes);
  check('new filings listed for a company', shown.length === newCodes.length, shown.join(', '));
  await p.screenshot({ path: OUT + '/p-comp.png', fullPage: true });
  for (const c of ['GSTR3BM', 'GSTR1M', 'TDSPAY', 'MSME1', 'DIR3', 'PT']) await p.click(`[data-act="tog"][data-c="${c}"]`);
  await p.click('[data-act="save"]'); await wait(900);

  // extension: GSTR-3B Sep 2026 (due 20 Oct, overdue on 24 Oct) → 31 Oct for everyone
  const before = await p.evaluate(id => { const c = S.clients.find(x => x.id === id); return tasksOf(c, '2026-12-31').find(t => t.key.startsWith('GSTR3BM|2026-09'))?.due; }, cid);
  await p.click('[data-tab="due"]'); await wait();
  await p.screenshot({ path: OUT + '/p-due.png', fullPage: true });
  await p.click('[data-act="ext"]'); await wait();
  await p.selectOption('#xcode', 'GSTR3BM'); await p.selectOption('#xp', '2026-09'); await p.fill('#xto', '2026-10-31');
  await p.click('[data-act="xadd"]'); await wait();
  await p.screenshot({ path: OUT + '/p-ext.png', fullPage: true });
  const after = await p.evaluate(id => { const c = S.clients.find(x => x.id === id); const t = tasksOf(c, '2026-12-31').find(t => t.key.startsWith('GSTR3BM|2026-09')); return [t.due, t.orig]; }, cid);
  check('extension moves the due date', before === '2026-10-20' && after[0] === '2026-10-31' && after[1] === '2026-10-20', `${before} → ${after[0]}`);
  await p.click('[data-act="back"]'); await wait();

  // invoice with IGST (client in another state), receipt
  await p.click('[data-tab="list"]'); await wait();
  await p.click(`[data-act="open"][data-id="${cid}"]`); await wait();
  await p.screenshot({ path: OUT + '/p-detail.png', fullPage: true });
  await p.click('[data-act="fees"]'); await wait();
  await p.fill('#amt', '35400'); await p.fill('#fdesc', 'GST compliance — Apr to Sep 2026');
  await p.click('[data-act="fadd"]'); await wait();
  await p.click('[data-act="kind"][data-k="rcpt"]');
  await p.fill('#amt', '20000'); await p.selectOption('#fmode', 'Bank transfer'); await p.fill('#fref', 'UTR HDFCN52026102411');
  await p.click('[data-act="fadd"]'); await wait();
  await p.screenshot({ path: OUT + '/p-fees.png', fullPage: true });
  await p.locator('[data-act="doc"]', { hasText: 'GST compliance' }).click(); await wait();
  await p.screenshot({ path: OUT + '/p-invoice.png', fullPage: true });
  const inv = await p.locator('.paper').textContent();
  check('tax invoice with IGST', inv.includes('TAX INVOICE') && inv.includes('IGST @ 18%') && inv.includes('30,000.00') && inv.includes('5,400.00'), '');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="dl"]')]);
  await dl.saveAs(OUT + '/tax-invoice.pdf'); await wait();
  check('invoice number kept after download', await p.evaluate(id => S.clients.find(c => c.id === id).fees.find(e => e.kind === 'bill').no, cid) === 'INV/2026-27/001');
  await p.keyboard.press('Escape'); await wait();
  check('Esc goes back', await p.evaluate(() => cur.v) === 'fees');
  await p.locator('[data-act="doc"]', { hasText: 'Received' }).click(); await wait();
  await p.screenshot({ path: OUT + '/p-receipt.png', fullPage: true });
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="dl"]')]);
  await dl2.saveAs(OUT + '/receipt2.pdf'); await wait();

  // amount in words
  const w = await p.evaluate(() => [amountInWords(35400), amountInWords(12345678.5), amountInWords(100000)]);
  check('amount in words (Indian)', w[0] === 'Rupees Thirty Five Thousand Four Hundred Only' && w[1] === 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only' && w[2] === 'Rupees One Lakh Only', w.join(' | '));

  // overview + due badge
  await p.click('[data-tab="dash"]'); await wait();
  await p.screenshot({ path: OUT + '/p-dash.png', fullPage: true });
  check('overview opens from tab', (await p.locator('h1.large').textContent()) === 'Overview');
  const badge = await p.locator('[data-tab="due"] .tbadge').textContent();
  check('overdue badge on due tab', +badge > 0, 'badge ' + badge);
  await p.click('[data-tab="list"]'); await wait();
  await p.screenshot({ path: OUT + '/p-list.png' });
  await p.keyboard.press('/');
  check('"/" focuses search', await p.evaluate(() => document.activeElement?.id === 'q'));

  // desktop layout
  await p.setViewportSize({ width: 1280, height: 820 }); await wait(400);
  await p.screenshot({ path: OUT + '/d-list.png' });
  const side = await p.evaluate(() => { const r = document.querySelector('#tabs').getBoundingClientRect(), a = document.querySelector('#app').getBoundingClientRect(); return { sideW: r.width, sideH: r.height, appLeft: a.left, appW: a.width }; });
  check('sidebar on wide screen, content beside it', side.sideW > 200 && side.sideH > 700 && side.appLeft >= side.sideW, JSON.stringify(side));
  await p.click(`[data-act="open"][data-id="${cid}"]`); await wait();
  await p.screenshot({ path: OUT + '/d-detail.png' });
  await p.click('[data-tab="due"]'); await wait();
  await p.screenshot({ path: OUT + '/d-due.png' });
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.click('[data-tab="dash"]'); await wait();
  await p.screenshot({ path: OUT + '/d-dash-dark.png' });
  await p.setViewportSize({ width: 390, height: 844 }); await wait(300);
  await p.click('[data-tab="list"]'); await wait();
  await p.screenshot({ path: OUT + '/p-list-dark.png' });

  // lock hides the tabs
  await p.evaluate(() => lock()); await wait();
  check('tabs hidden when locked', !(await p.locator('#tabs').isVisible()));

  check('no script errors', errs.length === 0, errs.join(' | '));
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
