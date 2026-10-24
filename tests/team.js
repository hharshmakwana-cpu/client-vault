// Sign-up with owner approval, erase data and delete account — against a fake Firebase that
// applies the same access rules as firebase/firestore.rules.
const { chromium } = require('playwright');
const R = [];
const check = (n, ok, i = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`);
const OWNER = 'hYa1oo6qKPM3DufxJK76YXExo6l2';
const { makeFake } = require('./fake-firebase');
const fake = makeFake({ ownerUid: OWNER, ownerEmail: 'owner@example.com', ownerPass: 'ownerpass1' });
const { users, docs, approved, requests } = fake;
const BASE = process.env.BASE || 'http://localhost:8123/';

async function page(b, w = 390) {
  const ctx = await b.newContext({ viewport: { width: w, height: 844 } }); const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.CLIENT_VAULT_CONFIG={apiKey:"k",projectId:"p",ownerUid:"${OWNER}"};` }));
  await p.route(/googleapis\.com/, fake.handler);
  await p.goto(BASE);
  return p;
}
const w = (p, ms) => p.waitForTimeout(ms || 700);

(async () => {
  const b = await chromium.launch();
  // owner sets up
  const o = await page(b);
  await o.fill('#em', 'owner@example.com'); await o.fill('#pw', 'ownerpass1'); await o.click('#go');
  await o.waitForSelector('#p1'); await o.fill('#p1', 'Owner-master-2026'); await o.fill('#p2', 'Owner-master-2026'); await o.click('#go');
  await o.waitForSelector('[data-act="skip"]'); await o.click('[data-act="skip"]'); await w(o);
  await o.evaluate(() => saveClient({ ...tidy({ type: 'Individual' }), id: 'own1', name: 'Owner Client', created: 1, updated: 1 })); await w(o);

  // new person signs up
  const s = await page(b);
  check('sign-in screen offers "Create an account"', await s.locator('[data-act="signup"]').isVisible());
  await s.click('[data-act="signup"]'); await w(s, 300);
  await s.fill('#nm', 'Priya Shah'); await s.fill('#em', 'Priya@Example.com'); await s.fill('#p1', 'priyapass1'); await s.fill('#p2', 'priyapass1');
  await s.click('#go'); await w(s, 1200);
  check('after sign-up: verify email screen', (await s.locator('.lock h1').textContent()) === 'Verify your email');
  await s.click('[data-act="again"]'); await w(s, 1000);
  check('not verified yet: stays on verify', (await s.locator('.lock h1').textContent()) === 'Verify your email');
  users.get([...users].find(([, u]) => u.email === 'priya@example.com')[0]).verified = true; // the person clicks the link in the email
  await s.click('[data-act="again"]'); await w(s, 1200);
  check('verified: waiting for approval', (await s.locator('.lock h1').textContent()) === 'Waiting for approval');
  check('request reached the owner', requests.has('priya@example.com') && requests.get('priya@example.com').name === 'Priya Shah');

  // owner approves
  await o.click('[data-tab="settings"]'); await w(o);
  check('owner sees Team access', await o.locator('[data-act="team"]').isVisible());
  check('owner cannot delete own account', !(await o.locator('[data-act="delacct"]').count()));
  await o.click('[data-act="team"]'); await w(o, 1200);
  await o.click('[data-act="approve"][data-e="priya@example.com"]'); await w(o, 1000);
  check('approved, request cleared', approved.has('priya@example.com') && !requests.has('priya@example.com'));

  // person gets in, gets own vault
  await s.click('[data-act="again"]'); await w(s, 1500);
  check('approved person creates own master password', await s.locator('#p1').isVisible() && (await s.locator('.lock h1').textContent()).includes('master password'));
  await s.fill('#p1', 'Priya-master-2026'); await s.fill('#p2', 'Priya-master-2026'); await s.click('#go'); await w(s, 1000);
  await s.click('[data-act="skip"]'); await w(s);
  check('new person sees none of the owner clients', await s.evaluate(() => S.clients.length) === 0);
  const peek = await s.evaluate(async () => { try { await fetch('https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/users/hYa1oo6qKPM3DufxJK76YXExo6l2', { headers: { Authorization: 'Bearer tok:u1' } }).then(r => r.status); } catch (e) { return 'err'; } return 'ok'; });
  const st = await s.evaluate(() => fetch('https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/users/hYa1oo6qKPM3DufxJK76YXExo6l2', { headers: { Authorization: 'Bearer tok:u1' } }).then(r => r.status));
  check('person blocked from owner vault', st === 403, 'status ' + st);
  check('person has no Team access', await s.evaluate(() => { go('settings'); return !document.querySelector('[data-act="team"]'); }));
  await s.evaluate(() => saveClient({ ...tidy({ type: 'Individual' }), id: 'p1', name: 'Priya Client', created: 1, updated: 1 })); await w(s);

  // erase all data
  await s.click('[data-act="erase"]'); await w(s);
  await s.fill('#emp', 'wrongpass'); await s.fill('#ety', 'DELETE'); await s.click('#ego'); await w(s, 1500);
  check('wrong master password refused', (await s.locator('#err').textContent()).includes('Wrong master password') && docs.has('/users/u1/clients/p1'));
  await s.fill('#emp', 'Priya-master-2026'); await s.fill('#ety', 'delete'); await s.click('#ego'); await w(s, 2500);
  check('erase removes everything on the server', ![...docs.keys()].some(k => k.startsWith('/users/u1')), [...docs.keys()].join(','));
  check('owner data untouched', docs.has('/users/' + OWNER + '/clients/own1'));
  check('after erase: create new master password', await s.locator('#p1').isVisible());
  await s.fill('#p1', 'Priya-master-2027'); await s.fill('#p2', 'Priya-master-2027'); await s.click('#go'); await w(s, 1000);
  await s.click('[data-act="skip"]'); await w(s);

  // delete account
  await s.click('[data-tab="settings"]'); await w(s);
  await s.click('[data-act="delacct"]'); await w(s);
  await s.fill('#emp', 'Priya-master-2027'); await s.fill('#esp', 'wrongsignin'); await s.fill('#ety', 'DELETE'); await s.click('#ego'); await w(s, 1500);
  check('wrong sign-in password refused', (await s.locator('#err').textContent()).includes('Wrong sign-in password') && users.has('u1'));
  await s.fill('#esp', 'priyapass1'); await s.click('#ego'); await w(s, 2500);
  check('account deleted, back to sign-in', !users.has('u1') && ![...docs.keys()].some(k => k.startsWith('/users/u1')) && await s.locator('[data-act="signup"]').isVisible());
  check('sign-in now refused for deleted account', await (async () => { await s.fill('#em', 'priya@example.com'); await s.fill('#pw', 'priyapass1'); await s.click('#go'); await w(s, 800); return (await s.locator('#err').textContent()).length > 0; })());

  // a stranger who signs up is never let in without approval
  const x = await page(b);
  await x.click('[data-act="signup"]'); await x.fill('#nm', 'Stranger'); await x.fill('#em', 'x@example.com'); await x.fill('#p1', 'strangerpass'); await x.fill('#p2', 'strangerpass'); await x.click('#go'); await w(x, 1000);
  users.get([...users].find(([, u]) => u.email === 'x@example.com')[0]).verified = true;
  await x.click('[data-act="again"]'); await w(x, 1000);
  await x.click('[data-act="again"]'); await w(x, 1000);
  check('unapproved stranger stays waiting', (await x.locator('.lock h1').textContent()) === 'Waiting for approval');

  check('no script errors', ![o, s, x].some(p => p.errs.length), [o, s, x].flatMap(p => p.errs).join(' | '));
  console.log(R.join('\n')); await b.close();
  process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
