// A6 final integration: the real modules working together on synthetic data (made-up amounts, names, emails).
// Imports go through the real dialogs: AGING + LIVE_POSITION, INVOICE_REGISTER, dispatch history, Hub RFQ sheets and a lead sheet.
module.exports = async (t) => {
  const { check, istToday } = t;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const asOnText = (iso) => { const [y, m, d] = iso.split('-'); return d + '-' + MON[+m - 1] + '-' + y.slice(2); };
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const ZF = 'ZF STEERING GEAR (INDIA) LTD', NR = 'NR INDUSTRIES', NEEL = 'NEEL METAL PRODUCTS LIMITED';
  const MK = 'VARSHA FORGINGS LTD MARKAL', KC = 'KCTR VARSHA AUTOMOTIVE PVT. LTD.';
  const ZFID = 'zf-steering-gear-india-ltd', NRID = 'nr-industries';
  const LEAD_MAIL = 'integration.lead@example.invalid', REF = 'integration-contact-ref';
  const TABS = ['dash', 'list', 'leads', 'rfqs', 'schedule', 'export'];

  // ---------------- fixtures ----------------
  const AGING = ['Customer,Printed Terms Days,ERP Total,ERP Not Due,ERP Overdue,Model Not Due,1-30,31-60,61-90,>90,Pre April,Credit Balance,Model Overdue,As On',
    ZF + ',45,"1,500,000","500,000","1,000,000","450,000","100,000","200,000","300,000","250,000","150,000",0,"1,000,000",' + asOnText(istToday(-2)),
    NR + ',,"300,000",0,"300,000",0,"300,000",0,0,0,0,0,"300,000",' + asOnText(istToday(-2)),
    NEEL + ',,"80,000","30,000","50,000",0,"50,000",0,0,0,0,0,"50,000",' + asOnText(istToday(-2)),
    MK + ',,"40,000",0,"40,000",0,"40,000",0,0,0,0,0,"40,000",' + asOnText(istToday(-2)),
    'Zeta Imaginary Pvt Ltd,,"10,000",0,"10,000",0,"10,000",0,0,0,0,0,"10,000",' + asOnText(istToday(-2)),
    'Total,,"9,999,999",0,"9,999,999",0,0,0,0,0,0,0,0,'].join('\n') + '\n';
  const LIVE = ['Customer,ERP 15-Oct,Invoices Since,Receipts Since,Estimated Live,As On',
    ZF + ',"2,000,000","300,000","100,000","2,200,000",' + asOnText(istToday(-2)),
    NR + ',"400,000",0,0,"400,000",' + asOnText(istToday(-2)),
    NEEL + ',"90,000",0,0,"90,000",' + asOnText(istToday(-2))].join('\n') + '\n';
  const INV_HEAD = 'Invoice No,Invoice Date,Customer On Invoice,Customer,ERP Group,PO No,Terms Days,Taxable,Invoice Amount,Due Date';
  const inv = (no, date, cust, tx) => [no, date, cust, cust, '', 'PO', '30', tx, tx, '30-Sep-26'].map(q).join(',');
  const INVOICES = [INV_HEAD, inv('I1', '01-Apr-26', ZF, '100,000'), inv('I2', '20-May-26', ZF, '200,000'), inv('I3', '15-Jun-26', NR, '50,000'), inv('I4', '12-Jul-26', NEEL, '30,000'),
    inv('I5', '20-Jun-26', MK, '450,000'), inv('I6', '12-Jul-26', KC, '100,000'), inv('I7', '08-Jul-26', 'Zeta Imaginary Pvt Ltd', '15,000')].join('\n') + '\n';
  const DISPATCH = ['Date,Customer,Part Code,Quantity,Slip Type',
    [istToday(-3), ZF, 'VX1001', 40, 'Invoice'].join(','), [istToday(-12), ZF, 'VX1002', 30, 'Invoice'].join(','), [istToday(-9), NR, 'VX2001', 15, 'Invoice'].join(','),
    [istToday(-20), 'Mystery Imaginary Works', 'VX3001', 5, 'Job work'].join(',')].join('\n') + '\n';
  const H1 = 'Item ID,Priority,Category,Subject / Matter,Counterparty / Organization,Delegated To,Action Required,Date Received,Target Due Date,Status';
  const act = (id, cat, subject, cp, action, status) => [id, '', cat, subject, cp, 'Sales desk', action, istToday(-5), istToday(-2), status].map(q).join(',');
  const ACTION = [H1, act('INT-1', 'NEW RFQ', 'ZF STEERING GEAR: drop arm RFQ', ZF, 'Send the quote', 'OPEN'), act('INT-2', 'REVIEW', 'Costing sheet for a bracket', NR, 'Prepare costing', 'OPEN'),
    act('INT-3', 'URGENT (PAYMENT RELEASE)', 'Imaginary GmbH: issue Tooling Invoice', 'Imaginary GmbH', 'Accounts must email the invoice', 'OPEN')].join('\n') + '\n';
  const H2 = 'Tracking ID,Category,Account / Counterparty,Contact Email / Reference,Outreach Date,Last Follow-up Date,Follow-up Count,Expected Deliverable,Status';
  const AWAIT = [H2, ['INT-A1', 'Offer Submitted', NEEL, REF, istToday(-9), istToday(-4), '1', 'Pin offer sent', 'Offer Submitted'].map(q).join(','),
    ['INT-A2', 'PO', NR, 'Buyer', istToday(-8), istToday(-3), '2', 'PO received for covers', 'PO received'].map(q).join(',')].join('\n') + '\n';
  const LEADS = 'Lead ID,Organization,Segment / Domain,Key Contact & Email,Date of Last Contact,Historical Context,Value Proposition / Angle,Recommended Outreach Action\n' +
    'LD-9,Integration Forge Pvt Ltd,Tractor,Jane Roe (' + LEAD_MAIL + '),2026-01-10,Quoted last year,Spare press capacity,Call in November\n' +
    'LD-8,Second Made Up Works,EV,Raj Test <raj.int@example.invalid>,2025-12-01,Sample sent,Weight saving,Send a note\n' +
    'LD-7,KCTR Varsha Automotive,Group,Staff (staff@kctr.example),2026-02-02,internal,,\n';

  const errs = [];
  const open = async (opts = {}) => {
    const c = await t.fresh(opts);
    c.page.on('pageerror', e => errs.push(String(e)));
    c.page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await t.open(c.page);
    return c.page;
  };
  const flush = (p) => p.evaluate(() => App.flush());
  const closedImport = (p) => p.waitForFunction(() => !document.getElementById('importDlg').open);
  const tabs = async (p) => { for (const id of TABS) { await t.tab(p, id); } };
  // one download at a time, with a short pause: two downloads started back to back can lose the second one in headless Chromium
  const dl = async (sel) => { await p.waitForTimeout(350); return t.download(p, sel); };
  const widthOf = (p) => p.evaluate(() => ({ w: document.documentElement.scrollWidth, vw: innerWidth }));

  // =========================================================================================
  // 1. every tab renders with no data
  // =========================================================================================
  const e = await open();
  const emptyInfo = [];
  for (const id of TABS) {
    await t.tab(e, id);
    if (id === 'schedule') { for (const s of ['visits', 'orders', 'dispatch']) { await e.click('#schTab-' + s); emptyInfo.push([id + '/' + s, (await e.locator('#schPane-' + s).innerText()).trim().length]); } }
    else emptyInfo.push([id, (await e.locator('#panel-' + id).innerText()).trim().length]);
  }
  check('every tab renders with no data (empty states, no error banner)', emptyInfo.every(x => x[1] > 20) && await e.locator('#syncErr').isHidden(), JSON.stringify(emptyInfo));
  const dashEmpty = await (async () => { await t.tab(e, 'dash'); return e.locator('#panel-dash').innerText(); })();
  check('the empty Dashboard says what to import', /No money data yet/.test(dashEmpty) && /No invoice data yet/.test(dashEmpty) && /No leads yet/.test(dashEmpty), dashEmpty.slice(0, 200));
  const emptyCards = await (async () => { await t.tab(e, 'export'); return e.locator('#dataList').innerText(); })();
  check('the empty Export tab shows zero counts', /0 RFQs/.test(emptyCards) && /0 leads/.test(emptyCards) && /Invoice file\s+None imported/.test(emptyCards));
  const ep = await open({ viewport: { width: 375, height: 760 } });
  const emptyWide = [];
  for (const id of TABS) {
    await t.tab(ep, id);
    const subs = id === 'schedule' ? ['visits', 'orders', 'dispatch'] : [null];
    for (const s of subs) { if (s) await ep.click('#schTab-' + s); const d = await widthOf(ep); if (d.w > d.vw) emptyWide.push(id + (s ? '/' + s : '') + ':' + d.w); }
  }
  check('no sideways scroll at 375px on any tab with no data', emptyWide.length === 0, emptyWide.join());

  // =========================================================================================
  // 2. import everything through the real dialogs
  // =========================================================================================
  const p = await open();
  const importVia = async (opener, name, text, o = {}) => {
    await opener();
    await p.waitForSelector('#importDlg[open]');
    await p.setInputFiles('#importFile', t.csvFile(name, text));
    await p.waitForSelector('#importSummary li, #importErr:not([hidden])');
    const kind = await p.locator('#importKind option:checked').innerText().catch(() => '');
    const summary = await p.locator('#importSummary').innerText();
    const err = (await p.locator('#importErr').isVisible()) ? await p.locator('#importErr').innerText() : '';
    if (o.review) return { kind, summary, err };
    await p.click('#importOk');
    await closedImport(p);
    await flush(p);
    return { kind, summary, err };
  };
  const evalOpen = (js) => () => p.evaluate(js);
  const aging = await importVia(evalOpen(() => CrmMoney.openImport()), 'AGING.csv', AGING);
  const live = await importVia(evalOpen(() => CrmMoney.openImport()), 'LIVE_POSITION.csv', LIVE);
  const invc = await importVia(evalOpen(() => CrmRevenue.openImport()), 'INVOICE_REGISTER.csv', INVOICES);
  await t.tab(p, 'schedule'); await p.click('#schTab-dispatch');
  const disp = await importVia(() => p.click('#dispatchImport'), 'dispatch_history.csv', DISPATCH);
  await t.tab(p, 'rfqs');
  const hubA = await importVia(() => p.click('#rfqImport'), 'hub_action.csv', ACTION, { review: true });
  await p.click('#importOk');
  await p.waitForSelector('#hubReviewDlg[open]');
  await p.click('#hubAccept');
  await p.waitForSelector('#hubReviewDlg:not([open])', { state: 'attached' });
  const hubW = await importVia(() => p.click('#rfqImport'), 'hub_awaiting.csv', AWAIT, { review: true });
  await p.click('#importOk');
  await p.waitForSelector('#hubReviewDlg[open]');
  await p.click('#hubAccept');
  await p.waitForSelector('#hubReviewDlg:not([open])', { state: 'attached' });
  await t.tab(p, 'leads');
  await p.click('#leadImport');
  await p.setInputFiles('#importFile', t.csvFile('hub_dormant.csv', LEADS));
  await p.waitForSelector('#importSummary li');
  const leadKind = await p.locator('#importKind option:checked').innerText();
  await p.click('#importOk');
  await closedImport(p);
  await p.waitForSelector('#leadStaging:not([hidden])');
  await p.click('#leadStageReview');
  await p.waitForSelector('#leadMergeDlg[open] .mcard');
  await p.click('#mergeOk');
  await p.waitForFunction(() => !document.getElementById('leadMergeDlg').open);
  await flush(p);

  const counts = await p.evaluate(() => ({ money: CrmMoney.has(), invoices: (Store.doc('revenue').get() || { rows: [] }).rows.length, dispatch: Store.col('dispatches').all().length,
    rfqs: Store.col('rfqs').all().length, leads: Store.col('leads').all().length, internal: Store.col('leads').all().filter(l => CrmLeads.isInternal(l.company) || CrmLeads.isInternal(l.email)).length,
    unmatchedMoney: CrmMoney.stats().unmatched.n }));
  check('every import dialog recognised its file', /AGING/.test(aging.kind) && /LIVE_POSITION/.test(live.kind) && /INVOICE_REGISTER/.test(invc.kind) && /Dispatch history/.test(disp.kind) && /Action Pending/.test(hubA.kind) && /Awaiting/.test(hubW.kind) && /Dormant/.test(leadKind) &&
    !aging.err && !live.err && !invc.err && !disp.err, JSON.stringify([aging.kind, live.kind, invc.kind, disp.kind, hubA.kind, hubW.kind, leadKind]));
  check('the imported data is all there', counts.money && counts.invoices === 7 && counts.dispatch === 4 && counts.rfqs >= 3 && counts.leads >= 2 && counts.internal === 0, JSON.stringify(counts));
  check('an internal company in a lead file is not imported', !(await p.evaluate(() => Store.col('leads').all().some(l => /kctr/i.test(l.company)))));

  // =========================================================================================
  // 3. related parties are excluded by default everywhere that matters
  // =========================================================================================
  const rel = await p.evaluate(() => {
    const s = CrmRevenue.stats({ to: 'data', includeRelated: false });
    const si = CrmRevenue.stats({ to: 'data', includeRelated: true });
    const relIds = Store.customers().filter(c => c.relatedParty).map(c => c.id);
    return { fytd: s.fytd, fytdAll: si.fytd, excl: s.excludedRelated, topRel: s.top10.filter(x => relIds.indexOf(x.id) !== -1).length, segRel: 0, relN: relIds.length };
  });
  check('related parties are excluded from revenue by default and counted in the note', rel.fytd === 100000 + 200000 + 50000 + 30000 + 15000 && rel.fytdAll === rel.fytd + 450000 + 100000 && rel.excl.n === 2 && rel.excl.amount === 550000 && rel.topRel === 0, JSON.stringify(rel));
  await t.tab(p, 'dash');
  check('the Dashboard says "Excludes 2 related parties"', /Excludes 2 related parties/.test(await p.locator('#panel-dash').innerText()));
  const relRep = await p.evaluate(() => { const r = CrmReport.compute({ from: Store.addDays(Store.todayISO(), -6), to: Store.todayISO() }, { customers: Store.customers(), log: Store.allLog(), visits: [], rfqs: [], rfqHistory: [], stats: { money: CrmMoney.stats(), rfq: null, orders: null, revenue: CrmRevenue.stats({ to: 'data', includeRelated: false }) } }); return JSON.stringify(r).length > 10; });
  check('the weekly report model builds from the real stats', relRep === true);

  // =========================================================================================
  // 4. the Dashboard numbers equal what the clickable numbers open
  // =========================================================================================
  await t.tab(p, 'dash');
  const n = await p.locator('#panel-dash button[data-go][data-n]').count();
  const mism = [], tally = {};
  for (let i = 0; i < n; i++) {
    const r = await p.evaluate((i) => {
      const b = document.querySelectorAll('#panel-dash button[data-go][data-n]')[i];
      if (!b) return null;
      const go = b.dataset.go, claim = Number(b.dataset.n), label = (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      b.click(); App.flush();
      let got = null;
      if (go === 'list') got = CrmCustomers.visible().length;
      else if (go === 'rfqs') got = CrmRfq.visible().length;
      else if (go === 'leads') got = CrmLeads.visible().length;
      App.show('dash'); App.flush();
      return { go, claim, got, label };
    }, i);
    if (!r) continue;
    tally[r.go] = (tally[r.go] || 0) + 1;
    if (r.got !== null && r.got !== r.claim) mism.push(r.go + ':' + r.label + ' says ' + r.claim + ' opens ' + r.got);
  }
  check('every Dashboard number opens exactly that many rows (Customers, RFQs, Leads)', n > 40 && mism.length === 0 && tally.list > 30 && tally.rfqs > 0 && tally.leads > 0, JSON.stringify({ n, tally, mism }));
  const money = await p.evaluate(() => { const s = CrmMoney.stats(); return { out: s.outstanding, over: s.overdue }; });
  const tileTxt = async (k) => (await p.locator('[data-tile="' + k + '"] .d-val').innerText());
  check('the money tiles equal the imported files', money.over === 1000000 + 300000 + 50000 + 40000 + 10000 && money.out === 2200000 + 400000 + 90000 && (await tileTxt('overdue-amt')) === (await p.evaluate((n) => App.fmt.moneyShort(n), money.over)) && (await tileTxt('outstanding')) === (await p.evaluate((n) => App.fmt.moneyShort(n), money.out)), JSON.stringify(money));
  await p.click('[data-tile="overdue-amt"]');
  await p.waitForSelector('#panel-list:not([hidden])');
  const overdueRows = await p.evaluate(() => CrmCustomers.visible().map(c => c.id).sort());
  check('the Total overdue tile opens the customers that owe overdue amounts', overdueRows.join() === [ZFID, NRID, 'neel-metal-products-limited', 'varsha-forgings-ltd-markal'].sort().join(), overdueRows.join());

  // =========================================================================================
  // 5. actions across the modules, then a full refresh keeps every one of them
  // =========================================================================================
  await t.tab(p, 'list');
  await p.fill('#q', '');
  await p.locator('#rows tr', { hasText: 'ZF STEERING' }).locator('.fu input').fill(istToday(-3));
  await p.locator('#rows tr', { hasText: 'NEEL METAL' }).locator('select.st').selectOption('At risk');
  await p.evaluate(async ([ZFID, NRID]) => {
    await Store.addLog(ZFID, { type: 'Call', note: 'integration call note' });
    await Store.col('visits').insert({ customer_id: NRID, type: 'Visit', date: Store.addDays(Store.todayISO(), 3), time: '11:00', note: 'integration visit', done: false, done_at: null, log_id: null });
    await Store.col('orders').insert({ customer_id: ZFID, order_no: 'PO-INT', part_code: 'VX1001', part: 'Hub', qty: 12, promised: Store.addDays(Store.todayISO(), -2), status: 'Open', dispatched: null, note: '' });
    const l = Store.col('leads').all()[0];
    await Store.addLeadLog(l.id, { type: 'Call', note: 'integration lead touch' });
    await Store.doc('targets').set({ v: 1, byFy: { '2026-27': { customers: { [ZFID]: 900000 }, segments: {} } }, settings: {} });
    App.flush();
  }, [ZFID, NRID]);
  await t.tab(p, 'export');
  await p.check('#exScope-cust-all'); await p.check('#exScope-rfq-all'); await p.check('#exScope-lead-all');
  const snapshot = () => p.evaluate(() => {
    const b = Store.exportBackup(); delete b.exportedAt;
    const docs = {}; ['money', 'revenue', 'aliases', 'targets', 'dispatch_meta', 'lead_staging', 'internal_entities'].forEach(k => { docs[k] = Store.doc(k).get(); });
    const cols = {}; ['rfqs', 'rfq_history', 'visits', 'orders', 'leads', 'dispatches'].forEach(k => { cols[k] = Store.col(k).all(); });
    return JSON.stringify({ cj: Store.exportCustomersJson(), b, docs, cols, log: Store.allLog(), view: App.view('export') });
  });
  const before = await snapshot();
  await t.reload(p);
  await t.tab(p, 'export');
  const after = await snapshot();
  check('a full refresh keeps every action and import', before === after && before.length > 20000, before === after ? String(before.length) : 'snapshots differ');
  check('the scope choice and the active tab survive that refresh', await p.isChecked('#exScope-cust-all') && (await p.getAttribute('#tab-export', 'aria-selected')) === 'true');
  const overdueRow = await (async () => { await t.tab(p, 'list'); return p.locator('#rows tr', { hasText: 'ZF STEERING' }).locator('.rel').innerText(); })();
  check('the overdue follow-up still says "Overdue by 3 days" after the refresh', overdueRow === 'Overdue by 3 days');

  // =========================================================================================
  // 6. Export counts match the data, and nothing private leaks
  // =========================================================================================
  await t.tab(p, 'export');
  const card = await p.locator('#dataList').innerText();
  const real = await p.evaluate(() => ({ cust: Store.customers().length, rfqs: Store.col('rfqs').all().length, leads: Store.col('leads').all().length, visits: Store.col('visits').all().length, orders: Store.col('orders').all().length,
    log: Store.allLog().filter(e => e.customerId).length, touch: Store.allLog().filter(e => !e.customerId && e.leadId).length, inv: Store.doc('revenue').get().rows.length, disp: Store.col('dispatches').all().length }));
  const m = (re) => { const x = re.exec(card); return x ? Number(x[1].replace(/,/g, '')) : -1; };
  check('the Export counts match the data', m(/Customers\s+(\d+) customer/) === real.cust && m(/RFQs\s+(\d+) RFQ/) === real.rfqs && m(/Leads\s+(\d+) lead/) === real.leads && m(/Visits and calls\s+(\d+) visit/) === real.visits && m(/Typed orders\s+(\d+) order/) === real.orders &&
    m(/Notes and call log\s+(\d+) entr/) === real.log && m(/\+ (\d+) lead touch/) === real.touch && m(/Invoice file\s+(\d+) invoice/) === real.inv && m(/Dispatch history\s+(\d+) slip/) === real.disp &&
    /data through 12 Jul 2026/.test(card) && /AGING as of/.test(card) && /LIVE_POSITION as of/.test(card) && /FY 2026-27: 1 customer, 0 segments/.test(card), card + JSON.stringify(real));
  const rowsOf = (text) => text.split('\r\n').filter(Boolean).length - 1;
  const cCsv = await dl('#csvBtn'), rCsv = await dl('#rfqCsvBtn'), lCsv = await dl('#leadCsvBtn'), vCsv = await dl('#visitCsvBtn');
  check('the CSV files have one row per record', rowsOf(cCsv.text) === real.cust && rowsOf(rCsv.text) === real.rfqs && rowsOf(lCsv.text) === real.leads && rowsOf(vCsv.text) === real.visits, [rowsOf(cCsv.text), rowsOf(rCsv.text), rowsOf(lCsv.text), rowsOf(vCsv.text)].join());
  const files = [cCsv.text, rCsv.text, lCsv.text, vCsv.text, (await dl('#export')).text, (await dl('#backup')).text];
  const SECRETS = [LEAD_MAIL, 'raj.int@example', REF, 'integration call note', 'integration visit', 'integration lead touch', '1000000', '2200000', '450000', '1234567'];
  const leaked = SECRETS.filter(s => files.some(f => f.includes(s)));
  check('default exports carry no email, contact reference, note text or amount', leaked.length === 0, leaked.join());
  const cj = JSON.parse(files[4]);
  check('customers.json from the integrated app has exactly the documented keys and no private data', cj.customers.length === real.cust && cj.customers.every(c => Object.keys(c).join() === 'id,name,contact,contactFrom,city,state,phone,last,followUp,status,disputed,group,segment,vehicleSegment,plants,relatedParty,erpGroup'));
  await t.reload(p);                       // a fresh page: the browser limits how many automatic downloads one page may start
  await t.tab(p, 'export');
  await p.check('#incNotes'); await p.check('#incContacts'); await p.check('#incAmounts');
  const full = [(await dl('#csvBtn')).text, (await dl('#leadCsvBtn')).text, (await dl('#rfqCsvBtn')).text, (await dl('#backup')).text, (await dl('#export')).text];
  check('with the boxes ticked the private details appear, except in customers.json', full[0].includes('integration call note') && full[0].includes('1000000.00') && full[1].includes(LEAD_MAIL) && full[2].includes(REF) && full[3].includes('integration lead touch') && full[3].includes(LEAD_MAIL) && !full[3].includes('1234567') &&
    !full[4].includes(LEAD_MAIL) && !full[4].includes('integration call note') && !full[4].includes('1000000'));
  await p.uncheck('#incNotes'); await p.uncheck('#incContacts'); await p.uncheck('#incAmounts');
  const reportText = await (async () => { await p.click('#weeklyReportBtn2'); await p.waitForSelector('#reportDlg[open]'); const x = await p.locator('#reportPage').innerText(); await p.keyboard.press('Escape'); return x; })();
  check('the weekly report from the Export tab has no email or contact reference by default', reportText.length > 100 && !reportText.includes(LEAD_MAIL) && !reportText.includes(REF) && !/@/.test(reportText), String(reportText.length));
  const ls = await p.evaluate((words) => Object.keys(localStorage).filter(k => words.some(w => (localStorage.getItem(k) || '').includes(w))), [LEAD_MAIL, REF]);
  check('lead emails and contact references live only in the browser database key', ls.length === 1 && ls[0] === 'varsha-crm-localdb-v1', ls.join());

  // =========================================================================================
  // 7. page-wide checks on the fully loaded app
  // =========================================================================================
  const dup = await p.evaluate(() => { const seen = {}, d = []; document.querySelectorAll('[id]').forEach(e => { if (seen[e.id]) d.push(e.id); seen[e.id] = 1; }); return d; });
  check('no duplicate element ids on the page', dup.length === 0, dup.join());
  const unnamed = [];
  for (const id of TABS) {
    await t.tab(p, id);
    const bad = await p.evaluate((id) => [...document.querySelectorAll('#panel-' + id + ' button, #panel-' + id + ' a[href]')].filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length, id);
    if (bad) unnamed.push(id + ':' + bad);
  }
  check('every button and link has a name on every tab', unnamed.length === 0, unnamed.join());

  await p.setViewportSize({ width: 375, height: 760 });
  const wide = [];
  const probe = async (label) => { const d = await widthOf(p); if (d.w > d.vw) wide.push(label + ':' + d.w); };
  for (const id of TABS) {
    await t.tab(p, id);
    if (id === 'schedule') { for (const s of ['visits', 'orders', 'dispatch']) { await p.click('#schTab-' + s); await probe('schedule/' + s); } }
    else if (id === 'rfqs') { for (const v of ['rfqViewBoard', 'rfqViewTable']) { await p.click('#' + v); await probe('rfqs/' + v); } }
    else await probe(id);
  }
  check('no sideways scroll at 375px on every tab with all data loaded', wide.length === 0, wide.join());
  await t.tab(p, 'list');
  await p.locator('#rows tr', { hasText: 'ZF STEERING' }).locator('.notes-btn, .notes, button', { hasText: /note/i }).first().click().catch(() => {});
  await p.keyboard.press('Escape');
  await probe('list+dialog');
  await t.tab(p, 'leads'); await p.click('#leadImport'); await probe('leads import dialog'); await p.keyboard.press('Escape');
  check('no sideways scroll at 375px with dialogs open', wide.length === 0, wide.join());
  await p.setViewportSize({ width: 1280, height: 900 });
  const wide2 = [];
  for (const id of TABS) { await t.tab(p, id); const d = await widthOf(p); if (d.w > d.vw) wide2.push(id + ':' + d.w); }
  check('no sideways scroll at 1280px on every tab', wide2.length === 0, wide2.join());

  check('no console errors during the whole integration run', errs.length === 0, JSON.stringify(errs.slice(0, 5)));
};
