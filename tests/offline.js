// Offline saving against a fake Firebase (sign-in + Firestore REST), with the network switched off and on.
const { chromium } = require('playwright');

const results = [];
const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);

const { makeFake } = require('./fake-firebase');
const fake = makeFake({ ownerUid: 'uid123', ownerEmail: 'me@example.com', ownerPass: 'signinpassword' });
const docs = fake.docs;
const BASE = process.env.BASE || 'http://localhost:8123/';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.CLIENT_VAULT_CONFIG={apiKey:"test",projectId:"p"};' }));
  await p.route(/googleapis\.com/, fake.handler);
  const wait = ms => p.waitForTimeout(ms || 700);

  await p.goto(BASE);
  await p.fill('#em', 'me@example.com'); await p.fill('#pw', 'signinpassword'); await p.click('#go');
  await p.waitForSelector('#p1');
  await p.fill('#p1', 'Master-pass-2026'); await p.fill('#p2', 'Master-pass-2026'); await p.click('#go');
  await p.waitForSelector('[data-act="skip"]'); await p.click('[data-act="skip"]');
  await p.waitForSelector('#list');
  const skipComp = async () => { if (await p.evaluate(() => cur.v) === 'comp') { await p.click('[data-act="back"]'); await wait(); } };

  // online: add a client
  await p.click('[data-act="add"]'); await wait();
  await p.fill('[data-k="name"]', 'Online Client'); await p.fill('[data-k="mobile"]', '9876543210');
  await p.click('[data-act="save"]'); await wait(); await skipComp();
  const clientsOnServer = () => [...docs.keys()].filter(k => k.includes('/clients/')).length;
  check('online save reaches server', clientsOnServer() === 1);
  const id1 = await p.evaluate(() => S.clients[0].id);

  // go offline, add one client and edit the other
  fake.state.offline = true;
  const w0 = fake.state.writes;
  await p.click('[data-tab="list"]'); await wait();
  await p.click('[data-act="add"]'); await wait();
  await p.fill('[data-k="name"]', 'Offline Client'); await p.fill('[data-k="pan"]', 'ABCPO1234F');
  await p.click('[data-act="save"]'); await wait(1200); await skipComp();
  check('saving offline still works on the device', await p.evaluate(() => S.clients.some(c => c.name === 'Offline Client') && cur.v === 'detail'));
  await p.click('[data-act="edit"]'); await wait();
  await p.fill('[data-k="email"]', 'offline@example.com');
  await p.click('[data-act="save"]'); await wait();
  await p.evaluate(() => go('fees', S.clients.find(c => c.name === 'Offline Client').id)); await wait();
  await p.fill('#amt', '5000'); await p.click('[data-act="fadd"]'); await wait();
  check('nothing sent while offline', fake.state.writes === w0, `writes ${fake.state.writes - w0}`);
  check('one queued entry for the client, one for invoice numbering', JSON.stringify(await p.evaluate(() => [...OUT.keys()].map(k => k.split(':')[0]).sort())) === '["c","vault"]', 'outbox ' + await p.evaluate(() => [...OUT.keys()].join()));
  await p.click('[data-tab="list"]'); await wait();
  const banner = await p.locator('.banner').first().textContent();
  check('offline banner explains pending changes', /offline/i.test(banner) && /2 changes/.test(banner), banner.trim());
  

  // close and reopen the app while still offline: queued change survives, data comes from this device
  await p.reload(); await p.waitForSelector('#pw');
  await p.fill('#pw', 'Master-pass-2026'); await p.click('#go'); await p.waitForSelector('#list');
  check('reopened offline with changes kept', await p.evaluate(() => S.offline && OUT.size === 2 && S.clients.find(c => c.name === 'Offline Client')?.email === 'offline@example.com'));

  // back online: tap the banner to upload
  fake.state.offline = false;
  await p.click('.banner[data-act="sync"]'); await wait(1500);
  const srv = [...docs.entries()].filter(([k]) => k.includes('/clients/'));
  check('queued changes uploaded when back online', srv.length === 2 && await p.evaluate(() => OUT.size === 0 && !S.offline), `server has ${srv.length} clients`);
  check('banner gone after upload', !(await p.locator('.banner[data-act="sync"]').count()));
  

  // a second device would see the offline edits: decrypt what the server holds
  await p.evaluate(() => lock()); await wait();
  await p.reload(); await p.waitForSelector('#pw');
  await p.fill('#pw', 'Master-pass-2026'); await p.click('#go'); await p.waitForSelector('#list');
  check('server copy contains the offline edits', await p.evaluate(() => { const c = S.clients.find(x => x.name === 'Offline Client'); return c?.email === 'offline@example.com' && c.fees.length === 1; }));

  // offline delete, then upload when the app is next opened online
  fake.state.offline = true;
  await p.evaluate(id => deleteClient(id), id1); await wait();
  check('offline delete queued', await p.evaluate(() => OUT.size) === 1);
  fake.state.offline = false; await p.reload(); await p.waitForSelector('#pw');
  await p.fill('#pw', 'Master-pass-2026'); await p.click('#go'); await p.waitForSelector('#list'); await wait();
  const st = await p.evaluate(() => ({ out: OUT.size, n: S.clients.length, off: S.offline }));
  check('queued delete uploaded when unlocking online', clientsOnServer() === 1 && st.out === 0 && st.n === 1, JSON.stringify({ server: clientsOnServer(), ...st }));

  check('no script errors', errs.length === 0, errs.join(' | '));
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
