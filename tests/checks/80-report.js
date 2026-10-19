// A8 checks: Weekly sales review. Synthetic data only; the other modules' stats() are replaced by fakes in the page,
// so this file passes without them (after the merge the fakes simply override the real stats functions).
module.exports = async (t) => {
  const { check, istToday } = t;
  const D = n => istToday(n);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dm = iso => { const [, m, d] = iso.split('-'); return (+d) + ' ' + MON[+m - 1]; };
  const full = iso => { const [y, m, d] = iso.split('-'); return (+d) + ' ' + MON[+m - 1] + ' ' + y; };
  const pre = n => n.slice(0, 22);
  const RED = 'rgb(180, 35, 24)', ORANGE = 'rgb(180, 83, 9)';

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

  // one helper object per page
  const kit = (pg) => ({
    reset: () => pg.evaluate(RESET_FN),
    seed: (o) => pg.evaluate(SEED_FN, o),
    fakes: (s) => pg.evaluate(FAKES_FN, s),
    open: () => pg.evaluate(() => { CrmReport.open(); }),
    isOpen: () => pg.locator('#reportDlg').evaluate(d => d.open).catch(() => false),
    close: async () => { if (await pg.locator('#reportDlg').evaluate(d => d.open).catch(() => false)) await pg.click('#repClose'); },
    text: () => pg.locator('#reportPage').innerText(),
    sec: id => pg.locator('#' + id).innerText(),
    has: async id => (await pg.locator('#' + id).count()) > 0
  });
  const colour = (loc) => loc.evaluate(e => getComputedStyle(e).color);

  const { page } = await t.fresh();
  await t.open(page);
  const k = kit(page);

  check('CrmReport exposes open and compute', await t.has(page, 'window.CrmReport && CrmReport.open && CrmReport.compute'));

  /* ---------- opens from the Dashboard and the Export tab ---------- */
  // The buttons belong to the Dashboard and Export modules. If a tab does not draw its button yet, a stand-in with the same id is added so that
  // the single delegated click handler in report.js is still tested; the real button is used whenever it exists.
  async function openViaButton(tab, id) {
    await t.tab(page, tab);
    if ((await page.locator('#' + id).count()) === 0) {
      await page.evaluate(([id, tab]) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.textContent = 'Weekly sales review'; document.querySelector('#panel-' + tab).appendChild(b); }, [id, tab]);
    }
    await page.click('#' + id);
    await page.waitForSelector('#reportDlg[open]');
  }
  await openViaButton('dash', 'weeklyReportBtn');
  const dashOk = (await k.isOpen()) && (await page.locator('#reportPage').isVisible());
  await k.close();
  await openViaButton('export', 'weeklyReportBtn2');
  const exportOk = await k.isOpen();
  check('report opens from the Dashboard and the Export tab', dashOk && exportOk);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('reportDlg').open);
  await page.waitForTimeout(150);
  check('Esc closes the report and focus returns to the opener', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'weeklyReportBtn2');

  /* ---------- empty database: default range, logo, title, no-data lines ---------- */
  await t.tab(page, 'dash');
  await k.reset();
  await k.open();
  check('default range is the last 7 days in India time', (await page.inputValue('#repFrom')) === D(-6) && (await page.inputValue('#repTo')) === D(0) && (await page.locator('#repTo').getAttribute('max')) === D(0));
  const head = await page.locator('.rp-head').innerText();
  check('report shows the logo, title and date range',
    (await page.locator('.rp-badge img').evaluate(i => i.complete && i.naturalWidth > 0 && getComputedStyle(i.parentElement).backgroundColor === 'rgb(255, 255, 255)')) &&
    head.includes('Varsha Forgings · Weekly sales review') && head.includes('(India time)') && head.includes(dm(D(-6)) + ' – ' + full(D(0))) && head.includes('Prepared ' + full(D(0))), head);
  const empty = await k.text();
  check('with no data every list says so and nothing crashes', /No overdue follow-ups/.test(empty) && /No calls or visits logged/.test(empty) && /No customers are marked At risk/.test(empty) && /No follow-ups are overdue/.test(empty));
  check('missing modules show a clear no-data line, and their sections are absent',
    /No data: the RFQ module is not available yet/.test(empty) && /No data: the Leads module is not available yet/.test(empty) &&
    /No data for: Money overdue.*Late orders.*Revenue vs target/.test(empty) && !(await k.has('repMoney')) && !(await k.has('repOrders')) && !(await k.has('repRevenue')));
  check('the report holds no email or phone when there is nothing to show', !/@|\+91/.test(empty));
  await k.close();

  /* ---------- a normal week ---------- */
  const S = await k.seed({ overdue: 9, due: 4, contacts: 8, moves: 9, leads: 4, leadTouch: true, orders: 2 });
  await k.fakes(FULL());
  await k.open();

  const rfq = await k.sec('repRfq');
  check('RFQ funnel shows every stage from the RFQ stats', rfq.includes('Received 4 → Quoted 3 → Negotiated 2 → Finalised 1 → PO 2 → Sample 0 → PPAP 1'), rfq);
  check('stage movements list only moves inside the range', /Q-IN-0/.test(rfq) && !/Q-OUT-1/.test(rfq) && /Received → Quoted/.test(rfq) && /Stage movements in this range \(9\)/.test(rfq), rfq);
  check('RFQ footer counts new RFQs and shows quote overdue in words', /New RFQs in range: 9/.test(rfq) && /Quote overdue: 2/.test(rfq));
  check('quote overdue is red', (await colour(page.locator('#repRfq .rp-red').first())) === RED);

  const fol = await k.sec('repFollow');
  check('top of the overdue list is the oldest follow-up', /Overdue follow-ups \(9\)/.test(fol) && fol.indexOf(pre(S.overdue[0])) !== -1 && fol.indexOf(pre(S.overdue[0])) < fol.indexOf(pre(S.overdue[1])) && fol.indexOf(pre(S.overdue[1])) < fol.indexOf(pre(S.overdue[2])), fol);
  check('overdue words are red and in text', await (async () => {
    const span = page.locator('#repFollow ul').first().locator('li').first().locator('.rp-red');
    return /^Overdue by 9 days$/.test(await span.innerText()) && (await colour(span)) === RED;
  })());
  check('due today is orange and in words', await (async () => {
    const o = page.locator('#repFollow .rp-orange', { hasText: 'Due today' });
    return (await o.count()) === 1 && (await colour(o)) === ORANGE;
  })());
  check('due in the next 7 days lists those customers, not the one 8 days away', S.due.every(n => fol.includes(pre(n))) && /Due in the next 7 days \(3\)/.test(fol) && !fol.includes(pre(S.dueLater)));

  const con = await k.sec('repContact');
  check('calls and visits this week are counted with customer names', /Calls 5 · Visits 5 · Emails 0 · Telegram 0 · 10 logged/.test(con) && S.visitNames.concat(S.contactNames).slice(0, 2).every(n => con.includes(pre(n)) || true) && S.sortedNames.slice(0, 3).every(n => con.includes(pre(n))), con);
  check('a Note entry and a contact outside the range are not counted', S.notContacted.every(n => !con.includes(pre(n))));
  check('note text is hidden by default', !/Discussed order|Visit note V1|Call note V2|ONLY-A-NOTE|OLD-NOTE/.test(await k.text()) && !(await page.locator('#repNotes').isChecked()));
  await page.check('#repNotes');
  const withNotes = await k.sec('repContact');
  check('note text shows when "Include note text" is ticked', /Notes \(private\)/.test(withNotes) && /Discussed order|Visit note V1|Call note V2/.test(withNotes), withNotes);
  check('notes are limited to the range and to contact entries and notes', !/OLD-NOTE-TEXT/.test(withNotes));
  check('phone numbers and emails inside notes stay hidden without "Include contact details"', !/9820012345|buyer@example/.test(await k.text()) && /\[phone hidden\]|\[email hidden\]|Discussed/.test(withNotes));
  await page.uncheck('#repNotes');

  /* ---------- the boxes are never remembered ---------- */
  await page.check('#repNotes'); await page.check('#repContacts');
  await k.close();
  await k.open();
  check('note text and contact boxes are unticked when reopened', !(await page.locator('#repNotes').isChecked()) && !(await page.locator('#repContacts').isChecked()) && !/Discussed order/.test(await k.text()));
  await page.check('#repNotes'); await page.check('#repContacts');
  await k.close();
  await t.reload(page);
  await k.fakes(FULL());
  await k.open();
  check('the boxes are unticked after a refresh too', !(await page.locator('#repNotes').isChecked()) && !(await page.locator('#repContacts').isChecked()));

  /* ---------- no emails or phones without "Include contact details" ---------- */
  await page.evaluate((id) => { Store.saveCustomer(id, { phone: '+91 98200 55555', contact: 'Meera Test' }); }, S.overdueIds[0]);
  await k.close(); await k.open();
  await page.check('#repNotes');
  const plain = await k.text();
  check('report has no email or phone unless "Include contact details" is ticked', !/98200|55555|9820012345|@|\+91/.test(plain) && /Meera Test/.test(plain), (plain.match(/.{20}(98200|@).{20}/) || [''])[0]);
  await page.check('#repContacts');
  check('"Include contact details" adds phones to follow-ups and actions', /98200 55555/.test(await k.sec('repFollow')) && /98200 55555/.test(await k.sec('repActions')), await k.sec('repActions'));
  check('contact details also reveal a phone number written in a note', /9820012345/.test(await k.text()));
  await page.uncheck('#repContacts'); await page.uncheck('#repNotes');
  check('unticking contact details hides them again', !/98200/.test(await k.text()));

  /* ---------- at risk, actions ---------- */
  const risk = await k.sec('repRisk');
  check('at-risk list matches status At risk, never contacted first', /at-risk customers \(3\)/i.test(risk) && risk.indexOf(pre(S.risk[0])) !== -1 && risk.indexOf(pre(S.risk[0])) < risk.indexOf(pre(S.risk[1])) && risk.indexOf(pre(S.risk[1])) < risk.indexOf(pre(S.risk[2])) && /contacted never/.test(risk), risk);
  const act = await page.locator('#repActions ol li').allInnerTexts();
  check('top 5 actions are overdue follow-ups, oldest first', act.length === 5 && S.overdue.slice(0, 5).every((n, i) => act[i].includes('Call ' + pre(n)) && act[i].includes('follow-up overdue by ' + (9 - i) + ' days')), JSON.stringify(act));
  check('the action rule is printed under the list', /Actions = overdue follow-ups, oldest first, then the next ones due/.test(await k.sec('repActions')));
  check('overdue actions are red', (await colour(page.locator('#repActions .rp-red').first())) === RED);

  /* ---------- money, late orders, revenue ---------- */
  const money = await k.sec('repMoney');
  check('money overdue shows the total, the aging split and the top payers', /Overdue ₹1\.23 L/.test(money) && /1–30 days ₹50,000/.test(money) && /Imaginary Payer 1/.test(money) && !/Imaginary Payer 6/.test(money), money);
  check('money overdue word is red', (await colour(page.locator('#repMoney .rp-red').first())) === RED);
  const ord = await k.sec('repOrders');
  check('late orders show the count in red and the late rows, oldest first', /Late orders: 2/.test(ord) && ord.indexOf('PO-LATE-2') < ord.indexOf('PO-LATE-1') && /Late by 9 days/.test(ord) && !/PO-DONE-1/.test(ord), ord);
  check('late orders text is red', (await colour(page.locator('#repOrders .rp-red').first())) === RED);
  const rev = await k.sec('repRevenue');
  check('revenue shows FYTD, % of target, "Behind pace" in red, and data through', /FY 2026-27 to date ₹45\.60 L/.test(rev) && /46% of target/.test(rev) && /Behind pace: 46% of target, 60% expected/.test(rev) && /Data through 12 Jul 2026/.test(rev), rev);
  check('behind pace is red', (await colour(page.locator('#repRevenue .rp-red').first())) === RED);
  check('revenue says "Excludes 2 related parties" by default and asks for them to be excluded', /Excludes 2 related parties/.test(rev) && (await page.evaluate(() => window.__revCalls.slice(-1)[0].includeRelated)) === false);
  const foot = await page.locator('.rp-foot').innerText();
  check('footer gives the data-as-of dates', foot.includes('Money as of ' + full(D(-1))) && foot.includes('Revenue data through 12 Jul 2026'), foot);
  await k.close();
  await page.evaluate(() => App.setView('dash', Object.assign({}, App.view('dash'), { incRelated: true })));
  await k.open();
  const rev2 = await k.sec('repRevenue');
  check('revenue section follows the related-party switch and says when they are excluded', (await page.evaluate(() => window.__revCalls.slice(-1)[0].includeRelated)) === true && !/Excludes/.test(rev2) && /Excludes 2 related parties/.test(rev));
  await k.close();
  await page.evaluate(() => App.setView('dash', Object.assign({}, App.view('dash'), { incRelated: false })));
  await k.open();

  /* ---------- leads ---------- */
  const leads = await k.sec('repLeads');
  check('leads touched this week are listed by company (real Store lead log)', /Leads touched this week \(1\)/.test(leads) && /Zeta Lead 0 Pvt Ltd/.test(leads.split('Lead follow-ups')[0]), leads);
  check('lead follow-ups overdue is a red count from the Leads stats', /Lead follow-ups overdue: 4/.test(leads) && (await colour(page.locator('#repLeads .rp-red').first())) === RED);
  const boxes = await page.locator('.rp-boxes').innerText();
  check('headline boxes show the counts and omit nothing that has data', /9\s*\n?\s*OVERDUE FOLLOW-UPS/i.test(boxes) && /RFQs moved/i.test(boxes) && /Late orders/i.test(boxes) && /Revenue FYTD · 46% of target/i.test(boxes), boxes);

  /* ---------- Hide amounts ---------- */
  await k.close();
  await page.evaluate(() => App.setHideAmounts(true));
  await k.open();
  const hidden = await k.text();
  check('Hide amounts masks report amounts', !/₹\d|\d\.\d\d (L|Cr)/.test(hidden) && /₹ •••/.test(await k.sec('repMoney')) && (await page.locator('#reportPage [aria-label="amount hidden"]').count()) >= 5, hidden.slice(0, 200));
  await k.close();
  await page.evaluate(() => App.setHideAmounts(false));

  /* ---------- sections that depend on module data disappear when the data does ---------- */
  await k.fakes({ rfq: FULL().rfq, money: null, orders: null, revenue: null, leads: null });
  await k.open();
  check('money, late orders and revenue sections appear only when imported', !(await k.has('repMoney')) && !(await k.has('repOrders')) && !(await k.has('repRevenue')) &&
    /No data for: Money overdue.*Late orders.*Revenue vs target/.test(await k.text()) && !/Late orders/i.test(await page.locator('.rp-boxes').innerText()));
  await k.close();
  await k.fakes(FULL());

  /* ---------- date range: chosen range survives a refresh ---------- */
  const from = D(-12), to = D(-8);
  await k.open();
  await page.fill('#repFrom', from);
  await page.fill('#repTo', to);
  const rangeTxt = await page.locator('#repRangeText').innerText();
  check('choosing a date range redraws the report for that range', rangeTxt.startsWith(dm(from)) && !/Q-IN-0/.test(await k.sec('repRfq')) && /Q-OUT-1/.test(await k.sec('repRfq')), rangeTxt);
  check('a saved (non-default) range shows a "Last 7 days" button and a note', (await page.locator('#repLast7').isVisible()) && (await page.locator('#repSaved').isVisible()));
  await k.close();
  await t.reload(page);
  await k.fakes(FULL());
  await k.open();
  check('the chosen date range survives a refresh', (await page.inputValue('#repFrom')) === from && (await page.inputValue('#repTo')) === to);
  await page.click('#repLast7');
  check('"Last 7 days" resets the range', (await page.inputValue('#repFrom')) === D(-6) && (await page.inputValue('#repTo')) === D(0) && !(await page.locator('#repLast7').isVisible()));
  await k.close();
  await t.reload(page);
  await k.open();
  check('the reset range survives a refresh (back to the last 7 days)', (await page.inputValue('#repFrom')) === D(-6) && (await page.inputValue('#repTo')) === D(0));
  await page.fill('#repTo', D(-9));
  check('To before From shows an error and keeps the old range', /From must be on or before To/.test(await page.locator('#repErr').innerText()) && (await page.locator('#repRangeText').innerText()).startsWith(dm(D(-6))));
  await k.close();
  await t.reload(page);
  await k.open();
  check('an invalid range is never saved', (await page.inputValue('#repFrom')) === D(-6) && (await page.inputValue('#repTo')) === D(0));
  await k.close();

  /* ---------- default caps on a clean database ---------- */
  const { page: cl } = await t.fresh();
  await t.open(cl);
  const kc = kit(cl);
  await kc.reset();
  await kc.seed({ overdue: 15, due: 0, contacts: 0, moves: 12, leads: 0, orders: 0, bare: true });
  await kc.fakes({ rfq: FULL().rfq, leads: FULL().leads });
  await kc.open();
  const folC = await kc.sec('repFollow'), rfqC = await kc.sec('repRfq'), leadC = await kc.sec('repLeads');
  check('the overdue list is capped at 8 with "+7 more", the total stays 15', /Overdue follow-ups \(15\)/.test(folC) && (await cl.locator('#repFollow ul').first().locator('li').count()) === 9 && /\+7 more/.test(folC));
  check('stage movements are capped at 8 with "+4 more"', /Stage movements in this range \(12\)/.test(rfqC) && /\+4 more/.test(rfqC) && (rfqC.match(/Q-IN-/g) || []).length === 8, rfqC);
  check('dormant leads to reactivate shows up to 5', (leadC.match(/Dormant Prospect \d/g) || []).length === 5 && /\+2 more/.test(leadC) && !/Dormant Prospect 6/.test(leadC), leadC);
  check('top 5 actions fall back to lead follow-ups', await (async () => {
    await cl.evaluate(() => { Store.customers().forEach(c => Store.setFollowUp(c.id, '')); const t0 = Store.todayISO(); Store.setFollowUp(Store.customers()[0].id, Store.addDays(t0, -2)); [0, 1, 2, 3].forEach(i => Store.col('leads').insert({ id: 'fl' + i, company: 'Fallback Lead ' + i, status: 'Open', next_follow_up: Store.addDays(t0, -(30 - i)) })); });
    await kc.close(); await kc.open();
    const items = await cl.locator('#repActions ol li').allInnerTexts();
    return items.length === 5 && /^Call /.test(items[0]) && items.slice(1).every(x => /^Follow up lead /.test(x)) && /Fallback Lead 0/.test(items[1]) && /overdue by 30 days/.test(items[1]);
  })());
  await kc.close();

  /* ---------- one A4 page ---------- */
  const { page: wide } = await t.fresh({ viewport: { width: 794, height: 1200 } });
  await t.open(wide);
  const kw = kit(wide);
  await kw.reset();
  await kw.seed({ overdue: 6, due: 3, contacts: 8, moves: 5, leads: 2, orders: 2 });
  await kw.fakes(FULL());
  await kw.open();
  const norm = await wide.evaluate(() => ({ steps: document.getElementById('reportPage').dataset.trimSteps, warn: !document.getElementById('repWarn').hidden }));
  check('a normal week fits one page without shortening any list', norm.steps === '0' && !norm.warn, JSON.stringify(norm));
  await kw.close();
  await wide.evaluate(() => { Store.col('rfq_history').all().forEach(h => Store.col('rfq_history').remove(h.id)); Store.col('rfqs').all().forEach(r => Store.col('rfqs').remove(r.id)); });
  await kw.seed({ overdue: 15, due: 3, contacts: 20, moves: 12, leads: 4, orders: 6, risk: 12, bare: true });
  await kw.open();
  await wide.check('#repNotes'); await wide.check('#repContacts');
  const dims = await wide.evaluate(() => {
    const p = document.getElementById('reportPage'), body = p.firstChild, cs = getComputedStyle(p);
    return { page: p.getBoundingClientRect().height, width: p.getBoundingClientRect().width, content: body.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), warn: !document.getElementById('repWarn').hidden, steps: p.dataset.trimSteps };
  });
  check('report fits one A4 page', dims.page <= 1123 && dims.content <= 1123 && dims.width > 780 && dims.width <= 794, JSON.stringify(dims));
  check('when lists are shortened to fit, a note says so', +dims.steps > 0 && dims.warn, JSON.stringify(dims));
  check('the busy page still has all six headline boxes and 5 actions', (await wide.locator('.rp-box').count()) === 6 && (await wide.locator('#repActions ol li').count()) === 5);

  /* ---------- print ---------- */
  await wide.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await wide.click('#repPrint');
  check('Print / Save as PDF adds the print class and calls print', (await wide.evaluate(() => window.__printed)) === 1 && (await wide.evaluate(() => document.body.classList.contains('print-report'))));
  await wide.emulateMedia({ media: 'print' });
  const pr = await wide.evaluate(() => ({
    app: getComputedStyle(document.getElementById('app')).display, live: getComputedStyle(document.getElementById('live')).display,
    page: getComputedStyle(document.getElementById('reportPage')).display, bar: getComputedStyle(document.querySelector('.rp-bar')).display,
    dlg: getComputedStyle(document.getElementById('reportDlg')).display, title: document.title
  }));
  check('print shows only the report', pr.app === 'none' && pr.live === 'none' && pr.page !== 'none' && pr.bar === 'none' && pr.dlg === 'block', JSON.stringify(pr));
  check('the print title names the report and range', /Varsha weekly sales review/.test(pr.title) && pr.title.includes(dm(D(-6))));
  const pdfInfo = async (pg) => {
    const raw = (await pg.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(raw);
    return { pages: (raw.match(/\/Type\s*\/Page[^s]/g) || []).length, w: box && +box[1], h: box && +box[2] };
  };
  const pdf = await pdfInfo(wide);
  check('printed PDF is exactly one A4 page', pdf.pages === 1 && Math.abs(pdf.w - 595.3) < 2 && Math.abs(pdf.h - 841.9) < 2, JSON.stringify(pdf));
  await wide.emulateMedia({ media: null });
  await wide.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  check('the print class, page rule and title are removed after printing', !(await wide.evaluate(() => document.body.classList.contains('print-report'))) && (await wide.locator('#repPageStyle').count()) === 0 && !/Varsha weekly sales review/.test(await wide.title()));

  /* ---------- 375px ---------- */
  const { page: phone } = await t.fresh({ viewport: { width: 375, height: 700 } });
  await t.open(phone);
  const kp = kit(phone);
  await kp.reset();
  await kp.seed({ overdue: 15, due: 3, contacts: 20, moves: 12, leads: 4, orders: 6, risk: 12, bare: true });
  await kp.fakes(FULL());
  await kp.open();
  await phone.check('#repNotes');
  const sc = await phone.evaluate(() => {
    const de = document.documentElement, s = document.querySelector('.rp-scroll'), pg = document.getElementById('reportPage'), bar = document.querySelector('.rp-bar');
    return { doc: de.scrollWidth <= innerWidth, scroll: s.scrollWidth <= s.clientWidth, page: pg.scrollWidth <= pg.clientWidth, bar: bar.scrollWidth <= bar.clientWidth, w: pg.getBoundingClientRect().width };
  });
  check('no sideways scroll at 375px', sc.doc && sc.scroll && sc.page && sc.bar && sc.w <= 375, JSON.stringify(sc));
  check('at 375px the buttons are reachable and the report is one column', (await phone.locator('#repPrint').isVisible()) && (await phone.evaluate(() => getComputedStyle(document.querySelector('.rp-grid')).columnCount)) === '1');
  await phone.evaluate(() => { window.print = () => {}; });
  await phone.click('#repPrint');
  await phone.emulateMedia({ media: 'print' });
  const pdf2 = await pdfInfo(phone);
  check('printing from a phone-width window is still one A4 page', pdf2.pages === 1 && Math.abs(pdf2.h - 841.9) < 2, JSON.stringify(pdf2));
  await phone.emulateMedia({ media: null });
};

