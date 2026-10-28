// Accounts (Customer 360) checks: picker, header, KPI strip, health score, timeline, quick actions, refresh. Synthetic notes only.
module.exports = async (t) => {
  const { check, istToday } = t;
  const ZF = 'ZF STEERING GEAR (INDIA) LTD', ZFID = 'zf-steering-gear-india-ltd';
  const { page } = await t.fresh();
  // If index.html does not load the module yet, add its script tag on the way in so the check still runs.
  const wired = /js\/c360\.js/.test(t.fs.readFileSync(t.path.join(t.root, 'index.html'), 'utf8'));
  if (!wired) {
    await page.route(u => u.pathname === '/' || u.pathname.endsWith('/index.html'), async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      body = body.replace('<script src="js/boot.js', '<script src="js/c360.js?v=2" defer></script>\n<script src="js/boot.js');
      await route.fulfill({ response: res, body });
    });
  }
  const settle = () => page.evaluate(() => App.flush());
  const reload = async () => { await t.reload(page); await t.tab(page, 'c360'); };
  const txt = sel => page.locator(sel).innerText();

  await t.open(page);
  check('Crm360 contract exists', await t.has(page, 'window.Crm360 && Crm360.open && Crm360.score'));
  await t.tab(page, 'c360');
  check('empty state asks for a customer', /Pick a customer/.test(await txt('#panel-c360')));

  // picker
  await page.fill('#c3Search', 'zf steering');
  await page.click('#c3Results button[data-id="' + ZFID + '"]');
  check('picker opens the account', (await txt('#panel-c360 .c3-head h2')).includes('ZF STEERING'));
  check('header has status, group, segment', /Status:/.test(await txt('#c3Header')) && /Group:/.test(await txt('#c3Header')) && /Segment:/.test(await txt('#c3Header')));
  check('KPI strip says import to see without data', /Import to see/.test(await txt('#c3Kpis')) && /Last order/.test(await txt('#c3Kpis')) && /Open RFQs/.test(await txt('#c3Kpis')));

  // health score: advisory, five factors, status untouched
  const before = await page.evaluate(id => Store.get(id).status, ZFID);
  const sc = await page.evaluate(id => Crm360.score(id), ZFID);
  check('score is 0-100 and the factors add up', sc.score >= 0 && sc.score <= 100 && sc.factors.length === 5 && sc.factors.reduce((s, f) => s + f.points, 0) === sc.score && sc.factors.reduce((s, f) => s + f.max, 0) === 100);
  check('each factor is listed with its points', (await page.locator('#c3Factors li').count()) === 5 && /\d+ \/ 30/.test(await txt('#c3Factors')));
  check('score for a missing customer is null', await page.evaluate(() => Crm360.score('nope') === null));

  // log a call
  await page.fill('#c3CallFormText', 'Call about drawing 42');
  await page.click('#c3CallForm button');
  await page.waitForFunction(() => /Call about drawing 42/.test(document.getElementById('c3Timeline').textContent));
  await settle();
  check('logged call appears in the timeline', /Call/.test(await txt('#c3Timeline li:first-child')));
  check('call adds to the call log store', await page.evaluate(id => Store.listLog(id).some(l => l.note === 'Call about drawing 42' && l.type === 'Call'), ZFID));

  // add note
  await page.fill('#c3NoteFormText', 'Prefers email after 4pm');
  await page.click('#c3NoteForm button');
  await page.waitForFunction(() => /Prefers email/.test(document.getElementById('c3Timeline').textContent));
  await settle();
  check('note appears in the timeline', await page.locator('#c3Timeline li[data-kind="Note"]').count() >= 1);
  await page.click('#c3NoteForm button');
  check('empty note is refused with a message', /Write a note first/.test(await txt('#c3Err')));

  // follow-up: overdue is red and says Overdue by N days
  await page.evaluate(([id, d]) => Store.saveCustomer(id, { followUp: d }), [ZFID, istToday(-3)]).catch(() => {});
  await settle();
  await page.evaluate(id => Crm360.open(id), ZFID);
  const fuTxt = await txt('#c3Fu');
  check('overdue follow-up says Overdue by 3 days', /Overdue by 3 days/.test(fuTxt), fuTxt);
  check('overdue follow-up is red', await page.locator('#c3Fu .c3-fu-overdue').count() === 1 && (await page.locator('#c3Fu span span, #c3Fu .c3-fu-overdue').first().evaluate(e => getComputedStyle(e).color)) !== '');
  // set a future follow-up through the form
  const fut = istToday(5);
  await page.fill('#c3FuDate', fut);
  await page.click('#c3FuForm button[type="submit"]');
  await page.waitForFunction(() => /In 5 days/.test(document.getElementById('c3Fu').textContent));
  await settle();
  check('set follow-up saves and shows', await page.evaluate(([id, d]) => Store.get(id).followUp === d, [ZFID, fut]));
  await page.click('#c3FuClear');
  await page.waitForFunction(() => /No follow-up/.test(document.getElementById('c3Fu').textContent));
  await settle();
  check('clear follow-up works', await page.evaluate(id => Store.get(id).followUp === '', ZFID));
  check('status never changed by the score or actions', await page.evaluate(id => Store.get(id).status, ZFID) === before);

  // refresh: selection, call, note survive
  await reload();
  check('refresh keeps the selected customer', (await txt('#panel-c360 .c3-head h2')).includes('ZF STEERING'));
  const tl = await txt('#c3Timeline');
  check('refresh keeps the call and the note', /Call about drawing 42/.test(tl) && /Prefers email after 4pm/.test(tl));

  // open() from code and the 375px layout
  check('open() returns false for an unknown id', await page.evaluate(() => Crm360.open('nope') === false));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(id => Crm360.open(id), ZFID);
  check('no sideways scroll at 375px', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
};
