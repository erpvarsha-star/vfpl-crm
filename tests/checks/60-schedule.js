// A5 Schedule checks: visits and calls calendar, typed upcoming orders, dispatch history import and views.
// Fixtures are built here with made-up customers, part codes and quantities. Dates are relative to India "today".
module.exports = async (t) => {
  const { check, istToday } = t;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const human = (iso) => { const [y, m, d] = iso.split('-'); return +d + ' ' + MON[+m - 1] + ' ' + y; };
  const ZF = 'ZF STEERING GEAR (INDIA) LTD', ZFID = 'zf-steering-gear-india-ltd', NR = 'NR INDUSTRIES', NRID = 'nr-industries';
  const RED = 'rgb(180, 35, 24)', ORANGE = 'rgb(180, 83, 9)';
  const closed = (page, id) => page.waitForFunction((i) => !document.getElementById(i).open, id);
  const settle = (page) => page.evaluate(() => App.flush());
  const dayOf = (offset) => istToday(offset);
  const ymOf = (iso) => iso.slice(0, 7);

  async function addVisit(page, o) {
    await page.click('#visitNew');
    await page.fill('#vCust', o.cust);
    if (o.type) await page.selectOption('#vType', o.type);
    await page.fill('#vDate', o.date);
    if (o.time) await page.fill('#vTime', o.time);
    if (o.note) await page.fill('#vNote', o.note);
    await page.click('#visitSave');
    await closed(page, 'visitDlg');
    await settle(page);
  }
  async function addOrder(page, o) {
    await page.click('#orderNew');
    await page.fill('#oCust', o.cust);
    if (o.no) await page.fill('#oNo', o.no);
    if (o.code) await page.fill('#oCode', o.code);
    if (o.part) await page.fill('#oPart', o.part);
    await page.fill('#oQty', String(o.qty));
    await page.fill('#oPromised', o.promised);
    if (o.status) await page.selectOption('#oStatus', o.status);
    if (o.dispatched) await page.fill('#oDispatched', o.dispatched);
    await page.click('#orderSave');
    await closed(page, 'orderDlg');
    await settle(page);
  }
  const goSchedule = async (page, sub) => { await t.tab(page, 'schedule'); if (sub) await page.click('#schTab-' + sub); };
  const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  // =========================================================================================
  // Visits and calls
  // =========================================================================================
  const { page } = await t.fresh();
  await t.open(page);
  await goSchedule(page);
  const first = await page.evaluate(() => ({
    heads: Array.from(document.querySelectorAll('table.cal thead th')).map(h => h.textContent),
    rows: document.querySelectorAll('table.cal tbody tr').length,
    firstDate: document.querySelector('table.cal button.day').dataset.date,
    today: document.querySelector('button.day.today') && document.querySelector('button.day.today').dataset.date,
    todayText: document.querySelector('button.day.today') && document.querySelector('button.day.today').textContent,
    title: document.getElementById('calTitle').textContent
  }));
  const dow = new Date(first.firstDate + 'T00:00:00Z').getUTCDay();
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const t0 = istToday(0);
  check('month grid starts on Monday and marks today', first.heads.join() === 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' && first.rows === 6 && dow === 1 && first.today === t0 && /today/.test(first.todayText) &&
    first.title === MONTH_NAMES[+t0.slice(5, 7) - 1] + ' ' + t0.slice(0, 4), JSON.stringify(first));

  await addVisit(page, { cust: ZF, type: 'Visit', date: t0, time: '10:30', note: 'Discuss tooling' });
  const todayBtn = page.locator('button.day[data-date="' + t0 + '"]');
  check('add a visit and it shows on its day and in the agenda',
    /1 entry/.test(await todayBtn.getAttribute('aria-label')) && /10:30 Visit · ZF STEERING/.test(await todayBtn.innerText()) &&
    (await page.locator('#agenda .sch-item').count()) === 1 && /10:30/.test(await page.locator('#agenda .sch-item').innerText()) && (await page.locator('#agenda .sch-item').innerText()).includes(ZF) && (await page.locator('#agenda .sch-note').innerText()) === 'Discuss tooling');

  await addVisit(page, { cust: NR, type: 'Call', date: t0, note: '<img src=x onerror="window.__x=1">' });
  check('visit note is shown as text, not HTML', (await page.locator('#agenda .sch-note', { hasText: 'onerror' }).innerText()) === '<img src=x onerror="window.__x=1">' && (await page.locator('#agenda img').count()) === 0 && (await page.evaluate(() => window.__x)) === undefined);

  await t.reload(page);
  await goSchedule(page);
  check('visits survive a refresh', (await page.locator('#agenda .sch-item').count()) === 2 && /2 entries/.test(await page.locator('button.day[data-date="' + t0 + '"]').getAttribute('aria-label')) &&
    (await page.evaluate(() => Store.col('visits').all().length)) === 2);

  // a customer must be picked from the list
  await page.click('#visitNew');
  await page.fill('#vCust', 'Nobody Imaginary Ltd');
  await page.fill('#vDate', t0);
  await page.click('#visitSave');
  check('visit needs a customer from the list', (await page.locator('#visitErr').innerText()) === 'Pick a customer from the list.' && await page.locator('#visitDlg').evaluate(d => d.open));
  await page.click('#visitCancel');
  await closed(page, 'visitDlg');

  // past visit not done
  const past = dayOf(-3);
  await addVisit(page, { cust: ZF, type: 'Call', date: past, note: 'Chase drawing' });
  const item = page.locator('#agenda .sch-item', { hasText: 'Chase drawing' });
  const stateEl = item.locator('.sch-state');
  const redState = await stateEl.evaluate(e => getComputedStyle(e).color);
  check('past visit not done is red and says "Not done"', (await stateEl.innerText()) === 'Not done · 3 days ago' && redState === RED, (await stateEl.innerText()) + ' ' + redState);
  check('the Not done chip counts it and turns red', (await page.locator('#vchip-missed b').innerText()) === '1' && /\bhas\b/.test(await page.locator('#vchip-missed').getAttribute('class')) && (await page.locator('button.day[data-date="' + past + '"] .vchip-missed').count()) === 1 &&
    /has missed entries/.test(await page.locator('button.day[data-date="' + past + '"]').getAttribute('aria-label')));
  await page.click('#vchip-missed');
  check('the Not done chip lists the missed entries across days', (await page.locator('#agenda .sch-gtitle').textContent()) === 'Not done (1)' && (await page.locator('#agenda .sch-item').count()) === 1);

  // marking done adds a call-log entry (ticked by default) and updates Last contacted
  await page.locator('#agenda .sch-item .vdone').click();
  check('ticking Done asks "Also add to the call log", ticked by default', await page.locator('#doneLog').isChecked() && await page.locator('#doneSave').isVisible());
  await page.click('#doneSave');
  await page.waitForFunction((id) => Store.listLog(id).length === 1, ZFID);
  const log = await page.evaluate((id) => ({ e: Store.listLog(id)[0], last: Store.lastContacted(id), v: Store.col('visits').all().find(v => v.note === 'Chase drawing') }), ZFID);
  check('marking done can add a call-log entry and updates Last contacted', log.e.type === 'Call' && log.e.at === past && log.e.note === 'Chase drawing' && log.last === past && log.v.done === true && log.v.done_at === t0 && log.v.log_id === log.e.id, JSON.stringify(log));
  await page.click('#vchip-missed');
  await t.reload(page);
  await goSchedule(page);
  check('a visit marked done stays done after a refresh and leaves the Not done count', (await page.evaluate(() => CrmSchedule.visitStats(Store.todayISO()).missed)) === 0 && (await page.evaluate((id) => Store.listLog(id).length, ZFID)) === 1 &&
    (await page.locator('#agenda .sch-item', { hasText: 'Chase drawing' }).locator('.sch-state').innerText()) === 'Done');
  await page.locator('#agenda .sch-item', { hasText: 'Chase drawing' }).locator('.vdone').uncheck();
  await settle(page);
  check('unticking Done reopens the visit but keeps the log entry', (await page.evaluate(() => CrmSchedule.visitStats(Store.todayISO()).missed)) === 1 && (await page.evaluate((id) => Store.listLog(id).length, ZFID)) === 1);
  await page.locator('#agenda .sch-item', { hasText: 'Chase drawing' }).locator('.vdone').check();
  check('re-ticking a visit that is already in the log does not offer a second entry', (await page.locator('#doneLog').count()) === 0 && /Already in the call log/.test(await page.locator('.sch-confirm').innerText()));
  await page.click('#doneSave');
  await page.waitForFunction(() => CrmSchedule.visitStats(Store.todayISO()).missed === 0);
  check('no duplicate log entry after ticking again', (await page.evaluate((id) => Store.listLog(id).length, ZFID)) === 1);

  // done without the log entry
  await addVisit(page, { cust: NR, type: 'Visit', date: dayOf(-1), note: 'No log wanted' });
  await page.locator('#agenda .sch-item', { hasText: 'No log wanted' }).locator('.vdone').check();
  await page.uncheck('#doneLog');
  await page.click('#doneSave');
  await page.waitForFunction(() => Store.col('visits').all().some(v => v.note === 'No log wanted' && v.done));
  check('Done with the log box unticked adds no call-log entry', (await page.evaluate((id) => Store.listLog(id).length, NRID)) === 0 && (await page.evaluate(() => Store.col('visits').all().find(v => v.note === 'No log wanted').log_id)) === null);
  // Cancel leaves it open
  await addVisit(page, { cust: NR, type: 'Meeting', date: dayOf(-2), note: 'Cancel me' });
  await page.locator('#agenda .sch-item', { hasText: 'Cancel me' }).locator('.vdone').check();
  await page.click('#doneCancel');
  check('Cancel on the Done confirm leaves the visit open', (await page.evaluate(() => Store.col('visits').all().find(v => v.note === 'Cancel me').done)) === false && !(await page.locator('#agenda .sch-item', { hasText: 'Cancel me' }).locator('.vdone').isChecked()));
  // a Meeting logs as a Visit; a future visit logs today
  await addVisit(page, { cust: ZF, type: 'Meeting', date: dayOf(2), note: 'Early meeting' });
  await page.locator('#agenda .sch-item', { hasText: 'Early meeting' }).locator('.vdone').check();
  await page.click('#doneSave');
  await page.waitForFunction((id) => Store.listLog(id).length === 2, ZFID);
  const l2 = await page.evaluate((id) => Store.listLog(id)[0], ZFID);
  check('a Meeting is logged as a Visit and a future date is logged as today', l2.type === 'Visit' && l2.at === t0, JSON.stringify(l2));

  // Today and Next 7 days chips
  await page.click('#calToday');
  await addVisit(page, { cust: NR, type: 'Visit', date: dayOf(1), note: 'Tomorrow thing' });
  const st = await page.evaluate(() => CrmSchedule.visitStats(Store.todayISO()));
  check('visitStats counts today, next 7 days and missed', st.today === 2 && st.missed === 1 && st.next7Count === 1 && st.next7[0].customerName === NR && st.next7[0].date === dayOf(1), JSON.stringify(st));
  await page.click('#vchip-next7');
  check('the Next 7 days chip lists tomorrow onwards and the count matches', (await page.locator('#agenda .sch-gtitle').textContent()) === 'Next 7 days (1)' && (await page.locator('#vchip-next7 b').innerText()) === '1' && (await page.locator('#agenda .sch-item').count()) === 1);
  await page.click('#vchip-today');
  check('the Today chip lists the entries for today', (await page.locator('#agenda .sch-item').count()) === 2 && (await page.locator('#vchip-today b').innerText()) === '2');
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
  await goSchedule(page);
  check('the chosen chip survives a refresh', (await page.locator('#vchip-today').getAttribute('aria-pressed')) === 'true');
  await page.click('#vchip-today');

  // arrow keys
  await page.click('#calToday');
  await page.locator('button.day.today').focus();
  await page.keyboard.press('ArrowRight');
  const af1 = await page.evaluate(() => document.activeElement.dataset.date);
  await page.keyboard.press('ArrowDown');
  const af2 = await page.evaluate(() => document.activeElement.dataset.date);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  const af3 = await page.evaluate(() => document.activeElement.dataset.date);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const sel = await page.evaluate(() => ({ sel: document.querySelector('button.day.sel').dataset.date, focus: document.activeElement.dataset.date, title: document.querySelector('#agenda .sch-gtitle').textContent }));
  const nx = dayOf(1);
  check('arrow keys move between days', af1 === nx && af2 === dayOf(8) && af3 === dayOf(0) && sel.sel === nx && sel.focus === nx, [af1, af2, af3, JSON.stringify(sel)].join(' '));
  check('Enter selects a day and the agenda shows that day', /Tomorrow|Tue|Mon|Wed|Thu|Fri|Sat|Sun/.test(sel.title) && (await page.locator('#agenda .sch-item').count()) === 1 && (await page.locator('#agenda .sch-note').innerText()) === 'Tomorrow thing');

  // month paging
  const nextYm = ymOf(dayOf(0)) === ymOf(dayOf(31)) ? ymOf(dayOf(45)) : ymOf(dayOf(31));
  await page.click('#calNext');
  const monthAfter = await page.locator('#calTitle').innerText();
  await page.click('#calPrev');
  check('next and previous move by a month and Today comes back', monthAfter !== first.title && (await page.locator('#calTitle').innerText()) === first.title && nextYm.length === 7);

  // edit and delete
  await page.click('#calToday');
  await page.locator('#agenda .sch-item', { hasText: 'Discuss tooling' }).locator('.sch-edit').click();
  await page.fill('#vNote', 'Discuss tooling and PPAP');
  await page.click('#visitSave');
  await closed(page, 'visitDlg');
  await settle(page);
  await t.reload(page);
  await goSchedule(page);
  check('an edited visit survives a refresh', (await page.locator('#agenda .sch-note', { hasText: 'PPAP' }).count()) === 1);
  await page.locator('#agenda .sch-item', { hasText: 'PPAP' }).locator('.sch-edit').click();
  page.once('dialog', d => d.accept());
  await page.click('#visitDelete');
  await closed(page, 'visitDlg');
  await settle(page);
  await t.reload(page);
  await goSchedule(page);
  check('Delete removes a visit after confirm and stays deleted after a refresh', (await page.locator('#agenda .sch-note', { hasText: 'PPAP' }).count()) === 0 && (await page.evaluate(() => Store.col('visits').all().filter(v => v.note.includes('PPAP')).length)) === 0);

  // sub-view choice
  await page.click('#schTab-dispatch');
  await t.reload(page);
  await goSchedule(page);
  check('sub-view choice survives a refresh', (await page.locator('#schTab-dispatch').getAttribute('aria-selected')) === 'true' && await page.locator('#schPane-dispatch').isVisible() && await page.locator('#schPane-visits').isHidden());
  await page.click('#schTab-orders');
  await page.focus('#schTab-orders');
  await page.keyboard.press('ArrowRight');
  check('arrow keys move between the sub-views', (await page.locator('#schTab-dispatch').getAttribute('aria-selected')) === 'true');

  // =========================================================================================
  // Phone: the agenda list replaces the grid
  // =========================================================================================
  const ph = await t.fresh({ viewport: { width: 375, height: 760 } });
  await t.open(ph.page);
  await ph.page.evaluate(([zf, d0, dm2, d3]) => Promise.all([
    Store.col('visits').insert({ customer_id: zf, type: 'Visit', date: d0, time: '', note: 'Phone today', done: false, done_at: null, log_id: null }),
    Store.col('visits').insert({ customer_id: zf, type: 'Call', date: dm2, time: '09:00', note: 'Phone missed', done: false, done_at: null, log_id: null }),
    Store.col('visits').insert({ customer_id: zf, type: 'Call', date: d3, time: '', note: 'Phone later', done: false, done_at: null, log_id: null })
  ]), [ZFID, dayOf(0), dayOf(-2), dayOf(5)]);
  await goSchedule(ph.page);
  const pv = await ph.page.evaluate(() => ({ cal: document.querySelectorAll('table.cal').length, calwrap: getComputedStyle(document.querySelector('.sch-calwrap')).display, titles: Array.from(document.querySelectorAll('#agenda .sch-gtitle')).map(x => x.textContent), title: document.getElementById('calTitle').textContent, items: document.querySelectorAll('#agenda .sch-item').length }));
  check('agenda list replaces the grid at 375px', pv.cal === 0 && pv.calwrap === 'none' && pv.items === 3 && pv.titles[0] === 'Not done (1)' && /^Today · /.test(pv.titles[1]) && /–/.test(pv.title), JSON.stringify(pv));
  check('the Not done group is red on the phone', (await ph.page.locator('#agenda .sch-redgroup .sch-gtitle').evaluate(e => getComputedStyle(e).color)) === RED);
  check('no sideways scroll on the Visits tab at 375px', await noScroll(ph.page));
  await ph.page.click('#visitNew');
  await ph.page.fill('#vNote', 'x'.repeat(480));
  const dlgBox = await ph.page.evaluate(() => { const d = document.getElementById('visitDlg').getBoundingClientRect(); return { l: d.left, r: d.right, b: d.bottom, vh: innerHeight, w: document.documentElement.scrollWidth }; });
  check('no sideways scroll at 375px with the visit dialog open', dlgBox.w <= 375 && dlgBox.l >= 0 && dlgBox.r <= 375 && dlgBox.b <= dlgBox.vh + 1, JSON.stringify(dlgBox));
  await ph.page.click('#visitCancel');
  await ph.page.click('#calNext');
  check('the next button pages the list by 30 days on the phone', /–/.test(await ph.page.locator('#calTitle').innerText()) && (await ph.page.locator('#agenda .sch-item').count()) === 1);
  await ph.page.click('#calToday');
  await ph.page.setViewportSize({ width: 1280, height: 800 });
  await ph.page.waitForSelector('table.cal');
  check('widening the window brings the month grid back', (await ph.page.locator('table.cal').count()) === 1);

  // =========================================================================================
  // Upcoming orders
  // =========================================================================================
  const oc = await t.fresh();
  await t.open(oc.page);
  const op = oc.page;
  await goSchedule(op, 'orders');
  check('orders show an empty state before the first order', await op.locator('#orderEmpty').isVisible() && /No upcoming orders yet/.test(await op.locator('#orderEmpty').innerText()));
  await addOrder(op, { cust: ZF, no: 'PO-77', code: 'VX1001', part: '<b>Shaft</b> forging', qty: 100, promised: dayOf(5) });
  const orow = op.locator('#orderRows tr', { hasText: 'PO-77' });
  check('typed order is saved and survives a refresh', (await orow.count()) === 1 && /Due in 5 days/.test(await orow.innerText()));
  await t.reload(op);
  await goSchedule(op);
  const orow2 = op.locator('#orderRows tr', { hasText: 'PO-77' });
  check('the order, its fields and the chosen sub-view survive a refresh', (await orow2.count()) === 1 && (await orow2.innerText()).includes('VX1001') && (await orow2.innerText()).includes('100') && (await op.locator('#schTab-orders').getAttribute('aria-selected')) === 'true' &&
    (await op.evaluate(() => Store.col('orders').all()[0].status)) === 'Open');
  check('order text is shown as text, not HTML', (await orow2.innerText()).includes('<b>Shaft</b> forging') && (await orow2.locator('b').count()) === 0);

  await addOrder(op, { cust: NR, no: 'PO-late', code: 'VX2050', part: 'Gear blank', qty: 40, promised: dayOf(-3) });
  await op.click('#ochip-late');
  const late = op.locator('#orderRows tr', { hasText: 'PO-late' });
  const lateState = late.locator('.sch-ostate');
  check('late typed order is red and says "Late by N days"', (await lateState.innerText()) === 'Late by 3 days' && (await lateState.evaluate(e => getComputedStyle(e).color)) === RED);
  check('Late chip count equals rows', (await op.locator('#ochip-late b').innerText()) === '1' && (await op.locator('#orderRows tr').count()) === 1 && /\bhas\b/.test(await op.locator('#ochip-late').getAttribute('class')));
  await op.click('#ochip-open');
  check('open orders sort by promised date, late first', (await op.locator('#orderRows tr').first().innerText()).includes('PO-late') && (await op.locator('#orderRows tr').count()) === 2);
  await addOrder(op, { cust: NR, no: 'PO-today', qty: 5, promised: t0 });
  const todayState = op.locator('#orderRows tr', { hasText: 'PO-today' }).locator('.sch-ostate');
  check('an order due today is orange and says "Due today"', (await todayState.innerText()) === 'Due today' && (await todayState.evaluate(e => getComputedStyle(e).color)) === ORANGE);
  const os = await op.evaluate(() => CrmSchedule.orderStats(Store.todayISO()));
  check('orderStats counts open, late, due today and this week', os.open === 3 && os.late === 1 && os.dueToday === 1 && os.dueWeek === 1 && os.asOf === null && os.stale === false, JSON.stringify(os));
  await op.click('#ochip-week');
  check('Due this week chip count equals rows', (await op.locator('#ochip-week b').innerText()) === '1' && (await op.locator('#orderRows tr').count()) === 1);
  await op.fill('#oq', 'blank');
  await t.reload(op);
  await goSchedule(op);
  check('order filter and search survive a refresh', (await op.locator('#ochip-week').getAttribute('aria-pressed')) === 'true' && (await op.inputValue('#oq')) === 'blank' && (await op.locator('#orderRows tr').count()) === 0);
  await op.fill('#oq', '');
  await op.click('#ochip-all');

  // validation
  await op.click('#orderNew');
  await op.fill('#oCust', 'Nobody Imaginary Ltd');
  await op.click('#orderSave');
  check('order needs a customer from the list', (await op.locator('#orderErr').innerText()) === 'Pick a customer from the list.');
  await op.fill('#oCust', ZF);
  await op.fill('#oQty', '0');
  await op.fill('#oPromised', dayOf(3));
  await op.click('#orderSave');
  check('order quantity must be a whole number, 1 or more', /Quantity must be a whole number/.test(await op.locator('#orderErr').innerText()));
  await op.fill('#oQty', '5');
  await op.selectOption('#oStatus', 'Dispatched');
  await op.fill('#oDispatched', '');
  await op.click('#orderSave');
  check('a Dispatched order needs the dispatched date', /dispatched/i.test(await op.locator('#orderErr').innerText()) && await op.locator('#orderDlg').evaluate(d => d.open));
  await op.click('#orderCancel');
  await closed(op, 'orderDlg');

  // dispatched late and cancelled words, edit, delete
  await addOrder(op, { cust: ZF, no: 'PO-done', qty: 7, promised: dayOf(-10), status: 'Dispatched', dispatched: dayOf(-7) });
  const doneRow = op.locator('#orderRows tr', { hasText: 'PO-done' });
  check('an order dispatched after its promise says "Dispatched N days late" in grey', (await doneRow.locator('.sch-ostate').innerText()) === 'Dispatched 3 days late' && (await doneRow.locator('.sch-ostate').evaluate(e => getComputedStyle(e).color)) !== RED);
  check('dispatched orders leave the Open chip and the Late count', (await op.locator('#ochip-open b').innerText()) === '3' && (await op.locator('#ochip-late b').innerText()) === '1');
  await op.locator('#orderRows tr', { hasText: 'PO-today' }).getByRole('button', { name: /Edit order/ }).click();
  await op.selectOption('#oStatus', 'Cancelled');
  await op.click('#orderSave');
  await closed(op, 'orderDlg');
  await settle(op);
  check('a cancelled order says Cancelled and is no longer open', (await op.locator('#orderRows tr', { hasText: 'PO-today' }).locator('.sch-ostate').innerText()) === 'Cancelled' && (await op.locator('#ochip-open b').innerText()) === '2');
  await op.locator('#orderRows tr', { hasText: 'PO-today' }).getByRole('button', { name: /Edit order/ }).click();
  op.once('dialog', d => d.accept());
  await op.click('#orderDelete');
  await closed(op, 'orderDlg');
  await settle(op);
  await t.reload(op);
  await goSchedule(op);
  check('edits and deletes of orders survive a refresh', (await op.locator('#orderRows tr', { hasText: 'PO-today' }).count()) === 0 && (await op.locator('#orderRows tr', { hasText: 'PO-done' }).count()) === 1);

  // =========================================================================================
  // Dispatch history
  // =========================================================================================
  const HEAD = 'Date,Customer,Part Code,Quantity,Slip Type';
  const DISP = 'Sales Dispatch Slip', JOB = 'Sales Jobwork Slip';
  const spec = [
    [dayOf(-2), NR, 'VX2050', 100, DISP], [dayOf(-100), ZF, 'VX1001', 10, DISP], [dayOf(-10), NR, 'VX1002 M', 5, JOB], [dayOf(-5), ZF, 'VX1001', 40, DISP],
    [dayOf(-60), 'Mystery Imaginary Works', 'VX1001', 7, DISP], [dayOf(-20), ZF, 'VX1002 M', 30, JOB], [dayOf(-40), ZF, 'VX1001', 20, DISP]
  ];
  const csvOf = (rows) => HEAD + '\n' + rows.map(r => r.map(c => String(c).includes(',') ? '"' + c + '"' : c).join(',')).join('\n') + '\n';
  const dispatchCsv = csvOf(spec);
  const TOTAL = spec.reduce((s, r) => s + r[3], 0);        // 212
  async function pick(page, name, text) {
    await page.click('#dispatchImport');
    await page.setInputFiles('#importFile', t.csvFile(name, text));
    await page.waitForSelector('#importSummary li, #importErr:not([hidden])');
  }
  async function importDispatch(page, text, o = {}) {
    await pick(page, 'dispatch_history.csv', text || dispatchCsv);
    for (const [n, id] of Object.entries(o.match || {})) await page.locator('#importUnmatched li', { hasText: n }).locator('select').selectOption(id);
    await page.click('#importOk');
    await closed(page, 'importDlg');
    await settle(page);
  }
  const dc = await t.fresh();
  const dp = dc.page;
  await t.open(dp);
  await goSchedule(dp, 'dispatch');
  check('dispatch history shows an empty state before the first import', await dp.locator('#dispatchEmpty').isVisible() && await dp.locator('#dispatchClear').isHidden() && (await dp.evaluate(() => CrmSchedule.dispatchStats(Store.todayISO()) === null && CrmSchedule.lastDispatch('x') === '')));

  // import dialog
  await pick(dp, 'dispatch_history.csv', dispatchCsv);
  const kind = await dp.locator('#importKind').evaluate(s => s.options[s.selectedIndex].text);
  const sum = await dp.locator('#importSummary').innerText();
  check('dispatch history import recognises Date, Customer, Part Code, Quantity, Slip Type', kind === 'Dispatch history' && /7 rows read · 7 kept · 0 skipped/.test(sum) && await dp.locator('#importOk').isEnabled() && await dp.locator('#importAsOf').isHidden(), kind + ' ' + sum);
  check('the import dialog lists the customer it cannot match', (await dp.locator('#importUnmatched li').count()) === 1 && (await dp.locator('#importUnmatched li').innerText()).includes('Mystery Imaginary Works') && /6 matched to customers · 1 not matched/.test(sum), sum);
  check('part codes like "VX1002 M" are accepted without a warning', await dp.locator('#importWarn').isHidden());
  await dp.click('#importCancel');
  // problems
  await pick(dp, 'wrong.csv', 'Party,Amount,Days\nA,1,2\n');
  const werr = await dp.locator('#importErr').innerText();
  check('dispatch import error lists the missing columns and blocks import', /Missing: .*Date.*Part Code.*Quantity.*Slip Type/.test(werr) && /Columns found in your file: Party, Amount, Days/.test(werr) && await dp.locator('#importOk').isDisabled(), werr);
  await dp.setInputFiles('#importFile', t.csvFile('bad.csv', HEAD + '\n' + dayOf(-1) + ',' + ZF + ',VX1001,12a,' + DISP + '\n' + dayOf(-1) + ',' + ZF + ',VX1001,5,' + DISP + '\n'));
  await dp.waitForSelector('#importSummary li');
  check('a bad quantity blocks the import and names the row', /Row 2: "12a" in Quantity is not a whole number/.test(await dp.locator('#importSummary').innerText()) && await dp.locator('#importOk').isDisabled());
  await dp.setInputFiles('#importFile', t.csvFile('odd.csv', HEAD + '\n' + dayOf(-1) + ',' + ZF + ',hello world,5,' + DISP + '\n' + dayOf(-1) + ',' + ZF + ',VX1001,,' + DISP + '\n,' + ZF + ',VX1001,5,' + DISP + '\n'));
  await dp.waitForSelector('#importWarn:not([hidden])');
  check('an unusual part code is a warning, blank date or quantity rows are skipped with the reason, and the import is still allowed',
    /looks unusual \(for example hello world\)/.test(await dp.locator('#importWarn').innerText()) && /3 rows read · 1 kept · 2 skipped \(blank quantity, blank date\)/.test(await dp.locator('#importSummary').innerText()) && await dp.locator('#importOk').isEnabled(), await dp.locator('#importSummary').innerText());
  await dp.click('#importCancel');

  await importDispatch(dp);
  const meta = await dp.evaluate(() => Store.doc('dispatch_meta').get());
  check('"data through" uses the latest date even when rows are out of order', meta.lastDate === dayOf(-2) && meta.firstDate === dayOf(-100) && meta.rows === 7 && meta.slipTypes.join() === DISP + ',' + JOB &&
    (await dp.locator('#dispatchThrough').innerText()) === 'Data through ' + human(dayOf(-2)), JSON.stringify(meta) + await dp.locator('#dispatchThrough').innerText());
  check('the notice says the import finished', /Imported 7 rows from Dispatch history/.test(await dp.locator('#notice').innerText()));

  // by customer
  const crow = (id) => dp.locator('#dispatchByCustomer tbody tr[data-id="' + id + '"]');
  const cells = async (id) => crow(id).locator('td').allInnerTexts();
  const zfc = await cells(ZFID), nrc = await cells(NRID);
  check('by-customer view shows last dispatch and 30/90-day quantities',
    zfc[1] === human(dayOf(-5)) && zfc[2] === '70' && zfc[3] === '90' && zfc[4] === '2' && /^4 \(1 jobwork\)$/.test(zfc[5]) && nrc[1] === human(dayOf(-2)) && nrc[2] === '105' && nrc[3] === '105' && /^2 \(1 jobwork\)$/.test(nrc[5]), JSON.stringify([zfc, nrc]));
  check('the reference date is shown in words (today, because the data is recent)', (await dp.locator('#dispatchRef').innerText()) === 'Measured from today, ' + human(t0) + '.' && (await dp.inputValue('#dmeasure')) === 'today');
  check('a customer that is not matched is listed with a "Not matched" tag', (await dp.locator('#dispatchByCustomer tbody tr', { hasText: 'Mystery Imaginary Works' }).locator('.sch-nomatch').count()) === 1);
  check('customers are sorted by newest dispatch first', (await dp.locator('#dispatchByCustomer tbody tr[data-key]').first().getAttribute('data-id')) === NRID);
  await crow(ZFID).locator('.sch-tog').click();
  const exp = await dp.locator('.sch-exp').innerText();
  check('a customer row expands to its parts, jobwork shown as jobwork', /VX1001/.test(exp) && /VX1002 M/.test(exp) && /Jobwork/.test(exp) && /Dispatch/.test(exp) && (await dp.locator('.sch-tog').first().getAttribute('aria-expanded')) !== null, exp);
  check('the lastDispatch contract returns the newest date for a customer', (await dp.evaluate((id) => CrmSchedule.lastDispatch(id), ZFID)) === dayOf(-5) && (await dp.evaluate(() => CrmSchedule.lastDispatch('force-motors-limited'))) === '');
  const ds = await dp.evaluate(() => CrmSchedule.dispatchStats(Store.todayISO()));
  check('dispatchStats gives slips, pieces and customers in 30 days and the idle customers', ds.dataThrough === dayOf(-2) && ds.slips30 === 4 && ds.qty30 === 175 && ds.customers30 === 2 && ds.noDispatch90.length === 40 && ds.noDispatch90.indexOf(ZFID) === -1, JSON.stringify(ds).slice(0, 200));

  // by part and month
  await dp.click('#dv-part');
  const partRows = await dp.locator('#dispatchByPart tbody tr').evaluateAll(trs => trs.map(r => ({ part: r.dataset.part, cells: Array.from(r.querySelectorAll('td')).map(c => c.innerText) })));
  const partSum = partRows.reduce((s, r) => s + Number(r.cells[5].replace(/,/g, '')), 0);
  check('by-part view and month totals add up to the file', partRows.length === 3 && partSum === TOTAL && partRows[0].part === 'VX2050' && partRows[0].cells[5] === '100' && partRows.find(r => r.part === 'VX1001').cells[1] === '2' && partRows.find(r => r.part === 'VX1002 M').cells[6] === 'Jobwork' && partRows.find(r => r.part === 'VX1001').cells[6] === 'Dispatch', JSON.stringify(partRows));
  await dp.click('#dv-month');
  const mtexts = await dp.locator('.sch-mtext').allInnerTexts();
  const monthSum = mtexts.reduce((s, x) => s + Number(x.split(' pcs')[0].replace(/,/g, '')), 0);
  const slipSum = mtexts.reduce((s, x) => s + Number((/· (\d+) slip/.exec(x) || [0, 0])[1]), 0);
  check('month totals add up to the file in pieces and in slips', monthSum === TOTAL && slipSum === spec.length && (await dp.locator('.sch-mbtn').count()) >= 4, JSON.stringify(mtexts));
  check('month totals show jobwork separately', mtexts.some(x => /jobwork \d+ pcs/.test(x)));
  const pick1 = ymOf(dayOf(-5)), expectQty = spec.filter(r => ymOf(r[0]) === pick1).reduce((s, r) => s + r[3], 0);
  await dp.locator('.sch-mbtn[data-ym="' + pick1 + '"]').click();
  check('clicking a month bar filters the lists to that month', (await dp.locator('.sch-mbtn[data-ym="' + pick1 + '"]').getAttribute('aria-pressed')) === 'true' && !(await dp.locator('#schPane-dispatch .extra-chip').isHidden()));
  await dp.click('#dv-part');
  const monthPartSum = (await dp.locator('#dispatchByPart tbody tr').evaluateAll(trs => trs.map(r => r.querySelectorAll('td')[5].innerText))).reduce((s, x) => s + Number(x.replace(/,/g, '')), 0);
  check('the by-part list for that month adds up to the month', monthPartSum === expectQty, monthPartSum + ' vs ' + expectQty);
  await t.reload(dp);
  await goSchedule(dp);
  check('view, month filter and sub-view survive a refresh', (await dp.locator('#dv-part').getAttribute('aria-pressed')) === 'true' && !(await dp.locator('#schPane-dispatch .extra-chip').isHidden()) && (await dp.locator('#dispatchByPart tbody tr').count()) > 0);
  await dp.click('#schPane-dispatch .extra-x');
  await dp.click('#dv-customer');

  // search and date range
  await dp.fill('#dq', 'vx2050');
  check('search narrows the dispatch list by part code', (await dp.locator('#dispatchByCustomer tbody tr[data-key]').count()) === 1 && (await dp.locator('#dispatchByCustomer tbody tr[data-key]').first().getAttribute('data-id')) === NRID);
  await dp.fill('#dq', '');
  await dp.fill('#dto', dayOf(-30));
  check('the date range limits the dispatch rows', (await cells(ZFID))[2] === '0' && (await dp.locator('#dispatchByCustomer tbody tr[data-key]').count()) === 2, JSON.stringify(await cells(ZFID)));
  await dp.fill('#dto', '');

  // slip-type chips
  const chips = await dp.locator('.dslip').allInnerTexts();
  check('slip-type chips are built from the data and all start on', chips.join() === DISP + ',' + JOB && (await dp.locator('.dslip[aria-pressed="true"]').count()) === 2, chips.join());
  await dp.locator('.dslip', { hasText: 'Jobwork' }).click();
  const zfNoJob = await cells(ZFID);
  check('slip-type chips filter and survive a refresh', zfNoJob[2] === '40' && /^3$/.test(zfNoJob[5]) && (await dp.locator('.dslip', { hasText: 'Jobwork' }).getAttribute('aria-pressed')) === 'false', JSON.stringify(zfNoJob));
  await t.reload(dp);
  await goSchedule(dp);
  check('the unticked slip type stays off after a refresh', (await dp.locator('.dslip', { hasText: 'Jobwork' }).getAttribute('aria-pressed')) === 'false' && (await cells(ZFID))[2] === '40', [await dp.locator('.dslip', { hasText: 'Jobwork' }).getAttribute('aria-pressed'), JSON.stringify(await cells(ZFID)), await dp.evaluate(() => JSON.stringify(App.view('schedule')))].join());
  await dp.locator('.dslip', { hasText: 'Jobwork' }).click();

  // unmatched names matched by hand
  check('unmatched dispatch customers are listed with a choice', (await dp.locator('#dispatchUnmatched li').count()) === 1 && /1 customer name is not matched/.test(await dp.locator('#dispatchUnmatched h3').innerText()));
  await dp.locator('#dispatchUnmatched select').selectOption('s-k-traders');
  await dp.locator('#dispatchUnmatched button').click();
  await settle(dp);
  check('unmatched dispatch customers can be matched by hand and are remembered',
    (await dp.locator('#dispatchUnmatched').isHidden()) && (await cells('s-k-traders'))[1] === human(dayOf(-60)) && (await dp.evaluate(() => CrmSchedule.lastDispatch('s-k-traders'))) === dayOf(-60) && (await dp.locator('#dispatchByCustomer .sch-nomatch').count()) === 0);
  await t.reload(dp);
  await goSchedule(dp);
  check('the match survives a refresh and the next import lists nothing to match', (await cells('s-k-traders')).length === 6 && await (async () => { await pick(dp, 'again.csv', dispatchCsv); const un = await dp.locator('#importUnmatched li').count(); const s = await dp.locator('#importSummary').innerText(); await dp.click('#importCancel'); return un === 0 && /7 matched to customers · 0 not matched/.test(s); })());

  // re-import replaces
  await importDispatch(dp, csvOf([[dayOf(-1), ZF, 'VX9999', 3, DISP]]));
  check('a new import replaces the dispatch history', (await dp.evaluate(() => Store.col('dispatches').all().length)) === 1 && (await dp.locator('#dispatchByCustomer tbody tr[data-key]').count()) === 1 && (await dp.evaluate(() => Store.doc('dispatch_meta').get().rows)) === 1);
  await importDispatch(dp);

  // the hint on a typed order
  await goSchedule(dp, 'orders');
  await addOrder(dp, { cust: ZF, no: 'PO-hint', code: 'VX1001', qty: 30, promised: dayOf(4) });
  await addOrder(dp, { cust: ZF, no: 'PO-nohint', code: 'VX1001', qty: 90, promised: dayOf(4) });
  await addOrder(dp, { cust: NR, no: 'PO-other', code: 'VX1001', qty: 1, promised: dayOf(4) });
  const created = await dp.evaluate(() => new Date(Store.col('orders').all()[0].created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  check('an order made today only looks dispatched from slips dated today or later', created === t0 && (await dp.locator('.sch-hint').count()) === 0);
  await goSchedule(dp, 'dispatch');
  await importDispatch(dp, csvOf(spec.concat([[t0, ZF, 'vx1001', 50, DISP]])));
  await goSchedule(dp, 'orders');
  const hint = dp.locator('#orderRows tr', { hasText: 'PO-hint' }).locator('.sch-hint');
  check('"looks dispatched" hint appears for the same customer and part with enough quantity', (await hint.count()) === 1 && /^Looks dispatched on \d+ [A-Z][a-z]{2}: mark dispatched\?$/.test(await hint.innerText()) &&
    (await dp.locator('#orderRows tr', { hasText: 'PO-nohint' }).locator('.sch-hint').count()) === 0 && (await dp.locator('#orderRows tr', { hasText: 'PO-other' }).locator('.sch-hint').count()) === 0, await hint.innerText());
  check('the hint changes nothing until it is clicked', (await dp.evaluate(() => Store.col('orders').all().filter(o => o.order_no === 'PO-hint')[0].status)) === 'Open');
  await t.reload(dp);
  await goSchedule(dp);
  check('the hint is still only a hint after a refresh', (await dp.locator('.sch-hint').count()) === 1 && (await dp.evaluate(() => Store.col('orders').all().every(o => o.status === 'Open'))));
  await dp.locator('.sch-hint').click();
  await settle(dp);
  const hinted = await dp.evaluate(() => Store.col('orders').all().find(o => o.order_no === 'PO-hint'));
  check('"looks dispatched" hint marks dispatched only when clicked', hinted.status === 'Dispatched' && hinted.dispatched === t0 && (await dp.locator('.sch-hint').count()) === 0 && (await dp.evaluate(() => Store.col('orders').all().filter(o => o.status === 'Open').length)) === 2);
  await t.reload(dp);
  await goSchedule(dp);
  check('the dispatched order stays dispatched after a refresh', (await dp.evaluate(() => Store.col('orders').all().find(o => o.order_no === 'PO-hint').status)) === 'Dispatched');

  // customers tab (A2)
  const a2 = await dp.evaluate(() => !/arrives with the next Customers update/.test(String(window.CrmCustomers.openEdit)));
  if (!a2) t.skip('Customers tab shows Last dispatch', 'needs A2');
  else {
    await t.tab(dp, 'list');
    const rt = await t.row(dp, 'ZF STEERING').innerText();
    check('Customers tab shows Last dispatch', rt.includes('Last dispatch') && rt.includes(human(t0)), rt);
  }

  // backup
  const bk = await dp.evaluate(() => JSON.stringify(Store.exportBackup()));
  const lsDb = await dp.evaluate(() => localStorage.getItem('varsha-crm-localdb-v1'));
  check('dispatch history is not in the backup; typed orders are', !bk.includes('Mystery Imaginary Works') && !bk.includes('slip_type') && !bk.includes('dispatches') && bk.includes('PO-hint') && bk.includes('PO-nohint') && lsDb.includes('slip_type'));
  check('dispatch history and typed orders are not in the customers.json export', await dp.evaluate(() => { const s = JSON.stringify(Store.exportCustomersJson()); return !s.includes('PO-hint') && !s.includes('slip_type') && !s.includes('VX1001'); }));

  // clear
  await goSchedule(dp, 'dispatch');
  dp.once('dialog', d => d.dismiss());
  await dp.click('#dispatchClear');
  check('Clear dispatch history does nothing when the confirm is dismissed', (await dp.evaluate(() => Store.col('dispatches').all().length)) === 8);
  dp.once('dialog', d => d.accept());
  await dp.click('#dispatchClear');
  await dp.waitForSelector('#dispatchEmpty:not([hidden])');
  await t.reload(dp);
  check('Clear dispatch history empties it after confirm', (await dp.evaluate(() => Store.col('dispatches').all().length === 0 && Store.doc('dispatch_meta').get() === null && CrmSchedule.dispatchStats(Store.todayISO()) === null)) && await dp.locator('#dispatchEmpty').isVisible());
  check('typed orders are not touched by clearing dispatch history', (await dp.evaluate(() => Store.col('orders').all().length)) === 3);

  // old data: Measure from switches to the last dispatch in the file by default
  const oldc = await t.fresh();
  const op2 = oldc.page;
  await t.open(op2);
  await goSchedule(op2, 'dispatch');
  const shifted = spec.map(r => [istToday(-(Math.round((new Date(t0) - new Date(r[0])) / 86400000) + 60)), r[1], r[2], r[3], r[4]]);
  const newest = shifted.map(r => r[0]).sort().pop();
  await importDispatch(op2, csvOf(shifted));
  const stale = await op2.locator('#dispatchThrough').evaluate(e => ({ text: e.innerText, color: getComputedStyle(e).color }));
  check('old data shows an orange "N days old" note beside Data through', stale.color === ORANGE && /^Data through .* · 62 days old$/.test(stale.text), JSON.stringify(stale));
  check('Measure from defaults to the last dispatch in the file when it is over 30 days old, and says so', (await op2.locator('#dispatchRef').innerText()) === 'Measured from ' + human(newest) + ', the last dispatch in the file.' && (await op2.inputValue('#dmeasure')) === 'data');
  const zfOld = await op2.locator('#dispatchByCustomer tbody tr[data-id="' + ZFID + '"] td').allInnerTexts();
  check('the 30/90-day columns follow the chosen reference date', zfOld[2] === '70' && zfOld[3] === '90', JSON.stringify(zfOld));
  await op2.selectOption('#dmeasure', 'today');
  check('the user can switch to Today and the words follow', (await op2.locator('#dispatchRef').innerText()) === 'Measured from today, ' + human(t0) + '.' && (await op2.locator('#dispatchByCustomer tbody tr[data-id="' + ZFID + '"] td').nth(2).innerText()) === '0');
  await t.reload(op2);
  await goSchedule(op2);
  check('the Measure from choice survives a refresh', (await op2.inputValue('#dmeasure')) === 'today' && /^Measured from today/.test(await op2.locator('#dispatchRef').innerText()));

  // 375px
  const dph = await t.fresh({ viewport: { width: 375, height: 760 } });
  const pp = dph.page;
  await t.open(pp);
  await goSchedule(pp, 'dispatch');
  await pick(pp, 'dispatch_history.csv', dispatchCsv);
  const dimsDlg = await pp.evaluate(() => { const d = document.getElementById('importDlg').getBoundingClientRect(); return { w: document.documentElement.scrollWidth, l: d.left, r: d.right }; });
  check('no sideways scroll at 375px with the dispatch import dialog open', dimsDlg.w <= 375 && dimsDlg.l >= 0 && dimsDlg.r <= 375, JSON.stringify(dimsDlg));
  await pp.click('#importCancel');
  await importDispatch(pp);
  await pp.locator('.sch-tog').first().click();
  const views = {};
  for (const v of ['customer', 'part', 'month']) { await pp.click('#dv-' + v); views[v] = await noScroll(pp); }
  check('no sideways scroll on the dispatch views at 375px', views.customer && views.part && views.month, JSON.stringify(views));
  await goSchedule(pp, 'orders');
  await addOrder(pp, { cust: ZF, no: 'PO-phone', code: 'VX1001', part: 'A long part description for a narrow phone screen', qty: 100, promised: dayOf(-2) });
  check('no sideways scroll on the orders list at 375px', await noScroll(pp));
  await pp.click('#orderNew');
  const odl = await pp.evaluate(() => { const d = document.getElementById('orderDlg').getBoundingClientRect(); return { w: document.documentElement.scrollWidth, l: d.left, r: d.right, b: d.bottom, vh: innerHeight }; });
  check('no sideways scroll at 375px with the order dialog open', odl.w <= 375 && odl.l >= 0 && odl.r <= 375 && odl.b <= odl.vh + 1, JSON.stringify(odl));
};
