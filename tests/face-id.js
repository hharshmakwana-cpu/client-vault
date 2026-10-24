const BASE = process.env.BASE || 'http://localhost:8123/';
const { chromium } = require('playwright');
const R = [], check = (n, ok, i = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.CLIENT_VAULT_CONFIG={apiKey:""};' }));
  await p.goto(BASE);
  await p.fill('#p1', 'testpassword123'); await p.fill('#p2', 'testpassword123'); await p.click('#go'); await p.waitForTimeout(600);
  await p.click('[data-act="skip"]'); await p.waitForTimeout(500);
  const on = await p.evaluate(async () => { try { const ok = await bioEnable(); if (!ok) await bioFinish(); return !!bioRecord(); } catch (e) { return 'err ' + e.name + ' ' + e.message; } });
  check('Face ID set up', on === true, String(on));
  await p.evaluate(() => lock(true)); // as when the app is brought back after locking
  await p.waitForTimeout(2500);
  check('opening the app unlocks with Face ID, no tap', await p.evaluate(() => cur.v) === 'list');
  // "Lock now" must not pop Face ID straight back
  await p.evaluate(() => lock()); await p.waitForTimeout(2000);
  check('“Lock now” stays locked (no prompt)', await p.evaluate(() => cur.v === null && !!document.querySelector('.facebtn')));
  // tapping the button still works
  await p.click('.facebtn'); await p.waitForTimeout(1500);
  check('tapping the Face ID button unlocks', await p.evaluate(() => cur.v) === 'list');
  // cancelled Face ID: buttons stay
  await cdp.send('WebAuthn.disable');
  await p.evaluate(() => lock(true)); // no authenticator → request fails/cancels
  await p.waitForTimeout(2500);
  check('after a failed attempt the buttons stay', await p.evaluate(() => cur.v === null && (!!document.querySelector('.facebtn') || !!document.querySelector('#pw'))));
  check('no script errors', !errs.length, errs.join(' | ')); console.log(R.join('\n')); await b.close();
  process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
