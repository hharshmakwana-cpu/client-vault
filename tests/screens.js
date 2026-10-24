const BASE = process.env.BASE || 'http://localhost:8123/';
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.CLIENT_VAULT_CONFIG={apiKey:""};' }));
  await p.goto(BASE);
  await p.fill('#p1', 'testpassword123'); await p.fill('#p2', 'testpassword123'); await p.click('#go'); await p.waitForSelector('[data-act="skip"]'); await p.click('[data-act="skip"]'); await p.waitForSelector('#list');
  const csv = 'Name,Status,PAN,Mobile,GSTIN\nAmit Shah,Individual,ABCPS1234K,9876543211,\nBad Row,Individual,XXXX,123,\n';
  const rows = await p.evaluate(t => csvToClients(t), csv);
  await p.evaluate(r => go('csvimport', { rows: r }), rows); await p.waitForTimeout(400);
  await p.click('[data-act="go"]'); await p.waitForTimeout(800);
  const id = await p.evaluate(() => S.clients[0].id);
  await p.evaluate(id => updateClient(S.clients[0], d => { d.comp = { ITR: '2026-09-01', ADV: '2026-09-01' }; }), id);
  const screens = [['list'], ['due'], ['dash'], ['settings'], ['detail', id], ['edit', id], ['comp', id], ['fees', id], ['wa', { id, back: 'detail' }],
    ['login', { id, p: 'it', back: 'detail' }], ['bulk'], ['templates'], ['changepw'], ['ext'], ['ext', { back: 'settings' }], ['firm']];
  for (const [v, a] of screens) { await p.evaluate(([v, a]) => go(v, a), [v, a]); await p.waitForTimeout(550); const ok = await p.evaluate(v => cur.v === v && app.innerHTML.length > 100, v); console.log((ok ? 'PASS ' : 'FAIL ') + ' screen ' + v); if (!ok) errs.push('screen ' + v); }
  const t = await p.evaluate(() => collectDue('2027-12-31').find(t => t.kind === 'task'));
  if (t) { await p.evaluate(t => go('task', { id: t.id, key: t.key, back: 'due' }), { id: t.c?.id || id, key: t.key }); await p.waitForTimeout(500); console.log('task screen', await p.evaluate(() => cur.v)); }
  await p.evaluate(() => exportBackup()); await p.waitForTimeout(300);
  console.log('imported clients:', await p.evaluate(() => S.clients.map(c => c.name).join(', ')));
  console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'NO ERRORS');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
