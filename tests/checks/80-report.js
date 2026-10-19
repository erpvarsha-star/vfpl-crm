// A8 checks: Weekly sales review. Synthetic data only; the other modules' stats() are replaced by fakes in the page,
// so this file passes without them (after the merge the fakes simply override the real stats functions).
module.exports = async (t) => {
  const { check, istToday } = t;
  const D = n => istToday(n);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dm = iso => { const [, m, d] = iso.split('-'); return (+d) + ' ' + MON[+m - 1]; };
  const full = iso => { const [y, m, d] = iso.split('-'); return (+d) + ' ' + MON[+m - 1] + ' ' + y; };
  const RED = 'rgb(180, 35, 24)', ORANGE = 'rgb(180, 83, 9)';

  const { page } = await t.fresh();
  await t.open(page);

  /* ---------- helpers that run inside the page ---------- */
  const seed = (o) => page.evaluate((o) => {
    const today = Store.todayISO(), add = n => Store.addDays(today, n);
    const ids = Store.customers().map(c => c.id), name = i => Store.get(ids[i]).name;
    const out = { ids, overdue: [], due: [], risk: [], contactNames: [] };
    for (let i = 0; i < o.overdue; i++) Store.setFollowUp(ids[i], add(-(i + 1)));
    for (let i = o.overdue - 1; i >= 0; i--) out.overdue.push(name(i));                       // oldest first
    [[20, 0], [21, 3], [22, 6], [23, 8]].slice(0, o.due).forEach(([i, n]) => { Store.setFollowUp(ids[i], add(n)); if (n <= 7) out.due.push(name(i)); });
    [[30, 'Call', -10], [31, null, 0], [32, 'Call', -40]].forEach(([i, type, n]) => {
      Store.setStatus(ids[i], 'At risk');
      if (type) Store.addLog(ids[i], { type, note: 'risk touch', at: add(n) });
    });
    out.risk = [name(31), name(32), name(30)];                                                // never, oldest, newer
    for (let i = 0; i < o.contacts; i++) {
      const note = i === 1 ? 'Call back 9820012345 or buyer@example.com' : 'Discussed order ' + i;
      Store.addLog(ids[i], { type: i % 2 ? 'Visit' : 'Call', note, at: add(-(i % 7)) });
      out.contactNames.push(name(i));
    }
    Store.addLog(ids[25], { type: 'Call', note: 'OLD-NOTE-TEXT', at: add(-9) });
    Store.addLog(ids[26], { type: 'Note', note: 'ONLY-A-NOTE-TEXT', at: add(-1) });
    out.notContacted = [name(25), name(26)];
    Store.col('visits').insert({ customer_id: ids[27], type: 'Visit', date: add(-2), time: '', note: 'Visit note V1', done: true, done_at: add(-2), log_id: null });
    Store.col('visits').insert({ customer_id: ids[28], type: 'Call', date: add(-1), time: '', note: 'Call note V2', done: true, done_at: add(-1), log_id: null });
    out.visitNames = [name(27), name(28)];
    for (let i = 0; i < o.moves; i++) {
      const id = 'rfq-in-' + i;
      Store.col('rfqs').insert({ id, rfq_no: 'Q-IN-' + i, customer_name: 'Imaginary Co ' + i, received: add(-(i % 6)), stage: 'Quoted' });
      Store.col('rfq_history').insert({ rfq_id: id, from: 'Received', to: 'Quoted', at: add(-(i % 6)) });
    }
    Store.col('rfqs').insert({ id: 'rfq-out', rfq_no: 'Q-OUT-1', customer_name: 'Imaginary Old Co', received: add(-30), stage: 'Quoted' });
    Store.col('rfq_history').insert({ rfq_id: 'rfq-out', from: 'Received', to: 'Quoted', at: add(-10) });
    for (let i = 0; i < o.leadOverdue; i++) Store.col('leads').insert({ id: 'lead-' + i, company: 'Zeta Lead ' + i + ' Pvt Ltd', status: 'Open', next_follow_up: add(-(20 - i)) });
    return out;
  }, o);

  const fakes = (s) => page.evaluate((s) => {
    const put = (n, m, v) => { const o = window[n] || (window[n] = {}); o[m] = () => v; };
    put('CrmMoney', 'stats', s.money === undefined ? null : s.money);
    put('CrmRfq', 'stats', s.rfq === undefined ? null : s.rfq);
    put('CrmSchedule', 'orderStats', s.orders === undefined ? null : s.orders);
    put('CrmLeads', 'stats', s.leads === undefined ? null : s.leads);
    window.__revCalls = [];
    (window.CrmRevenue || (window.CrmRevenue = {})).stats = (q) => { window.__revCalls.push(q); return s.revenue === undefined ? null : s.revenue; };
  }, s);

  const FULL = () => ({
    rfq: { total: 20, byStage: { Received: 4, Quoted: 3, Negotiated: 2, Finalised: 1, PO: 2, Sample: 0, PPAP: 1 }, quoteOverdue: 2 },
    money: { asOf: D(-1), stale: false, outstanding: 2500000, overdue: 123456, overduePct: 5, buckets: { b1_30: { amount: 50000, n: 2 }, b31_60: { amount: 40000, n: 1 }, b61_90: { amount: 20000, n: 1 }, b90: { amount: 13456, n: 1 } },
             top5: [1, 2, 3, 4, 5, 6].map(i => ({ id: 'm' + i, name: 'Imaginary Payer ' + i, overdue: 10000 * (7 - i), b90: 0 })) },
    orders: { asOf: null, stale: false, open: 6, late: 2, dueToday: 1, dueWeek: 2, onTimePct30: null },
    revenue: { fy: '2026-27', to: 'data', dataThrough: '2026-07-12', fytd: 4560000, mtd: 120000, mtdLabel: 'July 2026', excludedRelated: { n: 2, amount: 900000 }, prior: null,
               targets: { basis: 'customers', total: 10000000, actual: 4560000, pct: 46, pacePct: 60, behind: true, customers: [], segments: [] } },
    leads: { open: 9, byBucket: {}, dormant: 3, followOverdue: 4, followToday: 0, touched7: 1, converted30: 0,
             reactivate: [1, 2, 3, 4, 5, 6, 7].map(i => ({ id: 'd' + i, company: 'Dormant Prospect ' + i, lastContact: '2026-01-1' + (i % 9), category: 'Dormant >6 Mo (High Value)' })) }
  });

  const openReport = (opts) => page.evaluate((o) => { CrmReport.open(o || {}); }, opts || null);
  const isOpen = () => page.locator('#reportDlg').evaluate(d => d.open).catch(() => false);
  const closeReport = async () => { if (await isOpen()) await page.click('#repClose'); };
  const text = () => page.locator('#reportPage').innerText();
  const sec = id => page.locator('#' + id).innerText();
  const hasSec = async id => (await page.locator('#' + id).count()) > 0;

  /* ---------- the module is wired in ---------- */
  check('CrmReport exposes open and compute', await t.has(page, 'window.CrmReport && CrmReport.open && CrmReport.compute'));

  /* ---------- opens from the Dashboard and the Export tab ---------- */
  // The buttons belong to the Dashboard and Export modules. If a tab does not draw its button yet, a stand-in with the same id is added so that
  // the single delegated click handler in report.js is still tested; the real button is used whenever it exists.
  async function openViaButton(tab, id) {
    await t.tab(page, tab);
    let real = (await page.locator('#' + id).count()) > 0;
    if (!real) await page.evaluate((id) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.textContent = 'Weekly sales review'; document.querySelector('#panel-' + (id === 'weeklyReportBtn' ? 'dash' : 'export')).appendChild(b); }, id);
    await page.click('#' + id);
    await page.waitForSelector('#reportDlg[open]');
    return real;
  }
  await openViaButton('dash', 'weeklyReportBtn');
  const dashOk = await isOpen() && (await page.locator('#reportPage').isVisible());
  await closeReport();
  await openViaButton('export', 'weeklyReportBtn2');
  const exportOk = await isOpen();
  check('report opens from the Dashboard and the Export tab', dashOk && exportOk);
  check('Esc closes the report and focus returns to the opener', await (async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('reportDlg').open); await page.waitForTimeout(100); return (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'weeklyReportBtn2'; })());

  /* ---------- default range, logo, title ---------- */
  await t.tab(page, 'dash');
  await openReport();
  check('default range is the last 7 days in India time', (await page.inputValue('#repFrom')) === D(-6) && (await page.inputValue('#repTo')) === D(0) && (await page.locator('#repTo').getAttribute('max')) === D(0));
  const head = await page.locator('.rp-head').innerText();
  check('report shows the logo, title and date range',
    (await page.locator('.rp-badge img').evaluate(i => i.complete && i.naturalWidth > 0 && getComputedStyle(i.parentElement).backgroundColor === 'rgb(255, 255, 255)')) &&
    head.includes('Varsha Forgings · Weekly sales review') && head.includes('(India time)') && head.includes(dm(D(-6)) + ' – ' + full(D(0))) && head.includes('Prepared ' + full(D(0))), head);
  check('with no data every list says so and nothing crashes', /No overdue follow-ups/.test(await text()) && /No calls or visits logged/.test(await text()) && /No customers are marked At risk/.test(await text()) && /No follow-ups are overdue/.test(await text()));
  check('missing modules show a clear no-data line, and their sections are absent',
    /No data: the RFQ module is not available yet/.test(await text()) && /No data: the Leads module is not available yet/.test(await text()) &&
    /No data for: Money overdue.*Late orders.*Revenue vs target/.test(await text()) && !(await hasSec('repMoney')) && !(await hasSec('repOrders')) && !(await hasSec('repRevenue')));
  await closeReport();

  /* ---------- seed the busy week ---------- */
  const S = await seed({ overdue: 15, due: 4, contacts: 20, moves: 12, leadOverdue: 4 });
  await fakes(FULL());
  await page.evaluate(() => { window.__leadDeps = null; });
  const leadViaStore = await page.evaluate(() => {
    if (!Store.addLeadLog) return false;
    Store.addLeadLog('lead-0', { type: 'Call', note: 'lead touch', at: Store.addDays(Store.todayISO(), -2) });
    return true;
  });
  if (!leadViaStore) {
    // A1.1 (Store.addLeadLog) is not merged yet: pass a lead log row through the documented deps override instead
    await page.evaluate(() => { window.__leadDeps = { log: Store.allLog().concat([{ id: 'll1', customerId: null, leadId: 'lead-0', at: Store.addDays(Store.todayISO(), -2), type: 'Call', note: 'lead touch', createdAt: '' }]) }; });
  }
  const open = (extra) => page.evaluate((e) => { CrmReport.open(Object.assign({ deps: window.__leadDeps || undefined }, e || {})); }, extra || null);
  await open();

  /* ---------- RFQ pipeline ---------- */
  const rfq = await sec('repRfq');
  check('RFQ funnel shows every stage from the RFQ stats', rfq.includes('Received 4 → Quoted 3 → Negotiated 2 → Finalised 1 → PO 2 → Sample 0 → PPAP 1'), rfq);
  check('stage movements list only moves inside the range', /Q-IN-0/.test(rfq) && !/Q-OUT-1/.test(rfq) && /Received → Quoted/.test(rfq) && /Stage movements in this range \(12\)/.test(rfq) && /\+4 more/.test(rfq), rfq);
  check('RFQ footer counts new RFQs and shows quote overdue in words', /New RFQs in range: 12/.test(rfq) && /Quote overdue: 2/.test(rfq));
  check('quote overdue is red', (await page.locator('#repRfq .rp-red').evaluate(e => getComputedStyle(e).color)) === RED);

  /* ---------- follow-ups ---------- */
  const fol = await sec('repFollow');
  check('top of the overdue list is the oldest follow-up', fol.indexOf(S.overdue[0]) !== -1 && fol.indexOf(S.overdue[0]) < fol.indexOf(S.overdue[1]) && /Overdue follow-ups \(15\)/.test(fol));
  check('overdue list is capped at 8 with "+7 more"', (await page.locator('#repFollow ul').first().locator('li').count()) >= 9 || /\+\d+ more/.test(fol));
  check('overdue words are red and in text', await (async () => {
    const first = page.locator('#repFollow ul').first().locator('li').first();
    const span = first.locator('.rp-red');
    return /^Overdue by 15 days$/.test(await span.innerText()) && (await span.evaluate(e => getComputedStyle(e).color)) === RED;
  })());
  check('due today is orange and in words', await (async () => {
    const o = page.locator('#repFollow .rp-orange', { hasText: 'Due today' }).first();
    return (await o.count()) === 1 && (await o.evaluate(e => getComputedStyle(e).color)) === ORANGE;
  })());
  check('due in the next 7 days lists those customers, not the one 8 days away', S.due.every(n => fol.includes(n)) && /Due in the next 7 days \(3\)/.test(fol) && !fol.includes('Due ' + dm(D(8))));

  /* ---------- calls and visits ---------- */
  const con = await sec('repContact');
  const calls = 10 + 1, visits = 10 + 1;      // 20 log entries (10 calls, 10 visits) + one done call and one done visit with no log entry
  check('calls and visits this week are counted with customer names', new RegExp('Calls ' + calls + ' · Visits ' + visits + ' · Emails 0 · Telegram 0 · ' + (calls + visits) + ' logged').test(con) && S.visitNames.every(n => con.includes(n)) && S.contactNames.slice(0, 10).every(n => con.includes(n)), con);
  check('a Note entry and a contact outside the range are not counted', S.notContacted.every(n => !con.includes(n)));
  check('note text is hidden by default', !/Discussed order|Visit note V1|Call note V2|ONLY-A-NOTE|OLD-NOTE/.test(await text()) && (await page.locator('#repNotes').isChecked()) === false);
  await page.check('#repNotes');
  const withNotes = await sec('repContact');
  check('note text shows when "Include note text" is ticked', /Discussed order 0/.test(withNotes) && /Visit note V1/.test(withNotes) && /Call note V2/.test(withNotes) && /Notes \(private\)/.test(withNotes), withNotes);
  check('notes in the range only', !/OLD-NOTE-TEXT/.test(withNotes));
  check('phone numbers and emails inside notes stay hidden without "Include contact details"', !/9820012345|buyer@example/.test(await text()));
  await page.uncheck('#repNotes');

  /* ---------- note box and contact box are never remembered ---------- */
  await page.check('#repNotes'); await page.check('#repContacts');
  await closeReport();
  await open();
  check('note text and contact boxes are unticked when reopened', !(await page.locator('#repNotes').isChecked()) && !(await page.locator('#repContacts').isChecked()) && !/Discussed order/.test(await text()));
  await page.check('#repNotes'); await page.check('#repContacts');
  await closeReport();
  await t.reload(page);
  await fakes(FULL());
  await open();
  check('the boxes are unticked after a refresh too', !(await page.locator('#repNotes').isChecked()) && !(await page.locator('#repContacts').isChecked()));

  /* ---------- no emails or phones without "Include contact details" ---------- */
  await page.evaluate((ids) => { Store.saveCustomer(ids[0], { phone: '+91 98200 55555', contact: 'Meera Test' }); }, S.ids);
  await page.evaluate(() => CrmReport.open({ deps: window.__leadDeps || undefined }));
  await page.check('#repNotes');
  const plain = await text();
  check('report has no email or phone unless "Include contact details" is ticked', !/98200|55555|9820012345|@|\+91/.test(plain) && /Meera Test/.test(plain), (plain.match(/.{20}(98200|@).{20}/) || [''])[0]);
  await page.check('#repContacts');
  const contactsText = await text();
  check('"Include contact details" adds phones to follow-ups and actions', /98200 55555/.test(await sec('repFollow')) && /98200 55555/.test(await sec('repActions')), await sec('repActions'));
  check('contact details also reveal the phone number written in a note', /9820012345/.test(contactsText));
  await page.uncheck('#repContacts'); await page.uncheck('#repNotes');
  check('unticking contact details hides them again', !/98200/.test(await text()));

  /* ---------- at risk ---------- */
  const risk = await sec('repRisk');
  check('at-risk list matches status At risk, never contacted first', /At-risk customers \(3\)/.test(risk) && risk.indexOf(S.risk[0]) < risk.indexOf(S.risk[1]) && risk.indexOf(S.risk[1]) < risk.indexOf(S.risk[2]) && /last contacted never/.test(risk), risk);

  /* ---------- top 5 actions ---------- */
  const act = await page.locator('#repActions ol li').allInnerTexts();
  check('top 5 actions are overdue follow-ups, oldest first', act.length === 5 && S.overdue.slice(0, 5).every((n, i) => act[i].includes('Call ' + n) && act[i].includes('follow-up overdue by ' + (15 - i) + ' days')), JSON.stringify(act));
  check('the action rule is printed under the list', /Actions = overdue follow-ups, oldest first, then the next ones due/.test(await sec('repActions')));
  check('actions are red where overdue', (await page.locator('#repActions .rp-red').first().evaluate(e => getComputedStyle(e).color)) === RED);

  /* ---------- money, late orders, revenue ---------- */
  const money = await sec('repMoney');
  check('money overdue shows total, aging split and the top 5 only', /Overdue ₹1\.23 L/.test(money) && /1–30 days ₹50,000/.test(money) && /Imaginary Payer 1/.test(money) && /Imaginary Payer 5/.test(money) && !/Imaginary Payer 6/.test(money) && /\+1 more/.test(money), money);
  check('money overdue word is red', (await page.locator('#repMoney .rp-red').first().evaluate(e => getComputedStyle(e).color)) === RED);
  await page.evaluate(() => {
    const today = Store.todayISO(), ids = Store.customers().map(c => c.id);
    Store.col('orders').insert({ customer_id: ids[3], order_no: 'PO-LATE-1', part_code: 'VF1050', promised: Store.addDays(today, -4), status: 'Open' });
    Store.col('orders').insert({ customer_id: ids[4], order_no: 'PO-LATE-2', part_code: 'VF1060', promised: Store.addDays(today, -9), status: 'Open' });
    Store.col('orders').insert({ customer_id: ids[5], order_no: 'PO-DONE-1', promised: Store.addDays(today, -9), status: 'Dispatched' });
  });
  await open();
  const ord = await sec('repOrders');
  check('late orders show the count in red and the late rows, oldest first', /Late orders: 2/.test(ord) && ord.indexOf('PO-LATE-2') < ord.indexOf('PO-LATE-1') && /Late by 9 days/.test(ord) && !/PO-DONE-1/.test(ord), ord);
  check('late orders text is red', (await page.locator('#repOrders .rp-red').first().evaluate(e => getComputedStyle(e).color)) === RED);
  const rev = await sec('repRevenue');
  check('revenue shows FYTD, % of target, "Behind pace" in red, and data through', /FY 2026-27 to date ₹45\.60 L/.test(rev) && /46% of target/.test(rev) && /Behind pace: 46% of target, 60% expected/.test(rev) && /Data through 12 Jul 2026/.test(rev), rev);
  check('behind pace is red', (await page.locator('#repRevenue .rp-red').first().evaluate(e => getComputedStyle(e).color)) === RED);
  check('revenue says "Excludes 2 related parties" by default', /Excludes 2 related parties/.test(rev));
  const foot = await page.locator('.rp-foot').innerText();
  check('footer gives the data-as-of dates', foot.includes('Money as of ' + full(D(-1))) && foot.includes('Revenue data through 12 Jul 2026'), foot);
  const calls0 = await page.evaluate(() => window.__revCalls.slice(-1)[0]);
  check('revenue asks for related parties to be excluded by default', calls0 && calls0.includeRelated === false);
  await closeReport();
  await page.evaluate(() => App.setView('dash', Object.assign({}, App.view('dash'), { incRelated: true })));
  await open();
  const rev2 = await sec('repRevenue');
  const calls1 = await page.evaluate(() => window.__revCalls.slice(-1)[0]);
  check('revenue section follows the related-party switch and says when they are excluded', calls1.includeRelated === true && !/Excludes/.test(rev2) && /Excludes 2 related parties/.test(rev), JSON.stringify(calls1));
  await closeReport();
  await page.evaluate(() => App.setView('dash', Object.assign({}, App.view('dash'), { incRelated: false })));
  await open();

  /* ---------- leads ---------- */
  const leads = await sec('repLeads');
  check('leads touched this week are listed by company', /Leads touched this week \(1\)/.test(leads) && /Zeta Lead 0 Pvt Ltd/.test(leads.split('Lead follow-ups')[0]), leads);
  check('dormant leads to reactivate shows up to 5', (leads.match(/Dormant Prospect \d/g) || []).length === 5 && /\+2 more/.test(leads) && !/Dormant Prospect 6/.test(leads), leads);
  check('lead follow-ups overdue is a red count from the Leads stats', /Lead follow-ups overdue: 4/.test(leads) && (await page.locator('#repLeads .rp-red').first().evaluate(e => getComputedStyle(e).color)) === RED);

  /* ---------- headline ---------- */
  const boxes = await page.locator('.rp-boxes').innerText();
  check('headline boxes show the counts and omit nothing that has data', /15\s*\n?\s*OVERDUE FOLLOW-UPS/i.test(boxes) && /RFQs moved/i.test(boxes) && /Late orders/i.test(boxes) && /Revenue FYTD · 46% of target/i.test(boxes), boxes);

  /* ---------- Hide amounts ---------- */
  await closeReport();
  await page.evaluate(() => App.setHideAmounts(true));
  await open();
  const hidden = await text();
  check('Hide amounts masks report amounts', !/₹\d|\d\.\d\d (L|Cr)/.test(hidden) && /₹ •••/.test(await sec('repMoney')) && (await page.locator('#reportPage [aria-label="amount hidden"]').count()) >= 5, hidden.slice(0, 200));
  await closeReport();
  await page.evaluate(() => App.setHideAmounts(false));

  /* ---------- sections that depend on module data disappear when the data does ---------- */
  await fakes({ rfq: FULL().rfq, money: null, orders: null, revenue: null, leads: null });
  await open();
  const t2 = await text();
  check('money, late orders and revenue sections appear only when imported', !(await hasSec('repMoney')) && !(await hasSec('repOrders')) && !(await hasSec('repRevenue')) && /No data for: Money overdue.*Late orders.*Revenue vs target/.test(t2) && !/Late orders/i.test(await page.locator('.rp-boxes').innerText()));
  await closeReport();
  await fakes(FULL());

  /* ---------- one A4 page ---------- */
  await closeReport();
  const { page: wide } = await t.fresh({ viewport: { width: 794, height: 1200 } });
  await t.open(wide);
  const mk = (pg) => ({
    seed: (o) => pg.evaluate(SEED_FN, o),
    fakes: (s) => pg.evaluate(FAKES_FN, s)
  });
  const w = mk(wide);
  await w.seed({ overdue: 15, due: 4, contacts: 20, moves: 12, leadOverdue: 4 });
  await w.fakes(FULL());
  await wide.evaluate(() => CrmReport.open());
  await wide.check('#repNotes'); await wide.check('#repContacts');
  const dims = await wide.evaluate(() => {
    const p = document.getElementById('reportPage'), body = p.firstChild, cs = getComputedStyle(p);
    return { page: p.getBoundingClientRect().height, width: p.getBoundingClientRect().width, content: body.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), warn: !document.getElementById('repWarn').hidden };
  });
  check('report fits one A4 page', dims.page <= 1123 && dims.content <= 1123 && dims.width > 780 && dims.width <= 794, JSON.stringify(dims));
  check('when lists are shortened to fit, a note says so', dims.warn || dims.content < 1000);

  /* ---------- print ---------- */
  await wide.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await wide.click('#repPrint');
  check('Print / Save as PDF adds the print class and calls print', (await wide.evaluate(() => window.__printed)) === 1 && (await wide.evaluate(() => document.body.classList.contains('print-report'))));
  await wide.emulateMedia({ media: 'print' });
  const pr = await wide.evaluate(() => ({
    app: getComputedStyle(document.getElementById('app')).display,
    live: getComputedStyle(document.getElementById('live')).display,
    page: getComputedStyle(document.getElementById('reportPage')).display,
    bar: getComputedStyle(document.querySelector('.rp-bar')).display,
    dlg: getComputedStyle(document.getElementById('reportDlg')).display,
    title: document.title
  }));
  check('print shows only the report', pr.app === 'none' && pr.live === 'none' && pr.page !== 'none' && pr.bar === 'none' && pr.dlg === 'block', JSON.stringify(pr));
  check('the print title names the report and range', /Varsha weekly sales review/.test(pr.title) && pr.title.includes(dm(D(-6))));
  const pdf = await wide.pdf({ preferCSSPageSize: true, printBackground: true });
  const raw = pdf.toString('latin1');
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(raw);
  check('printed PDF is exactly one A4 page', pages === 1 && box && Math.abs(+box[1] - 595.3) < 2 && Math.abs(+box[2] - 841.9) < 2, 'pages=' + pages + ' box=' + (box ? box[1] + 'x' + box[2] : 'none'));
  await wide.emulateMedia({ media: null });
  await wide.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  check('the print class and title are removed after printing', !(await wide.evaluate(() => document.body.classList.contains('print-report'))) && !/Varsha weekly sales review/.test(await wide.title()));

  /* ---------- date range: chosen range survives a refresh ---------- */
  const from = D(-20), to = D(-14);
  await open();
  await page.fill('#repFrom', from);
  await page.fill('#repTo', to);
  check('choosing a date range redraws the report for that range', (await page.locator('#repRangeText').innerText()).startsWith(full(from).replace(/ \d{4}$/, '')) && !/Q-IN-0/.test(await sec('repRfq')), await page.locator('#repRangeText').innerText());
  check('only the Q-OUT move is inside the older range', /Q-OUT-1/.test(await sec('repRfq')));
  check('a saved (non-default) range shows a "Last 7 days" button and a note', (await page.locator('#repLast7').isVisible()) && (await page.locator('#repSaved').isVisible()));
  await closeReport();
  await t.reload(page);
  await fakes(FULL());
  await openReport();
  check('the chosen date range survives a refresh', (await page.inputValue('#repFrom')) === from && (await page.inputValue('#repTo')) === to);
  await page.click('#repLast7');
  check('"Last 7 days" resets the range', (await page.inputValue('#repFrom')) === D(-6) && (await page.inputValue('#repTo')) === D(0) && !(await page.locator('#repLast7').isVisible()));
  await closeReport();
  await t.reload(page);
  await openReport();
  check('the reset range survives a refresh (back to the last 7 days)', (await page.inputValue('#repFrom')) === D(-6) && (await page.inputValue('#repTo')) === D(0));
  await page.fill('#repFrom', D(0)); await page.fill('#repTo', D(-3));
  check('From after To shows an error and keeps the old range', /From must be on or before To/.test(await page.locator('#repErr').innerText()) && (await page.locator('#repRangeText').innerText()).startsWith(dm(D(-6))));
  await closeReport();
  await t.reload(page);
  await openReport();
  check('an invalid range is never saved', (await page.inputValue('#repFrom')) === D(-6));
  await closeReport();

  /* ---------- 375px ---------- */
  const { page: phone } = await t.fresh({ viewport: { width: 375, height: 700 } });
  await t.open(phone);
  const m = mk(phone);
  await m.seed({ overdue: 15, due: 4, contacts: 20, moves: 12, leadOverdue: 4 });
  await m.fakes(FULL());
  await phone.evaluate(() => CrmReport.open());
  await phone.check('#repNotes');
  const sc = await phone.evaluate(() => {
    const de = document.documentElement, sc = document.querySelector('.rp-scroll'), pg = document.getElementById('reportPage'), bar = document.querySelector('.rp-bar');
    return { doc: de.scrollWidth <= innerWidth, scroll: sc.scrollWidth <= sc.clientWidth, page: pg.scrollWidth <= pg.clientWidth, bar: bar.scrollWidth <= bar.clientWidth, w: pg.getBoundingClientRect().width };
  });
  check('no sideways scroll at 375px', sc.doc && sc.scroll && sc.page && sc.bar && sc.w <= 375, JSON.stringify(sc));
  check('at 375px the buttons are reachable and the report is one column', (await phone.locator('#repPrint').isVisible()) && (await phone.evaluate(() => getComputedStyle(document.querySelector('.rp-grid')).gridTemplateColumns.split(' ').length)) === 1);
  await phone.evaluate(() => { document.body.classList.add('print-report'); });
  await phone.emulateMedia({ media: 'print' });
  const pdf2 = await phone.pdf({ preferCSSPageSize: true, printBackground: true });
  check('printing from a phone-width window is still one A4 page', ((pdf2.toString('latin1').match(/\/Type\s*\/Page[^s]/g)) || []).length === 1);
  await phone.emulateMedia({ media: null });
};

