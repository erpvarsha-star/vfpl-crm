// A5 Money checks: AGING and LIVE_POSITION import, per-customer amounts, stats, the money card.
// Fixtures are built here with made-up amounts. The card is hosted in a test div because the Dashboard (A3) is not part of this branch.
module.exports = async (t) => {
  const { check, istToday } = t;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const asOnText = (iso) => { const [y, m, d] = iso.split('-'); return d + '-' + MON[+m - 1] + '-' + y.slice(2); };
  const human = (iso) => { const [y, m, d] = iso.split('-'); return +d + ' ' + MON[+m - 1] + ' ' + y; };
  const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

  const AGING_HEAD = 'Customer,Printed Terms Days,ERP Total,ERP Not Due,ERP Overdue,Model Not Due,1-30,31-60,61-90,>90,Pre April,Credit Balance,Model Overdue,As On';
  const OLD = istToday(-5), NEW = istToday(-2);       // the newest As On is NOT on the first row
  const aging = [
    AGING_HEAD,
    'ZF STEERING GEAR (INDIA) LTD,45,"1,500,000","500,000","1,000,000","450,000","100,000","200,000","300,000","250,000","150,000",0,"1,000,000",' + asOnText(OLD),
    'NR INDUSTRIES,,"1,234,567",0,"-2,500",0,"-2,500",0,0,0,0,"2,500","-2,500",' + asOnText(NEW),
    'Imaginary Group,30,"1,000,000","400,000","600,000","300,000",0,0,0,"400,000","200,000",0,"600,000",' + asOnText(OLD),
    'Zeta Imaginary Pvt Ltd,,"10,000",0,"10,000",0,"10,000",0,0,0,0,0,"10,000",' + asOnText(NEW),
    'VARSHA FORGINGS LTD MARKAL,,"40,000",0,"40,000",0,"40,000",0,0,0,0,0,"40,000",' + asOnText(NEW),
    'Total,,"9,999,999",0,"9,999,999",0,0,0,0,0,0,0,0,'
  ].join('\n') + '\n';
  const LIVE_HEAD = 'Customer,ERP 15-Oct,Invoices Since,Receipts Since,Estimated Live,As On';
  const live = [
    LIVE_HEAD,
    'ZF STEERING GEAR (INDIA) LTD,"2,000,000","300,000","100,000","2,200,000",' + asOnText(NEW),
    'NR INDUSTRIES,"50,000",0,0,"50,000",' + asOnText(NEW),
    'Imaginary Group,"900,000","10,000","5,000","905,000",' + asOnText(NEW),
    'Zeta Imaginary Pvt Ltd,"20,000",0,0,"20,000",' + asOnText(NEW),
    'VARSHA FORGINGS LTD MARKAL,"15,000",0,0,"15,000",' + asOnText(NEW)
  ].join('\n') + '\n';
  const OVERDUE_TOTAL = 1000000 - 2500 + 600000 + 10000 + 40000;     // 1,647,500: every row, the group once
  const OUTSTANDING_TOTAL = 2200000 + 50000 + 905000 + 20000 + 15000; // 3,190,000

  const seed = JSON.parse(JSON.stringify(t.data));
  seed.customers.filter(c => c.name.startsWith('SANGKAJ')).forEach(c => { c.erpGroup = 'Imaginary Group'; });
  const SANG = ['sangkaj-auto-components-private-limited', 'sangkaj-industries-pvt-ltd'];

  const newCtx = (opts = {}) => t.fresh(Object.assign({ init: (d) => { window.CRM_DATA = d; }, initArg: seed }, opts));
  const host = (page) => page.evaluate(() => {
    let h = document.getElementById('moneyHost');
    if (!h) { h = document.createElement('div'); h.id = 'moneyHost'; document.getElementById('panel-dash').appendChild(h); }
    CrmMoney.renderCard(h);
  });
  const settle = (page) => page.evaluate(() => App.flush());
  const stats = (page) => page.evaluate(() => CrmMoney.stats());
  const closed = (page) => page.waitForFunction(() => !document.getElementById('importDlg').open);
  async function pick(page, name, text) {
    await page.click('#moneyImportBtn');
    await page.setInputFiles('#importFile', t.csvFile(name, text));
    await page.waitForSelector('#importSummary li, #importErr:not([hidden])');
  }
  async function doImport(page, name, text, o = {}) {
    await pick(page, name, text);
    if (o.asOf) await page.fill('#importAsOf', o.asOf);
    for (const [n, id] of Object.entries(o.match || {})) await page.locator('#importUnmatched li', { hasText: n }).locator('select').selectOption(id);
    await page.click('#importOk');
    await closed(page);
    await settle(page);
  }

  // ---------- empty state ----------
  const { page } = await newCtx();
  await t.open(page);
  await host(page);
  check('money card shows the empty state before an import', await page.locator('#moneyEmpty').isVisible() && /Amounts stay in this browser only and are never saved to git/.test(await page.locator('#moneyEmpty').innerText()) &&
    await page.evaluate(() => CrmMoney.has() === false && CrmMoney.stats() === null && CrmMoney.forCustomer('zf-steering-gear-india-ltd') === null));

  // ---------- AGING ----------
  await pick(page, 'aging.csv', aging);
  const kind = await page.locator('#importKind').evaluate(s => ({ v: s.value, text: s.options[s.selectedIndex].text }));
  const sum = await page.locator('#importSummary').innerText();
  check('money import recognises an AGING file with the exact A–N headers', kind.v === '0' && kind.text === 'AGING tab' && await page.locator('#importOk').isEnabled() && /6 rows read · 5 kept · 1 skipped/.test(sum), JSON.stringify(kind) + sum);
  check('total rows are skipped', /1 skipped \(total row\)/.test(sum), sum);
  check('"As On" (15-Oct-26) sets Data as of: the newest date wins, whatever the row order', (await page.inputValue('#importAsOf')) === NEW, await page.inputValue('#importAsOf'));
  check('unmatched names are listed in the import dialog', (await page.locator('#importUnmatched li').count()) === 1 && (await page.locator('#importUnmatched li').innerText()).includes('Zeta Imaginary Pvt Ltd'));
  check('a consistent AGING file shows no bucket warning', await page.locator('#importWarn').isHidden());
  await page.click('#importOk');
  await closed(page);
  await settle(page);

  const st1 = await stats(page);
  const rows = await page.evaluate(() => Store.doc('money').get().aging.rows);
  const nr = rows.find(r => r.sourceName === 'NR INDUSTRIES'), zf = rows.find(r => r.sourceName.startsWith('ZF'));
  check('amounts like "1,234,567", "-2,500" and "0" parse', nr.erpTotal === 1234567 && nr.overdue === -2500 && nr.erpNotDue === 0 && zf.creditBalance === 0 && zf.erpTotal === 1500000 && nr.termsDays === null && zf.termsDays === 45, JSON.stringify(nr));
  check('total rows are not stored', rows.length === 5 && !rows.some(r => /^total/i.test(r.sourceName)));
  check('"Data as of" shows the newest As On date on the card', (await page.locator('#moneyAsOf').innerText()) === 'Data as of ' + human(NEW), await page.locator('#moneyAsOf').innerText());
  check('with AGING only the card says to import LIVE_POSITION for outstanding', st1.outstanding === null && st1.overdue === OVERDUE_TOTAL && /Import the LIVE_POSITION tab/.test(await page.locator('.mny-tiles').innerText()));

  // ---------- LIVE_POSITION ----------
  await pick(page, 'live_position.csv', live);
  check('LIVE_POSITION with an "ERP 15-Oct" header is recognised and Estimated Live becomes outstanding', (await page.locator('#importKind').inputValue()) === '1' && await page.locator('#importOk').isEnabled());
  await page.click('#importOk');
  await closed(page);
  await settle(page);
  const st2 = await stats(page);
  const lrows = await page.evaluate(() => Store.doc('money').get().live.rows);
  const lzf = lrows.find(r => r.sourceName.startsWith('ZF'));
  const baseYear = +NEW.slice(0, 4) - (NEW.slice(0, 4) + '-10-15' > NEW ? 1 : 0);
  check('Estimated Live is stored as outstanding, with the ERP base amount and its date', lzf.outstanding === 2200000 && lzf.erpBase === 2000000 && lzf.invoicesSince === 300000 && lzf.receiptsSince === 100000 && lzf.erpBaseDate === baseYear + '-10-15', JSON.stringify(lzf));
  check('LIVE_POSITION import adds outstanding without removing aging', st2.outstanding === OUTSTANDING_TOTAL && st2.overdue === OVERDUE_TOTAL && (await page.evaluate(() => !!Store.doc('money').get().aging && !!Store.doc('money').get().live)));
  check('overduePct is overdue as a percentage of outstanding', st2.overduePct === Math.round(OVERDUE_TOTAL / OUTSTANDING_TOTAL * 1000) / 10, String(st2.overduePct));
  check('totals use every row: unmatched rows count, total rows do not', st2.unmatched.n === 1 && st2.unmatched.list[0].sourceName === 'Zeta Imaginary Pvt Ltd' && st2.unmatched.amount === 10000);

  // ---------- per customer ----------
  const per = await page.evaluate((ids) => ({ zf: CrmMoney.forCustomer('zf-steering-gear-india-ltd'), a: CrmMoney.forCustomer(ids[0]), b: CrmMoney.forCustomer(ids[1]), none: CrmMoney.forCustomer('force-motors-limited') }), SANG);
  check('an ERP Group row (Sangkaj) joins both group customers and counts once in totals',
    per.a.overdue === 600000 && per.b.overdue === 600000 && per.a.outstanding === 905000 && per.b.outstanding === 905000 &&
    per.a.shared && per.a.shared.groupName === 'Imaginary Group' && per.a.shared.n === 2 && per.zf.shared === null && st2.overdue === OVERDUE_TOTAL, JSON.stringify(per.a));
  check('a customer with no row gets null, not zero', per.none === null);
  check('related parties stay in money totals', (await page.evaluate(() => CrmMoney.forCustomer('varsha-forgings-ltd-markal').overdue)) === 40000 && st2.overdue === OVERDUE_TOTAL && st2.outstanding === OUTSTANDING_TOTAL);
  check('>90 includes Pre April; forCustomer.b90 already includes it', st2.buckets.b90.amount === 1000000 && st2.buckets.b90.preApril === 350000 && per.zf.b90 === 400000 && per.zf.preApril === 150000 && per.zf.b90Raw === 250000, JSON.stringify(st2.buckets));
  const legend = await page.locator('.mny-legend').innerText();
  check('>90 includes Pre April and the legend says "of which before April"', legend.includes('Over 90 days') && legend.includes(inr(1000000)) && legend.includes('of which before April ' + inr(350000)), legend);
  check('bucket counts are customers: 1-30 has 2, 31-60 has 1, >90 has 3 (a group counts each member)', st2.buckets.b1_30.n === 2 && st2.buckets.b31_60.n === 1 && st2.buckets.b61_90.n === 1 && st2.buckets.b90.n === 3, JSON.stringify(st2.buckets));
  check('top 5 overdue are sorted, credits and unmatched rows are left out, a group is one entry',
    st2.top5.map(e => e.name).join('|') === 'ZF STEERING GEAR (INDIA) LTD|Imaginary Group (group of 2)|VARSHA FORGINGS LTD MARKAL' && st2.top5[1].id === null && st2.top5[1].ids.length === 2, JSON.stringify(st2.top5));

  // ---------- red with text, links into the Customers tab ----------
  const redInfo = await page.locator('.mny-tile-over .mny-big').evaluate(e => ({ color: getComputedStyle(e).color, tile: e.closest('.mny-tile').innerText }));
  check('overdue amounts are red and the tile says Overdue', redInfo.color === 'rgb(180, 35, 24)' && /Overdue/.test(redInfo.tile) && /% of outstanding/.test(redInfo.tile), JSON.stringify(redInfo));
  const topRed = await page.locator('.mny-topbtn').first().locator('.mny-amt').evaluate(e => ({ color: getComputedStyle(e).color, text: e.innerText }));
  check('top 5 amounts are red and say "Overdue"', topRed.color === 'rgb(180, 35, 24)' && /^Overdue ₹/.test(topRed.text), JSON.stringify(topRed));
  await page.locator('.mny-leg[data-bucket="b90"]').click();
  await page.waitForSelector('#panel-list:not([hidden]) #rows tr');
  check('the >90 legend opens the Customers tab with exactly that many customers', (await t.rows(page)) === st2.buckets.b90.n && /over 90 days/.test(await page.locator('#extraLabel').innerText()), String(await t.rows(page)));
  await t.tab(page, 'dash');
  await host(page);
  await page.locator('.mny-topbtn').nth(1).click();
  await page.waitForSelector('#panel-list:not([hidden]) #rows tr');
  check('a group in the top 5 opens both group customers', (await t.rows(page)) === 2);
  await t.tab(page, 'dash');
  await host(page);

  // ---------- a manual match from the card, and from the import dialog, is remembered ----------
  const card = await page.locator('.mny-unm').innerText();
  check('the card lists unmatched names with their amount', /Zeta Imaginary Pvt Ltd/.test(card) && card.includes(inr(10000)), card);
  await page.locator('.mny-unmlist li select').selectOption('s-k-traders');
  await page.locator('.mny-unmlist li button').click();
  await settle(page);
  check('a manual match from the card moves the amount to that customer and clears the list', (await page.evaluate(() => CrmMoney.forCustomer('s-k-traders').overdue)) === 10000 && (await page.locator('.mny-unm').count()) === 0 && (await stats(page)).overdue === OVERDUE_TOTAL);
  const aging2 = aging.replace('\nTotal,', '\nQux Imaginary Ltd,,"5,000",0,"5,000",0,"5,000",0,0,0,0,0,"5,000",' + asOnText(NEW) + '\nTotal,');
  await pick(page, 'aging2.csv', aging2);
  check('the earlier match is remembered, only the new name is listed', (await page.locator('#importUnmatched li').count()) === 1 && (await page.locator('#importUnmatched li').innerText()).includes('Qux Imaginary Ltd') && /5 matched to customers \(1 by ERP group\) · 1 not matched/.test(await page.locator('#importSummary').innerText()), await page.locator('#importSummary').innerText());
  await page.locator('#importUnmatched li select').selectOption('nr-industries');
  await page.click('#importOk');
  await closed(page);
  await settle(page);
  await pick(page, 'aging2.csv', aging2);
  check('unmatched names are listed and a manual match is remembered next time', (await page.locator('#importUnmatched li').count()) === 0 && /6 matched to customers \(1 by ERP group\) · 0 not matched/.test(await page.locator('#importSummary').innerText()), await page.locator('#importSummary').innerText());
  await page.click('#importCancel');
  check('a name matched by hand adds into that customer: NR now has -2,500 + 5,000', (await page.evaluate(() => CrmMoney.forCustomer('nr-industries').overdue)) === 2500);

  // ---------- exports never carry amounts ----------
  const leak = await page.evaluate(() => {
    const blobs = [JSON.stringify(Store.exportCustomersJson()), JSON.stringify(Store.exportBackup()), localStorage.getItem('varsha-crm-localdb-v1') || ''];
    const needles = ['1000000', '2200000', '905000', '600000', '1234567', '10,00,000', '22,00,000'];
    return blobs.map(b => needles.filter(n => b.includes(n)));
  });
  check('amounts never appear in the customers.json export or the backup', leak.every(l => l.length === 0), JSON.stringify(leak));
  const money1 = await page.evaluate(() => localStorage.getItem('varsha-crm-money-v1') || '');
  check('amounts are kept only under their own storage key', money1.includes('2200000') && money1.length > 500);

  // ---------- Hide amounts ----------
  await t.tab(page, 'dash');
  await host(page);
  const before = await page.locator('#moneyHost').innerText();
  check('amounts show as numbers before hiding', /₹\d/.test(before));
  await page.click('#moneyHide');
  await settle(page);
  const hidden = await page.locator('#moneyHost').innerText();
  check('Hide amounts masks every amount on the money card', !/₹\s?\d/.test(hidden) && hidden.includes('₹ •••') && (await page.getAttribute('#moneyHide', 'aria-pressed')) === 'true' && await page.evaluate(() => document.body.classList.contains('amounts-hidden')), hidden.slice(0, 300));
  await page.emulateMedia({ media: 'print' });
  check('Hide amounts also covers print', !/₹\s?\d/.test(await page.locator('#moneyHost').innerText()));
  await page.emulateMedia({ media: 'screen' });
  await t.reload(page);
  await host(page);
  check('Hide amounts survives a refresh', !/₹\s?\d/.test(await page.locator('#moneyHost').innerText()) && (await page.locator('#moneyHide').innerText()) === 'Show amounts');
  await page.click('#moneyHide');
  await settle(page);
  check('Show amounts brings the numbers back', /₹\d/.test(await page.locator('#moneyHost').innerText()));

  // ---------- refresh ----------
  const beforeStats = await stats(page);
  await t.reload(page);
  await host(page);
  const afterStats = await stats(page);
  check('amounts survive a refresh', JSON.stringify(beforeStats) === JSON.stringify(afterStats) && afterStats.outstanding === OUTSTANDING_TOTAL && (await page.locator('#moneyAsOf').innerText()).startsWith('Data as of'), JSON.stringify(afterStats).slice(0, 200));
  check('the manual matches survive a refresh', (await page.evaluate(() => CrmMoney.forCustomer('s-k-traders').overdue)) === 10000);

  // ---------- Data as of / stale ----------
  const fresh12 = istToday(-12);
  await doImport(page, 'aging3.csv', aging, { asOf: fresh12 });
  const asofText = await page.locator('#moneyAsOf').innerText();
  check('"Data as of" shows the chosen date', asofText.includes(human(fresh12)), asofText);
  const stale = await page.locator('#moneyStale').evaluate(e => ({ text: e.innerText, color: getComputedStyle(e).color }));
  check('stale data shows the orange warning', stale.text === 'Money data is 12 days old. Import a fresh file.' && stale.color === 'rgb(180, 83, 9)', JSON.stringify(stale));
  check('stale data keeps the totals visible', /₹/.test(await page.locator('.mny-tiles').innerText()) && (await stats(page)).stale === true);
  await t.reload(page);
  await host(page);
  check('the chosen Data as of date survives a refresh', (await page.locator('#moneyAsOf').innerText()).includes(human(fresh12)));

  // ---------- clear ----------
  page.once('dialog', d => d.accept());
  await page.click('#moneyClear');
  await page.waitForSelector('#moneyEmpty');
  check('Clear imported money data removes it', await page.evaluate(() => CrmMoney.has() === false && CrmMoney.stats() === null && localStorage.getItem('varsha-crm-money-v1') === null));
  await t.reload(page);
  check('cleared money stays cleared after a refresh', await page.evaluate(() => CrmMoney.has() === false));

  // ---------- clearing one file keeps the other ----------
  await host(page);
  await doImport(page, 'aging.csv', aging);
  await doImport(page, 'live.csv', live);
  await page.evaluate(() => CrmMoney.clear('aging'));
  await settle(page);
  const onlyLive = await stats(page);
  check('clear("aging") keeps LIVE_POSITION and clear("live") then empties everything', onlyLive.overdue === null && onlyLive.outstanding === OUTSTANDING_TOTAL && (await page.evaluate(async () => { await CrmMoney.clear('live'); return CrmMoney.has(); })) === false);

  // ---------- wrong file, bad number, buckets that do not add up ----------
  const w = await newCtx();
  await t.open(w.page);
  await w.page.evaluate(() => CrmMoney.openImport());
  await w.page.setInputFiles('#importFile', t.csvFile('wrong.csv', 'Party,Amount,Days\nA,1,2\n'));
  await w.page.waitForSelector('#importErr:not([hidden])');
  const werr = await w.page.locator('#importErr').innerText();
  check('wrong file shows the missing-columns error and blocks import', /This file does not have the columns we need\. Missing: .*Customer/.test(werr) && /Columns found in your file: Party, Amount, Days\./.test(werr) && await w.page.locator('#importOk').isDisabled(), werr);
  await w.page.setInputFiles('#importFile', t.csvFile('bad.csv', AGING_HEAD + '\nZF STEERING GEAR (INDIA) LTD,,"1,000",0,"12,34a",0,0,0,0,0,0,0,0,\nNR INDUSTRIES,,"1,000",0,"500",0,500,0,0,0,0,0,0,\n'));
  await w.page.waitForSelector('#importSummary li');
  const bad = await w.page.locator('#importSummary').innerText();
  check('bad number blocks import with the row number', /Row 2: "12,34a" in ERP Overdue is not a number/.test(bad) && await w.page.locator('#importOk').isDisabled(), bad);
  const off = AGING_HEAD + '\nZF STEERING GEAR (INDIA) LTD,,"1,000",0,"1,000",0,"100","200",0,"300",0,0,"650",' + asOnText(NEW) + '\nNR INDUSTRIES,,"1,000",0,500,0,500,0,0,0,0,0,500,' + asOnText(NEW) + '\n';
  await w.page.setInputFiles('#importFile', t.csvFile('off.csv', off));
  await w.page.waitForSelector('#importWarn:not([hidden])');
  const warn = await w.page.locator('#importWarn').innerText();
  check('buckets that do not add up to ERP Overdue show a warning but do not block', /Row 2: buckets add up to ₹600 but ERP Overdue says ₹1,000\./.test(warn) && /Model Overdue says ₹650/.test(warn) && await w.page.locator('#importOk').isEnabled(), warn);
  await w.page.click('#importCancel');

  // ---------- the real sheet names the ERP group on the line of one of its customers ----------
  const g = await t.fresh();
  await t.open(g.page);
  await host(g.page);
  await doImport(g.page, 'aging.csv', AGING_HEAD + '\nSANGKAJ INDUSTRIES PVT. LTD.,,"90,000",0,"77,000",0,"77,000",0,0,0,0,0,"77,000",' + asOnText(NEW) + '\n');
  const gs = await g.page.evaluate((ids) => ({ a: CrmMoney.forCustomer(ids[0]), b: CrmMoney.forCustomer(ids[1]), s: CrmMoney.stats() }), SANG);
  check('a line named like one group customer but carried by a shared ERP group joins every member and counts once', gs.a.overdue === 77000 && gs.b.overdue === 77000 && gs.a.shared.n === 2 && gs.s.overdue === 77000 && gs.s.top5.length === 1 && gs.s.top5[0].ids.length === 2, JSON.stringify(gs.s.top5));

  // ---------- 375px ----------
  const ph = await newCtx({ viewport: { width: 375, height: 700 } });
  await t.open(ph.page);
  await host(ph.page);
  await doImport(ph.page, 'aging.csv', aging);
  await doImport(ph.page, 'live.csv', live);
  const dims = await ph.page.evaluate(() => ({ page: document.documentElement.scrollWidth, card: document.querySelector('.mny-card').getBoundingClientRect().right }));
  check('no sideways scroll on the money card at 375px', dims.page === 375 && dims.card <= 375, JSON.stringify(dims));
  await ph.page.click('#moneyImportBtn');
  await ph.page.setInputFiles('#importFile', t.csvFile('off.csv', off));
  await ph.page.waitForSelector('#importWarn:not([hidden])');
  const dims2 = await ph.page.evaluate(() => { const d = document.getElementById('importDlg').getBoundingClientRect(); return { page: document.documentElement.scrollWidth, left: d.left, right: d.right }; });
  check('no sideways scroll with the money import dialog open at 375px', dims2.page === 375 && dims2.left >= 0 && dims2.right <= 375, JSON.stringify(dims2));
};
