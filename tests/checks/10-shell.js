// A1 shell checks: tabs, logo, favicon, 375px, panel stubs.
module.exports = async (t) => {
  const { check } = t;
  const { page } = await t.fresh();
  await t.open(page);

  check('first visit opens the Dashboard tab',
    (await page.getAttribute('#tab-dash', 'aria-selected')) === 'true' && await page.locator('#panel-dash').isVisible() && await page.locator('#panel-list').isHidden());
  const labels = await page.locator('nav.tabs[role=tablist] [role=tab]').allInnerTexts();
  check('tab order is Dashboard, Customers, RFQs, Schedule, Export', labels.join(', ') === 'Dashboard, Customers, RFQs, Schedule, Export', labels.join(', '));

  await t.tab(page, 'list');
  await t.reload(page);
  check('tab choice survives a refresh', (await page.getAttribute('#tab-list', 'aria-selected')) === 'true' && await page.locator('#panel-list').isVisible() && await page.locator('#panel-dash').isHidden());

  await page.focus('#tab-dash');
  await page.keyboard.press('ArrowRight');
  const afterRight = await page.evaluate(() => ({ sel: document.querySelector('[role=tab][aria-selected=true]').id, focus: document.activeElement.id }));
  await page.keyboard.press('End');
  const afterEnd = await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').id);
  await page.keyboard.press('ArrowRight');
  const wrapped = await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').id);
  await page.keyboard.press('Home');
  const afterHome = await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').id);
  await page.keyboard.press('ArrowLeft');
  const wrapBack = await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').id);
  check('arrow keys move between tabs', afterRight.sel === 'tab-list' && afterRight.focus === 'tab-list' && afterEnd === 'tab-export' && wrapped === 'tab-dash' && afterHome === 'tab-dash' && wrapBack === 'tab-export',
    JSON.stringify({ afterRight, afterEnd, wrapped, afterHome, wrapBack }));
  check('only the selected tab is in the tab order (roving tabindex)', (await page.locator('[role=tab][tabindex="0"]').count()) === 1);

  const logo = await page.evaluate(() => {
    const img = document.querySelector('.logo-badge img');
    return { w: img.naturalWidth, bg: getComputedStyle(img.parentElement).backgroundColor, alt: img.alt };
  });
  check('logo shows in the header on a white badge', logo.w > 0 && logo.bg === 'rgb(255, 255, 255)' && logo.alt === 'Varsha Forgings', JSON.stringify(logo));

  const href = await page.getAttribute('link[rel=icon]', 'href');
  const res = await page.request.get(t.url + href);
  const buf = await res.body();
  const isPng = buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  check('favicon is a 64px PNG', res.ok() && /image\/png/.test(res.headers()['content-type']) && isPng && buf.readUInt32BE(16) === 64 && buf.readUInt32BE(20) === 64, href);

  const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
  check('the page has no CSP violations while loading', !t.errors.some(e => /Content Security Policy/i.test(e)) && /script-src 'self'/.test(csp));

  // every stub mounts
  const before = t.errors.length;
  let content = true;
  for (const id of ['dash', 'list', 'rfqs', 'schedule', 'export']) {
    await t.tab(page, id);
    if (!(await page.locator('#panel-' + id).innerText()).trim()) content = false;
  }
  check('every panel stub mounts without console errors', content && t.errors.length === before, JSON.stringify(t.errors));

  // a module needs no shell edit beyond the markup: a panel registered for an id with no tab gets one
  await page.evaluate(() => { App.registerPanel('zz', { label: 'Zed', mount(el) { el.textContent = 'hello zed'; }, render() {}, show() {} }); });
  check('a module registering a new panel gets a tab and a panel automatically',
    await page.locator('#tab-zz').count() === 1 && await page.locator('#panel-zz').count() === 1);
  await page.click('#tab-zz');
  check('the new tab opens and its panel shows', (await page.locator('#panel-zz').innerText()) === 'hello zed' && await page.locator('#panel-list').isHidden());
  await page.keyboard.press('ArrowLeft');
  check('arrow keys follow the DOM order, including the new tab', (await page.getAttribute('#tab-export', 'aria-selected')) === 'true');

  // 375px
  const phone = await t.fresh({ viewport: { width: 375, height: 760 } });
  await t.open(phone.page);
  for (const id of ['dash', 'list', 'rfqs', 'schedule', 'export']) {
    await t.tab(phone.page, id);
  }
  const m = await phone.page.evaluate(() => {
    const nav = document.querySelector('nav.tabs');
    return { page: document.documentElement.scrollWidth, navScrolls: nav.scrollWidth > nav.clientWidth, overflowX: getComputedStyle(nav).overflowX,
             selVisible: (() => { const b = document.querySelector('[role=tab][aria-selected=true]').getBoundingClientRect(); return b.left >= -1 && b.right <= 376; })() };
  });
  check('tab bar fits at 375px without page scroll', m.page === 375 && m.overflowX === 'auto' && m.selVisible, JSON.stringify(m));
};
