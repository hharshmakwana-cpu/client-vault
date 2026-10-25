// Data safety: real dates only, safe backup restore, unreadable records, honest save messages,
// unsaved forms kept, Recently deleted, fee corrections with history, storage-full protection.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8123/';
const R = [], check = (n, ok, i = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`);
const PW = 'Master-pass-2026';

(async () => {
  process.on('unhandledRejection', e => { console.log(R.join('\n')); console.log('Error', e.message); process.exit(1); });
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, serviceWorkers: 'block' }), p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.CLIENT_VAULT_CONFIG={apiKey:""};' }));
  const wait = ms => p.waitForTimeout(ms || 500);
  await p.goto(BASE);
  await p.fill('#p1', PW); await p.fill('#p2', PW); await p.click('#go'); await wait();
  await p.click('[data-act="skip"]'); await wait();
  const newClient = (id, name, extra = '{}') => p.evaluate(([id, name, extra]) => saveClient({ ...tidy({ type: 'Individual' }), id, name, created: 1, updated: 1, ...JSON.parse(extra) }), [id, name, extra]);
  await newClient('c1', 'Ramesh Patel', JSON.stringify({ pan: 'ABCPP1234F', mobile: '9876543210' })); await wait(200);

  // ---- 1. real dates only
  const dates = await p.evaluate(() => {
    const bad = ['2026-02-31', '2026-04-31', '2026-13-10', '2026-00-10', '2026-02-29', '31/02/2026', '29/02/2026', '2026/02/10', 'tomorrow', '10-Feb-2026'];
    const good = { '2024-02-29': '2024-02-29', '29/02/2024': '2024-02-29', '2026-2-3': '2026-02-03', '5/9/26': '2026-09-05', '': '' };
    return {
      csvBad: bad.filter(d => csvDate(d) !== null), csvGood: Object.entries(good).filter(([d, w]) => csvDate(d) !== w).map(([d]) => d),
      ymdBad: ['2026-02-31', '2026-04-31', '2026-13-10', '2026-00-10', '2026-02-29', '1900-02-29'].filter(validYmd),
      ymdGood: ['2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01'].filter(d => !validYmd(d)),
      dob: ['2026-02-31', '2026-04-31'].map(d => RULES.dob(d, { type: 'Individual' })?.level),
      rows: csvToClients('Name,DOB\nA Shah,2026-02-31\nB Shah,2024-02-29\nC Shah,31/04/2026\n').map(r => r.errors.length),
    };
  });
  check('impossible dates refused in imports (31 Feb, 31 Apr, month 13/00, 29 Feb 2026…)', !dates.csvBad.length, dates.csvBad.join(', '));
  check('valid dates accepted, incl. leap day 2024 and DD/MM forms', !dates.csvGood.length, dates.csvGood.join(', '));
  check('calendar check (leap years incl. 1900 / 2000)', !dates.ymdBad.length && !dates.ymdGood.length, dates.ymdBad.concat(dates.ymdGood).join(', '));
  check('date of birth rule refuses 31 Feb and 31 Apr', dates.dob.every(l => l === 'err'));
  check('CSV rows with impossible dates are flagged', JSON.stringify(dates.rows) === '[1,0,1]', JSON.stringify(dates.rows));

  // ---- 2. backup restore
  const backup = await p.evaluate(() => JSON.parse(JSON.stringify({ app: 'client-vault', v: 2, saved: Date.now(), vault: S.vault, clients: [...S.recs.values()] })));
  const restore = async (data, pw, click = true) => p.evaluate(async ([data, pw, click]) => {
    go('import', data); await new Promise(r => setTimeout(r, 250));
    if (!document.querySelector('#pw')) return { screen: document.querySelector('#app').innerText.slice(0, 160) };
    document.querySelector('#pw').value = pw; document.querySelector('#f').requestSubmit(); await new Promise(r => setTimeout(r, 1500));
    const preview = document.querySelector('.tiles')?.innerText.replace(/\s+/g, ' ');
    const err = document.querySelector('#err')?.textContent;
    if (preview && click) { document.querySelector('[data-act="restore"]').click(); await new Promise(r => setTimeout(r, 1500)); }
    return { preview, err, names: S.clients.map(c => c.name).sort() };
  }, [data, pw, click]);
  const future = await restore({ ...backup, v: 9 }, PW);
  check('backup from a newer version refused clearly', /newer version/.test(future.screen || ''), future.screen);
  const wrong = await restore(backup, 'not-the-password');
  check('wrong backup password refused', wrong.err === 'Wrong password for this backup.');
  const damaged = await restore({ ...backup, clients: [...backup.clients, { id: 'zz', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA==' }] }, PW);
  check('damaged backup: nothing restored, clear message', /damaged, so nothing was restored/.test(damaged.err || '') && damaged.names.join() === 'Ramesh Patel', damaged.err);
  await p.evaluate(async () => { await updateClient(S.clients[0], d => { d.email = 'changed@example.com'; }); await saveClient({ ...tidy({ type: 'Individual' }), id: 'c9', name: 'Later Client', created: 1, updated: 1 }); });
  await p.evaluate(async () => { await deleteClient('c1'); }); // lost by mistake
  const ok = await restore(backup, PW);
  check('restore preview shown before anything changes', /1 New clients/.test(ok.preview || ''), ok.preview);
  check('restore brings back the missing client and keeps the others', ok.names.join() === 'Later Client,Ramesh Patel', ok.names.join());

  // ---- 3. unreadable record
  await p.evaluate(async () => { await applyRecs([...S.recs.values(), { id: 'broken', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA==' }]); go('list'); });
  await wait(300);
  check('unreadable record reported, not silently hidden', /couldn’t be opened/.test(await p.locator('.banner').first().innerText()));
  await p.evaluate(async () => { await applyRecs([...S.recs.values()].filter(r => r.id !== 'broken')); go('list'); });

  // ---- 4. honest save message
  const msgs = await p.evaluate(() => { const online = savedMsg('Saved'); OUT.set('x', {}); const off = savedMsg('Saved'); OUT.delete('x'); return [online, off]; });
  check('"Saved" only when it reached the vault; otherwise "on this device"', msgs[0] === 'Saved' && /on this device/.test(msgs[1]), msgs[1]);

  // ---- 5. unsaved form: kept across a reload, warning before leaving
  await p.evaluate(() => go('edit', 'c9')); await wait();
  await p.fill('[data-k="email"]', 'draft@example.com');
  const warns = await p.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });
  check('closing the page with a changed form asks first', warns);
  await p.evaluate(() => keepDraft()); await wait(300);
  await p.reload(); await p.waitForSelector('#pw'); await p.fill('#pw', PW); await p.click('#go'); await wait(1500);
  check('half-filled form comes back after a reload', await p.evaluate(() => cur.v) === 'edit' && await p.inputValue('[data-k="email"]') === 'draft@example.com');
  await p.evaluate(() => { FORM_DIRTY = false; go('list'); }); await wait();

  // ---- 6. Recently deleted + Undo
  await p.evaluate(() => go('edit', 'c9')); await wait();
  await p.click('[data-act="del"]'); await wait();
  const del = await p.evaluate(() => ({ list: S.clients.map(c => c.name), trash: S.trash.map(c => c.name), undo: document.querySelector('.toast-act')?.textContent }));
  check('deleting moves the client to Recently deleted, with Undo', !del.list.includes('Later Client') && del.trash.includes('Later Client') && del.undo === 'Undo', JSON.stringify(del));
  await p.click('.toast-act'); await wait(800);
  check('Undo brings the client back', await p.evaluate(() => S.clients.some(c => c.name === 'Later Client') && !S.trash.length));
  await p.evaluate(async () => { await updateClient(S.clients.find(c => c.id === 'c9'), d => { d.deleted = Date.now(); }); go('trash'); });
  await wait(); await p.click('[data-act="restore"]'); await wait(800);
  check('Restore from the Recently deleted screen', await p.evaluate(() => S.clients.some(c => c.id === 'c9')));
  await p.evaluate(async () => { await updateClient(S.clients.find(c => c.id === 'c9'), d => { d.deleted = Date.now() - 31 * 864e5; }); });
  await p.evaluate(() => lock()); await wait(400); await p.fill('#pw', PW); await p.click('#go'); await wait(1500);
  check('removed for good after 30 days', await p.evaluate(() => !S.trash.length && !S.recs.has('c9')));

  // ---- 7. fee corrections keep history
  await p.evaluate(() => go('fees', 'c1')); await wait();
  await p.fill('#amt', '10000'); await p.fill('#fdesc', 'ITR filing'); await p.click('[data-act="fadd"]'); await wait();
  await p.click('[data-act="kind"][data-k="rcpt"]'); await p.fill('#amt', '6000'); await p.click('[data-act="fadd"]'); await wait();
  const inv = await p.evaluate(() => S.clients.find(c => c.id === 'c1').fees.find(e => e.kind === 'bill').id);
  await p.evaluate(id => go('feefix', { id: 'c1', e: id }), inv); await wait();
  await p.fill('#amt', '9000'); await p.click('[data-act="save"]'); await wait();
  const fixed = await p.evaluate(id => S.clients.find(c => c.id === 'c1').fees.find(e => e.id === id), inv);
  check('correcting an invoice keeps the earlier amount in its history', fixed.amt === 9000 && fixed.history?.[0]?.amt === 10000);
  await p.evaluate(id => go('feeadj', { id: 'c1', e: id }), inv); await wait();
  await p.fill('#amt', '9500'); await p.click('[data-act="save"]'); await wait(300);
  check('credit note larger than the invoice refused', await p.evaluate(() => cur.v) === 'feeadj');
  await p.fill('#amt', '1000'); await p.fill('#fdesc', 'Discount agreed'); await p.click('[data-act="save"]'); await wait();
  const cn = await p.evaluate(() => { const c = S.clients.find(c => c.id === 'c1'); return { totals: feeTotals(c), cn: c.fees.find(e => e.kind === 'credit'), title: document.querySelector('.pp-title')?.textContent }; });
  check('credit note numbered and lowers what is owed', cn.cn?.no === 'CN/2026-27/001' && cn.totals.billed === 8000 && cn.totals.due === 2000 && cn.title === 'CREDIT NOTE', JSON.stringify(cn.totals));
  const rc = await p.evaluate(() => S.clients.find(c => c.id === 'c1').fees.find(e => e.kind === 'rcpt').id);
  await p.evaluate(id => go('feeadj', { id: 'c1', e: id }), rc); await wait();
  await p.fill('#amt', '500'); await p.click('[data-act="save"]'); await wait();
  const rf = await p.evaluate(() => feeTotals(S.clients.find(c => c.id === 'c1')));
  check('refund lowers what was received', rf.received === 5500 && rf.due === 2500, JSON.stringify(rf));
  await p.evaluate(id => go('doc', { id: 'c1', e: id }), inv); await wait();
  await p.evaluate(() => ACT.del()); await wait(300);
  check('an invoice with a credit note can’t be deleted', await p.evaluate(id => S.clients.find(c => c.id === 'c1').fees.some(e => e.id === id), inv));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(id => { go('doc', { id: 'c1', e: S.clients.find(c => c.id === 'c1').fees.find(e => e.kind === 'credit').id }); setTimeout(() => ACT.dl(), 300); }, inv)]);
  check('credit note downloads as a PDF', /CN-2026-27-001/.test(dl.suggestedFilename()), dl.suggestedFilename());

  // ---- 8 + 9. clear search, error messages linked to fields
  await p.evaluate(() => go('list')); await wait();
  await p.fill('#q', 'nobody-like-this'); await wait(200);
  check('"Clear search" offered when nothing matches', await p.locator('[data-act="clearq"]').isVisible());
  await p.click('[data-act="clearq"]'); await wait(200);
  check('clearing shows everyone again', await p.locator('[data-act="open"]').count() >= 1 && await p.inputValue('#q') === '');
  await p.evaluate(() => go('edit', null)); await wait();
  await p.fill('[data-k="mobile"]', '123'); await p.press('[data-k="mobile"]', 'Tab'); await wait(200);
  const aria = await p.evaluate(() => { const el = document.querySelector('[data-k="mobile"]'), id = el.getAttribute('aria-describedby'); return { inv: el.getAttribute('aria-invalid'), msg: id && document.getElementById(id)?.textContent, live: id && document.getElementById(id)?.getAttribute('aria-live') }; });
  check('field error linked to its field for screen readers', aria.inv === 'true' && /10-digit/.test(aria.msg || '') && aria.live === 'polite', JSON.stringify(aria));
  await p.evaluate(() => { FORM_DIRTY = false; go('list'); });

  // ---- 11. storage full while offline: the change isn't claimed
  const full = await p.evaluate(async () => {
    const set = store.set; S.offline = true; store.set = () => Promise.reject(new Error('QuotaExceededError'));
    let msg = '';
    try { await updateClient(S.clients.find(c => c.id === 'c1'), d => { d.notes = 'should not stick'; }); } catch (e) { msg = e.message; }
    store.set = set; S.offline = false;
    return { msg, kept: S.clients.find(c => c.id === 'c1').notes, queued: OUT.size };
  });
  check('offline + storage full: save refused and nothing half-kept', /storage is full/.test(full.msg) && full.kept !== 'should not stick' && full.queued === 0, JSON.stringify(full));

  check('no script errors', !errs.length, errs.join(' | '));
  console.log(R.join('\n')); await b.close();
  process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
