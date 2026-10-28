// A1 shell checks: tabs, logo, favicon, 375px, panel stubs.
module.exports = async (t) => {
  const { check } = t;
  const { page } = await t.fresh();
  await t.open(page);

  check('first visit opens the Dashboard tab',
    (await page.getAttribute('#tab-dash', 'aria-selected')) === 'true' && await page.locator('#panel-dash').isVisible() && await page.locator('#panel-list').isHidden());
  const labels = await page.locator('nav.tabs[role=tablist] [role=tab]').allInnerTexts();
  check('tab order is Dashboard, Customers, Leads, RFQs, Schedule, Today, Accounts, Forecast, Automation, Sync, Export', labels.join(', ') === 'Dashboard, Customers, Leads, RFQs, Schedule, Today, Accounts, Forecast, Automation, Sync, Export', labels.join(', '));

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
  for (const id of ['dash', 'list', 'leads', 'rfqs', 'schedule', 'export']) {
    await t.tab(page, id);
    if (!(await page.locator('#panel-' + id).innerText()).trim()) content = false;
  }
  check('every panel stub mounts without console errors', content && t.errors.length === before, JSON.stringify(t.errors));

  await t.tab(page, 'leads');
  check('Leads panel stub mounts', (await page.getAttribute('#tab-leads', 'aria-selected')) === 'true' && await page.locator('#panel-leads').isVisible() && (await page.locator('#panel-leads').innerText()).trim().length > 0 &&
    (await page.locator('#tab-leads').innerText()) === 'Leads');

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
  for (const id of ['dash', 'list', 'leads', 'rfqs', 'schedule', 'export']) {
    await t.tab(phone.page, id);
  }
  const m = await phone.page.evaluate(() => {
    const nav = document.querySelector('nav.tabs');
    return { page: document.documentElement.scrollWidth, navScrolls: nav.scrollWidth > nav.clientWidth, overflowX: getComputedStyle(nav).overflowX,
             selVisible: (() => { const b = document.querySelector('[role=tab][aria-selected=true]').getBoundingClientRect(); return b.left >= -1 && b.right <= 376; })() };
  });
  check('tab bar fits at 375px without page scroll', m.page === 375 && m.overflowX === 'auto' && m.selVisible, JSON.stringify(m));

  // ---- messages (App.notice): dismiss button, auto-dismiss, cleared on tab switch, roles, 375px ----
  const n = await t.fresh();
  await t.open(n.page);
  const np = n.page;
  await t.tab(np, 'list');
  await np.clock.install({ time: Date.now() });
  const vis = sel => np.locator(sel).isVisible();
  await np.evaluate(() => App.notice('Imported 3 rows from test.csv.', 'info'));
  check('a message shows with a visible dismiss button and keeps role=status', await vis('#notice') && await vis('#notice .banner-x') && (await np.getAttribute('#notice', 'role')) === 'status' &&
    (await np.getAttribute('#notice .banner-x', 'aria-label')) === 'Dismiss message');
  check('errors use role=alert', (await np.getAttribute('#syncErr', 'role')) === 'alert' && (await np.getAttribute('#storageWarn', 'role')) === 'alert');
  await np.focus('#notice .banner-x');
  await np.keyboard.press('Enter');
  check('the dismiss button works from the keyboard', await np.locator('#notice').isHidden());
  await np.evaluate(() => App.notice('Imported 4 rows.', 'info'));
  await np.clock.fastForward(11000);
  const still = await vis('#notice');
  await np.clock.fastForward(1500);
  check('an info message goes away by itself after 12 seconds', still && await np.locator('#notice').isHidden());
  await np.evaluate(() => App.notice('Check this first.', 'warn'));
  await np.clock.fastForward(60000);
  check('a warning stays until dismissed', await vis('#notice'));
  await np.click('#notice .banner-x');
  check('a warning can be dismissed with the ×', await np.locator('#notice').isHidden());
  await np.evaluate(() => App.notice('Something failed.', 'error'));
  await np.clock.fastForward(60000);
  check('an error stays until dismissed', await vis('#syncErr') && (await np.locator('#syncErr').innerText()).includes('Something failed.'));
  await np.click('#tab-rfqs');
  check('an error survives a tab switch', await vis('#syncErr'));
  await np.click('#syncErr .banner-x');
  check('an error can be dismissed', await np.locator('#syncErr').isHidden());
  await np.evaluate(() => App.notice('Imported 7 rows from aging.csv.', 'info'));
  await np.clock.fastForward(3000);
  await np.click('#tab-schedule');
  check('an info message is cleared when the user switches tab', await np.locator('#notice').isHidden());
  await np.evaluate(() => { App.notice('Added a customer from the lead.', 'info'); App.show('list', {}); });
  check('a message posted just before a switch is still shown on the new tab', await vis('#notice') && (await np.locator('#notice').innerText()).includes('Added a customer from the lead.'));
  await np.evaluate(() => App.notice('Check the dates.', 'warn'));
  await np.clock.fastForward(3000);
  await np.click('#tab-export');
  check('a warning is cleared on a tab switch too', await np.locator('#notice').isHidden());
  await np.evaluate(() => { App.notice('First message.', 'info'); App.notice('Second message.', 'info'); });
  await np.clock.fastForward(11500);
  await np.evaluate(() => App.notice('Third message.', 'info'));
  await np.clock.fastForward(11500);
  check('a new message restarts the 12 second timer', await vis('#notice') && (await np.locator('#notice').innerText()).includes('Third message.'));
  await np.clock.fastForward(1000);
  check('...and then goes away', await np.locator('#notice').isHidden());

  const sm = await t.fresh({ viewport: { width: 375, height: 700 } });
  await t.open(sm.page);
  await t.tab(sm.page, 'list');
  await sm.page.evaluate(() => App.notice('Imported 28 rows from a long file name that goes on and on for a while (aging-and-live-position.csv). Data as of 15 Oct 2026.', 'info'));
  const g = await sm.page.evaluate(() => {
    const nb = document.getElementById('notice').getBoundingClientRect(), tb = document.querySelector('.tabbar').getBoundingClientRect();
    const first = document.querySelector('#panel-list .bar').getBoundingClientRect(), x = document.querySelector('#notice .banner-x').getBoundingClientRect();
    return { page: document.documentElement.scrollWidth, belowTabs: nb.top >= tb.bottom - 0.5, aboveContent: nb.bottom <= first.top + 0.5, xInside: x.right <= nb.right + 0.5 && x.left >= nb.left && x.width >= 36 };
  });
  check('a message at 375px fits, does not cover the tab bar or the content, and has a full-size dismiss button', g.page === 375 && g.belowTabs && g.aboveContent && g.xInside, JSON.stringify(g));
};
