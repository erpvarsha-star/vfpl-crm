// A4 checks: RFQ board and table, dialog, history, imports, Hub review. Synthetic data only (made-up names, subjects, amounts, emails).
module.exports = async (t) => {
  const { check, istToday } = t;
  const CUST = 'ZF STEERING GEAR (INDIA) LTD', CUST_ID = 'zf-steering-gear-india-ltd';
  const CUST2 = 'NR INDUSTRIES', CUST2_ID = 'nr-industries';
  const RED = 'rgb(180, 35, 24)', ORANGE = 'rgb(180, 83, 9)';
  const TODAY = istToday(0);

  const boot = async (opts) => {
    const { page } = await t.fresh(opts);
    await t.open(page);
    await t.tab(page, 'rfqs');
    return page;
  };
  const col = (page, stage) => page.locator('details.rfq-col[data-stage="' + stage + '"]');
  const cardIn = (page, stage, text) => col(page, stage).locator('.rfq-card', { hasText: text });
  const rfq = (page, no) => page.evaluate((n) => Store.col('rfqs').all().find((r) => r.rfq_no === n) || null, no);
  const hist = (page, id) => page.evaluate((i) => Store.col('rfq_history').all().filter((h) => h.rfq_id === i).sort((a, b) => a.created_at.localeCompare(b.created_at)), id);
  const nRfq = (page) => page.evaluate(() => Store.col('rfqs').all().length);
  const seed = async (page, rows, h) => {
    await page.evaluate(({ rows, h }) => { rows.forEach((r) => Store.col('rfqs').insert(r)); (h || []).forEach((x) => Store.col('rfq_history').insert(x)); App.flush(); }, { rows, h: h || [] });
  };
  const mk = (o) => Object.assign({ customer_id: CUST_ID, customer_name: CUST, rfq_no: '', part_name: '', part_no: '', qty: null, received: istToday(-10), quote_due: '', quoted_value: null,
    stage: 'Received', stage_at: istToday(-5), next_action: '', notes: '', lost: false, lost_reason: '', stage_source: 'user' }, o);
  const newRfq = async (page, o) => {
    await page.click('#rfqNew');
    await page.fill('#rfqCustomer', o.customer == null ? CUST : o.customer);
    if (o.no != null) await page.fill('#rfqNo', o.no);
    if (o.part != null) await page.fill('#rfqPartName', o.part);
    if (o.value != null) await page.fill('#rfqValue', o.value);
    if (o.notes != null) await page.fill('#rfqNotes', o.notes);
    await page.click('#rfqSave');
  };
  const reload = async (page) => { await t.reload(page); await page.waitForSelector('#panel-rfqs:not([hidden])'); };

  // =========================================================================================== manual RFQs
  const p = await boot();
  check('RFQs tab shows the empty state and a 7-column board', (await p.locator('details.rfq-col').count()) === 7 && /No RFQs yet/.test(await p.locator('#rfqEmpty').innerText()));
  check('board columns are in stage order', (await p.locator('details.rfq-col').evaluateAll((d) => d.map((x) => x.dataset.stage))).join() === 'Received,Quoted,Negotiated,Finalised,PO,Sample,PPAP');

  await newRfq(p, { no: 'T-100', part: 'Drop arm', value: '1250000' });
  const r1 = await rfq(p, 'T-100');
  const h1 = r1 ? await hist(p, r1.id) : [];
  check('new RFQ appears in Received with history', !!r1 && (await cardIn(p, 'Received', 'T-100').count()) === 1 && r1.stage === 'Received' && h1.length === 1 && h1[0].from === null && h1[0].to === 'Received' && h1[0].at === TODAY, JSON.stringify([r1 && r1.stage, h1]));
  check('the new card shows customer, part and value', /ZF STEERING/.test(await cardIn(p, 'Received', 'T-100').innerText()) && /Drop arm/.test(await cardIn(p, 'Received', 'T-100').innerText()) && /12\.50 L/.test(await cardIn(p, 'Received', 'T-100').innerText()), await cardIn(p, 'Received', 'T-100').innerText());
  check('column heading shows the count and total value', (await col(p, 'Received').locator('h3').innerText()) === 'Received (1)' && /12\.50 L/.test(await col(p, 'Received').locator('summary').innerText()));

  // customer must be picked from the list
  await p.click('#rfqNew');
  await p.fill('#rfqCustomer', 'Nobody Imaginary Pvt Ltd');
  await p.fill('#rfqNo', 'T-101');
  await p.click('#rfqSave');
  check('customer must be picked from the list', (await p.locator('#rfqErr').innerText()) === 'Pick a customer from the list, or add the customer first.' && await p.locator('#rfqDlg').evaluate((d) => d.open) && (await nRfq(p)) === 1);
  // duplicate RFQ no
  await p.fill('#rfqCustomer', CUST2);
  await p.fill('#rfqNo', 't-100');
  await p.click('#rfqSave');
  check('duplicate RFQ no is refused', (await p.locator('#rfqErr').innerText()) === 'RFQ t-100 already exists.' && (await nRfq(p)) === 1);
  await p.fill('#rfqNo', '');
  await p.click('#rfqSave');
  check('an RFQ needs a number or a part name', (await p.locator('#rfqErr').innerText()) === 'Enter the RFQ number or the part name.');
  await p.fill('#rfqNo', 'T-101'); await p.fill('#rfqQty', '12.5'); await p.click('#rfqSave');
  check('quantity must be a whole number', (await p.locator('#rfqErr').innerText()) === 'Quantity must be a whole number.');
  await p.fill('#rfqQty', ''); await p.fill('#rfqValue', 'abc'); await p.click('#rfqSave');
  check('quoted value must be a number', (await p.locator('#rfqErr').innerText()) === 'Quoted value is not a number.');
  await p.keyboard.press('Escape');
  check('Escape closes the dialog without saving', await p.locator('#rfqDlg').evaluate((d) => !d.open) && (await nRfq(p)) === 1);

  // moves
  const id1 = r1.id;
  await p.locator('.rfq-card[data-id="' + id1 + '"] .next').click();
  const moved = await rfq(p, 'T-100'), hm = await hist(p, id1);
  check("▶ moves a card to the next stage and logs history with today's date", moved.stage === 'Quoted' && (await cardIn(p, 'Quoted', 'T-100').count()) === 1 && (await cardIn(p, 'Received', 'T-100').count()) === 0 &&
    hm.length === 2 && hm[1].from === 'Received' && hm[1].to === 'Quoted' && hm[1].at === TODAY, JSON.stringify(hm));
  const focus = await p.evaluate(() => { const a = document.activeElement; return { cls: a.className, stage: a.closest('details') && a.closest('details').dataset.stage, hasCard: !!a.closest('.rfq-card') }; });
  check('focus follows the moved card', focus.hasCard && focus.stage === 'Quoted' && /next/.test(focus.cls), JSON.stringify(focus));
  await p.waitForFunction(() => /moved/.test(document.getElementById('live').textContent));
  check('the move is announced', /RFQ T-100 moved to Quoted\./.test(await p.locator('#live').innerText()));
  check('move buttons have descriptive labels', (await p.locator('.rfq-card[data-id="' + id1 + '"] .prev').getAttribute('aria-label')) === 'Move RFQ T-100 back to Received' && (await p.locator('.rfq-card[data-id="' + id1 + '"] .next').getAttribute('aria-label')) === 'Move RFQ T-100 to Negotiated');
  await p.locator('.rfq-card[data-id="' + id1 + '"] .prev').click();
  const back = await rfq(p, 'T-100'), hb = await hist(p, id1);
  check('◀ moves it back', back.stage === 'Received' && (await cardIn(p, 'Received', 'T-100').count()) === 1 && hb.length === 3 && hb[2].from === 'Quoted' && hb[2].to === 'Received', JSON.stringify(hb));
  check('the first stage has no usable ◀ and the last has no usable ▶', await p.locator('.rfq-card[data-id="' + id1 + '"] .prev').isDisabled());

  // table view
  await p.click('#rfqViewTable');
  check('table view shows the RFQ row with value and age', (await p.locator('#rfqRows tr').count()) === 1 && /T-100/.test(await p.locator('#rfqRows tr').innerText()) && /₹12,50,000/.test(await p.locator('#rfqRows tr').innerText()) && /0 days/.test(await p.locator('#rfqRows tr').innerText()), await p.locator('#rfqRows tr').innerText());
  await p.locator('#rfqRows tr select.stage-sel').selectOption('Negotiated');
  const sel = await rfq(p, 'T-100'), hs = await hist(p, id1);
  check('stage select in the table moves the RFQ', sel.stage === 'Negotiated' && hs.length === 4 && hs[3].from === 'Received' && hs[3].to === 'Negotiated' && hs[3].at === TODAY && (await p.evaluate(() => document.activeElement.classList.contains('stage-sel'))));
  await reload(p);
  check('board and table views survive a refresh', await p.locator('#rfqTableWrap').isVisible() && await p.locator('#rfqBoardWrap').isHidden() && (await p.getAttribute('#rfqViewTable', 'aria-pressed')) === 'true');
  const rs = await rfq(p, 'T-100');
  check('RFQs and history survive a refresh', rs && rs.stage === 'Negotiated' && (await hist(p, rs.id)).length === 4 && (await p.locator('#rfqRows tr').count()) === 1);
  await p.click('#rfqViewBoard');
  await reload(p);
  check('the board choice survives a refresh too', await p.locator('#rfqBoardWrap').isVisible() && (await cardIn(p, 'Negotiated', 'T-100').count()) === 1);

  // edit dialog + stage history with dates
  await p.locator('.rfq-card[data-id="' + id1 + '"] .edit').click();
  const histText = await p.locator('#rfqHist li').allInnerTexts();
  check('the edit dialog lists the stage history with dates', histText.length === 4 && histText.every((x) => /^\d{1,2} [A-Z][a-z]{2} \d{4} · /.test(x)), histText.join(' | '));
  check('history lines read "date · from → to"', /Created at Received/.test(histText[0]) && /Received → Quoted/.test(histText[1]) && /Quoted → Received/.test(histText[2]) && /Received → Negotiated/.test(histText[3]) && /\d{4}/.test(histText[3]), histText.join(' | '));
  await p.selectOption('#rfqStage', 'Finalised');
  check('changing the stage in the dialog shows an optional stage note', await p.locator('#rfqStageNote').isVisible());
  await p.fill('#rfqStageNote', 'price agreed');
  await p.fill('#rfqPartName', 'Drop arm rev B');
  await p.click('#rfqSave');
  const ed = await rfq(p, 'T-100'), he = await hist(p, id1);
  check('editing saves the fields and writes one history row with the note', ed.stage === 'Finalised' && ed.part_name === 'Drop arm rev B' && he.length === 5 && he[4].note === 'price agreed' && he[4].to === 'Finalised' && (await cardIn(p, 'Finalised', 'T-100').count()) === 1);
  await reload(p);
  check('edits survive a refresh', (await cardIn(p, 'Finalised', 'T-100').count()) === 1 && /rev B/.test(await cardIn(p, 'Finalised', 'T-100').innerText()));

  // Lost marker
  await seed(p, [mk({ rfq_no: 'T-200', part_name: 'Pin' })]);
  await cardIn(p, 'Received', 'T-200').locator('.edit').click();
  await p.check('#rfqLost');
  await p.fill('#rfqLostReason', 'price too high');
  await p.click('#rfqSave');
  const lostRow = await rfq(p, 'T-200'), hl = await hist(p, lostRow.id);
  check('mark lost hides it unless Show lost', lostRow.lost === true && lostRow.lost_reason === 'price too high' && (await p.locator('.rfq-card', { hasText: 'T-200' }).count()) === 0 && hl[hl.length - 1].to === 'Lost');
  await p.click('#rfqChipLost');
  check('Show lost reveals it greyed with the reason', (await p.locator('.rfq-card.is-lost', { hasText: 'T-200' }).count()) === 1 && /Lost: price too high/.test(await p.locator('.rfq-card.is-lost', { hasText: 'T-200' }).innerText()));
  check('a lost card has no move buttons', (await p.locator('.rfq-card.is-lost', { hasText: 'T-200' }).locator('.next').count()) === 0);
  await reload(p);
  check('the Show lost choice and the lost flag survive a refresh', (await p.getAttribute('#rfqChipLost', 'aria-pressed')) === 'true' && (await p.locator('.rfq-card.is-lost', { hasText: 'T-200' }).count()) === 1);
  await p.locator('.rfq-card.is-lost', { hasText: 'T-200' }).locator('.edit').click();
  await p.uncheck('#rfqLost');
  await p.click('#rfqSave');
  const reopened = await rfq(p, 'T-200'), hr = await hist(p, reopened.id);
  check('reopening a lost RFQ is logged', reopened.lost === false && hr[hr.length - 1].note === 'Reopened' && (await cardIn(p, 'Received', 'T-200').count()) === 1);
  await p.click('#rfqChipLost');

  // overdue words
  await seed(p, [
    mk({ rfq_no: 'Q-OVER', quote_due: istToday(-3) }), mk({ rfq_no: 'Q-TODAY', quote_due: TODAY }), mk({ rfq_no: 'Q-LATER', quote_due: istToday(5) }),
    mk({ rfq_no: 'A-OVER', stage: 'Quoted', next_action: istToday(-2), quote_due: '' }), mk({ rfq_no: 'A-TODAY', stage: 'Negotiated', next_action: TODAY }), mk({ rfq_no: 'A-PPAP', stage: 'PPAP', next_action: istToday(-9) })
  ]);
  const qo = cardIn(p, 'Received', 'Q-OVER').locator('.rc-flag');
  check('quote overdue shows red text "Quote overdue by N days"', (await qo.innerText()) === 'Quote overdue by 3 days' && (await qo.evaluate((e) => getComputedStyle(e).color)) === RED);
  const qt = cardIn(p, 'Received', 'Q-TODAY').locator('.rc-flag');
  check('quote due today is orange', (await qt.innerText()) === 'Quote due today' && (await qt.evaluate((e) => getComputedStyle(e).color)) === ORANGE);
  check('a future quote date reads "Quote due <date>"', /^Quote due \d{1,2} [A-Z][a-z]{2}/.test(await cardIn(p, 'Received', 'Q-LATER').locator('.rc-flag').innerText()));
  const ao = cardIn(p, 'Quoted', 'A-OVER').locator('.rc-flag');
  check('action overdue shows red text', (await ao.innerText()) === 'Action overdue by 2 days' && (await ao.evaluate((e) => getComputedStyle(e).color)) === RED);
  check('action due today is orange and PPAP never shows action overdue', (await cardIn(p, 'Negotiated', 'A-TODAY').locator('.rc-flag').evaluate((e) => getComputedStyle(e).color)) === ORANGE && (await cardIn(p, 'PPAP', 'A-PPAP').locator('.rc-flag').count()) === 0);
  check('"Next: <date>" shows on cards', /Next: \d{1,2} [A-Z][a-z]{2}/.test(await cardIn(p, 'Quoted', 'A-OVER').innerText()));
  check('Quote overdue chip counts and turns red', (await p.locator('#rfqNQuote').innerText()) === '1' && (await p.locator('#rfqChipQuote').evaluate((e) => getComputedStyle(e).color)) === RED);
  check('Action overdue chip counts', (await p.locator('#rfqNAction').innerText()) === '1');

  // flag filter, table stage chips, persistence
  await p.click('#rfqChipQuote');
  check('the Quote overdue chip filters the board to matching RFQs', (await p.locator('.rfq-card').count()) === 1 && (await cardIn(p, 'Received', 'Q-OVER').count()) === 1);
  await p.click('#rfqViewTable');
  await p.click('#rfqStageBar .chip[data-stage="Received"]');
  check('table stage chips filter with counts', (await p.locator('#rfqRows tr').count()) === 1 && /\d/.test(await p.locator('#rfqStageBar .chip[data-stage="Received"] b').innerText()));
  await reload(p);
  check('stage and flag filters survive a refresh', (await p.getAttribute('#rfqChipQuote', 'aria-pressed')) === 'true' && (await p.getAttribute('#rfqStageBar .chip[data-stage="Received"]', 'aria-pressed')) === 'true' && (await p.locator('#rfqRows tr').count()) === 1);
  await p.click('#rfqChipQuote');
  await p.click('#rfqStageBar .chip[data-stage=""]');
  await p.fill('#rfqQ', 'q-today');
  check('search matches the RFQ number', (await p.locator('#rfqRows tr').count()) === 1);
  await reload(p);
  check('search text survives a refresh', (await p.inputValue('#rfqQ')) === 'q-today' && (await p.locator('#rfqRows tr').count()) === 1);
  await p.fill('#rfqQ', '');
  await p.click('#rfqViewBoard');

  // sort
  await p.click('#rfqViewTable');
  await p.click('#rfqTable th button[data-sort="quoteDue"]');
  const firstDue = await p.locator('#rfqRows tr').first().innerText();
  check('sorting by quote due puts the oldest first', /Q-OVER/.test(firstDue), firstDue);
  await p.click('#rfqViewBoard');

  // released parts
  await seed(p, [mk({ rfq_no: 'R-FIN', stage: 'Finalised' }), mk({ rfq_no: 'R-PO', stage: 'PO' }), mk({ rfq_no: 'R-SAM', stage: 'Sample' }), mk({ rfq_no: 'R-PPAP', stage: 'PPAP' })]);
  check('Released parts chip counts Finalised and later', Number(await p.locator('#rfqNReleased').innerText()) === 6, await p.locator('#rfqNReleased').innerText());
  await p.click('#rfqChipReleased');
  const relNames = await p.locator('.rfq-card .rc-no').allInnerTexts();
  check('released parts view shows only Finalised, PO, Sample and PPAP RFQs', relNames.length === 6 && relNames.indexOf('R-FIN') !== -1 && relNames.indexOf('Q-OVER') === -1, relNames.join());
  check('released parts view asks the user to confirm the definition', /confirm/i.test(await p.locator('#rfqReleasedNote').innerText()) && await p.locator('#rfqReleasedNote').isVisible());
  await reload(p);
  check('the released parts filter survives a refresh', (await p.getAttribute('#rfqChipReleased', 'aria-pressed')) === 'true');
  await p.click('#rfqChipReleased');

  // stats contract
  const st = await p.evaluate(() => CrmRfq.stats());
  check('CrmRfq.stats() follows the Dashboard contract', st.total >= 10 && st.released.total === 6 && st.byStage.Received >= 4 && st.quoteOverdue === 1 && st.quoteDueToday === 1 && st.actionOverdue === 1 && Array.isArray(st.released.list) && 'quotedToPoPct' in st.hints && Array.isArray(st.hints.stuck), JSON.stringify(st).slice(0, 300));
  check('CrmRfq exposes STAGES, RELEASED and the open functions', await t.has(p, 'CrmRfq.STAGES.length === 7 && CrmRfq.RELEASED.length === 4 && CrmRfq.openNew && CrmRfq.openEdit && CrmRfq.visible && CrmRfq.summary'));
  // App.show with a filter replaces the filters
  await p.evaluate(() => App.show('rfqs', { view: 'table', stage: 'PO' }));
  check('App.show("rfqs", filter) applies the filter', (await p.locator('#rfqRows tr').count()) === 1 && /R-PO/.test(await p.locator('#rfqRows tr').innerText()));
  await p.evaluate(() => App.show('rfqs', { view: 'board' }));

  // text, not HTML
  await newRfq(p, { no: 'X-1', part: '<img src=x onerror="window.__xss=1">', notes: '<b>bold</b>' });
  check('RFQ text is shown as text, not HTML', (await p.locator('.rfq-card img').count()) === 0 && (await p.locator('.rfq-card', { hasText: 'X-1' }).innerText()).indexOf('<img src=x') !== -1 && (await p.evaluate(() => window.__xss)) === undefined);

  // desktop summaries do not collapse
  await col(p, 'Quoted').locator('summary').click();
  check('on desktop the stage sections stay open', await col(p, 'Quoted').evaluate((d) => d.open));

  // =========================================================================================== generic RFQ CSV import
  const g = await boot();
  await seed(g, [mk({ rfq_no: 'IMP-1', part_name: 'Old part', stage: 'Received' })], []);
  const openImport = async (page) => { await page.click('#rfqImport'); await page.waitForSelector('#importDlg[open]'); };
  const setFile = async (page, name, text) => { await page.setInputFiles('#importFile', t.csvFile(name, text)); await page.waitForSelector('#importSummary li, #importErr:not([hidden])'); };
  await openImport(g);
  const list = 'Customer,RFQ No,Part Name,Qty,Stage,Quoted Value\n' +
    CUST + ',IMP-1,New part name,100,Quoted,"1,00,000"\n' +
    CUST2 + ',IMP-2,Bracket,50,,\n' +
    'Zeta Imaginary Pvt Ltd,IMP-3,Hub cover,10,PO received,5000\n';
  await setFile(g, 'rfqs.csv', list);
  check('RFQ import matches headers', (await g.locator('#importKind option:checked').innerText()) === 'RFQ list (CSV)' && /3 rows read · 3 kept/.test(await g.locator('#importSummary').innerText()) && await g.locator('#importOk').isEnabled());
  await g.click('#importOk');
  await g.waitForSelector('#importDlg:not([open])', { state: 'attached' });
  const ex = await rfq(g, 'IMP-1'), im2 = await rfq(g, 'IMP-2'), im3 = await rfq(g, 'IMP-3');
  const hx = await hist(g, ex.id);
  check('RFQ import matches headers and upserts by RFQ no', (await nRfq(g)) === 3 && ex.part_name === 'New part name' && ex.stage === 'Quoted' && ex.qty === 100 && ex.quoted_value === 100000 && hx[hx.length - 1].note === 'Imported' && hx[hx.length - 1].from === 'Received' &&
    im2 && im2.stage === 'Received' && im2.customer_id === CUST2_ID && im3 && im3.stage === 'PO', JSON.stringify([ex, im2, im3]).slice(0, 400));
  check('new imported RFQs get history marked "Imported"', (await hist(g, im2.id))[0].note === 'Imported' && (await hist(g, im3.id))[0].to === 'PO');
  check('unmatched customer is kept as text and flagged', im3.customer_id === null && im3.customer_name === 'Zeta Imaginary Pvt Ltd' && /not in CRM/.test(await cardIn(g, 'PO', 'IMP-3').innerText()) && (await cardIn(g, 'PO', 'IMP-3').locator('.rc-cust.guess').count()) === 1);
  check('the import result is announced', /RFQ list imported: 2 new, 1 updated\./.test(await g.locator('#notice').innerText()));
  await reload(g);
  check('imported RFQs survive a refresh', (await nRfq(g)) === 3 && (await cardIn(g, 'Quoted', 'IMP-1').count()) === 1);
  await openImport(g);
  await setFile(g, 'wrong.csv', 'Foo,Bar\n1,2\n');
  const impErr = await g.locator('#importErr').innerText();
  check('RFQ import shows a clear error for missing columns', /This file does not have the columns we need\. Missing: / .test(impErr) && /Foo, Bar/.test(impErr) && await g.locator('#importOk').isDisabled(), impErr);
  await g.click('#importCancel');
  await openImport(g);
  await setFile(g, 'badstage.csv', 'Customer,RFQ No,Stage\n' + CUST + ',IMP-9,Won\n');
  await g.click('#importOk');
  await g.waitForSelector('#importErr:not([hidden])');
  check('an unknown stage in an RFQ list is a row error and nothing is imported', /Row 2: Stage "Won" is not one of/.test(await g.locator('#importErr').innerText()) && (await nRfq(g)) === 3);
  await g.click('#importCancel');

  // =========================================================================================== Hub: Action Pending
  const hubPage = async (opts) => {
    const page = await boot(opts);
    await page.evaluate(() => {
      window.CrmLeads = {
        _made: [],
        match: (n) => (/omega/i.test(n) ? 'lead-omega' : null),
        isInternal: (x) => /varsha|kctr|prima ft|scm maxility|tng korea/i.test(String(x)),
        createFromImport: async (f) => { window.CrmLeads._made.push(f); return { ok: true, id: 'lead-new-' + window.CrmLeads._made.length }; }
      };
      Store.col('leads').insert({ id: 'lead-omega', company: 'Omega Castings Inc' });
    });
    return page;
  };
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const H1 = 'Item ID,Priority,Category,Subject / Matter,Counterparty / Organization,Delegated To,Action Required,Date Received,Target Due Date,Status';
  const H2 = 'Tracking ID,Category,Account / Counterparty,Contact Email / Reference,Outreach Date,Last Follow-up Date,Follow-up Count,Expected Deliverable,Status';
  const act = (id, cat, subject, cp, action, status) => [id, '', cat, subject, cp, 'Sales desk', action, istToday(-5), istToday(-2), status == null ? cat : status].map(q).join(',');
  const ACTION = [H1,
    act('ACT-901', 'HIGH-PRIORITY NEW RFQ', 'Imaginary Railways Co: 12 forged fittings RFQ', '', 'Reply to Asha Rao (asha@imaginary-example.com, +91 90000 11111).'),
    act('ACT-902', 'URGENT (PAYMENT RELEASE)', 'Imaginary GmbH: issue EUR 5,000 Tooling Invoice', '', 'Accounts must email the invoice.'),
    act('ACT-903', 'REVIEW', 'Costing sheet for a bracket', 'Brand New Buyer Ltd', 'Prepare the costing sheet.', 'OPEN'),
    act('ACT-904', 'REVIEW', 'ZF STEERING GEAR: drop arm RFQ', '', 'Check the drawing.', 'OPEN'),
    act('ACT-905', 'BOARD', 'Annual accounts', 'Varsha Forgings Ltd', 'Review the quotation file.'),
    act('ACT-906', 'ENQUIRY', 'Drop arm enquiry', 'Omega Castings Inc', 'Buyer sent a regret on this enquiry.', 'REGRET'),
    act('ACT-907', 'ACCOUNTS', 'Invoice payment follow-up', CUST2, 'Chase the payment.')
  ].join('\n') + '\n';
  const h = await hubPage();
  await openImport(h);
  await setFile(h, 'hub_action.csv', ACTION);
  check('Hub "Action Pending (Internal)" import recognises the exact headers', (await h.locator('#importKind option:checked').innerText()) === 'Action Pending (Internal)' && /7 rows read · 7 kept/.test(await h.locator('#importSummary').innerText()) && await h.locator('#importOk').isEnabled());
  await h.click('#importOk');
  await h.waitForSelector('#hubReviewDlg[open]');
  check('nothing is written before the review is accepted', (await nRfq(h)) === 0 && /Nothing is saved until you press Import/.test(await h.locator('#notice').innerText()));
  const sum = await h.locator('#hubSummary').innerText();
  check('review summary counts RFQs, guesses, unmatched, other and internal', /^7 rows: 4 RFQs \(2 stage guessed, 2 customer not matched\) · 2 other items \(skipped\) · 1 internal \(skipped\)$/.test(sum), sum);
  check('"HIGH-PRIORITY NEW RFQ" becomes an RFQ at Received with priority High', (await h.inputValue('#hub0Kind')) === 'rfq' && (await h.inputValue('#hub0Stage')) === 'Received' && (await h.inputValue('#hub0Prio')) === 'High' && await h.locator('#hubRows li').nth(0).locator('.badge', { hasText: 'stage guessed' }).isHidden());
  check('a tooling invoice request is "Other" and skipped by default', (await h.inputValue('#hub1Kind')) === 'other' && !(await h.isChecked('#hub1Inc')) && await h.locator('#hub1Inc').isDisabled());
  check('unclear rows default to Received with "stage guessed"', (await h.inputValue('#hub2Stage')) === 'Received' && await h.locator('#hubRows li').nth(2).locator('.badge', { hasText: 'stage guessed' }).isVisible());
  check('blank counterparty is guessed from the subject and flagged', (await h.inputValue('#hub3Match')) === 'c:' + CUST_ID && await h.locator('#hubRows li').nth(3).locator('.badge', { hasText: 'customer guessed' }).isVisible() && /\(blank\)/.test(await h.locator('#hubRows li').nth(3).locator('.hub-cp').innerText()));
  check('internal entities are skipped', (await h.inputValue('#hub4Kind')) === 'internal' && !(await h.isChecked('#hub4Inc')));
  check('"regret" sets the Lost marker', await h.isChecked('#hub5Lost') && (await h.inputValue('#hub5LostWhy')) === 'regret' && (await h.inputValue('#hub5Match')) === 'l:lead-omega');
  check('unknown counterparty defaults to "Create lead" when the Leads module is present', (await h.inputValue('#hub2Match')) === 'new');
  check('a blank counterparty with no guess is kept as text', (await h.inputValue('#hub0Match')) === 'text');
  await h.click('#hubAttn');
  const shown = await h.locator('#hubRows li:visible').count();
  check('"Needs attention" shows stage-guessed, unmatched, guessed and Other rows only', shown === 5 && await h.locator('#hubRows li').nth(4).isHidden() && await h.locator('#hubRows li').nth(5).isHidden(), String(shown));
  await h.click('#hubAttn');
  check('"Save as a note" is offered for Other rows once a customer is matched', await h.locator('#hub6Note').isEnabled() && await h.locator('#hub1Note').isDisabled());
  await h.check('#hub6Note');
  check('the accept button counts RFQs and notes', (await h.locator('#hubAccept').innerText()) === 'Import 4 RFQs and save 1 note', await h.locator('#hubAccept').innerText());
  await h.click('#hubAccept');
  await h.waitForSelector('#hubReviewDlg:not([open])', { state: 'attached' });
  check('accepting writes the RFQs and a note, and reports it', (await nRfq(h)) === 4 && /Hub import: 4 new, 0 updated, 0 unchanged; 1 note saved; 1 lead created\./.test(await h.locator('#notice').innerText()), await h.locator('#notice').innerText());
  const a1 = await rfq(h, 'ACT-901'), a2 = await rfq(h, 'ACT-903'), a3 = await rfq(h, 'ACT-904'), a4 = await rfq(h, 'ACT-906');
  check('Hub rows are stored with source, priority, waiting-on and stage source', a1.source_ref.sheet === 'hub_action' && a1.source_ref.id === 'ACT-901' && a1.priority === 'High' && a1.waiting_on === 'us' && a1.stage_source === 'rule' && a1.delegated_to === 'Sales desk' && a1.received === istToday(-5) && a1.next_action === istToday(-2) && a1.quote_due === istToday(-2));
  check('Hub history is written with the note "Hub import"', (await hist(h, a1.id))[0].note === 'Hub import' && (await hist(h, a1.id))[0].from === null && (await hist(h, a1.id))[0].at === TODAY);
  check('emails and phone numbers are kept out of the RFQ notes', !/@|90000|11111/.test(a1.notes) && /asha@imaginary-example\.com/.test(a1.contact_ref), a1.notes);
  check('"stage guessed" is stored and shown on the card', a2.stage_source === 'guess' && (await cardIn(h, 'Received', 'ACT-903').locator('.badge', { hasText: 'stage guessed' }).count()) === 1);
  check('an unknown counterparty can create a lead', a2.lead_id === 'lead-new-1' && (await h.evaluate(() => window.CrmLeads._made.length)) === 1 && (await h.evaluate(() => window.CrmLeads._made[0].company)) === 'Brand New Buyer Ltd' && /Lead: Brand New Buyer Ltd/.test(await cardIn(h, 'Received', 'ACT-903').innerText()));
  check('a guessed customer is stored with the flag', a3.customer_id === CUST_ID && a3.customer_guessed === true && (await cardIn(h, 'Received', 'ACT-904').locator('.badge', { hasText: 'customer guessed' }).count()) === 1);
  check('a lost Hub row is stored lost with the reason and history', a4.lost === true && a4.lost_reason === 'regret' && a4.lead_id === 'lead-omega' && (await hist(h, a4.id)).some((x) => x.to === 'Lost'));
  const noteLog = await h.evaluate((c) => Store.listLog(c), CUST2_ID);
  check('"save as note" adds a call-log Note with the subject and action', noteLog.length === 1 && noteLog[0].type === 'Note' && /Invoice payment follow-up/.test(noteLog[0].note) && /Chase the payment/.test(noteLog[0].note), JSON.stringify(noteLog));
  check('the Hub import does not write the skipped rows', (await rfq(h, 'ACT-902')) === null && (await rfq(h, 'ACT-905')) === null && (await rfq(h, 'ACT-907')) === null);
  await cardIn(h, 'Received', 'ACT-903').locator('.next').click();
  const a2b = await rfq(h, 'ACT-903');
  check('moving the card removes "stage guessed"', a2b.stage_source === 'user' && (await cardIn(h, 'Quoted', 'ACT-903').locator('.badge', { hasText: 'stage guessed' }).count()) === 0);
  await reload(h);
  check('Hub RFQs, history and notes survive a refresh', (await nRfq(h)) === 4 && (await cardIn(h, 'Quoted', 'ACT-903').count()) === 1 && (await h.evaluate((c) => Store.listLog(c).length, CUST2_ID)) === 1 && (await hist(h, a1.id)).length === 1);
  const spot = await h.evaluate(() => Object.keys(localStorage).filter((k) => localStorage.getItem(k).indexOf('asha@imaginary-example.com') !== -1));
  check('the contact email is only in the browser database', spot.length === 1 && spot[0] === 'varsha-crm-localdb-v1', spot.join());
  // a re-import of the same file is all "Unchanged" for the untouched rows, and the note is not saved twice
  await openImport(h);
  await setFile(h, 'again.csv', ACTION);
  await h.click('#importOk');
  await h.waitForSelector('#hubReviewDlg[open]');
  check('re-importing the same file shows no new rows and no duplicates', /New 0 · Updated 0 · Unchanged 4/.test(await h.locator('#hubCounts').innerText()) && (await h.locator('#hub6Note').isDisabled()) && /already saved/.test(await h.locator('#hubRows li').nth(6).innerText()), await h.locator('#hubCounts').innerText());
  await h.click('#hubCancel');
  check('cancelling the review writes nothing', (await nRfq(h)) === 4);

  // =========================================================================================== Hub: Awaiting Customer
  const w = await hubPage();
  const aw = (id, cat, account, contact, deliverable, status, cnt) => [id, cat, account, contact, istToday(-9), istToday(-4), cnt == null ? '' : cnt, deliverable, status].map(q).join(',');
  const AWAIT = (over) => [H2,
    aw('EXT-901', 'Offer Submitted', CUST, 'Asha Rao', 'Standard end bodies offer sent', 'Offer Submitted', over && over.c1 ? over.c1 : '1'),
    aw('EXT-902', 'In Negotiation', CUST2, 'Purchasing Desk', 'Pin pricing round', over && over.s2 ? over.s2 : 'In Negotiation'),
    aw('EXT-903', 'PO', 'Zeta Imaginary Pvt Ltd', 'Buyer', 'PO received for 500 pcs of covers', 'PO received'),
    aw('EXT-904', 'Samples', CUST, 'Buyer', 'Sample dispatched for approval', over && over.s4 ? over.s4 : 'Sample dispatched'),
    aw('EXT-905', 'PPAP', CUST2, 'Buyer', 'PPAP documents submitted', 'PPAP submitted'),
    aw('EXT-906', 'Enquiry', CUST, 'Buyer', 'Enquiry for hubs', 'Regret received from buyer')
  ].join('\n') + '\n';
  await openImport(w);
  await setFile(w, 'hub_awaiting.csv', AWAIT());
  check('Hub "Awaiting Customer Response" import recognises the exact headers', (await w.locator('#importKind option:checked').innerText()) === 'Awaiting Customer Response' && /6 rows read · 6 kept/.test(await w.locator('#importSummary').innerText()) && await w.locator('#importOk').isEnabled());
  await w.click('#importOk');
  await w.waitForSelector('#hubReviewDlg[open]');
  const stages = [];
  for (let i = 0; i < 6; i++) stages.push(await w.inputValue('#hub' + i + 'Stage'));
  check('stage words map to stages', stages.join() === 'Quoted,Negotiated,PO,Sample,PPAP,Received', stages.join());
  check('the awaiting sheet marks RFQs as waiting on the customer and matches customers', (await w.inputValue('#hub0Match')) === 'c:' + CUST_ID && (await w.inputValue('#hub2Match')) === 'new' && !(await w.locator('#hubRows li').nth(0).locator('.badge', { hasText: 'stage guessed' }).isVisible()));
  check('"regret" sets the Lost marker (awaiting sheet)', await w.isChecked('#hub5Lost') && (await w.inputValue('#hub5LostWhy')) === 'regret');
  await w.selectOption('#hub0Stage', 'Finalised');
  await w.selectOption('#hub2Match', 'c:' + CUST_ID);
  check('review screen lets the user change stage and customer before import', !(await w.locator('#hubRows li').nth(0).locator('.badge', { hasText: 'stage guessed' }).isVisible()) && (await w.inputValue('#hub0Stage')) === 'Finalised' && (await w.inputValue('#hub2Match')) === 'c:' + CUST_ID);
  await w.click('#hubAccept');
  await w.waitForSelector('#hubReviewDlg:not([open])', { state: 'attached' });
  const e1 = await rfq(w, 'EXT-901'), e3 = await rfq(w, 'EXT-903'), e2 = await rfq(w, 'EXT-902'), e6 = await rfq(w, 'EXT-906');
  check('review choices are what gets stored', e1.stage === 'Finalised' && e1.stage_source === 'user' && e3.customer_id === CUST_ID && e3.stage === 'PO' && e3.stage_source === 'rule' && e2.stage === 'Negotiated' && e6.lost === true && (await nRfq(w)) === 6, JSON.stringify([e1.stage, e3.customer_id]));
  check('awaiting rows store waiting_on, follow-ups and last touch', e1.waiting_on === 'customer' && e1.followup_count === 1 && e1.last_touch === istToday(-4) && e1.received === istToday(-9) && e1.next_action === '' && e1.quote_due === '');
  const exportJson = await w.evaluate(() => JSON.stringify(Store.exportCustomersJson()));
  check('contact reference is stored in this browser and never in customers.json', e1.contact_ref === 'Asha Rao' && exportJson.indexOf('Asha Rao') === -1 && exportJson.indexOf('contact_ref') === -1);

  // move one of the imported RFQs by hand, then change the file and import again
  await cardIn(w, 'Negotiated', 'EXT-902').locator('.next').click();     // user-set: Finalised
  await openImport(w);
  await setFile(w, 'again.csv', AWAIT({ s4: 'PPAP approved', s2: 'PO received', c1: '4' }));
  await w.click('#importOk');
  await w.waitForSelector('#hubReviewDlg[open]');
  const counts = await w.locator('#hubCounts').innerText();
  check('the review of a re-import shows New / Updated / Unchanged', /New 0 · Updated 3 · Unchanged 3/.test(counts), counts);
  await w.click('#hubAccept');
  await w.waitForSelector('#hubReviewDlg:not([open])', { state: 'attached' });
  const f1 = await rfq(w, 'EXT-901'), f2 = await rfq(w, 'EXT-902'), f4 = await rfq(w, 'EXT-904');
  check('re-import updates without duplicates and never overwrites a user-set stage', (await nRfq(w)) === 6 && f1.followup_count === 4 && f1.stage === 'Finalised' && f2.stage === 'Finalised' && f2.stage_source === 'user' && /Status: PO received/.test(f2.notes) &&
    f4.stage === 'PPAP' && f4.stage_source === 'rule' && (await hist(w, f4.id)).some((x) => x.from === 'Sample' && x.to === 'PPAP' && x.note === 'Hub import'), JSON.stringify([f1.followup_count, f2.stage, f4.stage]));
  await reload(w);
  check('re-imported changes survive a refresh', (await nRfq(w)) === 6 && (await cardIn(w, 'PPAP', 'EXT-904').count()) === 1);
  check('the Lost RFQ from the sheet is hidden until Show lost', (await w.locator('.rfq-card', { hasText: 'EXT-906' }).count()) === 0 && (await w.locator('#rfqNLost').innerText()) === '1');
  check('"Waiting on customer" and "Waiting on us" chips filter', (await w.locator('#rfqNCust').innerText()) === '5' && (await (async () => { await w.click('#rfqChipCust'); return w.locator('.rfq-card').count(); })()) === 5);
  await reload(w);
  check('the waiting-on filter survives a refresh', (await w.getAttribute('#rfqChipCust', 'aria-pressed')) === 'true');
  await w.click('#rfqChipUs');
  check('only one waiting-on chip applies at a time', (await w.locator('.rfq-card').count()) === 0 && (await w.getAttribute('#rfqChipCust', 'aria-pressed')) === 'false');

  // =========================================================================================== no leads module: nothing breaks
  const nl = await boot({ init: () => { Object.defineProperty(window, 'CrmLeads', { configurable: true, get: () => undefined, set: () => {} }); } });
  await openImport(nl);
  await setFile(nl, 'a.csv', ACTION);
  await nl.click('#importOk');
  await nl.waitForSelector('#hubReviewDlg[open]');
  check('without the Leads module "Create lead" is not offered and unknown counterparties stay text', (await nl.locator('#hub2Match option[value="new"]').count()) === 0 && (await nl.inputValue('#hub2Match')) === 'text' && /customer not matched/.test(await nl.locator('#hubSummary').innerText()));
  await nl.click('#hubAccept');
  await nl.waitForSelector('#hubReviewDlg:not([open])', { state: 'attached' });
  check('the import still works without the Leads module', (await nRfq(nl)) === 4);

  // =========================================================================================== phone width (375px)
  const m = await boot({ viewport: { width: 375, height: 700 } });
  await seed(m, [mk({ rfq_no: 'M-1', part_name: 'A very long part name for a forged steering component', quote_due: istToday(-3) }), mk({ rfq_no: 'M-2', stage: 'Quoted', quoted_value: 2500000, next_action: istToday(-1) }),
    mk({ rfq_no: 'M-3', stage: 'PO' }), mk({ rfq_no: 'M-4', stage: 'PPAP', customer_id: null, customer_name: 'A made up buyer with a really long company name Pvt Ltd' })]);
  const noScroll = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= 375 && document.body.scrollWidth <= 375);
  const cols = await m.locator('details.rfq-col').evaluateAll((ds) => ds.map((d) => ({ open: d.open, w: Math.round(d.getBoundingClientRect().width) })));
  check('board becomes stacked sections at 375px without page scroll', await noScroll(m) && cols.length === 7 && cols.every((c) => c.open && c.w > 300) && (await m.locator('details.rfq-col summary').first().evaluate((s) => s.getBoundingClientRect().height)) >= 40, JSON.stringify(cols));
  await col(m, 'Received').locator('summary').click();
  check('a stage section can be collapsed on a phone', !(await col(m, 'Received').evaluate((d) => d.open)) && await noScroll(m));
  await reload(m);
  check('a collapsed section stays collapsed after a refresh', !(await col(m, 'Received').evaluate((d) => d.open)));
  await col(m, 'Received').locator('summary').click();
  await m.click('#rfqViewTable');
  const tableDims = await m.evaluate(() => ({ page: document.documentElement.scrollWidth, wrap: document.getElementById('rfqTableWrap').scrollWidth, wrapW: document.getElementById('rfqTableWrap').clientWidth, thead: getComputedStyle(document.querySelector('#rfqTable thead')).display }));
  check('table becomes cards at 375px without page scroll', tableDims.page <= 375 && tableDims.wrap <= tableDims.wrapW && tableDims.thead === 'none', JSON.stringify(tableDims));
  await m.locator('#rfqRows tr').first().locator('.edit').click();
  const dd = await m.evaluate(() => { const d = document.getElementById('rfqDlg'), r = d.getBoundingClientRect(); return { page: document.documentElement.scrollWidth, left: r.left, right: r.right, sw: d.scrollWidth, cw: d.clientWidth }; });
  check('RFQ dialog fits at 375px without page scroll', dd.page <= 375 && dd.left >= 0 && dd.right <= 375 && dd.sw <= dd.cw, JSON.stringify(dd));
  await m.keyboard.press('Escape');
  await m.click('#rfqViewBoard');
  await openImport(m);
  await setFile(m, 'a.csv', ACTION);
  await m.click('#importOk');
  await m.waitForSelector('#hubReviewDlg[open]');
  const rd = await m.evaluate(() => { const d = document.getElementById('hubReviewDlg'), r = d.getBoundingClientRect(), b = d.querySelector('.dlg-body'); return { page: document.documentElement.scrollWidth, left: r.left, right: r.right, bottom: r.bottom, vh: innerHeight, bw: b.scrollWidth, bc: b.clientWidth }; });
  check('review screen fits at 375px without page scroll', rd.page <= 375 && rd.left >= 0 && rd.right <= 375 && rd.bottom <= rd.vh + 1 && rd.bw <= rd.bc, JSON.stringify(rd));
  await m.click('#hubCancel');
  await m.evaluate(() => Store.col('rfqs').insert({ customer_name: 'x', rfq_no: 'M-5', stage: 'Received', received: Store.todayISO(), lost: false }));
  check('no sideways scroll on the RFQs tab at 375px', await noScroll(m));
};