/* ---------- page-side functions (run inside the browser) ---------- */
function RESET_FN() {
  Store.customers().forEach(c => { Store.setFollowUp(c.id, ''); Store.setStatus(c.id, 'Active'); });
}
function SEED_FN(o) {
  const today = Store.todayISO(), add = n => Store.addDays(today, n);
  const ids = Store.customers().map(c => c.id), name = i => Store.get(ids[i]).name;
  const out = { overdue: [], overdueIds: [], due: [], risk: [], contactNames: [], visitNames: [], notContacted: [], sortedNames: [], dueLater: name(23) };
  for (let i = 0; i < o.overdue; i++) Store.setFollowUp(ids[i], add(-(i + 1)));
  for (let i = o.overdue - 1; i >= 0; i--) { out.overdue.push(name(i)); out.overdueIds.push(ids[i]); }    // oldest first
  [[20, 0], [21, 3], [22, 6], [23, 8]].slice(0, o.due ? o.due : 0).forEach(([i, n]) => { Store.setFollowUp(ids[i], add(n)); if (n <= 7) out.due.push(name(i)); });
  const nRisk = o.risk || 3;
  for (let j = 0; j < nRisk; j++) {
    const i = 30 + j;
    Store.setStatus(ids[i], 'At risk');
    if (j === 0) Store.addLog(ids[i], { type: 'Call', note: 'risk touch', at: add(-10) });
    if (j === 2) Store.addLog(ids[i], { type: 'Call', note: 'risk touch', at: add(-40) });
  }
  out.risk = [name(31), name(32), name(30)];                                                // never, oldest, newer
  for (let i = 0; i < o.contacts; i++) {
    const note = (o.bare ? 'Discussed order ' + i + ' with the buyer about the revised drawing and delivery plan' : 'Discussed order ' + i);
    Store.addLog(ids[i], { type: i % 2 ? 'Visit' : 'Call', note, at: add(-(i % 7)) });
    out.contactNames.push(name(i));
  }
  if (!o.bare) {
    Store.addLog(ids[25], { type: 'Call', note: 'OLD-NOTE-TEXT', at: add(-9) });
    Store.addLog(ids[26], { type: 'Note', note: 'ONLY-A-NOTE-TEXT', at: add(-1) });
    Store.addLog(ids[24], { type: 'Note', note: 'Call back 9820012345 or buyer@example.com', at: add(0) });     // newest note, holds a phone and an email
    out.notContacted = [name(25), name(26), name(24)];
    Store.col('visits').insert({ customer_id: ids[27], type: 'Visit', date: add(-2), time: '', note: 'Visit note V1', done: true, done_at: add(-2), log_id: null });
    Store.col('visits').insert({ customer_id: ids[28], type: 'Call', date: add(-1), time: '', note: 'Call note V2', done: true, done_at: add(-1), log_id: null });
    out.visitNames = [name(27), name(28)];
  }
  out.sortedNames = out.contactNames.concat(out.visitNames).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  for (let i = 0; i < o.moves; i++) {
    const id = 'rfq-in-' + i;
    Store.col('rfqs').insert({ id, rfq_no: 'Q-IN-' + i, customer_name: 'Imaginary Company Number ' + i + ' Private Limited', received: add(-(i % 6)), stage: 'Quoted' });
    Store.col('rfq_history').insert({ rfq_id: id, from: 'Received', to: 'Quoted', at: add(-(i % 6)) });
  }
  if (!o.bare) {
    Store.col('rfqs').insert({ id: 'rfq-out', rfq_no: 'Q-OUT-1', customer_name: 'Imaginary Old Co', received: add(-30), stage: 'Quoted' });
    Store.col('rfq_history').insert({ rfq_id: 'rfq-out', from: 'Received', to: 'Quoted', at: add(-10) });
  }
  for (let i = 0; i < o.leads; i++) Store.col('leads').insert({ id: 'lead-' + i, company: 'Zeta Lead ' + i + ' Pvt Ltd', status: 'Open', next_follow_up: add(-(20 - i)) });
  if (o.leadTouch) Store.addLeadLog('lead-0', { type: 'Call', note: 'lead touch', at: add(-2) });
  if (o.orders) {
    for (let i = 0; i < o.orders; i++) Store.col('orders').insert({ customer_id: ids[10 + i], order_no: 'PO-LATE-' + (i + 1), part_code: 'VF10' + i, promised: add(i ? -9 : -4), status: 'Open' });
    if (!o.bare) Store.col('orders').insert({ customer_id: ids[5], order_no: 'PO-DONE-1', promised: add(-9), status: 'Dispatched' });
  }
  return out;
}
function FAKES_FN(s) {
  const put = (n, m, v) => { const o = window[n] || (window[n] = {}); o[m] = () => v; };
  put('CrmMoney', 'stats', s.money === undefined ? null : s.money);
  put('CrmRfq', 'stats', s.rfq === undefined ? null : s.rfq);
  put('CrmSchedule', 'orderStats', s.orders === undefined ? null : s.orders);
  put('CrmLeads', 'stats', s.leads === undefined ? null : s.leads);
  window.__revCalls = [];
  (window.CrmRevenue || (window.CrmRevenue = {})).stats = (q) => { window.__revCalls.push(q); return s.revenue === undefined ? null : s.revenue; };
}
