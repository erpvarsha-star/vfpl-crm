// A1 Customers-core checks: the 27 Phase 1 checks (adapted to the tabs) plus the store, migration and data checks.
module.exports = async (t) => {
  const { check, istToday, fs, data } = t;
  const { page } = await t.fresh();
  const rows = () => t.rows(page);
  const row = n => t.row(page, n);
  const reload = async () => { await t.reload(page); await page.waitForSelector('#rows tr'); };

  await t.open(page);
  await t.tab(page, 'list');
  check('loads all 42 customers from customers.json', (await rows()) === 42, String(await rows()));
  check('nothing unsaved on a clean load', await page.locator('#unsaved').isHidden());
  const ids = await page.locator('#rows tr').evaluateAll(trs => trs.map(r => r.dataset.id));
  check('rows carry a stable data-id', ids.length === 42 && new Set(ids).size === 42 && ids.every(Boolean) && ids.includes('zf-steering-gear-india-ltd'), ids.slice(0, 3).join());

  // follow-up date in the past -> red, counted, filterable, survives refresh
  await row('ZF STEERING').locator('.fu input').fill(istToday(-3));
  check('past follow-up shows "Overdue by 3 days"', (await row('ZF STEERING').locator('.rel').innerText()) === 'Overdue by 3 days');
  const red = await row('ZF STEERING').locator('.rel').evaluate(el => getComputedStyle(el).color);
  check('overdue text is red', red === 'rgb(180, 35, 24)', red);
  check('overdue row is flagged', (await row('ZF STEERING').getAttribute('class')) === 'overdue');
  check('Overdue chip counts 1', (await page.locator('#v-overdue').innerText()) === '1');
  await reload();
  check('follow-up date survives a refresh', (await row('ZF STEERING').locator('.fu input').inputValue()) === istToday(-3));
  check('overdue row sorts to the top', (await page.locator('#rows tr').first().innerText()).includes('ZF STEERING'));
  check('the unsaved banner counts the edit after a refresh', await page.locator('#unsaved').isVisible() && (await page.locator('#unsavedMsg').innerText()) === '1 change saved in this browser only.');

  // today and future
  await row('NEEL METAL').locator('.fu input').fill(istToday(0));
  check('today shows "Due today"', (await row('NEEL METAL').locator('.rel').innerText()) === 'Due today');
  const orange = await row('NEEL METAL').locator('.rel').evaluate(el => getComputedStyle(el).color);
  check('due today is orange', orange === 'rgb(180, 83, 9)', orange);
  await row('NR INDUSTRIES').locator('.fu input').fill(istToday(5));
  check('future shows "In 5 days"', (await row('NR INDUSTRIES').locator('.rel').innerText()) === 'In 5 days');
  check('future date is not red', (await row('NR INDUSTRIES').getAttribute('class')) !== 'overdue');
  check('counts: 1 overdue, 1 today, 1 next-7', (await page.locator('#v-overdue').innerText()) === '1' && (await page.locator('#v-today').innerText()) === '1' && (await page.locator('#v-week').innerText()) === '1');

  // filters survive a refresh
  await page.click('.chip[data-v="overdue"]');
  check('Overdue filter shows 1 row', (await rows()) === 1);
  await reload();
  check('filter choice survives a refresh', (await rows()) === 1 && (await page.locator('.chip[data-v="overdue"]').getAttribute('aria-pressed')) === 'true');
  await page.click('.chip[data-v="all"]');
  await page.fill('#q', 'zf');
  await reload();
  check('search text survives a refresh', (await page.inputValue('#q')) === 'zf' && (await rows()) === 1);
  await page.fill('#q', '');

  // sorting by name
  await page.click('th button[data-sort="name"]');
  const first = (await page.locator('#rows tr').first().locator('td.name').innerText());
  check('sort by name puts the first name first', first === [...data.customers.map(c => c.name)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))[0], first);

  // status by hand survives a refresh
  await row('ZF STEERING').locator('select.st').selectOption('At risk');
  await reload();
  check('status survives a refresh', (await row('ZF STEERING').locator('select.st').inputValue()) === 'At risk');

  // clear a follow-up date
  await row('NR INDUSTRIES').locator('.clr').click();
  await reload();
  check('cleared follow-up stays cleared after refresh', (await row('NR INDUSTRIES').locator('.fu input').inputValue()) === '');

  // extra filter chip (the Dashboard opens these through App.show)
  await page.evaluate(() => App.show('list', { extra: { kind: 'disputed' } }));
  const disputedN = data.customers.filter(c => c.disputed).length;
  const shown = await page.locator('#extraBar').isVisible() && (await page.locator('#extraLabel').innerText()) === 'Disputed' && (await rows()) === disputedN;
  await reload();
  const kept = await page.locator('#extraBar').isVisible() && (await rows()) === disputedN;
  await page.click('#extraClear');
  const cleared = await page.locator('#extraBar').isHidden() && (await rows()) === 42;
  check('extra filter chip shows, clears with ×, and survives a refresh', shown && kept && cleared, JSON.stringify({ shown, kept, cleared, disputedN }));
  await page.evaluate(() => App.show('list', { extra: { kind: 'ids', value: ['nr-industries', 'force-motors-limited'], label: 'Top 2' } }));
  check('an "ids" filter shows only those customers', (await rows()) === 2 && (await page.locator('#extraLabel').innerText()) === 'Top 2');
  await page.evaluate(() => App.show('list', {}));
  check('App.show with an empty filter resets every filter', (await rows()) === 42 && await page.locator('#extraBar').isHidden());

  // add a customer with a follow-up date
  await page.click('#openForm');
  await page.fill('input[name=name]', 'Test Forge Co');
  await page.fill('input[name=contact]', 'Rahul Patil');
  await page.fill('input[name=phone]', '9876543210');
  await page.fill('input[name=city]', 'Pune');
  await page.fill('input[name=followUp]', istToday(-1));
  await page.selectOption('select[name=status]', 'Follow up');
  await page.click('button[type=submit]');
  await reload();
  check('added customer survives a refresh', (await rows()) === 43);
  check('added customer keeps its overdue follow-up', (await row('Test Forge Co').locator('.rel').innerText()) === 'Overdue by 1 day');
  await page.click('#openForm');
  await page.fill('input[name=name]', 'test forge co');
  await page.click('button[type=submit]');
  check('duplicate name is refused in #formErr (no alert)', (await page.locator('#formErr').innerText()) === 'test forge co is already in the list.' && await page.locator('#dlg').evaluate(d => d.open));
  await page.click('#cancel');
  check('duplicate name adds nothing', (await rows()) === 43);

  // export carries everything (Export tab)
  await t.tab(page, 'export');
  const dl = await t.download(page, '#export');
  const out = JSON.parse(dl.text);
  const by = n => out.customers.find(c => c.name.startsWith(n));
  check('export has 43 customers', out.customers.length === 43 && dl.name === 'customers.json');
  check('export keeps follow-up dates', by('ZF STEERING').followUp === istToday(-3) && by('Test Forge').followUp === istToday(-1));
  check('export keeps statuses', by('ZF STEERING').status === 'At risk' && by('Test Forge').status === 'Follow up');
  const keys = [...new Set(out.customers.flatMap(c => Object.keys(c)))].sort().join();
  check('export has only the expected fields (no email or GST)', keys === 'city,contact,contactFrom,disputed,erpGroup,followUp,group,id,last,name,phone,plants,relatedParty,segment,state,status,vehicleSegment', keys);
  check('export has the new keys', Object.keys(out.customers[0]).join() === 'id,name,contact,contactFrom,city,state,phone,last,followUp,status,disputed,group,segment,vehicleSegment,plants,relatedParty,erpGroup');
  check('export keeps ids', by('Test Forge').id === 'test-forge-co' && by('ZF STEERING').id === 'zf-steering-gear-india-ltd');

  // notes and amounts never reach customers.json
  await page.evaluate(async () => {
    await Store.addLog('nr-industries', { type: 'Call', note: 'SECRET-NOTE-TEXT' });
    await Store.doc('money').set({ v: 1, aging: { rows: [{ overdue: 424242424 }] } });
  });
  const dl2 = await t.download(page, '#export');
  check('customers.json export never includes notes or amounts', !/SECRET-NOTE-TEXT|424242424|overdue|outstanding|"notes?"\s*:\s*\[/i.test(dl2.text) && !Object.keys(JSON.parse(dl2.text).customers[0]).some(k => /note|amount|money/i.test(k)), (dl2.text.match(/SECRET-NOTE-TEXT|424242424|overdue|outstanding|"notes?"\s*:\s*\[/i) || [''])[0]);
  const stored = await page.evaluate(() => localStorage.getItem('varsha-crm-localdb-v1'));
  check('the call log is saved in the local database', /SECRET-NOTE-TEXT/.test(stored) && !/424242424/.test(stored), String(stored).slice(0, 200));

  // data shape
  await t.tab(page, 'list');
  const shape = await page.evaluate(() => Store.customers().every(c => c.group === '' && c.segment === '' && c.vehicleSegment === '' && Array.isArray(c.plants) && c.plants.length === 0 || c.name === 'Test Forge Co'));
  check('old customers.json without group, segment or plants loads with blanks', shape && !data.customers.some(c => 'group' in c || 'segment' in c || 'plants' in c));
  const related = await page.evaluate(() => Store.customers().filter(c => c.relatedParty).map(c => c.id).sort());
  check('Markal and KCTR Varsha are flagged as related parties', related.join() === 'kctr-varsha-automotive-pvt-ltd,varsha-forgings-ltd-markal', related.join());
  check('customers.json has erpGroup for every customer and nothing private', data.customers.every(c => typeof c.erpGroup === 'string' && c.erpGroup) &&
    !JSON.stringify(data).match(/@|\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ\w\b|amount|outstanding/i));

  // phone layout
  const phone = await t.fresh({ viewport: { width: 375, height: 760 } });
  await t.open(phone.page);
  await t.tab(phone.page, 'list');
  check('no sideways scroll on a phone', (await phone.page.evaluate(() => document.documentElement.scrollWidth)) === 375);
  await phone.page.evaluate(() => App.show('list', { extra: { kind: 'last', value: '61-90', ref: '2026-10-19' } }));
  check('no sideways scroll on a phone with the extra filter showing', (await phone.page.evaluate(() => document.documentElement.scrollWidth)) === 375);
  await phone.page.click('#openForm');
  check('no sideways scroll on a phone with the Add dialog open', (await phone.page.evaluate(() => document.documentElement.scrollWidth)) === 375);

  // ---- Phase 1 edits move to the new store ----
  const legacy = { added: [{ name: 'Legacy Added Co', contact: 'Asha', phone: '9000000001', city: 'Nashik', last: '', followUp: istToday(2), status: 'Follow up' }],
                   status: { 'ZF STEERING GEAR (INDIA) LTD': 'At risk' }, follow: { 'NEEL METAL PRODUCTS LIMITED': istToday(3) } };
  const m = await t.fresh({
    init: (l) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('varsha-crm-local-v2', JSON.stringify(l)); sessionStorage.setItem('seeded', '1'); } },
    initArg: legacy
  });
  await t.open(m.page);
  await t.tab(m.page, 'list');
  const mrow = n => t.row(m.page, n);
  check('Phase 1 edits move to the new store',
    (await mrow('ZF STEERING').locator('select.st').inputValue()) === 'At risk' &&
    (await mrow('NEEL METAL').locator('.fu input').inputValue()) === istToday(3) &&
    (await t.rows(m.page)) === 43 && (await mrow('Legacy Added Co').locator('.rel').innerText()) === 'In 2 days');
  const noticeText = await m.page.locator('#notice').innerText();
  check('the migration notice says how many changes moved', await m.page.locator('#notice').isVisible() && /Moved 3 changes saved by the old version of this page\./.test(noticeText), noticeText);
  const keysAfter = await m.page.evaluate(() => ({ old: localStorage.getItem('varsha-crm-local-v2'), backup: !!localStorage.getItem('varsha-crm-local-v2-backup'), done: localStorage.getItem('varsha-crm-legacy-done-v1') }));
  check('the old key is backed up and removed, and the one-time flag is set', keysAfter.old === null && keysAfter.backup && keysAfter.done === '1', JSON.stringify(keysAfter));
  await t.reload(m.page);
  check('Phase 1 edits survive a refresh and the notice does not repeat',
    (await mrow('ZF STEERING').locator('select.st').inputValue()) === 'At risk' && (await mrow('NEEL METAL').locator('.fu input').inputValue()) === istToday(3) &&
    (await t.rows(m.page)) === 43 && await m.page.locator('#notice').isHidden());

  // ---- unknown segment in customers.json ----
  const seg = JSON.parse(JSON.stringify(data));
  seg.customers[0].segment = 'Whale'; seg.customers[1].segment = 'Bogus';
  const s = await t.fresh({ init: (d) => { window.CRM_DATA = d; }, initArg: seg });
  await t.open(s.page);
  const segState = await s.page.evaluate(() => Store.customers().slice(0, 2).map(c => c.segment));
  const segNotice = await s.page.locator('#notice').innerText();
  check('unknown segment in customers.json is left blank with a notice',
    segState.join('') === '' && await s.page.locator('#notice').isVisible() && /2 customers had a segment value that is not in the list; it was left blank\./.test(segNotice), segNotice);

  // storage warning on Customers too is covered in 99-final; a load failure shows a message and the page still opens
  const nf = await t.fresh({ trackErrors: false });
  await nf.page.route('**/customers.json*', r => r.fulfill({ status: 404, body: 'no' }));
  await t.open(nf.page);
  await t.tab(nf.page, 'list');
  check('a missing customers.json shows a clear message instead of failing silently',
    await nf.page.locator('#syncErr').isVisible() && /Could not load customers\.json \(HTTP 404\)/.test(await nf.page.locator('#syncErr').innerText()) && /Could not load customers\.json/.test(await nf.page.locator('#empty').innerText()));
};
