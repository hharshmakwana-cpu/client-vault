const BASE = process.env.BASE || 'http://localhost:8123/';
const { chromium } = require('playwright');
const OUT = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'cv-test-')), R = [];
const check = (n, ok, i = '') => R.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.CLIENT_VAULT_CONFIG={apiKey:""};' }));
  const wait = ms => p.waitForTimeout(ms || 650);
  await p.goto(BASE);
  await p.fill('#p1', 'testpassword123'); await p.fill('#p2', 'testpassword123'); await p.click('#go'); await wait();
  await p.click('[data-act="skip"]'); await wait();
  // new company with two contact persons
  await p.evaluate(() => go('edit', null)); await wait();
  check('"Add contact person" offered on a new client', await p.locator('[data-act="cadd"]').isVisible());
  await p.selectOption('[data-k="type"]', 'Company');
  await p.fill('[data-k="name"]', 'Shree Sai Textiles Private Limited'); await p.fill('[data-k="pan"]', 'aabcs1234d');
  await p.click('[data-act="more"]'); await wait(300);
  check('IT user ID shows the PAN, not a text box', (await p.locator('#itUserShow').textContent()) === 'AABCS1234D' && !(await p.locator('[data-k="itUser"]').count()));
  await p.fill('[data-k="pan"]', 'AABCS1234E');
  check('IT user ID follows PAN changes', (await p.locator('#itUserShow').textContent()) === 'AABCS1234E');
  await p.fill('[data-k="pan"]', 'AABCS1234D');
  await p.click('[data-act="cadd"]'); await p.fill('[data-contact]:nth-child(1) [data-cf="name"]', 'Suresh Patel'); await p.fill('[data-contact]:nth-child(1) [data-cf="role"]', 'Director');
  await p.fill('[data-contact]:nth-child(1) [data-cf="mobile"]', '12345');
  await p.click('[data-act="cadd"]'); await p.fill('[data-contact]:nth-child(2) [data-cf="name"]', 'Meena Shah'); await p.fill('[data-contact]:nth-child(2) [data-cf="role"]', 'Accountant');
  await p.fill('[data-contact]:nth-child(2) [data-cf="email"]', 'Meena@Example.com');
  check('labels number the contacts', (await p.locator('[data-contact] .ct').allTextContents()).join('|') === 'Contact person 1|Contact person 2');
  await p.click('[data-act="save"]'); await wait(500);
  check('bad contact mobile blocks saving', await p.evaluate(() => cur.v) === 'edit');
  await p.fill('[data-contact]:nth-child(1) [data-cf="mobile"]', '+91 98250 12345');
  await p.screenshot({ path: OUT + '/c1-edit.png', fullPage: true });
  await p.click('[data-act="save"]'); await wait(900);
  if (await p.evaluate(() => cur.v) === 'comp') { await p.click('[data-act="back"]'); await wait(); }
  const c = await p.evaluate(() => S.clients.find(x => x.type === 'Company'));
  check('contacts saved and tidied', JSON.stringify(c.contacts) === JSON.stringify([{ name: 'Suresh Patel', role: 'Director', mobile: '9825012345', email: '' }, { name: 'Meena Shah', role: 'Accountant', mobile: '', email: 'meena@example.com' }]), JSON.stringify(c.contacts));
  check('no separate IT user ID stored', !('itUser' in c));
  const d = await p.locator('#app').innerText();
  check('client page lists contacts', d.includes('Suresh Patel') && d.includes('Director · 9825012345') && d.includes('Meena Shah'));
  check('call / WhatsApp / email buttons for contacts', await p.locator('a[href="tel:9825012345"]').count() === 1 && await p.locator('[data-act="cwa"]').count() === 1 && await p.locator('a[href="mailto:meena@example.com"]').count() === 1);
  check('IT portal shows PAN as user ID', d.includes('User ID') && d.includes('Same as the PAN'));
  await p.screenshot({ path: OUT + '/c2-detail.png', fullPage: true });
  check('search finds a contact', await p.evaluate(() => haystack(S.clients[0]).includes('meena')));
  // a client saved by the earlier version
  const old = await p.evaluate(async () => {
    const raw = { name: 'Old Firm', type: 'Partnership Firm', contact: 'Ramesh (partner)', itUser: 'WRONGID', pan: 'AAAFO1234B', itPass: 'secret', created: 1, updated: 1, id: 'old1' };
    const e = await encJSON(S.key, raw); S.recs.set('old1', { id: 'old1', ...e }); await applyRecs([...S.recs.values()]);
    const c = S.clients.find(x => x.id === 'old1');
    return { contacts: c.contacts, itUser: c.itUser, portal: portalsOf(c)[0].user };
  });
  check('old "contact person" text becomes the first contact', old.contacts.length === 1 && old.contacts[0].name === 'Ramesh (partner)');
  check('old typed IT user ID replaced by PAN', old.itUser === undefined && old.portal === 'AAAFO1234B');
  // CSV import with a contact column
  const rows = await p.evaluate(() => csvToClients('Name,Status,PAN,Contact person\nNew Co LLP,LLP,AAOFN1234C,Kiran Mehta\n'));
  check('CSV "Contact person" column imported', rows[0].c.contacts[0]?.name === 'Kiran Mehta' && !rows[0].errors.length, JSON.stringify(rows[0].errors));
  check('no script errors', !errs.length, errs.join(' | '));
  console.log(R.join('\n')); await b.close(); process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