/* Page-side functions shared by the extra pages (the main page defines its own copies above). */
function SEED_FN(o) {
  const today = Store.todayISO(), add = n => Store.addDays(today, n);
  const ids = Store.customers().map(c => c.id);
  for (let i = 0; i < o.overdue; i++) Store.setFollowUp(ids[i], add(-(i + 1)));
  [[20, 0], [21, 3], [22, 6], [23, 8]].slice(0, o.due).forEach(([i, n]) => Store.setFollowUp(ids[i], add(n)));
  [[30, 'Call', -10], [31, null, 0], [32, 'Call', -40]].forEach(([i, type, n]) => {
    Store.setStatus(ids[i], 'At risk');
    if (type) Store.addLog(ids[i], { type, note: 'risk touch', at: add(n) });
  });
  for (let i = 0; i < o.contacts; i++) Store.addLog(ids[i], { type: i % 2 ? 'Visit' : 'Call', note: 'Discussed order ' + i + ' with the buyer about the revised drawing and delivery plan', at: add(-(i % 7)) });
  Store.col('visits').insert({ customer_id: ids[27], type: 'Visit', date: add(-2), time: '', note: 'Visit note V1', done: true, done_at: add(-2), log_id: null });
  for (let i = 0; i < o.moves; i++) {
    const id = 'rfq-in-' + i;
    Store.col('rfqs').insert({ id, rfq_no: 'Q-IN-' + i, customer_name: 'Imaginary Company Number ' + i + ' Private Limited', received: add(-(i % 6)), stage: 'Quoted' });
    Store.col('rfq_history').insert({ rfq_id: id, from: 'Received', to: 'Quoted', at: add(-(i % 6)) });
  }
  for (let i = 0; i < o.leadOverdue; i++) Store.col('leads').insert({ id: 'lead-' + i, company: 'Zeta Lead ' + i + ' Pvt Ltd', status: 'Open', next_follow_up: add(-(20 - i)) });
  for (let i = 0; i < 6; i++) Store.col('orders').insert({ customer_id: ids[10 + i], order_no: 'PO-L-' + i, part_code: 'VF10' + i, promised: add(-(3 + i)), status: 'Open' });
}
function FAKES_FN(s) {
  const put = (n, m, v) => { const o = window[n] || (window[n] = {}); o[m] = () => v; };
  put('CrmMoney', 'stats', s.money === undefined ? null : s.money);
  put('CrmRfq', 'stats', s.rfq === undefined ? null : s.rfq);
  put('CrmSchedule', 'orderStats', s.orders === undefined ? null : s.orders);
  put('CrmLeads', 'stats', s.leads === undefined ? null : s.leads);
  (window.CrmRevenue || (window.CrmRevenue = {})).stats = () => (s.revenue === undefined ? null : s.revenue);
}
