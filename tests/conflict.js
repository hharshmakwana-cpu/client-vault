// Two devices editing the same client: nothing either of them saved may be lost.
const { chromium } = require('playwright');
const { makeFake } = require('./fake-firebase');
const BASE = process.env.BASE || 'http://localhost:8123/';
const R = [], check = (n, ok, i = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`);
const OWNER = 'owner1';
const fake = makeFake({ ownerUid: OWNER });

async function device(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.CLIENT_VAULT_CONFIG={apiKey:"k",projectId:"p",ownerUid:"${OWNER}"};` }));
  await p.route(/googleapis\.com/, fake.handler);
  await p.goto(BASE);
  await p.fill('#em', 'owner@example.com'); await p.fill('#pw', 'ownerpass1'); await p.click('#go');
  return p;
}
const w = (p, ms) => p.waitForTimeout(ms || 700);
const client = (p, id) => p.evaluate(id => { const c = S.clients.find(x => x.id === id); return c && JSON.parse(JSON.stringify(c)); }, id);
const edit = (p, id, fn) => p.evaluate(([id, src]) => updateClient(S.clients.find(x => x.id === id), new Function('d', src)), [id, fn]);

(async () => {
  const b = await chromium.launch();
  const A = await device(b);
  await A.waitForSelector('#p1'); await A.fill('#p1', 'Master-pass-2026'); await A.fill('#p2', 'Master-pass-2026'); await A.click('#go');
  await A.waitForSelector('[data-act="skip"]'); await A.click('[data-act="skip"]'); await w(A);
  await A.evaluate(() => saveClient({ ...tidy({ type: 'Individual' }), id: 'x1', name: 'Ramesh Patel', mobile: '9876543210', created: 1, updated: 1 })); await w(A);

  const B = await device(b);
  await B.waitForSelector('#pw'); await B.fill('#pw', 'Master-pass-2026'); await B.click('#go'); await B.waitForSelector('#list'); await w(B);
  check('second device sees the client', !!(await client(B, 'x1')));

  // both edit different fields from the same starting version
  await edit(A, 'x1', "d.email = 'ramesh@example.com';"); await w(A);
  await edit(B, 'x1', "d.mobile = '9825012345';"); await w(B, 1200);
  let srv = await client(B, 'x1');
  check('both edits kept (email from A, mobile from B)', srv.email === 'ramesh@example.com' && srv.mobile === '9825012345', JSON.stringify({ email: srv.email, mobile: srv.mobile }));
  await A.evaluate(() => sync()); await w(A, 1000);
  srv = await client(A, 'x1');
  check('first device gets the combined copy', srv.email === 'ramesh@example.com' && srv.mobile === '9825012345');

  // fees added on both devices
  await edit(A, 'x1', "d.fees.push({ id: 'fa', kind: 'bill', amt: 5000, date: '2026-10-20', no: 'INV/2026-27/001' });"); await w(A);
  await edit(B, 'x1', "d.fees.push({ id: 'fb', kind: 'rcpt', amt: 2000, date: '2026-10-21', no: 'RCPT/2026-27/001' });"); await w(B, 1200);
  await A.evaluate(() => sync()); await w(A, 1000);
  srv = await client(A, 'x1');
  check('invoice from one device and payment from the other both kept', srv.fees.map(f => f.id).sort().join() === 'fa,fb', srv.fees.map(f => f.id).join());

  // one device offline: its change is merged when it uploads later
  fake.state.offline = false;
  await B.evaluate(() => sync()); await w(B, 800);
  await B.route(/googleapis\.com/, r => r.abort('internetdisconnected'));
  await edit(B, 'x1', "d.notes = 'Prefers calls after 6 pm';"); await w(B);
  check('offline device queued its change', await B.evaluate(() => OUT.size) === 1);
  await edit(A, 'x1', "d.group = 'Patel family';"); await w(A);
  await B.unroute(/googleapis\.com/); await B.route(/googleapis\.com/, fake.handler);
  await B.evaluate(() => sync()); await w(B, 1500);
  srv = await client(B, 'x1');
  check('offline edit merged with the other device’s edit', srv.notes === 'Prefers calls after 6 pm' && srv.group === 'Patel family' && srv.email === 'ramesh@example.com', JSON.stringify({ notes: srv.notes, group: srv.group }));
  check('queue empty afterwards', await B.evaluate(() => OUT.size) === 0);

  // a field changed on both devices: the later save wins, nothing else is lost
  await A.evaluate(() => sync()); await w(A, 800);
  await edit(A, 'x1', "d.fileNo = 'A-1';"); await w(A);
  await edit(B, 'x1', "d.fileNo = 'B-2'; d.dob = '1980-08-15';"); await w(B, 1200);
  srv = await client(B, 'x1');
  check('same field on both: this device’s value wins, other fields kept', srv.fileNo === 'B-2' && srv.dob === '1980-08-15' && srv.group === 'Patel family');

  // settings changed on both devices
  await A.evaluate(async () => { S.meta.firm = 'Makwana & Associates'; await saveMeta(); }); await w(A);
  await B.evaluate(async () => { S.meta.pwDays = 90; await saveMeta(); }); await w(B, 1200);
  await A.evaluate(() => sync()); await w(A, 1000);
  const meta = await A.evaluate(() => ({ firm: S.meta.firm, pwDays: S.meta.pwDays }));
  check('settings from both devices kept', meta.firm === 'Makwana & Associates' && meta.pwDays === 90, JSON.stringify(meta));

  // a client deleted on one device while edited on the other: the delete stands
  await A.evaluate(() => saveClient({ ...tidy({ type: 'Individual' }), id: 'x2', name: 'To Delete', created: 1, updated: 1 })); await w(A);
  await B.evaluate(() => sync()); await w(B, 800);
  await A.evaluate(() => deleteClient('x2')); await w(A);
  await edit(B, 'x2', "d.notes = 'late edit';"); await w(B, 1200);
  check('edit after a delete on another device brings the client back (no data lost)', !!(await client(B, 'x2')));

  check('no script errors', ![A, B].some(p => p.errs.length), [A, B].flatMap(p => p.errs).join(' | '));
  console.log(R.join('\n')); await b.close();
  process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
