// A1 checks for the frozen CrmImport contract, using a made-up spec and made-up amounts (no real data).
module.exports = async (t) => {
  const { check } = t;
  const seed = JSON.parse(JSON.stringify(t.data));
  seed.customers.filter(c => c.name.startsWith('SANGKAJ')).forEach(c => { c.erpGroup = 'Imaginary Group'; });
  const { page } = await t.fresh({ init: (d) => { window.CRM_DATA = d; }, initArg: seed });
  await t.open(page);

  const open = () => page.evaluate(() => {
    window.__got = null;
    CrmImport.open({
      title: 'Import test data', intro: 'Test intro', customerField: 'customer', asOf: true,
      specs: [
        { key: 'aging', label: 'AGING tab', skipRow: (cells, map) => /^total/i.test(cells[map.customer] || '') ? 'total row' : null,
          fields: [
            { key: 'customer', label: 'Customer', required: true, synonyms: ['Party'], type: 'text' },
            { key: 'overdue', label: 'ERP Overdue', required: true, type: 'amount' },
            { key: 'terms', label: 'Printed Terms Days', required: false, type: 'int' },
            { key: 'asOn', label: 'As On', required: false, type: 'date' }
          ] },
        { key: 'other', label: 'OTHER tab', fields: [{ key: 'customer', label: 'Customer', required: true, type: 'text' }, { key: 'zzz', label: 'Zzz Column', required: true, type: 'text' }] }
      ],
      onConfirm: async (res) => { window.__got = res; return { ok: true }; }
    });
  });
  const set = (name, text) => page.setInputFiles('#importFile', t.csvFile(name, text));

  await open();
  check('import dialog opens with its title and intro', await page.locator('#importDlg').evaluate(d => d.open) && (await page.locator('#importTitle').innerText()) === 'Import test data' && (await page.locator('#importIntro').innerText()) === 'Test intro');
  check('Import is disabled before a file is chosen', await page.locator('#importOk').isDisabled());

  const good = 'Customer,ERP Overdue,Printed Terms Days,As On\n' +
    'ZF STEERING GEAR (INDIA) LTD,"1,23,456.50",45,15-Oct-26\n' +
    'Zeta Imaginary Pvt Ltd,"2,000 Cr",,12-Oct-26\n' +
    'Imaginary Group,500,,\n' +
    'ZF STEERING GEAR (INDIA) LTD,1000,,01-Oct-26\n' +
    'Total,9999,,\n' +
    ',5,,\n';
  await set('aging.csv', good);
  await page.waitForSelector('#importSummary li');
  const sum = await page.locator('#importSummary').innerText();
  check('summary counts rows read, kept and skipped with reasons', /6 rows read · 4 kept · 2 skipped/.test(sum) && /total row/.test(sum), sum);
  check('summary counts matches, ERP-group matches and repeated customers', /3 matched to customers \(1 by ERP group\) · 1 not matched/.test(sum) && /1 customer appears on more than one row; their amounts are added together\./.test(sum), sum);
  check('the file is recognised as the AGING tab', (await page.locator('#importKind').inputValue()) === '0');
  check('Data as of defaults to the latest "As On" date, whatever the row order', (await page.inputValue('#importAsOf')) === '2026-10-15', await page.inputValue('#importAsOf'));
  check('the unmatched name is listed with a choice, text only', (await page.locator('#importUnmatched li').count()) === 1 && (await page.locator('#importUnmatched li').innerText()).includes('Zeta Imaginary Pvt Ltd'));
  check('Import button says how many rows', (await page.locator('#importOk').innerText()) === 'Import 4 rows' && await page.locator('#importOk').isEnabled());
  await page.selectOption('#importUnmatched select', 'nr-industries');
  await page.click('#importOk');
  await page.waitForFunction(() => window.__got);
  const got = await page.evaluate(() => window.__got);
  check('onConfirm gets typed rows with ids, file row numbers, meta and the aliases chosen',
    got.specKey === 'aging' && got.rows.length === 4 && got.rows[0].overdue === 123456.5 && got.rows[0].terms === 45 && got.rows[0].asOn === '2026-10-15' &&
    got.rows[0].customerId === 'zf-steering-gear-india-ltd' && got.rows[0].row === 2 && got.rows[1].overdue === -2000 && got.rows[1].customerId === 'nr-industries' &&
    got.rows[2].customerId === null && got.rows[2].groupIds.length === 2 && got.rows[3].customerId === 'zf-steering-gear-india-ltd' &&
    got.meta.fileName === 'aging.csv' && got.meta.asOf === '2026-10-15' && got.meta.rowsRead === 6 && got.meta.rowsKept === 4 && got.meta.skipped.length === 2 && got.meta.unmatched === 0 &&
    got.aliases['Zeta Imaginary Pvt Ltd'] === 'nr-industries', JSON.stringify(got).slice(0, 600));
  check('the dialog closes and a notice shows the data-as-of date', await page.locator('#importDlg').evaluate(d => !d.open) && /Imported 4 rows from AGING\. Data as of 15 Oct 2026\./.test(await page.locator('#notice').innerText()));
  const remembered = await page.evaluate(() => Store.matchCustomer('Zeta Imaginary Pvt Ltd'));
  check('a manual match is remembered for the next import', remembered === 'nr-industries');

  // second import: remembered match, blank Printed Terms Days is normal
  await open();
  await set('again.csv', 'Customer,ERP Overdue\nZeta Imaginary Pvt Ltd,10\n');
  await page.waitForSelector('#importSummary li');
  check('a remembered name is matched and nothing is listed as unmatched', (await page.locator('#importUnmatched li').count()) === 0 && /1 matched to customers · 0 not matched/.test(await page.locator('#importSummary').innerText()));
  check('optional columns may be absent', await page.locator('#importOk').isEnabled());

  // wrong file
  await open();
  await set('wrong.csv', 'Party,Amount,Days\nA,1,2\n');
  await page.waitForSelector('#importErr:not([hidden])');
  const err = await page.locator('#importErr').innerText();
  check('a wrong file shows the missing columns and the columns found, and blocks Import',
    /This file does not have the columns we need\. Missing: ERP Overdue\./.test(err) && /Columns found in your file: Party, Amount, Days\./.test(err) && /Check that you exported the right tab\./.test(err) && await page.locator('#importOk').isDisabled(), err);
  check('the error is a role=alert region', (await page.getAttribute('#importErr', 'role')) === 'alert');

  // bad number blocks, with the row number
  await open();
  await set('bad.csv', 'Customer,ERP Overdue\nZF STEERING GEAR (INDIA) LTD,100\nNR INDUSTRIES,"12,34a"\n');
  await page.waitForSelector('#importSummary li');
  const sum2 = await page.locator('#importSummary').innerText();
  check('a bad number blocks the import and names the row', /Row 3: "12,34a" in ERP Overdue is not a number/.test(sum2) && await page.locator('#importOk').isDisabled(), sum2);

  // title rows above the header, semicolons, a missing file type
  await open();
  await set('title.csv', 'Collections report;;\n;;\nParty;ERP Overdue;Printed Terms Days\nNR INDUSTRIES;5;\n');
  await page.waitForSelector('#importSummary li');
  check('title rows above the header and ; delimiters are handled', /1 rows read · 1 kept/.test(await page.locator('#importSummary').innerText()) && await page.locator('#importOk').isEnabled());
  await page.click('#importCancel');
  check('Cancel closes without importing', await page.locator('#importDlg').evaluate(d => !d.open));

  // the success notice: shows what was imported, goes away by itself, and does not follow the user to other tabs
  await page.clock.install({ time: Date.now() });
  await open();
  await set('notice.csv', 'Customer,ERP Overdue,As On\nNR INDUSTRIES,10,14-Oct-26\n');
  await page.waitForSelector('#importSummary li');
  await page.click('#importOk');
  await page.waitForFunction(() => window.__got);
  check('the import notice says what was imported and has a dismiss button', /Imported 1 rows from AGING\. Data as of 14 Oct 2026\./.test(await page.locator('#notice').innerText()) && await page.locator('#notice .banner-x').isVisible());
  await page.clock.fastForward(12500);
  check('the import notice goes away by itself after 12 seconds', await page.locator('#notice').isHidden());
  await open();
  await set('notice2.csv', 'Customer,ERP Overdue\nNR INDUSTRIES,10\n');
  await page.waitForSelector('#importSummary li');
  await page.evaluate(() => { window.__got = null; });
  await page.click('#importOk');
  await page.waitForFunction(() => window.__got);
  await page.clock.fastForward(3000);
  await page.click('#tab-export');
  check('the import notice is cleared when the user moves to another tab', await page.locator('#notice').isHidden());

  // dataset registry is open
  const reg = await page.evaluate(() => {
    CrmImport.register('demo_kind', { label: 'Demo', fields: [{ key: 'a', label: 'A', required: true, type: 'text' }] });
    return CrmImport.kinds().indexOf('demo_kind') !== -1 && CrmImport.spec('demo_kind').key === 'demo_kind';
  });
  check('a module can register a new dataset kind without any importer edit', reg);

  // 375px
  const ph = await t.fresh({ viewport: { width: 375, height: 700 } });
  await t.open(ph.page);
  await ph.page.evaluate(() => CrmImport.open({ title: 'T', intro: 'i', specs: [{ key: 'k', label: 'K', fields: [{ key: 'c', label: 'Customer', required: true, type: 'text' }] }], customerField: 'c', asOf: true, onConfirm: async () => ({ ok: true }) }));
  await ph.page.setInputFiles('#importFile', t.csvFile('x.csv', 'Customer\n' + Array.from({ length: 12 }, (_, i) => 'Made Up Company Number ' + i + ' Pvt Ltd').join('\n') + '\n'));
  await ph.page.waitForSelector('#importUnmatched li');
  const dims = await ph.page.evaluate(() => { const d = document.getElementById('importDlg').getBoundingClientRect(); return { page: document.documentElement.scrollWidth, left: d.left, right: d.right, bottom: d.bottom, vh: innerHeight }; });
  check('import dialog fits at 375px without page scroll', dims.page === 375 && dims.left >= 0 && dims.right <= 375 && dims.bottom <= dims.vh + 1, JSON.stringify(dims));
};
