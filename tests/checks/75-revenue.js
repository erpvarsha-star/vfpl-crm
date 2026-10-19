// A7 checks: Revenue analytics and targets (js/revenue.js). Synthetic data only: made-up amounts and a made-up GSTIN, built inside this test.
// Customer names are the CRM's own names (they are already in customers.json); no real invoice amounts are used anywhere.
module.exports = async (t) => {
  const { check, istToday } = t;
  const { page } = await t.fresh();

  // ---------- fixture: exact INVOICE_REGISTER headers (+ GSTIN and tax columns that must never be stored) ----------
  const HEAD = 'Invoice No,Invoice Date,Customer On Invoice,Customer,ERP Group,PO No,Terms Days,Taxable,Invoice Amount,Due Date,GSTIN,CGST,SGST,IGST,TCS';
  const GSTIN = '27ABCDE1234F1Z5';
  const q = s => /[",]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
  const line = (no, date, cust, grp, taxable, invAmt) => [no, date, cust, cust, grp, 'PO-1', '30', taxable, invAmt, '30-Sep-26', GSTIN, '9,000', '9,000', '0', '100'].map(q).join(',');
  const ZF = 'ZF STEERING GEAR (INDIA) LTD', NR = 'NR INDUSTRIES', NEEL = 'NEEL METAL PRODUCTS LIMITED', SK = 'S K TRADERS';
  const MK = 'VARSHA FORGINGS LTD MARKAL', KC = 'KCTR VARSHA AUTOMOTIVE PVT. LTD.', ZETA = 'Zeta Imaginary Pvt Ltd';
  const main = [
    line('T1001', '01-Apr-26', ZF, 'Alpha Group', '100,000', '118,000'),
    line('T1007', '20-Jun-26', MK, 'Markal Grp', '450,000', '531,000'),
    line('T1011', '12-Jul-26', KC, 'KCTR Grp', '100,000', '118,000'),
    line('T1003', '05-May-26', ZF, 'Alpha Group', '200,000', '236,000'),
    line('T1002', '20-Apr-26', NR, 'Alpha Group', '50,000', '59,000'),
    line('T1004', '15-May-26', NEEL, 'Gamma', '30,000', '35,400'),
    line('T1005', '20-May-26', NEEL, 'Gamma', '-5,000', '-5,900'),
    line('T1006', '02-Jun-26', SK, 'S K TRADERS', '20,000', '23,600'),
    line('T1010', '12-Jul-26', NR, 'Alpha Group', '25,000', '29,500'),
    line('T1009', '03-Jul-26', ZF, 'Alpha Group', '100,000', '118,000'),
    line('T1008', '08-Jul-26', ZETA, 'Zeta Group', '15,000', '17,700'),
    line('T1001', '01-Apr-26', ZF, 'Alpha Group', '100,000', '118,000'),            // duplicate
    'Total,,,,,,,"999,999","999,999",,,,,,'                                         // total row
  ];
  const csv1 = [HEAD, ...main].join('\n') + '\n';
  const prior = [
    line('P1001', '15-Apr-25', ZF, 'Alpha Group', '80,000', '94,400'), line('P1002', '10-Jun-25', NR, 'Alpha Group', '40,000', '47,200'),
    line('P1003', '05-Jul-25', ZF, 'Alpha Group', '60,000', '70,800'), line('P1004', '20-Jul-25', NEEL, 'Gamma', '10,000', '11,800')
  ];
  const csv2 = [HEAD, ...main, ...prior].join('\n') + '\n';
  // expected numbers (related parties out): ZF 400000, NR 75000, NEEL 25000, SK 20000, unmatched 15000
  const FYTD = '₹5,35,000', RELATED = '₹5,50,000';
  const through = '2026-07-12', staleDays = Math.round((Date.parse(istToday(0)) - Date.parse(through)) / 86400000);

  // ---------- helpers ----------
  const slot = () => page.evaluate(() => {
    let s = document.getElementById('dashRevenue');
    if (!s) { s = document.createElement('section'); s.id = 'dashRevenue'; document.getElementById('panel-dash').appendChild(s); }
    CrmRevenue.renderCard(s);
  });
  const flush = () => page.evaluate(() => App.flush());
  const dash = async () => { await t.tab(page, 'dash'); await slot(); };
  const reloadDash = async () => { await t.reload(page); await dash(); };
  const txt = sel => page.locator(sel).innerText();
  const tc = sel => page.locator(sel).textContent();
  const color = sel => page.locator(sel).evaluate(e => getComputedStyle(e).color);
  const idOf = name => page.evaluate(n => Store.customers().find(c => c.name === n).id, name);
  const importCsv = async (text, name, wait) => {
    await page.click('#revImportBtn');
    await page.setInputFiles('#importFile', t.csvFile(name || 'INVOICE_REGISTER.csv', text));
    await page.waitForSelector(wait || '#importSummary li');
  };
  const confirmImport = async () => {
    await page.click('#importOk');
    await page.waitForFunction(() => !document.getElementById('importDlg').open);
    await page.waitForSelector('#revCard[data-state="data"]');
  };
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('varsha-crm-revenue-v1')));
  const setTargets = async (map, seg) => {
    await page.click('#revSetTargets');
    await page.waitForSelector('#targetsDlg[open]');
    for (const [name, v] of Object.entries(map)) await page.fill('#tgtCust .tgt-row[data-id="' + await idOf(name) + '"] input', String(v));
    for (const [s, v] of Object.entries(seg || {})) await page.fill('#tgtSeg .tgt-row[data-segment="' + s + '"] input', String(v));
    await page.click('#tgtSave');
    await page.waitForFunction(() => !document.getElementById('targetsDlg').open);
  };

  await t.open(page);
  await dash();

  // ---------- empty state ----------
  const empty = await txt('#revEmpty');
  check('empty state before import says Taxable is used', /No invoice data yet\./.test(empty) && /INVOICE_REGISTER/.test(empty) && /Taxable column \(before GST and TCS\)/.test(empty) && await page.locator('#revImportBtn').isVisible() && (await page.locator('#revCard').getAttribute('data-state')) === 'empty', empty);
  check('before an import the contract is empty', await page.evaluate(() => CrmRevenue.has() === false && CrmRevenue.stats() === null && CrmRevenue.meta() === null && CrmRevenue.forCustomer('zf-steering-gear-india-ltd') === null && CrmRevenue.fys().length === 0));

  // ---------- import: recognise, parse, store ----------
  await importCsv('Party,Overdue,Days\nA,1,2\n', 'wrong.csv', '#importErr:not([hidden])');
  const wrong = await txt('#importErr');
  check('a file from another tab shows the missing columns and blocks Import', /Missing: Invoice No, Invoice Date, Customer, Taxable\./.test(wrong) && await page.locator('#importOk').isDisabled(), wrong);
  await page.click('#importCancel');

  await importCsv(csv1);
  const sum = await txt('#importSummary');
  const kind = await page.locator('#importKind').evaluate(s => s.options[s.selectedIndex].text);
  check('INVOICE_REGISTER import recognises the exact headers', kind === 'INVOICE_REGISTER tab' && await page.locator('#importErr').isHidden() && /13 rows read · 12 kept · 1 skipped \(total row\)/.test(sum) && (await txt('#importOk')) === 'Import 12 rows' && await page.locator('#importOk').isEnabled(), kind + ' | ' + sum);
  check('the dialog says the file is read in this browser only and that Taxable is used', /Taxable column \(before GST and TCS\)/.test(await txt('#importIntro')) && /Invoice Amount is not used/.test(await txt('#importIntro')) && /read in this browser only/.test(await page.locator('#importDlg').innerText()));
  check('the import warns about the duplicate row', /1 duplicate invoice row \(same Invoice No and date\) will be ignored/.test(await txt('#importWarn')));
  check('there is no "Data as of" box (the data-through date comes from the invoices)', await page.locator('#importAsOf').isHidden());
  await confirmImport();
  const doc = await store();
  const rowOf = no => doc.rows.find(r => r.invoiceNo === no);
  check('dates like 01-Apr-26 and numbers with commas parse', doc.rows.length === 11 && rowOf('T1001').date === '2026-04-01' && rowOf('T1001').taxable === 100000 && rowOf('T1005').taxable === -5000 && rowOf('T1007').date === '2026-06-20' && rowOf('T1007').taxable === 450000, JSON.stringify(doc.rows[0]));
  check('stored rows have only the design fields and the customer links', JSON.stringify(Object.keys(doc.rows[0])) === JSON.stringify(['invoiceNo', 'date', 'customerId', 'sourceName', 'onInvoice', 'erpGroup', 'taxable']) && rowOf('T1001').customerId === 'zf-steering-gear-india-ltd' && rowOf('T1008').customerId === null);
  check('GSTIN and tax columns are never stored', await page.evaluate(g => {
    for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)); if (v.includes(g) || /CGST|SGST|IGST|TCS|GSTIN|invoiceAmount|Invoice Amount/.test(v)) return false; }
    return true;
  }, GSTIN));
  check('duplicate invoice rows are ignored and reported', doc.meta.duplicates === 1 && /1 duplicate ignored/.test(await txt('#revThroughText')), await txt('#revThroughText'));
  check('"Data through" shows the last invoice date, whatever the row order', doc.meta.lastDate === through && doc.meta.firstDate === '2026-04-01' && (await txt('#revThroughText')) === 'Data through 12 Jul 2026 · 11 invoices · 1 duplicate ignored', await txt('#revThroughText'));
  check('old invoice data is flagged in orange with words', staleDays > 30 ? ((await txt('#revStale')) === 'Invoice data is ' + staleDays + ' days old' && (await color('#revStale')) === 'rgb(180, 83, 9)') : true, await txt('#revStale').catch(() => 'none'));
  check('revenue uses Taxable, not Invoice Amount', (await txt('#revTileFytd .v')) === FYTD && !(await txt('#revCard')).includes('6,31,300') && /Taxable column \(before GST and TCS\)/.test(await txt('#revBasisNote')) && /Invoice Amount is not used/.test(await txt('#revBasisNote')), await txt('#revTileFytd .v'));
  check('stats() has the contract shape', await page.evaluate(() => {
    const s = CrmRevenue.stats({ includeRelated: false, to: 'data' });
    return ['excludedRelated', 'fy', 'to', 'dataThrough', 'fytd', 'mtd', 'mtdLabel', 'prior', 'months', 'top10', 'top1Share', 'top5Share', 'concentration', 'bySegment', 'byGroup', 'unmatched', 'targets'].every(k => k in s) &&
      s.months.length === 12 && s.fy === '2026-27' && CrmRevenue.fyOf('2026-04-01') === '2026-27' && CrmRevenue.fys().join() === '2026-27' && CrmRevenue.has() && CrmRevenue.meta().lastDate === '2026-07-12';
  }));
  check('forCustomer gives FY to date, month to date and the max invoice date', await page.evaluate(() => {
    const f = CrmRevenue.forCustomer('zf-steering-gear-india-ltd'), n = CrmRevenue.forCustomer('neel-metal-products-limited');
    return f.fytd === 400000 && f.mtd === 100000 && f.lastInvoice === '2026-07-03' && n.lastInvoice === '2026-05-15' && n.fytd === 25000;
  }));

  // ---------- related parties ----------
  const excl = await txt('#revExcl');
  check('related parties are excluded by default and the note says "Excludes 2 related parties"', (await txt('#revTileFytd .v')) === FYTD && excl === 'Excludes 2 related parties (' + RELATED + ')' && (await page.getAttribute('#incRelated', 'aria-pressed')) === 'false', excl);
  await page.click('#revExcl');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('the Excludes note opens the related parties on the Customers tab', (await txt('#extraLabel')) === 'Related parties' && (await t.rows(page)) === 2);
  await dash();

  // ---------- tiles, both measure-to choices ----------
  check('FY to date and month to date match the fixture (measure to the last invoice date)',
    (await tc('#revTileFytd .k')) === 'FY 2026-27 to date' && (await txt('#revTileFytd .v')) === FYTD && (await tc('#revTileMtd .k')) === 'Month to date (July 2026)' && (await txt('#revTileMtd .v')) === '₹1,40,000' &&
    (await page.getAttribute('#revToData', 'aria-pressed')) === 'true' && /Invoices up to 12 Jul 2026/.test(await txt('#revTileFytd .s')));
  await page.click('#revToToday');
  const todayMonth = await page.evaluate(() => { const d = Store.todayISO(); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4); });
  const laterThanData = istToday(0) > '2026-07-31';
  check('measuring to today keeps all invoices and moves the month to the current one', laterThanData ? ((await txt('#revTileFytd .v')) === FYTD && (await tc('#revTileMtd .k')) === 'Month to date (' + todayMonth + ')' && (await txt('#revTileMtd .v')) === '₹0') : true, await tc('#revTileMtd .k'));
  await reloadDash();
  check('the measure-to choice survives a refresh', (await page.getAttribute('#revToToday', 'aria-pressed')) === 'true' && (await page.getAttribute('#revToData', 'aria-pressed')) === 'false');
  await page.click('#revToData');
  await page.click('#revTileFytd');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('the FY tile opens the invoiced customers, largest first', (await txt('#extraLabel')) === 'Invoiced in FY 2026-27' && (await t.rows(page)) === 4 && (await txt('#rows tr:first-child td.name')).startsWith(ZF), await txt('#extraLabel'));
  await dash();

  // ---------- trend ----------
  const bars = await page.locator('#revTrend .vbar').evaluateAll(b => b.map(x => ({ ym: x.dataset.ym, label: x.querySelector('.m-full').textContent, aria: x.getAttribute('aria-label'), disabled: x.disabled })));
  check('monthly trend runs April to March', bars.length === 12 && bars[0].ym === '2026-04' && bars[0].label === 'Apr' && bars[11].ym === '2027-03' && bars[11].label === 'Mar' && /April 2026: ₹1,50,000/.test(bars[0].aria) && /May 2026: ₹2,25,000/.test(bars[1].aria) && bars[4].disabled, JSON.stringify(bars[0]));
  await page.click('#revTrend .vbar[data-ym="2026-05"]');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('month column opens customers invoiced that month', (await txt('#extraLabel')) === 'Invoiced in May 2026' && (await t.rows(page)) === 2, await txt('#extraLabel'));
  await dash();

  // ---------- top 10 ----------
  const top = await page.locator('#revTop10 .hbar').evaluateAll(b => b.map(x => x.querySelector('.nm').textContent));
  check('top 10 is sorted and each bar opens that customer', top.join('|') === '1. ' + ZF + '|2. ' + NR + '|3. ' + NEEL + '|4. ' + SK && /₹4\.00 L · 75%/.test(await txt('#revTop10 .hbar:first-child .val')), top.join('|'));
  await page.click('#revTop10 .hbar:first-child');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('a top-10 bar opens only that customer', (await t.rows(page)) === 1 && (await txt('#extraLabel')) === 'Customer: ' + ZF);
  await dash();
  await page.click('#revTop10All');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('"Show these 4" opens all of them', (await t.rows(page)) === 4);
  await dash();

  // ---------- concentration ----------
  check('top 1 and top 5 shares show', (await tc('#revConc')) === 'Top customer 75% · Top 5 97%', await tc('#revConc'));
  check('concentration risk is red with text above the threshold', (await txt('#revRisk')) === 'Concentration risk: ' + ZF + ' is 75% of revenue (limit 25%)' && (await color('#revRisk')) === 'rgb(180, 35, 24)', await txt('#revRisk'));
  await page.fill('#concPct', '3');
  await page.dispatchEvent('#concPct', 'change');
  await page.waitForSelector('#concErr:not([hidden])');
  check('a limit outside 5 to 90 is refused with words', /whole number from 5 to 90/.test(await txt('#concErr')) && (await txt('#revRisk')).startsWith('Concentration risk'));
  await page.fill('#concPct', '80');
  await page.dispatchEvent('#concPct', 'change');
  await page.waitForFunction(() => /below the 80% limit/.test(document.getElementById('revRisk').textContent));
  await reloadDash();
  check('threshold change survives a refresh', (await page.inputValue('#concPct')) === '80' && (await txt('#revRisk')) === 'Top customer below the 80% limit' && await page.evaluate(() => CrmRevenue.stats().concentration.thresholdPct === 80));
  await page.fill('#concPct', '25');
  await page.dispatchEvent('#concPct', 'change');
  await page.click('#revTop1Btn');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('the top-customer number opens that customer', (await t.rows(page)) === 1);
  await dash();
  await page.click('#revTop5Btn');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('the top-5 number opens up to five customers', (await t.rows(page)) === 4);
  await dash();

  // ---------- segments and groups ----------
  await page.evaluate(async ([a, b, c]) => { await Store.saveCustomer(a, { segment: 'OEM' }); await Store.saveCustomer(b, { segment: 'OEM' }); await Store.saveCustomer(c, { segment: 'Tier-1' }); App.flush(); },
    [await idOf(ZF), await idOf(NR), await idOf(NEEL)]);
  await flush();
  const segs = await page.locator('#revSegments .hbar').evaluateAll(b => b.map(x => x.querySelector('.nm').textContent));
  check('share by segment lists OEM, Tier-1 and Not set last, with amounts and %', segs.join('|') === 'OEM|Tier-1|Not set' && /₹4\.75 L · 89%/.test(await txt('#revSegments .hbar:first-child .val')), segs.join('|'));
  check('share by segment and by ERP group add up to 100%', await page.evaluate(() => {
    const s = CrmRevenue.stats(), sum = l => l.reduce((x, e) => x + e.share, 0);
    return Math.abs(sum(s.bySegment) - 100) < 1e-9 && Math.abs(sum(s.byGroup) - 100) < 1e-9 && s.byGroup[0].group === 'Alpha Group';
  }));
  await page.click('#revSegments .hbar[data-segment="OEM"]');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('a segment bar opens that segment on the Customers tab', (await t.rows(page)) === 2);
  await dash();
  await page.click('#revSegments .hbar[data-segment="none"]');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('"Not set" opens the customers with no segment', (await t.rows(page)) === 42 - 3);
  await dash();
  await page.click('#revGroups .hbar[data-group="Alpha Group"]');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('a group bar opens the customers of that ERP group', (await txt('#extraLabel')) === 'ERP Group: Alpha Group' && (await t.rows(page)) === 2);
  await dash();

  // ---------- targets ----------
  check('no targets yet says so and offers Set targets', (await txt('#revTargetText')) === 'No targets set for FY 2026-27.' && await page.locator('#revSetTargets').isVisible());
  await page.click('#revSetTargets');
  await page.waitForSelector('#targetsDlg[open]');
  await page.fill('#tgtCust .tgt-row[data-id="' + await idOf(ZF) + '"] input', '12a');
  await page.click('#tgtSave');
  const terr = await txt('#tgtErr');
  check('a target that is not a number is refused with the row name', /^Row ZF STEERING GEAR \(INDIA\) LTD: target is not a number\.$/.test(terr) && await page.locator('#targetsDlg').evaluate(d => d.open), terr);
  await page.fill('#tgtFilter', 'neel');
  check('the customer list can be filtered by name', (await page.locator('#tgtCust .tgt-row:not([hidden])').count()) === 1);
  await page.fill('#tgtFilter', '');
  await page.fill('#tgtCust .tgt-row[data-id="' + await idOf(ZF) + '"] input', '2000000');
  await page.fill('#tgtCust .tgt-row[data-id="' + await idOf(NR) + '"] input', '500000');
  await page.fill('#tgtCust .tgt-row[data-id="' + await idOf(MK) + '"] input', '600000');
  await page.fill('#tgtSeg .tgt-row[data-segment="OEM"] input', '5000000');
  await page.click('#tgtSave');
  await page.waitForFunction(() => !document.getElementById('targetsDlg').open);
  await reloadDash();
  check('targets per customer and per segment survive a refresh', await page.evaluate(async () => {
    const t = JSON.parse(localStorage.getItem('varsha-crm-targets-v1')), f = t.byFy['2026-27'];
    return f.customers['zf-steering-gear-india-ltd'] === 2000000 && f.customers['nr-industries'] === 500000 && f.segments.OEM === 5000000;
  }) && (await txt('#revTargetText')).startsWith('Targets FY 2026-27: ₹4,75,000 of ₹25,00,000 (19%)'), await txt('#revTargetText'));
  await page.click('#revSetTargets');
  await page.waitForSelector('#targetsDlg[open]');
  check('the targets dialog shows the saved targets and the actual FY to date', (await page.inputValue('#tgtCust .tgt-row[data-id="' + await idOf(ZF) + '"] input')) === '2000000' && (await page.inputValue('#tgtSeg .tgt-row[data-segment="OEM"] input')) === '5000000' &&
    (await txt('#tgtCust .tgt-row[data-id="' + await idOf(ZF) + '"] .act')) === 'FY to date ₹4,00,000' && /never saved to git/.test(await txt('#targetsDlg')));
  await page.click('#tgtCancel');
  check('customer targets are used before segment targets', (await txt('#revBasis')) === 'Based on customer targets (2 customers)' && await page.evaluate(() => CrmRevenue.stats().targets.basis === 'customers'), await txt('#revBasis'));
  const pace = await txt('#revPace');
  check('behind pace is red and says "Behind pace"', pace === 'Behind pace: 19% of target, 28% expected' && (await color('#revPace')) === 'rgb(180, 35, 24)', pace);
  const behindRows = await page.locator('#revBehindList .hbar').evaluateAll(b => b.map(x => x.textContent));
  check('the most-behind customers are listed with the words "Behind pace"', behindRows.length === 2 && behindRows.every(r => /Behind pace/.test(r)) && /^NR INDUSTRIES.*15% of target/.test(behindRows[0]), JSON.stringify(behindRows));
  await page.click('#revBehindBtn');
  await page.waitForSelector('#panel-list:not([hidden])');
  check('"Behind pace (2 customers)" opens them', (await txt('#extraLabel')) === 'Behind target pace' && (await t.rows(page)) === 2);
  await dash();
  // change targets to be on pace
  await setTargets({ [ZF]: 1000000, [NR]: 100000 });
  check('on pace says "On pace"', (await txt('#revPace')) === 'On pace' && (await color('#revPace')) === 'rgb(26, 127, 75)' && (await txt('#revTargetText')) === 'Targets FY 2026-27: ₹4,75,000 of ₹11,00,000 (43%)', await txt('#revTargetText'));
  check('the progress bar shows the percent and the pace mark', await page.evaluate(() => {
    const p = document.querySelector('.prog'), f = p.querySelector('.fill'), m = p.querySelector('.pace');
    return p.getAttribute('role') === 'progressbar' && Math.abs(parseFloat(f.style.width) - 43.18) < 0.1 && Math.abs(parseFloat(m.style.left) - 28.22) < 0.1;
  }));

  // ---------- include related parties ----------
  await page.click('#incRelated');
  const inc = {
    on: await page.getAttribute('#incRelated', 'aria-pressed'), fytd: await txt('#revTileFytd .v'), note: await txt('#revIncl'),
    top: await txt('#revTop10 .hbar:first-child .nm'), conc: await txt('#revRisk'), exclGone: (await page.locator('#revExcl').count()) === 0,
    targets: await txt('#revTargetText'), segNotSet: await txt('#revSegments .hbar:last-child .val')
  };
  check('"Include related parties" adds them back to FYTD, top 10, concentration, segment share and targets',
    inc.on === 'true' && inc.fytd === '₹10,85,000' && inc.top === '1. ' + MK && inc.conc === 'Concentration risk: ' + MK + ' is 41% of revenue (limit 25%)' && inc.exclGone && /^Includes 2 related parties/.test(inc.note) &&
    inc.targets === 'Targets FY 2026-27: ₹9,25,000 of ₹17,00,000 (54%)' && /₹5\.85 L/.test(inc.segNotSet), JSON.stringify(inc));
  await reloadDash();
  check('"Include related parties" survives a refresh', (await page.getAttribute('#incRelated', 'aria-pressed')) === 'true' && (await txt('#revTileFytd .v')) === '₹10,85,000' && await page.evaluate(() => CrmRevenue.viewOpts().includeRelated === true));
  await page.click('#incRelated');
  check('switching it off restores the exclusion note', (await txt('#revExcl')) === 'Excludes 2 related parties (' + RELATED + ')' && (await txt('#revTileFytd .v')) === FYTD);

  // ---------- use this file: Update Last order, Fill blank groups ----------
  await page.evaluate(async ([zf, nr, neel, sk, mk, kc]) => {
    await Store.saveCustomer(zf, { last: '2026-08-01' });   // newer than the file: unchanged
    await Store.saveCustomer(nr, { last: '2026-01-01' });   // older: updated to 2026-07-12
    await Store.saveCustomer(neel, { last: '' });           // none: set to 2026-05-15 (the credit note does not count)
    await Store.saveCustomer(sk, { last: '2026-06-02' });   // same: unchanged
    await Store.saveCustomer(mk, { last: '2027-01-01' });
    await Store.saveCustomer(kc, { last: '2027-01-01' });
    await Store.saveCustomer(neel, { group: 'Existing Group' });
    App.flush();
  }, [await idOf(ZF), await idOf(NR), await idOf(NEEL), await idOf(SK), await idOf(MK), await idOf(KC)]);
  await flush();
  check('the button names how many customers have a newer invoice', (await txt('#revUpdateLast')) === 'Update Last order for 2 customers from this file', await txt('#revUpdateLast').catch(() => 'none'));
  await page.click('#revUpdateLast');
  await page.waitForFunction(() => !document.getElementById('revUpdateLast'));
  const lasts = async () => page.evaluate(() => { const o = {}; Store.customers().forEach(c => { o[c.name] = c.last; }); return o; });
  const l1 = await lasts();
  check('Update Last order changes only customers with a newer invoice', l1[NR] === '2026-07-12' && l1[NEEL] === '2026-05-15' && l1[ZF] === '2026-08-01' && l1[SK] === '2026-06-02' && l1[MK] === '2027-01-01', JSON.stringify([l1[NR], l1[NEEL], l1[ZF], l1[SK]]));
  await reloadDash();
  const l2 = await lasts();
  check('updated Last order survives a refresh and the button is gone', l2[NR] === '2026-07-12' && l2[NEEL] === '2026-05-15' && (await page.locator('#revUpdateLast').count()) === 0);
  check('the fill button counts blank groups where every row has one ERP Group', (await txt('#revFillGroups')) === 'Fill 4 blank groups from ERP Group', await txt('#revFillGroups').catch(() => 'none'));
  await page.click('#revFillGroups');
  await page.waitForFunction(() => !document.getElementById('revFillGroups'));
  const grp = async () => page.evaluate(() => { const o = {}; Store.customers().forEach(c => { o[c.name] = c.group; }); return o; });
  const g1 = await grp();
  check('Fill blank groups from ERP Group only fills blanks', g1[ZF] === 'Alpha Group' && g1[NR] === 'Alpha Group' && g1[MK] === 'Markal Grp' && g1[KC] === 'KCTR Grp' && g1[NEEL] === 'Existing Group' && g1[SK] === '', JSON.stringify([g1[ZF], g1[NEEL], g1[SK]]));
  await reloadDash();
  check('filled groups survive a refresh', (await grp())[ZF] === 'Alpha Group');

  // ---------- never in customers.json or the backup ----------
  const exp = await page.evaluate(() => ({ cj: JSON.stringify(Store.exportCustomersJson()), bk: Store.exportBackup() }));
  const bk = JSON.stringify(exp.bk);
  check('revenue never appears in customers.json or the backup', !/T100\d|T1011|taxable|invoiceNo|"rows"/.test(exp.cj) && !/T100\d|T1011|taxable|invoiceNo|"rows"/.test(bk) && !bk.includes(GSTIN) && exp.bk.targets && exp.bk.targets.byFy['2026-27'].customers[await idOf(ZF)] === 1000000);

  // ---------- hide amounts ----------
  await page.click('#revHide');
  const hid = await txt('#revCard');
  check('Hide amounts masks revenue', !/₹\s?\d/.test(hid) && (await txt('#revTileFytd .v')) === '₹ •••' && (await page.locator('#revTileFytd .v .amt').getAttribute('aria-label')) === 'amount hidden' &&
    !(await page.locator('#revTrend .vbar').first().getAttribute('aria-label')).match(/₹\s?\d/) && /\d+%/.test(await txt('#revTop10 .hbar:first-child .val')), hid.slice(0, 300));
  await reloadDash();
  check('Hide amounts survives a refresh', (await txt('#revTileFytd .v')) === '₹ •••' && (await page.getAttribute('#revHide', 'aria-pressed')) === 'true');
  await page.click('#revHide');
  check('and shows the amounts again', (await txt('#revTileFytd .v')) === FYTD);

  // ---------- prior year, financial year choice ----------
  check('prior-year comparison is absent without prior-year rows', (await page.locator('#revPrior').count()) === 0 && (await page.locator('#revTrend .prior').count()) === 0 && (await page.locator('#revFy option').count()) === 1);
  await importCsv(csv2);
  check('a re-import shows how many rows were read and replaces the data', /17 rows read · 16 kept/.test(await txt('#importSummary')));
  await confirmImport();
  check('prior-year comparison appears only with prior-year rows', (await txt('#revPrior')) === 'vs same period last FY +197%' && (await page.locator('#revTrend .prior').count()) === 4 && (await txt('#revFy option:first-child')) === 'FY 2026-27' && (await page.locator('#revFy option').count()) === 2, await txt('#revPrior').catch(() => 'none'));
  check('the re-import replaced the earlier rows (15 invoices, no double counting)', (await store()).rows.length === 15 && (await txt('#revTileFytd .v')) === FYTD);
  await page.selectOption('#revFy', '2025-26');
  check('choosing the earlier year shows that year whole, with no comparison of its own', (await tc('#revTileFytd .k')) === 'FY 2025-26 to date' && (await txt('#revTileFytd .v')) === '₹1,90,000' && (await page.locator('#revPrior').count()) === 0 && (await txt('#revTargetText')) === 'No targets set for FY 2025-26.');
  await reloadDash();
  check('the financial year choice survives a refresh', (await page.inputValue('#revFy')) === '2025-26' && (await tc('#revTileFytd .k')) === 'FY 2025-26 to date');
  await page.selectOption('#revFy', '2026-27');

  // ---------- clear ----------
  page.once('dialog', d => d.dismiss());
  await page.click('#revClearBtn');
  check('Clear invoice data does nothing if you cancel', (await store()) !== null && (await page.locator('#revCard').getAttribute('data-state')) === 'data');
  page.once('dialog', d => d.accept());
  await page.click('#revClearBtn');
  await page.waitForSelector('#revCard[data-state="empty"]');
  check('Clear invoice data removes it after confirm', (await store()) === null && await page.evaluate(() => !CrmRevenue.has()));
  await reloadDash();
  check('and stays cleared after a refresh, keeping the targets', (await page.locator('#revCard').getAttribute('data-state')) === 'empty' && await page.evaluate(() => !!JSON.parse(localStorage.getItem('varsha-crm-targets-v1')).byFy['2026-27']));

  // ---------- 375px ----------
  const ph = await t.fresh({ viewport: { width: 375, height: 760 } });
  const p2 = ph.page;
  await t.open(p2);
  await p2.evaluate(() => { const s = document.createElement('section'); s.id = 'dashRevenue'; document.getElementById('panel-dash').appendChild(s); CrmRevenue.renderCard(s); });
  const wide = await p2.evaluate(() => document.documentElement.scrollWidth);
  await p2.click('#revImportBtn');
  await p2.setInputFiles('#importFile', t.csvFile('x.csv', csv2));
  await p2.waitForSelector('#importSummary li');
  await p2.click('#importOk');
  await p2.waitForFunction(() => !document.getElementById('importDlg').open);
  await p2.waitForSelector('#revCard[data-state="data"]');
  await p2.evaluate(async () => {
    await Store.saveCustomer('zf-steering-gear-india-ltd', { segment: 'OEM' });
    await Store.doc('targets').set({ v: 1, byFy: { '2026-27': { customers: { 'zf-steering-gear-india-ltd': 2000000, 'nr-industries': 500000 }, segments: {} } }, settings: {} });
    App.flush();
  });
  const fit = await p2.evaluate(() => {
    const card = document.getElementById('revCard').getBoundingClientRect();
    const over = Array.from(document.querySelectorAll('#revCard *')).filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > 375.5).map(e => e.tagName + '.' + e.className).slice(0, 5);
    return { page: document.documentElement.scrollWidth, left: card.left, right: card.right, over };
  });
  check('no sideways scroll on the revenue card at 375px', wide <= 375 && fit.page <= 375 && fit.left >= 0 && fit.right <= 375.5 && fit.over.length === 0, JSON.stringify(fit));
  const short = await p2.evaluate(() => Array.from(document.querySelectorAll('#revTrend .vbar')).map(b => getComputedStyle(b.querySelector('.m-short')).display !== 'none' && getComputedStyle(b.querySelector('.m-full')).display === 'none').every(Boolean));
  check('month labels shrink to a letter at 375px and the amounts are in the details list', short && (await p2.locator('.rev-months').count()) === 1 && await p2.evaluate(() => { const d = document.querySelector('.rev-months'); d.open = true; return /April 2026: ₹1,50,000/.test(d.innerText); }));
  await p2.click('#revSetTargets');
  await p2.waitForSelector('#targetsDlg[open]');
  const dlgFit = await p2.evaluate(() => {
    const d = document.getElementById('targetsDlg').getBoundingClientRect();
    const rows = document.querySelectorAll('#tgtCust .tgt-row');
    const r0 = rows[0].getBoundingClientRect(), nm = rows[0].querySelector('.nm').getBoundingClientRect(), inp = rows[0].querySelector('input').getBoundingClientRect();
    return { page: document.documentElement.scrollWidth, left: d.left, right: d.right, bottom: d.bottom, vh: innerHeight, stacked: inp.top >= nm.bottom - 1, rowRight: r0.right };
  });
  check('no sideways scroll on the targets dialog at 375px', dlgFit.page <= 375 && dlgFit.left >= 0 && dlgFit.right <= 375.5 && dlgFit.bottom <= dlgFit.vh + 1 && dlgFit.stacked && dlgFit.rowRight <= 375.5, JSON.stringify(dlgFit));
  const ok375 = await p2.evaluate(() => { const b = document.getElementById('tgtSave').getBoundingClientRect(); return b.right <= 375.5 && b.bottom <= innerHeight; });
  check('the Save button is reachable at 375px', ok375);
};
