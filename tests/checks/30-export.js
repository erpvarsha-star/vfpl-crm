// A6 Export checks. Synthetic data only: made-up notes, emails, phones and amounts built inside this test.
// Customer names are the CRM's own (they are already in customers.json). Every action has a refresh check.
module.exports = async (t) => {
  const { check, istToday } = t;
  const ZF = 'ZF STEERING GEAR (INDIA) LTD', ZFID = 'zf-steering-gear-india-ltd', NRID = 'nr-industries';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const asOnText = (iso) => { const [y, m, d] = iso.split('-'); return d + '-' + MON[+m - 1] + '-' + y.slice(2); };
  const NOTE = 'SECRET-NOTE-ALPHA', VNOTE = 'SECRET-VISIT-BETA', ONOTE = 'SECRET-ORDER-GAMMA', LCTX = 'SECRET-LEAD-CONTEXT';
  const LMAIL = 'lead.secret@example.invalid', LPHONE = '+91 90000 77777', REF = 'contact-ref-secret-99';
  const GSTIN = '27ABCDE1234F1Z5';
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const BOM = '﻿';
  const parse = (text) => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).split('\r\n').filter(Boolean).map(l => l.slice(1, -1).split('","'));

  // ---------- fixtures ----------
  const AGING = ['Customer,Printed Terms Days,ERP Total,ERP Not Due,ERP Overdue,Model Not Due,1-30,31-60,61-90,>90,Pre April,Credit Balance,Model Overdue,As On',
    ZF + ',45,"1,500,000","500,000","1,234,567","450,000","100,000","200,000","300,000","250,000","150,000",0,"1,234,567",' + asOnText(istToday(-2)),
    'Total,,"9,999,999",0,"9,999,999",0,0,0,0,0,0,0,0,'].join('\n') + '\n';
  const INV_HEAD = 'Invoice No,Invoice Date,Customer On Invoice,Customer,ERP Group,PO No,Terms Days,Taxable,Invoice Amount,Due Date,GSTIN,CGST,SGST,IGST,TCS';
  const inv = (no, date, cust, taxable) => [no, date, cust, cust, '', 'PO-1', '30', taxable, '999,999', '30-Sep-26', GSTIN, '9,000', '9,000', '0', '100'].map(q).join(',');
  const INVOICES = [INV_HEAD, inv('E1', '01-Apr-26', ZF, '100,000'), inv('E2', '12-Jul-26', ZF, '50,000')].join('\n') + '\n';
  const AWAIT_HEAD = 'Tracking ID,Category,Account / Counterparty,Contact Email / Reference,Outreach Date,Last Follow-up Date,Follow-up Count,Expected Deliverable,Status';
  const AWAIT = [AWAIT_HEAD, ['EXT-1', 'Offer Submitted', ZF, REF + ' (asha.secret@example.invalid)', istToday(-9), istToday(-4), '1', 'Standard end bodies offer sent', 'Offer Submitted'].map(q).join(',')].join('\n') + '\n';

  const dialogs = [];
  const answer = (page, accept) => { dialogs.length = 0; page.removeAllListeners('dialog'); return page.once('dialog', d => { dialogs.push(d.message()); return accept ? d.accept() : d.dismiss(); }); };
  const flush = (page) => page.evaluate(() => App.flush());
  const closedImport = (page) => page.waitForFunction(() => !document.getElementById('importDlg').open);
  async function runImport(page, opener, name, text) {
    await page.evaluate(opener);
    await page.waitForSelector('#importDlg[open]');
    await page.setInputFiles('#importFile', t.csvFile(name, text));
    await page.waitForSelector('#importSummary li, #importErr:not([hidden])');
    await page.click('#importOk');
    await closedImport(page);
    await flush(page);
  }
  async function hubImport(page, text) {
    await t.tab(page, 'rfqs');
    await page.click('#rfqImport');
    await page.waitForSelector('#importDlg[open]');
    await page.setInputFiles('#importFile', t.csvFile('hub_awaiting.csv', text));
    await page.waitForSelector('#importSummary li');
    await page.click('#importOk');
    await page.waitForSelector('#hubReviewDlg[open]');
    await page.click('#hubAccept');
    await page.waitForSelector('#hubReviewDlg:not([open])', { state: 'attached' });
  }
  const seedData = (page) => page.evaluate(async ([NOTE, VNOTE, ONOTE, LCTX, LMAIL, LPHONE, dates]) => {
    await Store.addLog('zf-steering-gear-india-ltd', { type: 'Call', note: NOTE, at: dates.d3 });
    await Store.addLog('nr-industries', { type: 'Note', note: 'plain note' });
    await Store.col('visits').insert({ customer_id: 'zf-steering-gear-india-ltd', type: 'Visit', date: dates.d2, time: '10:30', note: VNOTE, done: false, done_at: null, log_id: null });
    await Store.col('orders').insert({ customer_id: 'zf-steering-gear-india-ltd', order_no: 'PO-7', part_code: 'VX1001', part: 'Hub', qty: 10, promised: dates.d5, status: 'Open', dispatched: null, note: ONOTE });
    const l = await Store.col('leads').insert({ company: 'Made Up Forge Pvt Ltd', company_key: CrmLeads.leadKey('Made Up Forge Pvt Ltd'), contact_name: 'Jane Test', email: LMAIL, phone: LPHONE, scope: 'Hubs', region_program: 'EU',
      segment_domain: 'CV', last_contact: dates.d3, context: LCTX, strategy: 'Call in November', bucket: 'A', fit: 'sweet', status: 'Open', source: 'Manual', sources: [] });
    await Store.col('leads').insert({ company: 'Other Test Works', company_key: CrmLeads.leadKey('Other Test Works'), contact_name: 'Raj Test', email: 'raj@example.invalid', bucket: 'dormant', status: 'Open', source: 'Manual', sources: [], context: '' });
    await Store.addLeadLog(l.row.id, { type: 'Call', note: 'lead touch text', at: dates.d3 });
    await Store.doc('targets').set({ v: 1, byFy: { '2026-27': { customers: { 'zf-steering-gear-india-ltd': 1500000 }, segments: { OEM: 40000000 } } }, settings: {} });
    await Store.setStatus('zf-steering-gear-india-ltd', 'At risk');
    App.flush();
  }, [NOTE, VNOTE, ONOTE, LCTX, LMAIL, LPHONE, { d2: istToday(2), d3: istToday(-3), d5: istToday(5) }]);

  const open = async (opts) => { const c = await t.fresh(opts); await t.open(c.page); return c; };
  const goExport = async (page) => { await t.tab(page, 'export'); await page.waitForSelector('#dataCard'); };
  const dl = (page, sel) => t.download(page, sel);

  // =========================================================================================
  const { ctx, page } = await open();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: t.url.replace(/\/$/, '') });
  await goExport(page);

  const cards = await page.evaluate(() => ['exInclude', 'exCustomers', 'exRfqs', 'exLeads', 'exVisits', 'exBackup', 'exReport', 'exAuto', 'dataCard'].map(i => !!document.getElementById(i)));
  const btns = await page.evaluate(() => ['csvBtn', 'copyBtn', 'export', 'rfqCsvBtn', 'leadCsvBtn', 'visitCsvBtn', 'backup', 'restoreBtn', 'weeklyReportBtn2', 'autoBtn'].map(i => !!document.getElementById(i)));
  check('Export tab shows customers, RFQs, visits, backup and data cards', cards.every(Boolean) && btns.every(Boolean) && (await page.locator('#exportMsg').getAttribute('role')) === 'status', JSON.stringify([cards, btns]));
  check('automatic Sheet export is disabled and marked coming next', await page.locator('#autoBtn').isDisabled() && /Coming next/i.test(await page.locator('#exAuto').innerText()));
  const counts0 = await page.locator('#dataList').innerText();
  check('the data card shows empty counts before any data', /42 customers/.test(counts0) && /0 RFQs/.test(counts0) && /0 leads/.test(counts0) && /Money files\s+None imported/.test(counts0) && /Invoice file\s+None imported/.test(counts0) && await page.locator('#clearRow button').count() === 0, counts0);
  check('the amounts box is hidden until money or invoices are imported', await page.locator('#incAmounts').isHidden());

  // ---------- customers.json keeps working ----------
  const cj = await dl(page, '#export');
  const cjObj = JSON.parse(cj.text);
  check('Download customers.json still downloads the git-safe file', cj.name === 'customers.json' && cjObj.customers.length === 42 && Object.keys(cjObj.customers[0]).join() === 'id,name,contact,contactFrom,city,state,phone,last,followUp,status,disputed,group,segment,vehicleSegment,plants,relatedParty,erpGroup');

  // ---------- seed data, then CSV ----------
  await seedData(page);
  await hubImport(page, AWAIT);
  await runImport(page, () => CrmMoney.openImport(), 'AGING.csv', AGING);
  await runImport(page, () => CrmRevenue.openImport(), 'INVOICE_REGISTER.csv', INVOICES);
  await page.evaluate(async () => { await Store.col('dispatches').replaceAll([{ date: '2026-10-01', customer_id: null, source_name: 'Imaginary Co', part_code: 'VX1', qty: 5, slip_type: 'Invoice' }, { date: '2026-10-12', customer_id: null, source_name: 'Imaginary Co', part_code: 'VX1', qty: 7, slip_type: 'Invoice' }]);
    await Store.doc('dispatch_meta').set({ fileName: 'd.csv', fileDate: '2026-10-12', firstDate: '2026-10-01', lastDate: '2026-10-12', rows: 2, skipped: 0, slipTypes: ['Invoice'] }); App.flush(); });
  await goExport(page);

  const stored = await page.evaluate(() => Store.col('rfqs').all().map(r => ({ no: r.rfq_no, ref: r.contact_ref, cust: r.customer_id })));
  check('Hub RFQ import stored a contact reference in this browser', stored.length === 1 && stored[0].ref.includes('contact-ref-secret-99') && stored[0].cust === ZFID, JSON.stringify(stored));
  await page.evaluate(async () => { await Store.addCustomer({ name: '=HYPERLINK("http://evil.example","x")', phone: '123' }); await Store.addCustomer({ name: '@cmd', phone: '' }); App.flush(); });
  await goExport(page);

  // default file: all customers (the Customers tab shows everything)
  await page.check('#exScope-cust-all');
  const all = await dl(page, '#csvBtn');
  const allRows = parse(all.text);
  check('CSV starts with a BOM and has the exact header', all.text.startsWith(BOM + '"Customer","Contact person","Phone","City","Group","Segment","Vehicle segment","Plants","Last order","Follow-up","Status","Last contacted","Notes count"\r\n') && all.text.endsWith('\r\n') && /^varsha-crm-customers-\d{4}-\d{2}-\d{2}\.csv$/.test(all.name), all.name + all.text.slice(0, 120));
  check('"All customers" has every row', allRows.length === 1 + 44, String(allRows.length));
  const zfRow = allRows.find(r => r[0] === ZF);
  check('CSV rows carry status, follow-up, last contacted and notes count', zfRow[10] === 'At risk' && zfRow[11] === istToday(-3) && zfRow[12] === '1' && allRows.find(r => r[0] === 'NR INDUSTRIES')[11] === '' && allRows.find(r => r[0] === 'NR INDUSTRIES')[12] === '1', JSON.stringify(zfRow));
  check('CSV guards formulas', all.text.includes('"\'=HYPERLINK(""http://evil.example"",""x"")"') && all.text.includes('"\'@cmd"'));
  check('CSV has no emails or GST', !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(all.text.replace(/\'@cmd/g, '').replace(/evil\.example/g, '')) && !all.text.includes(GSTIN) && !/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/.test(all.text));
  check('no notes unless ticked', !all.text.includes(NOTE) && !all.text.includes('plain note') && allRows[0].length === 13);
  check('no amounts unless ticked', !all.text.includes('1234567') && !all.text.includes('Outstanding') && !all.text.includes('150000') && !/1,234,567/.test(all.text));
  await page.check('#incNotes');
  const withNotes = parse((await dl(page, '#csvBtn')).text);
  check('ticking "Include notes" adds the Notes column with the text', withNotes[0].length === 14 && withNotes[0][13] === 'Notes' && withNotes.find(r => r[0] === ZF)[13].includes(NOTE) && withNotes.find(r => r[0] === 'NR INDUSTRIES')[13].includes('plain note'));
  await page.uncheck('#incNotes');
  check('the amounts box shows once money or invoices exist', await page.locator('#incAmounts').isVisible());
  await page.check('#incAmounts');
  const withAmt = parse((await dl(page, '#csvBtn')).text);
  const zfAmt = withAmt.find(r => r[0] === ZF);
  check('ticking "Include amounts" adds money and revenue columns', withAmt[0].slice(13).join('|') === 'Outstanding|Overdue|1-30 days|31-60 days|61-90 days|>90 days|Amount note|Revenue FY 2026-27 (Taxable)' && zfAmt[14] === '1234567.00' && zfAmt[20] === '150000.00', JSON.stringify(zfAmt.slice(13)));
  await page.uncheck('#incAmounts');

  // ---------- shown filter ----------
  await t.tab(page, 'list');
  await page.fill('#q', 'ZF STEERING');
  await goExport(page);
  await page.check('#exScope-cust-shown');
  check('the scope label counts the rows the Customers tab shows', /Customers in the Customers tab now \(1\), with current filters/.test(await page.locator('#exScopeText-cust-shown').innerText()) && /All customers \(44\)/.test(await page.locator('#exScopeText-cust-all').innerText()) && /Showing 1 of 44 customers/.test(await page.locator('#exCustSummary').innerText()), await page.locator('#exCustomers').innerText());
  const shown = await dl(page, '#csvBtn');
  check('CSV respects the current filter', parse(shown.text).length === 2 && parse(shown.text)[1][0] === ZF && /-shown-/.test(shown.name), shown.name + parse(shown.text).length);
  await t.reload(page);
  await goExport(page);
  check('scope survives a refresh', await page.isChecked('#exScope-cust-shown') && !(await page.isChecked('#exScope-cust-all')));
  await page.check('#exScope-cust-all');
  await t.reload(page);
  await goExport(page);
  check('the "All customers" scope survives a refresh too', await page.isChecked('#exScope-cust-all'));

  // ---------- boxes are never remembered ----------
  await page.check('#incNotes'); await page.check('#incContacts'); await page.check('#incAmounts');
  await t.tab(page, 'dash'); await t.tab(page, 'export');
  check('the boxes keep their ticks while you stay in the app', await page.isChecked('#incNotes') && await page.isChecked('#incContacts'));
  await t.reload(page);
  await goExport(page);
  check('both boxes are unticked after a refresh', !(await page.isChecked('#incNotes')) && !(await page.isChecked('#incContacts')) && !(await page.isChecked('#incAmounts')));
  check('contact box is unticked after a refresh', !(await page.isChecked('#incContacts')));
  check('the boxes are not written to browser storage', await page.evaluate(() => !Object.keys(localStorage).some(k => /incNotes|incContacts|incAmounts/i.test(k) || /incNotes|incContacts|incAmounts/i.test(localStorage.getItem(k) || ''))));

  // ---------- copy for Sheets ----------
  await page.click('#copyBtn');
  await page.waitForFunction(() => /Copied 44 customers/.test(document.getElementById('exportMsg').textContent));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const clipRows = clip.split('\n').map(l => l.split('\t'));
  check('Copy puts tab-separated rows on the clipboard', clipRows.length === 45 && clipRows[0].join('|') === 'Customer|Contact person|Phone|City|Group|Segment|Vehicle segment|Plants|Last order|Follow-up|Status|Last contacted|Notes count' && clipRows[1].length === 13 && !clip.startsWith('"') && !clip.includes(NOTE) && await page.locator('#copyFallback').isHidden(), JSON.stringify([clipRows.length, clipRows[1].length, clip.includes('","'), clip.startsWith('"'), await page.locator('#copyFallback').isHidden()]));
  const blocked = await open();
  await goExport(blocked.page);
  await blocked.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('blocked')) } }));
  await blocked.page.click('#copyBtn');
  await blocked.page.waitForSelector('#copyFallback:not([hidden])');
  const boxText = await blocked.page.inputValue('#copyBox');
  check('Copy falls back when the clipboard is blocked', boxText.split('\n').length === 43 && boxText.split('\n')[0].split('\t').length === 13 && await blocked.page.locator('#copyBox').evaluate(e => e.readOnly && e.selectionEnd > e.selectionStart) && /Ctrl\+C/.test(await blocked.page.locator('#copyFallback').innerText()), String(boxText.length));

  // ---------- RFQs CSV ----------
  await goExport(page);
  const rfq = await dl(page, '#rfqCsvBtn');
  const rfqRows = parse(rfq.text);
  check('RFQs CSV has the expected header and respects the RFQ filter', rfq.text.startsWith(BOM + '"RFQ no","Customer","Part name","Part no","Qty","Received","Quote due","Quoted value","Stage","Stage since","Next action","Lost"\r\n') && rfqRows.length === 2 && rfqRows[1][0] === 'EXT-1' && rfqRows[1][1] === ZF && /-shown-/.test(rfq.name) && /Contains quoted values/.test(await page.locator('#exRfqs').innerText()), rfq.text.slice(0, 200));
  await t.tab(page, 'rfqs');
  await page.fill('#rfqQ', 'zzz-no-such-rfq');
  await goExport(page);
  const rfqNone = await dl(page, '#rfqCsvBtn');
  await page.check('#exScope-rfq-all');
  const rfqAll = await dl(page, '#rfqCsvBtn');
  check('the RFQ filter limits the file and "All RFQs" has every RFQ', parse(rfqNone.text).length === 1 && parse(rfqAll.text).length === 2 && !/-shown-/.test(rfqAll.name));
  await t.tab(page, 'rfqs'); await page.fill('#rfqQ', '');
  await goExport(page);

  // ---------- the contact reference ----------
  const noTick = [cj.text, (await dl(page, '#export')).text, (await dl(page, '#backup')).text, rfqAll.text, rfq.text];
  check('contact reference is stored but not in any export unless ticked', noTick.every(x => !x.includes(REF) && !x.includes('asha.secret') && !x.includes('contact_ref":"c')) && !(await dl(page, '#visitCsvBtn')).text.includes(REF));
  await page.check('#incContacts');
  const rfqTick = await dl(page, '#rfqCsvBtn');
  const bkTick = await dl(page, '#backup');
  check('with "Include contact details" ticked the RFQ CSV and the backup carry the reference', rfqTick.text.includes('"Contact reference"') && rfqTick.text.includes(REF) && bkTick.text.includes(REF) && !(await dl(page, '#export')).text.includes(REF));
  await page.uncheck('#incContacts');

  // ---------- Leads CSV ----------
  const lead0 = await dl(page, '#leadCsvBtn');
  const leadRows = parse(lead0.text);
  check('Leads CSV has the exact header and respects the Leads filter', lead0.text.startsWith(BOM + '"Company","Key contact","Region / program","Scope","Segment / domain","Last contact","Bucket","Action category","Strategy","Next follow-up","Fit","Source","Status"\r\n') && leadRows.length === 3 && leadRows[0].length === 13 && /-shown-/.test(lead0.name), lead0.text.slice(0, 200));
  check('no email or phone columns unless "Include contact details" is ticked', !/Email|Phone/.test(leadRows[0].join()) && !lead0.text.includes(LMAIL) && !lead0.text.includes(LPHONE) && !lead0.text.includes('raj@example') && !lead0.text.includes(LCTX));
  check('lead bucket and fit are written as words', leadRows.some(r => r[0] === 'Made Up Forge Pvt Ltd' && r[6] === 'No response: awaiting them' && r[10] === 'Sweet spot' && r[12] === 'Open'), JSON.stringify(leadRows[1]));
  await page.check('#incContacts');
  await page.check('#incNotes');
  const lead1 = parse((await dl(page, '#leadCsvBtn')).text);
  check('ticking contact details adds Email and Phone; ticking notes adds Notes', lead1[0].slice(0, 4).join() === 'Company,Key contact,Email,Phone' && lead1[0][lead1[0].length - 1] === 'Notes' && lead1.some(r => r[2] === LMAIL && r[3] === "'" + LPHONE && r[r.length - 1] === LCTX));
  await page.uncheck('#incContacts'); await page.uncheck('#incNotes');
  await t.tab(page, 'leads');
  await page.click('.chip[data-b="dormant"]');
  await goExport(page);
  const leadShown = await dl(page, '#leadCsvBtn');
  check('the Leads CSV follows the Leads tab filter', parse(leadShown.text).length === 2 && parse(leadShown.text)[1][0] === 'Other Test Works' && /Leads shown in the Leads tab now \(1\)/.test(await page.locator('#exScopeText-lead-shown').innerText()));
  await page.check('#exScope-lead-all');
  check('"All leads" has every lead', parse((await dl(page, '#leadCsvBtn')).text).length === 3 && !/-shown-/.test((await dl(page, '#leadCsvBtn')).name));
  await t.reload(page); await goExport(page);
  check('the Leads scope survives a refresh', await page.isChecked('#exScope-lead-all'));

  // ---------- visits CSV ----------
  const vis = await dl(page, '#visitCsvBtn');
  check('Visits CSV has the header, the visit and no note unless ticked', vis.text.startsWith(BOM + '"Date","Time","Type","Customer","Done"\r\n') && parse(vis.text).length === 2 && parse(vis.text)[1][3] === ZF && !vis.text.includes(VNOTE));
  await page.check('#incNotes');
  const vis2 = parse((await dl(page, '#visitCsvBtn')).text);
  check('ticking notes adds the visit note', vis2[0].join() === 'Date,Time,Type,Customer,Note,Done' && vis2[1][4] === VNOTE);
  await page.uncheck('#incNotes');

  // ---------- backup ----------
  const bk0 = await dl(page, '#backup');
  const b0 = JSON.parse(bk0.text);
  check('backup has notes, RFQs, visits and targets but no money and no invoices', page && /^varsha-crm-backup-\d{4}-\d{2}-\d{2}\.json$/.test(bk0.name) && b0.format === 'varsha-crm-backup-v2' && b0.callLog.length === 3 && b0.rfqs.length === 1 && b0.visits.length === 1 && b0.orders.length === 1 && b0.leads.length === 2 &&
    b0.targets.byFy['2026-27'].customers[ZFID] === 1500000 && !('money' in b0) && !('revenue' in b0) && !bk0.text.includes('1234567') && !bk0.text.includes('"taxable"') && !bk0.text.includes(GSTIN), Object.keys(b0).join());
  check('the backup name is covered by .gitignore and it is not customers.json', /varsha-crm-backup-\*\.json/.test(t.fs.readFileSync(t.path.join(t.root, '.gitignore'), 'utf8')) && bk0.name !== 'customers.json');
  check('backup has leads but no emails or phones unless ticked', b0.leads.every(l => !l.email && !l.phone) && !bk0.text.includes(LMAIL) && !bk0.text.includes(LPHONE) && b0.includes.contactDetails === false && b0.leads.some(l => l.company === 'Made Up Forge Pvt Ltd'), JSON.stringify(b0.leads.map(l => [l.email, l.phone])));
  check('a backup without the notes box has no note text', ![NOTE, VNOTE, ONOTE, LCTX, 'lead touch text', 'plain note'].some(x => bk0.text.includes(x)) && b0.includes.notes === false && b0.callLog.length === 3);
  check('dispatch history and money are never in the backup', !bk0.text.includes('slip_type') && !bk0.text.includes('Imaginary Co') && !bk0.text.includes('AGING'));
  await page.check('#incNotes'); await page.check('#incContacts');
  const bk1 = await dl(page, '#backup');
  const b1 = JSON.parse(bk1.text);
  check('ticking both boxes makes a complete backup', [NOTE, VNOTE, ONOTE, LCTX, 'lead touch text', LMAIL, LPHONE, REF].every(x => bk1.text.includes(x)) && b1.includes.notes && b1.includes.contactDetails);
  check('the amounts box never changes the backup (no money, no invoices)', !bk1.text.includes('1234567') && !bk1.text.includes('"taxable"'));
  await page.uncheck('#incNotes'); await page.uncheck('#incContacts');

  // ---------- restore ----------
  const restoreWith = async (pg, text, accept) => {
    dialogs.length = 0;
    answer(pg, accept);
    await pg.setInputFiles('#restoreFile', { name: 'varsha-crm-backup.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
    await pg.waitForFunction(() => document.getElementById('exportMsg').textContent !== '' || !document.getElementById('exportErr').hidden);
  };
  const snap = () => page.evaluate(() => ({ status: Store.get('zf-steering-gear-india-ltd').status, visits: Store.col('visits').all().length, rfqs: Store.col('rfqs').all().length, orders: Store.col('orders').all().length,
    leads: Store.col('leads').all().map(l => l.email).sort(), log: Store.allLog().length, targets: !!Store.doc('targets').get(), ref: (Store.col('rfqs').all()[0] || {}).contact_ref || '' }));
  const before = await snap();
  await page.evaluate(async () => { await Store.setStatus('zf-steering-gear-india-ltd', 'Active'); await Store.col('visits').replaceAll([]); await Store.col('leads').replaceAll([]); await Store.col('rfqs').replaceAll([]); await Store.col('orders').replaceAll([]); await Store.doc('targets').clear(); App.flush(); });
  const wiped = await snap();
  await page.evaluate(() => { document.getElementById('exportMsg').textContent = ''; });
  await restoreWith(page, bk1.text, false);
  const cancelled = await snap();
  check('Restore asks first, says what the file has, and Cancel changes nothing', dialogs.length === 1 && /has 44 customers/.test(dialogs[0]) && /3 call-log entries/.test(dialogs[0]) && /2 leads/.test(dialogs[0]) && /cannot be undone/.test(dialogs[0]) && JSON.stringify(cancelled) === JSON.stringify(wiped) && /cancelled/i.test(await page.locator('#exportMsg').innerText()), dialogs[0]);
  await restoreWith(page, bk1.text, true);
  const restored = await snap();
  check('Restore brings back customers, RFQs, visits, orders, leads and targets', JSON.stringify(restored) === JSON.stringify(before) && /Restored from varsha-crm-backup\.json/.test(await page.locator('#exportMsg').innerText()), JSON.stringify([before, restored]));
  check('Restore does not duplicate call-log entries and keeps lead touches', restored.log === before.log && (await page.evaluate(() => Store.allLog().filter(e => e.leadId && !e.customerId).length)) === 1);
  await t.reload(page);
  check('a restore survives a refresh', JSON.stringify(await snap()) === JSON.stringify(before));
  await goExport(page);

  // a backup made without ticks must not wipe the emails, notes and references already here
  await restoreWith(page, bk0.text, true);
  const keep = await snap();
  check('restoring a backup made without contact details keeps the emails and references already here', JSON.stringify(keep.leads) === JSON.stringify(before.leads) && keep.ref === before.ref && keep.log === before.log, JSON.stringify(keep.leads));
  check('restoring a backup made without notes keeps the notes already here', (await page.evaluate(() => Store.listLog('zf-steering-gear-india-ltd')[0].note)) === NOTE && (await page.evaluate(() => Store.col('visits').all()[0].note)) === VNOTE && /without note text/.test(dialogs[0]));
  await restoreWith(page, cj.text, true);
  check('a file that is not a backup is refused with a reason and changes nothing', (await page.locator('#exportErr').isVisible()) && /customers\.json, not a backup/.test(await page.locator('#exportErr').innerText()) && dialogs.length === 0 && JSON.stringify(await snap()) === JSON.stringify(keep));
  // a customer edit in the backup is applied; an unedited customer is left alone
  const edited = JSON.parse(bk1.text);
  edited.customers.find(c => c.id === NRID).status = 'Follow up';
  edited.customers.find(c => c.id === NRID).followUp = istToday(4);
  edited.customers.push({ id: 'restored-new-co', name: 'Restored New Co', contact: '', contactFrom: '', city: 'Pune', state: '', phone: '', last: '', followUp: '', status: 'Active', disputed: false, group: '', segment: '', vehicleSegment: '', plants: [], relatedParty: false, erpGroup: '' });
  const upd0 = await page.evaluate(() => Store.get('nr-industries').updatedAt + '|' + Store.get('zf-steering-gear-india-ltd').updatedAt);
  await restoreWith(page, JSON.stringify(edited), true);
  const after = await page.evaluate(() => ({ nr: Store.get('nr-industries'), zf: Store.get('zf-steering-gear-india-ltd').updatedAt, nw: Store.customers().find(c => c.name === 'Restored New Co') }));
  check('Restore applies customer changes, adds new customers and leaves unchanged ones alone', after.nr.status === 'Follow up' && after.nr.followUp === istToday(4) && !!after.nw && after.nw.city === 'Pune' && after.zf === upd0.split('|')[1]);
  await t.reload(page);
  check('restored customer changes survive a refresh', (await page.evaluate(() => Store.get('nr-industries').status + '|' + !!Store.customers().find(c => c.name === 'Restored New Co'))) === 'Follow up|true');
  await goExport(page);

  // ---------- data card and Clear ----------
  const dc = await page.locator('#dataList').innerText();
  check('data card shows counts, "as of" dates and the invoice data-through date', /Notes and call log\s+2 entries \+ 1 lead touch/.test(dc) && /RFQs\s+1 RFQ/.test(dc) && /Leads\s+2 leads/.test(dc) && /Visits and calls\s+1 visit or call/.test(dc) && /Typed orders\s+1 order/.test(dc) &&
    new RegExp('AGING as of ' + require_date(istToday(-2)) + ' \\(1 row\\)').test(dc) && /Invoice file\s+2 invoices, data through 12 Jul 2026/.test(dc) && /Dispatch history\s+2 slips, data through 12 Oct 2026/.test(dc) && /Targets\s+FY 2026-27: 1 customer, 1 segment/.test(dc), dc);
  function require_date(iso) { const [y, m, d] = iso.split('-'); return +d + ' ' + MON[+m - 1] + ' ' + y; }
  check('Clear buttons exist only for datasets that hold data', (await page.locator('#clearRow button').allInnerTexts()).join('|') === 'Clear imported money data|Clear invoice data|Clear dispatch history');

  answer(page, false);
  await page.click('#clearMoney');
  check('Clear imported money data asks first, and No keeps the data', dialogs.length === 1 && /Remove the imported money data/.test(dialogs[0]) && (await page.evaluate(() => CrmMoney.has())) && /Nothing was removed/.test(await page.locator('#exportMsg').innerText()));
  answer(page, true);
  await page.click('#clearMoney');
  await page.waitForFunction(() => !CrmMoney.has());
  check('Clear imported money data removes amounts after confirm', !(await page.evaluate(() => CrmMoney.has())) && await page.locator('#clearMoney').count() === 0 && /Money files\s+None imported/.test(await page.locator('#dataList').innerText()) && (await page.evaluate(() => localStorage.getItem('varsha-crm-money-v1'))) === null);
  await t.reload(page);
  check('the money data stays cleared after a refresh', !(await page.evaluate(() => CrmMoney.has())));
  await goExport(page);
  answer(page, true);
  await page.click('#clearInvoices');
  await page.waitForFunction(() => !CrmRevenue.has());
  await goExport(page);
  check('data card shows invoice data-through date and Clear invoice data works', /Invoice file\s+None imported/.test(await page.locator('#dataList').innerText()) && (await page.evaluate(() => localStorage.getItem('varsha-crm-revenue-v1'))) === null && await page.locator('#incAmounts').isHidden());
  answer(page, true);
  await page.click('#clearDispatch');
  await page.waitForFunction(() => Store.col('dispatches').all().length === 0);
  await t.reload(page); await goExport(page);
  check('Clear dispatch history empties it after confirm and stays empty after a refresh', /Dispatch history\s+None imported/.test(await page.locator('#dataList').innerText()) && (await page.evaluate(() => Store.doc('dispatch_meta').get())) === null);
  check('clearing imported data leaves customers, notes, RFQs, leads and targets alone', await page.evaluate(() => Store.allLog().length === 3 + 0 && Store.col('rfqs').all().length === 1 && Store.col('leads').all().length === 2 && !!Store.doc('targets').get()));

  // ---------- weekly report ----------
  if (!(await t.has(page, 'window.CrmReport'))) t.skip('Weekly sales review button opens the report', 'needs A8');
  else {
    await page.click('#weeklyReportBtn2');
    await page.waitForSelector('#reportDlg[open]');
    check('Weekly sales review button opens the report', await page.locator('#reportDlg').evaluate(d => d.open));
    await page.keyboard.press('Escape');
  }

  // ---------- 375px ----------
  const ph = await open({ viewport: { width: 375, height: 760 } });
  await goExport(ph.page);
  await seedData(ph.page);
  await goExport(ph.page);
  await ph.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('blocked')) } }));
  await ph.page.click('#copyBtn');
  await ph.page.waitForSelector('#copyFallback:not([hidden])');
  const dims = await ph.page.evaluate(() => ({ page: document.documentElement.scrollWidth, wide: [...document.querySelectorAll('#panel-export *')].filter(e => e.getBoundingClientRect().right > 376 && getComputedStyle(e).position !== 'fixed' && !e.classList.contains('sr-only')).map(e => e.id || e.className).slice(0, 5) }));
  check('no sideways scroll on the Export tab at 375px', dims.page === 375 && dims.wide.length === 0, JSON.stringify(dims));
  const tapSizes = await ph.page.evaluate(() => [...document.querySelectorAll('#panel-export button:not([disabled]), #panel-export label.ex-check')].filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect().height).filter(h => h < 30).length);
  check('buttons and tick rows are big enough to tap at 375px', tapSizes === 0, String(tapSizes));

  // ---------- storage blocked ----------
  const nb = await open({ blockStorage: true });
  await goExport(nb.page);
  const blockedCsv = await dl(nb.page, '#csvBtn');
  check('with storage blocked the warning shows and the exports still work', await nb.page.locator('#storageWarn').isVisible() && parse(blockedCsv.text).length >= 2 && (await dl(nb.page, '#export')).name === 'customers.json');

  // ---------- no private text outside the browser database ----------
  const spots = await page.evaluate((words) => Object.keys(localStorage).filter(k => words.some(w => (localStorage.getItem(k) || '').includes(w))), [LMAIL, NOTE, REF]);
  check('private text lives only in the browser database key', spots.every(k => k === 'varsha-crm-localdb-v1') && spots.length === 1, spots.join());
};
