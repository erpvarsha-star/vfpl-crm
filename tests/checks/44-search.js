// Global search / command palette. Synthetic data only. If index.html does not yet include search.js/css, the check injects them.
module.exports = async (t) => {
  const { check } = t;
  const load = async (page) => {
    if (!(await page.evaluate(() => !!window.CrmSearch))) {
      await page.addStyleTag({ url: t.url + 'css/search.css' });
      await page.addScriptTag({ url: t.url + 'js/search.js' });
    }
  };
  const c = await t.fresh(); const page = c.page;
  await t.open(page);
  await load(page);
  await page.evaluate(async () => {
    await Store.col('leads').insert({ company: 'Zorblax Imaginary Ltd', company_key: 'zorblax', status: 'Open', email: 'zz@example.invalid' });
    await Store.col('rfqs').insert({ rfq_no: 'RFQ-ZQ-9', part_name: 'Quuxle Hub', stage: 'Received' });
    await Store.col('tasks').insert({ title: 'Chase Wibblewood drawings' });
    App.flush();
  });
  const dlgOpen = () => page.evaluate(() => document.getElementById('cmdk').open);
  const txt = () => page.locator('#cmdk .cmdk-list').innerText();
  await page.focus('#openSearch');
  await page.click('#openSearch');
  check('search: button opens palette', await dlgOpen());
  check('search: input focused', await page.evaluate(() => document.activeElement.closest('#cmdk') !== null));
  await page.keyboard.press('Escape');
  check('search: Esc closes', !(await dlgOpen()));
  check('search: focus returns to opener', await page.evaluate(() => document.activeElement.id === 'openSearch'));
  await page.keyboard.press('Control+k');
  check('search: Ctrl+K opens', await dlgOpen());
  await page.keyboard.type('zorblax');
  check('search: lead found under Leads', /LEADS/i.test(await txt()) && (await txt()).includes('Zorblax Imaginary Ltd'));
  check('search: result count announced', /1 result/.test(await page.locator('#cmdk [aria-live]').innerText()));
  check('search: no email in index', !(await page.locator('#cmdk').innerText()).includes('example.invalid'));
  await page.fill('#cmdk input', 'quuxle');
  check('search: RFQ by part', (await txt()).includes('RFQ-ZQ-9'));
  await page.fill('#cmdk input', 'wibble');
  check('search: task found', (await txt()).includes('Chase Wibblewood drawings'));
  await page.fill('#cmdk input', 'go to rf');
  check('search: action Go to RFQs', (await txt()).includes('Go to RFQs'));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  check('search: Enter runs action and closes', !(await dlgOpen()) && (await page.evaluate(() => App.tab())) === 'rfqs');
  await page.keyboard.press('Control+k');
  await page.fill('#cmdk input', 'zorblax');
  await page.keyboard.press('Enter');
  check('search: choosing lead switches to Leads', (await page.evaluate(() => App.tab())) === 'leads');
  await page.keyboard.press('Control+k');
  check('search: recent shows last query', (await txt()).includes('zorblax'));
  await page.keyboard.press('Escape');
  await t.reload(page);
  await load(page);
  await page.keyboard.press('Control+k');
  check('search: recents survive refresh', (await txt()).includes('zorblax'));
  const recents = await page.evaluate(() => JSON.parse(localStorage.getItem('crm.recentSearches')));
  check('search: recents capped at 5 and plain strings', recents.length <= 5 && recents.every(x => typeof x === 'string'));
  await page.keyboard.press('Escape');
  const m = await t.fresh({ viewport: { width: 375, height: 700 } });
  await t.open(m.page);
  await load(m.page);
  await m.page.click('#openSearch');
  check('search: no sideways scroll at 375px', await m.page.evaluate(() => document.documentElement.scrollWidth <= 375));
};
