// A2 Customers checks: Mark done (P2-A), Notes and call log (P2-B), Edit (P2-C), group / segment / plants (P2-K),
// the money / revenue / dispatch lines, and the layout checks. Synthetic made-up data only.
//
// The money, revenue and dispatch lines consume other modules (CrmMoney, CrmRevenue, CrmSchedule). When one of them is
// not on this branch yet, the test installs a small stand-in that follows the design contract (sections 4.5, 2.4, 2.4b and
// 12.4) and reads the same documents, so the checks run either way. Once the real module is merged, the real one is used.
module.exports = async (t) => {
  const { check, istToday, data } = t;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = iso => { const [y, m, d] = iso.split('-'); return (+d) + ' ' + MON[+m - 1] + ' ' + y; };
  const addMonth = iso => {
    let [y, m, d] = iso.split('-').map(Number); m += 1; if (m > 12) { m = 1; y++; }
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); d = Math.min(d, dim);
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };
  const today = istToday(0);
  const ID = { zf: 'zf-steering-gear-india-ltd', neel: 'neel-metal-products-limited', nr: 'nr-industries' };
  const nrName = data.customers.find(c => c.name.startsWith('NR INDUSTRIES')).name;

  const { page } = await t.fresh();
  const row = n => t.row(page, n);
  const rows = () => t.rows(page);
  const reload = async () => { await t.reload(page); await page.waitForSelector('#rows tr'); };
  const logs = id => page.evaluate(i => Store.listLog(i), id);
  const dlgOpen = sel => page.evaluate(s => document.querySelector(s).open, sel);
  const closed = sel => page.waitForFunction(s => !document.querySelector(s).open, sel);
  const text = async loc => ((await loc.textContent()) || '').trim();   // textContent: CSS text-transform must not change what we compare

  await t.open(page);
  await t.tab(page, 'list');
  await page.click('th button[data-sort="name"]');
  const firstName = [...data.customers.map(c => c.name)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))[0];
  check('sort by name puts the first name first (name element)', (await text(page.locator('#rows tr').first().locator('td.name .nm'))) === firstName);
  await page.click('th button[data-sort="follow"]');

  // ===================== P2-A: Mark done =====================
  await row('ZF STEERING').locator('.fu input').fill(istToday(-3));
  const doneBtns = await page.locator('.done-btn').count();
  check('Done button only on rows with a follow-up',
    doneBtns === data.customers.filter(c => c.followUp).length + 1 && (await row('ZF STEERING').locator('.done-btn').count()) === 1 &&
    (await row('NEEL METAL').locator('.done-btn').count()) === 0 &&
    (await row('ZF STEERING').locator('.done-btn').getAttribute('aria-label')) === 'Mark follow-up done for ZF STEERING GEAR (INDIA) LTD', String(doneBtns));

  await row('ZF STEERING').locator('.done-btn').click();
  await page.waitForSelector('#doneDlg[open]');
  check('Done dialog defaults to a Call and an empty next date',
    (await page.inputValue('#doneType')) === 'Call' && (await page.inputValue('#doneNext')) === '' && (await page.getAttribute('#doneNext', 'min')) === today &&
    (await page.locator('#doneType option').allInnerTexts()).join() === 'Call,Visit,Email,Telegram,Note');
  await page.click('#doneDlg .quick button:has-text("In 2 weeks")');
  const w2 = await page.inputValue('#doneNext');
  await page.click('#doneDlg .quick button:has-text("In 1 month")');
  const m1 = await page.inputValue('#doneNext');
  check('quick buttons set +14 days and +1 month', w2 === istToday(14) && m1 === addMonth(today), w2 + ' ' + m1);
  const doneNote = 'Spoke to purchase; PO expected next week';
  await page.fill('#doneNote', doneNote);
  check('the note counter counts characters', (await text(page.locator('#doneCount'))) === doneNote.length + ' / 500');
  await page.click('#doneDlg .quick button:has-text("In 1 week")');
  check('quick button "In 1 week" sets today + 7', (await page.inputValue('#doneNext')) === istToday(7));
  await page.click('#doneSave');
  await closed('#doneDlg');
  check('Done with a note and next date moves the follow-up',
    (await text(row('ZF STEERING').locator('.rel'))) === 'In 7 days' && (await row('ZF STEERING').getAttribute('class')) !== 'overdue' &&
    (await row('ZF STEERING').locator('.fu input').inputValue()) === istToday(7));
  await page.waitForTimeout(120);
  check('Done announces the result', (await page.locator('#live').innerText()) === 'Marked done. Next follow-up ' + fmtDate(istToday(7)) + '.', await page.locator('#live').innerText());
  const zfLog = await logs(ID.zf);
  check('Done adds a log entry and sets Last contacted today',
    zfLog.length === 1 && zfLog[0].type === 'Call' && zfLog[0].note === doneNote && zfLog[0].at === today &&
    zfLog[0].doneFollowUp === true && zfLog[0].nextFollowUp === istToday(7) &&
    (await text(row('ZF STEERING').locator('.lc'))) === 'Last contacted ' + fmtDate(today) + ' · today', JSON.stringify(zfLog));
  await reload();
  check('Done survives a refresh',
    (await row('ZF STEERING').locator('.fu input').inputValue()) === istToday(7) && (await text(row('ZF STEERING').locator('.lc'))) === 'Last contacted ' + fmtDate(today) + ' · today' &&
    (await text(row('ZF STEERING').locator('.badge'))) === '1' && (await logs(ID.zf)).length === 1);

  // Done without a next date clears the follow-up
  await row('NEEL METAL').locator('.fu input').fill(today);
  await row('NEEL METAL').locator('.done-btn').click();
  await page.waitForSelector('#doneDlg[open]');
  await page.selectOption('#doneType', 'Visit');
  await page.click('#doneSave');
  await closed('#doneDlg');
  const neelLog = await logs(ID.neel);
  check('Done without a next date clears the follow-up',
    (await row('NEEL METAL').locator('.fu input').inputValue()) === '' && (await row('NEEL METAL').locator('.done-btn').count()) === 0 &&
    neelLog.length === 1 && neelLog[0].type === 'Visit' && neelLog[0].nextFollowUp === '' && (await row('NEEL METAL').getAttribute('class')) !== 'overdue');
  await reload();
  check('Done without a next date survives a refresh', (await row('NEEL METAL').locator('.fu input').inputValue()) === '' && (await logs(ID.neel)).length === 1);

  // refuses a past next date
  await row('ZF STEERING').locator('.done-btn').click();
  await page.waitForSelector('#doneDlg[open]');
  await page.fill('#doneNext', istToday(-2));
  await page.click('#doneSave');
  check('Done refuses a past next date',
    await page.locator('#doneErr').isVisible() && (await text(page.locator('#doneErr'))) === 'Pick today or a later date for the next follow-up.' &&
    (await dlgOpen('#doneDlg')) && (await logs(ID.zf)).length === 1 && (await row('ZF STEERING').locator('.fu input').inputValue()) === istToday(7));

  // Esc closes without saving
  await page.fill('#doneNext', istToday(30));
  await page.fill('#doneNote', 'this must not be saved');
  await page.keyboard.press('Escape');
  await closed('#doneDlg');
  check('Esc closes Done without saving',
    !(await dlgOpen('#doneDlg')) && (await logs(ID.zf)).length === 1 && (await row('ZF STEERING').locator('.fu input').inputValue()) === istToday(7));
  await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('done-btn'));
  check('focus returns to the Done button after Esc', true);

  // ===================== P2-B: Notes and call log =====================
  await row(nrName).locator('.notes-btn').click();
  await page.waitForSelector('#notesDlg[open]');
  check('Notes drawer starts empty with a message', await page.locator('#notesEmpty').isVisible() && (await page.locator('#notesList li').count()) === 0 &&
    /^NR INDUSTRIES.* · No contact logged yet · 0 entries$/.test(await text(page.locator('#notesSub'))), await text(page.locator('#notesSub')));
  check('the note date defaults to today and cannot be in the future', (await page.inputValue('#noteDate')) === today && (await page.getAttribute('#noteDate', 'max')) === today && (await page.inputValue('#noteType')) === 'Note');
  await page.fill('#noteText', '   ');
  await page.click('#noteSave');
  check('empty note is refused', (await text(page.locator('#noteErr'))) === 'Write a note first.' && (await page.locator('#notesList li').count()) === 0 && (await logs(ID.nr)).length === 0);

  await page.fill('#noteText', 'First note');
  await page.click('#noteSave');
  check('a Note entry does not change Last contacted; a Call does (Note part)',
    (await text(row(nrName).locator('.lc'))) === 'No contact logged yet' && (await page.locator('#notesList li').count()) === 1);
  await page.selectOption('#noteType', 'Call');
  await page.fill('#noteText', 'Second note');
  await page.click('#noteSave');
  check('Notes drawer adds an entry at the top',
    (await page.locator('#notesList li').count()) === 2 && (await text(page.locator('#notesList li').first().locator('.log-text'))) === 'Second note' &&
    (await text(page.locator('#notesList li').first().locator('.log-type'))) === 'Call' && (await text(page.locator('#notesList li').first().locator('time'))) === fmtDate(today) &&
    (await text(page.locator('#notesList li').nth(1).locator('.log-text'))) === 'First note');
  check('a Note entry does not change Last contacted; a Call does',
    (await text(row(nrName).locator('.lc'))) === 'Last contacted ' + fmtDate(today) + ' · today' && /Last contacted .* · 2 entries$/.test(await text(page.locator('#notesSub'))));
  check('the drawer keeps focus in the note box after saving', await page.evaluate(() => document.activeElement && document.activeElement.id === 'noteText'));

  // 500 characters
  await page.fill('#noteText', '');
  await page.locator('#noteText').pressSequentially('x'.repeat(510));
  const typed = (await page.inputValue('#noteText')).length;
  check('note is limited to 500 characters', typed === 500 && (await page.getAttribute('#noteText', 'maxlength')) === '500' && (await text(page.locator('#noteCount'))) === '500 / 500' &&
    (await page.locator('#noteCount').getAttribute('class')).includes('near'), String(typed));
  await page.evaluate(() => { const f = document.getElementById('noteText'); f.removeAttribute('maxlength'); f.value = 'y'.repeat(501); });
  await page.click('#noteSave');
  check('a 501-character note is refused with a message', (await text(page.locator('#noteErr'))) === 'A note can have 500 characters at most.' && (await logs(ID.nr)).length === 2);
  await page.evaluate(() => { document.getElementById('noteText').setAttribute('maxlength', '500'); });

  // older-dated note sorts below newer ones
  await page.fill('#noteDate', istToday(-5));
  await page.fill('#noteText', 'Older note');
  await page.click('#noteSave');
  await page.fill('#noteDate', today);
  check('older-dated note sorts below newer ones',
    (await page.locator('#notesList li').count()) === 3 && (await text(page.locator('#notesList li').last().locator('.log-text'))) === 'Older note' &&
    (await text(page.locator('#notesList li').first().locator('.log-text'))) === 'Second note' && (await text(page.locator('#notesList li').last().locator('time'))) === fmtDate(istToday(-5)));
  check('a note cannot be dated in the future', await (async () => {
    await page.evaluate(() => { document.getElementById('noteDate').removeAttribute('max'); });
    await page.fill('#noteDate', istToday(3)); await page.fill('#noteText', 'Future');
    await page.click('#noteSave');
    const msg = await text(page.locator('#noteErr'));
    await page.fill('#noteDate', today);
    return msg === "Date can't be in the future." && (await logs(ID.nr)).length === 3;
  })());

  // text, not HTML
  const evil = '<img src=x onerror="window.__xss=1"><b>bold?</b>';
  await page.fill('#noteText', evil);
  await page.click('#noteSave');
  const evilText = await text(page.locator('#notesList li').first().locator('.log-text'));
  check('note text is shown as text, not HTML', evilText === evil && (await page.locator('#notesList img, #notesList b').count()) === 0 && (await page.evaluate(() => window.__xss)) === undefined, evilText);
  await page.fill('#noteText', 'Line one\nLine two');
  await page.locator('#noteText').press('Control+Enter');
  check('Ctrl+Enter saves the note and line breaks are kept', (await page.locator('#notesList li').count()) === 5 && (await page.locator('#notesList li').first().locator('.log-text').evaluate(e => getComputedStyle(e).whiteSpace)) === 'pre-wrap');
  check('the drawer says notes are never edited or deleted', /never edited or deleted/.test(await page.locator('#notesDlg .log-note').innerText()) && (await page.locator('#notesList button').count()) === 0);

  // close, focus, refresh
  await page.click('#notesClose');
  await closed('#notesDlg');
  await page.waitForFunction(() => { const a = document.activeElement; return a && a.classList.contains('notes-btn') && a.closest('tr').dataset.id === 'nr-industries'; });
  check('focus returns to the Notes button after closing the drawer', true);
  check('the Notes button names the customer and the count', (await row(nrName).locator('.notes-btn').getAttribute('aria-label')) === 'Notes for ' + nrName + ', 5 entries' && (await text(row(nrName).locator('.badge'))) === '5');
  await reload();
  await row(nrName).locator('.notes-btn').click();
  await page.waitForSelector('#notesDlg[open]');
  const items = await page.locator('#notesList .log-text').allInnerTexts();
  check('notes and badge survive a refresh',
    (await text(row(nrName).locator('.badge'))) === '5' && items.length === 5 && items[0] === 'Line one\nLine two' && items[1] === evil && items[2] === 'Second note' && items[4] === 'Older note' &&
    (await text(row(nrName).locator('.lc'))) === 'Last contacted ' + fmtDate(today) + ' · today', JSON.stringify(items));
  await page.keyboard.press('Escape');
  await closed('#notesDlg');

  // ===================== P2-C: Edit customer =====================
  const zfBefore = data.customers.find(c => c.name.startsWith('ZF STEERING'));
  await row('ZF STEERING').locator('select.st').selectOption('At risk');
  check('a guessed contact is shown in grey italic before the edit', (await row('ZF STEERING').locator('td[data-label="Contact person"]').getAttribute('class')).includes('guess') && zfBefore.contactFrom === 'email');
  await row('ZF STEERING').locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  check('Edit dialog opens with the current values and edit-mode labels',
    (await page.getAttribute('#dlg', 'data-mode')) === 'edit' && (await text(page.locator('#dlgTitle'))) === 'Edit customer' && await page.locator('#addOnly').isHidden() &&
    (await text(page.locator('#saveCustomer'))) === 'Save changes' && (await page.inputValue('input[name=name]')) === zfBefore.name && (await page.inputValue('input[name=contact]')) === zfBefore.contact &&
    (await page.inputValue('input[name=phone]')) === zfBefore.phone);
  check('Edit shows the ERP group as read-only text', (await text(page.locator('#erpLine'))) === 'ERP group (from the Collections sheet): ' + zfBefore.erpGroup && (await page.locator('#erpLine input').count()) === 0);

  // no change: closes without touching the record
  const upd0 = await page.evaluate(i => Store.get(i).updatedAt, ID.zf);
  await page.click('#saveCustomer');
  await closed('#dlg');
  check('Edit with no change closes without marking the customer edited', (await page.evaluate(i => Store.get(i).updatedAt, ID.zf)) === upd0);

  await row('ZF STEERING').locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  await page.fill('input[name=name]', 'ZF Steering Renamed Ltd');
  await page.fill('input[name=contact]', 'Priya Nair');
  await page.fill('input[name=phone]', '9811122233');
  await page.fill('input[name=city]', 'Pune');
  await page.click('#saveCustomer');
  await closed('#dlg');
  const renamed = () => row('ZF Steering Renamed');
  check('edit changes name, contact, phone and city',
    (await renamed().count()) === 1 && (await text(renamed().locator('td[data-label="Contact person"]'))) === 'Priya Nair' &&
    (await text(renamed().locator('td[data-label="Phone"]'))) === '98111 22233' && (await text(renamed().locator('td[data-label="City"]'))) === 'Pune');
  check('rename keeps the same id', (await renamed().getAttribute('data-id')) === ID.zf && (await page.evaluate(i => Store.get(i).name, ID.zf)) === 'ZF Steering Renamed Ltd');
  check('renamed customer keeps follow-up, status and notes',
    (await renamed().locator('.fu input').inputValue()) === istToday(7) && (await renamed().locator('select.st').inputValue()) === 'At risk' &&
    (await text(renamed().locator('.badge'))) === '1' && (await logs(ID.zf)).length === 1);
  check('edited contact is no longer shown as a guess', !(await renamed().locator('td[data-label="Contact person"]').getAttribute('class') || '').includes('guess'));
  await reload();
  check('edits survive a refresh',
    (await renamed().count()) === 1 && (await text(renamed().locator('td[data-label="Contact person"]'))) === 'Priya Nair' && (await text(renamed().locator('td[data-label="City"]'))) === 'Pune' &&
    (await renamed().getAttribute('data-id')) === ID.zf && (await renamed().locator('select.st').inputValue()) === 'At risk' && (await text(renamed().locator('.badge'))) === '1');
  const exp = await (async () => { await t.tab(page, 'export'); const d = await t.download(page, '#export'); await t.tab(page, 'list'); return JSON.parse(d.text).customers.find(c => c.id === ID.zf); })();
  check('edits are in the customers.json download', exp.name === 'ZF Steering Renamed Ltd' && exp.contact === 'Priya Nair' && exp.phone === '9811122233' && exp.city === 'Pune' && exp.contactFrom === '', JSON.stringify(exp));

  await row('NEEL METAL').locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  await page.fill('input[name=name]', nrName.toLowerCase());
  await page.click('#saveCustomer');
  check('rename to an existing name is refused', (await text(page.locator('#formErr'))) === nrName.toLowerCase() + ' is already in the list.' && (await dlgOpen('#dlg')) &&
    (await page.evaluate(i => Store.get(i).name, ID.neel)) === data.customers.find(c => c.name.startsWith('NEEL')).name);
  await page.fill('input[name=name]', '   ');
  await page.click('#saveCustomer');
  check('empty name is refused', (await text(page.locator('#formErr'))) === 'Enter a customer name.' && (await dlgOpen('#dlg')));
  await page.click('#cancel');
  await closed('#dlg');

  // ===================== P2-K: group, segment, vehicle, plants =====================
  await page.click('#openForm');
  await page.waitForSelector('#dlg[open]');
  const segOpts = await page.locator('select[name=segment] option').allInnerTexts();
  const vegOpts = await page.locator('select[name=vehicleSegment] option').allInnerTexts();
  check('segment and vehicle segment come from fixed lists and default to Not set',
    segOpts.join() === 'Not set,OEM,Tier-1,Tier-2,Trader,Export' && vegOpts.join() === 'Not set,PV,CV,Tractor,2W,Off-highway,Other' &&
    (await page.inputValue('select[name=segment]')) === '' && (await page.inputValue('select[name=vehicleSegment]')) === '' && !(await page.isChecked('input[name=relatedParty]')) &&
    (await page.getAttribute('#dlg', 'data-mode')) === 'add' && await page.locator('#erpLine').isHidden() && await page.locator('#cityWrap').isVisible());
  await page.fill('input[name=name]', 'Alpha Plants Co');
  await page.fill('input[name=city]', 'Pune');
  await page.fill('input[name=group]', 'Test Group Alpha');
  await page.selectOption('select[name=segment]', 'OEM');
  await page.selectOption('select[name=vehicleSegment]', 'CV');
  await page.selectOption('select[name=status]', 'Follow up');
  await page.click('#addPlant');
  const p1 = page.locator('#plantList .plant-row').first();
  check('adding a plant moves the old city into it',
    (await p1.locator('.pl-city').inputValue()) === 'Pune' && await page.locator('#cityWrap').isHidden() && (await page.locator('#plantList .plant-row').count()) === 1 &&
    (await text(p1.locator('.plant-no'))) === 'Plant 1 (main)', JSON.stringify([await p1.locator('.pl-city').inputValue(), await page.locator('#cityWrap').isHidden(), await page.locator('#plantList .plant-row').count(), await text(p1.locator('.plant-no'))]));
  await p1.locator('.pl-name').fill('Chakan plant');
  await p1.locator('.pl-state').fill('Maharashtra');
  await page.click('#addPlant');
  const p2 = page.locator('#plantList .plant-row').nth(1);
  await p2.locator('.pl-name').fill('Hosur plant'); await p2.locator('.pl-city').fill('Hosur'); await p2.locator('.pl-state').fill('Tamil Nadu');
  await page.click('#addPlant');
  const p3 = page.locator('#plantList .plant-row').nth(2);
  await p3.locator('.pl-city').fill('Sanand'); await p3.locator('.pl-state').fill('Gujarat');
  check('plant rows have numbered labels and Remove buttons, and Make main is edit-only',
    (await p2.locator('.pl-rm').getAttribute('aria-label')) === 'Remove plant 2' && (await p3.locator('.pl-city').getAttribute('aria-label')) === 'Plant 3 city' && (await page.locator('.pl-main:visible').count()) === 0);
  await page.click('#saveCustomer');
  await closed('#dlg');
  const alpha = () => row('Alpha Plants Co');
  check('first plant drives the City column and "+N plants" shows',
    (await text(alpha().locator('td[data-label="City"]'))).startsWith('Pune') && (await text(alpha().locator('.badge-lite'))) === '+2 plants' &&
    (await alpha().locator('.badge-lite').getAttribute('title')) === 'Pune, Maharashtra; Hosur, Tamil Nadu; Sanand, Gujarat' &&
    (await page.evaluate(() => { const c = Store.customers().find(x => x.name === 'Alpha Plants Co'); return c.city + '|' + c.state; })) === 'Pune|Maharashtra');
  check('badges show group, segment and vehicle segment as buttons',
    (await alpha().locator('.tags .tag-btn').allInnerTexts()).join() === 'Group: Test Group Alpha,OEM,CV' && (await alpha().locator('.tag-btn').first().getAttribute('aria-label')) === 'Show all customers in group Test Group Alpha');

  // group suggestion, then a second customer in the same group
  await page.click('#openForm');
  await page.waitForSelector('#dlg[open]');
  const suggest = await page.locator('#groupList option').evaluateAll(os => os.map(o => o.value));
  check('group can be typed and is suggested for the next customer', suggest.includes('Test Group Alpha') && (await page.getAttribute('input[name=group]', 'list')) === 'groupList', suggest.join());
  await page.fill('input[name=name]', 'Beta Tags Co');
  await page.fill('input[name=group]', 'Test Group Alpha');
  await page.selectOption('select[name=segment]', 'OEM');
  await page.click('#saveCustomer');
  await closed('#dlg');
  await page.click('#openForm');
  await page.waitForSelector('#dlg[open]');
  await page.fill('input[name=name]', 'Gamma Tags Co');
  await page.selectOption('select[name=segment]', 'Tier-1');
  await page.click('#saveCustomer');
  await closed('#dlg');

  // Edit: Make main, empty plant refused
  await alpha().locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  check('Edit loads group, segment, vehicle segment and all plants',
    (await page.inputValue('input[name=group]')) === 'Test Group Alpha' && (await page.inputValue('select[name=segment]')) === 'OEM' && (await page.inputValue('select[name=vehicleSegment]')) === 'CV' &&
    (await page.locator('#plantList .plant-row').count()) === 3 && (await page.locator('.pl-main:visible').count()) === 2 && await page.locator('#cityWrap').isHidden());
  await page.locator('#plantList .plant-row').nth(1).locator('.pl-main').click();
  check('Make main moves a plant to the top',
    (await page.locator('#plantList .plant-row').first().locator('.pl-city').inputValue()) === 'Hosur' && (await text(page.locator('#plantList .plant-row').first().locator('.plant-no'))) === 'Plant 1 (main)' &&
    (await page.locator('#plantList .plant-row').nth(1).locator('.pl-city').inputValue()) === 'Pune' && (await page.locator('.pl-main:visible').count()) === 2,
    JSON.stringify(await page.locator('#plantList .pl-city').evaluateAll(l => l.map(i => i.value))));
  await page.click('#saveCustomer');
  await closed('#dlg');
  check('Make main changes the City column after saving',
    (await text(alpha().locator('td[data-label="City"]'))).startsWith('Hosur') && (await text(alpha().locator('.badge-lite'))) === '+2 plants' &&
    (await page.evaluate(() => { const c = Store.customers().find(x => x.name === 'Alpha Plants Co'); return c.city + '|' + c.state + '|' + c.plants.map(p => p.city).join(); })) === 'Hosur|Tamil Nadu|Hosur,Pune,Sanand');
  check('the Plants list shows every plant on the phone card (hidden on desktop)', (await alpha().locator('td.plants-cell li').count()) === 3 && !(await alpha().locator('td.plants-cell').isVisible()));

  await alpha().locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  await page.click('#addPlant');
  await page.locator('#plantList .plant-row').nth(3).locator('.pl-name').fill('Empty plant');
  await page.click('#saveCustomer');
  check('plant without city or state is refused', (await text(page.locator('#formErr'))) === 'Plant 4 needs a city or a state.' && (await dlgOpen('#dlg')) &&
    (await page.evaluate(() => Store.customers().find(x => x.name === 'Alpha Plants Co').plants.length)) === 3);
  await page.locator('#plantList .plant-row').nth(3).locator('.pl-rm').click();
  check('removing a plant row renumbers the rest', (await page.locator('#plantList .plant-row').count()) === 3);
  await page.click('#cancel');
  await closed('#dlg');

  // old state moves into the first plant (customer with a state from the GST number, no city)
  await row(nrName).locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  await page.click('#addPlant');
  check('adding the first plant to a customer with only a state moves that state, nothing is invented',
    (await page.locator('#plantList .pl-state').first().inputValue()) === 'Maharashtra' && (await page.locator('#plantList .pl-city').first().inputValue()) === '' && (await page.locator('#plantList .pl-name').first().inputValue()) === '');
  await page.locator('#plantList .pl-rm').first().click();
  check('removing the last plant brings the City box back', await page.locator('#cityWrap').isVisible());
  await page.click('#cancel');
  await closed('#dlg');

  await reload();
  check('group, segment and plants survive a refresh',
    (await alpha().locator('.tags .tag-btn').allInnerTexts()).join() === 'Group: Test Group Alpha,OEM,CV' && (await text(alpha().locator('td[data-label="City"]'))).startsWith('Hosur') &&
    (await text(alpha().locator('.badge-lite'))) === '+2 plants' && (await page.evaluate(() => Store.customers().find(x => x.name === 'Alpha Plants Co').plants.map(p => p.name + ':' + p.city + ':' + p.state).join('|'))) ===
      'Hosur plant:Hosur:Tamil Nadu|Chakan plant:Pune:Maharashtra|:Sanand:Gujarat');
  const ex2 = await (async () => { await t.tab(page, 'export'); const d = await t.download(page, '#export'); await t.tab(page, 'list'); return JSON.parse(d.text).customers.find(c => c.name === 'Alpha Plants Co'); })();
  check('group, segment and plants are in the customers.json download', ex2.group === 'Test Group Alpha' && ex2.segment === 'OEM' && ex2.vehicleSegment === 'CV' && ex2.plants.length === 3 && ex2.plants[0].city === 'Hosur' && !!ex2.plants[0].id, JSON.stringify(ex2));

  // filters
  const optTexts = id => page.locator(id + ' option').allInnerTexts();
  check('filter lists carry counts', (await optTexts('#fSegment')).includes('OEM (2)') && (await optTexts('#fSegment')).includes('Tier-1 (1)') && (await optTexts('#fSegment')).some(x => /^Not set \(\d+\)$/.test(x)) &&
    (await optTexts('#fVseg')).includes('CV (1)') && (await optTexts('#fGroup')).includes('Test Group Alpha (2)'), (await optTexts('#fSegment')).join());
  await page.selectOption('#fSegment', 'OEM');
  const oemN = await rows();
  await page.selectOption('#fGroup', 'Test Group Alpha');
  const grpN = await rows();
  await page.selectOption('#fVseg', 'CV');
  const cvN = await rows();
  await page.click('.chip[data-f="Follow up"]');
  const chipN = await rows();
  await reload();
  check('segment, vehicle and group filters combine with chips and survive a refresh',
    oemN === 2 && grpN === 2 && cvN === 1 && chipN === 1 && (await rows()) === 1 && (await page.inputValue('#fSegment')) === 'OEM' && (await page.inputValue('#fVseg')) === 'CV' && (await page.inputValue('#fGroup')) === 'Test Group Alpha' &&
    (await page.locator('.chip[data-f="Follow up"]').getAttribute('aria-pressed')) === 'true' && (await alpha().count()) === 1, JSON.stringify({ oemN, grpN, cvN, chipN }));
  await page.selectOption('#fVseg', 'none');
  await page.click('.chip[data-f="all"]');
  check('"Not set" filters customers without that value', (await rows()) === 1 && (await row('Beta Tags Co').count()) === 1);
  await page.evaluate(() => App.show('list', { segment: 'none' }));
  check('App.show can open the list filtered by segment "none"', (await page.inputValue('#fSegment')) === 'none' && (await rows()) === 42);
  await page.evaluate(() => App.show('list', {}));
  check('App.show with an empty filter clears segment, vehicle and group too', (await rows()) === 45 && (await page.inputValue('#fSegment')) === '' && (await page.inputValue('#fGroup')) === '');

  await alpha().locator('.tag-btn', { hasText: 'OEM' }).click();
  const b1 = (await page.inputValue('#fSegment')) === 'OEM' && (await rows()) === 2;
  await row('Alpha Plants Co').locator('.tag-btn', { hasText: 'Group:' }).click();
  const b2 = (await page.inputValue('#fGroup')) === 'Test Group Alpha' && (await rows()) === 2;
  await alpha().locator('.tag-btn', { hasText: 'CV' }).click();
  check('badge click applies its filter', b1 && b2 && (await page.inputValue('#fVseg')) === 'CV' && (await rows()) === 1);
  await page.evaluate(() => App.show('list', {}));

  await page.fill('#q', 'sanand');
  const s1 = await rows();
  await page.fill('#q', 'hosur plant');
  const s2 = await rows();
  await page.fill('#q', 'test group alpha');
  const s3 = await rows();
  check('search finds a plant city', s1 === 1 && s2 === 1 && s3 === 2, [s1, s2, s3].join());
  await page.fill('#q', '');

  // related party
  check('the two related parties show the tag', (await row('VARSHA FORGINGS LTD MARKAL').locator('.tag-rel').count()) === 1 && (await row('KCTR VARSHA').locator('.tag-rel').count()) === 1 &&
    (await text(row('KCTR VARSHA').locator('.tag-rel'))) === 'Related party');
  await row('Gamma Tags Co').locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  await page.check('input[name=relatedParty]');
  await page.click('#saveCustomer');
  await closed('#dlg');
  await reload();
  await row('Gamma Tags Co').locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  const relChecked = await page.isChecked('input[name=relatedParty]');
  await page.click('#cancel');
  await closed('#dlg');
  await page.evaluate(() => App.show('list', { extra: { kind: 'related' } }));
  check('related party tag shows and the checkbox survives a refresh',
    relChecked && (await text(row('Gamma Tags Co').locator('.tag-rel'))) === 'Related party' && (await rows()) === 3 && (await text(page.locator('#extraLabel'))) === 'Related parties');
  await page.evaluate(() => App.show('list', {}));
  check('related parties are not excluded from the list, follow-ups or filters', (await rows()) === 45);

  // HTML in a name is shown as text
  await page.click('#openForm');
  await page.waitForSelector('#dlg[open]');
  await page.fill('input[name=name]', '<b>Bold</b> & Sons');
  await page.fill('input[name=group]', '<i>grp</i>');
  await page.click('#saveCustomer');
  await closed('#dlg');
  check('names and groups are shown as text, not HTML', (await row('Bold').locator('.nm').innerText()) === '<b>Bold</b> & Sons' && (await page.locator('#rows b, #rows i').count()) === 0 &&
    (await text(row('Bold').locator('.tag-btn'))) === 'Group: <i>grp</i>');

  // ===================== Add dialog: prefill and onSaved (lead conversion) =====================
  await page.evaluate(() => {
    window.__saved = null;
    CrmCustomers.openAdd({ name: 'Lead Convert Co', contact: 'Asha Rao', phone: '9000000002', city: 'Nashik', segment: 'Tier-1', vehicleSegment: 'Whale', group: 'Lead Group' }, (id, c) => { window.__saved = [id, c && c.name]; });
  });
  await page.waitForSelector('#dlg[open]');
  check('Add customer opens prefilled',
    (await page.getAttribute('#dlg', 'data-mode')) === 'add' && (await page.inputValue('input[name=name]')) === 'Lead Convert Co' && (await page.inputValue('input[name=contact]')) === 'Asha Rao' &&
    (await page.inputValue('input[name=phone]')) === '9000000002' && (await page.inputValue('input[name=city]')) === 'Nashik' && (await page.inputValue('select[name=segment]')) === 'Tier-1' &&
    (await page.inputValue('select[name=vehicleSegment]')) === '' && (await page.inputValue('input[name=group]')) === 'Lead Group');
  await page.click('#cancel');
  await closed('#dlg');
  check('onSaved is not called when the dialog is cancelled', (await page.evaluate(() => window.__saved)) === null);
  await page.evaluate(() => CrmCustomers.openAdd(new Event('click')));
  await page.waitForSelector('#dlg[open]');
  check('openAdd ignores an event passed as the prefill and starts blank', (await page.inputValue('input[name=name]')) === '' && (await page.inputValue('input[name=city]')) === '');
  await page.click('#cancel');
  await closed('#dlg');
  await page.evaluate(() => { CrmCustomers.openAdd({ name: 'Lead Convert Co', contact: 'Asha Rao', phone: '9000000002', segment: 'Tier-1' }, (id, c) => { window.__saved = [id, c && c.name]; }); });
  await page.waitForSelector('#dlg[open]');
  await page.click('#saveCustomer');
  await closed('#dlg');
  check('onSaved gets the new customer id after the save', JSON.stringify(await page.evaluate(() => window.__saved)) === JSON.stringify(['lead-convert-co', 'Lead Convert Co']));
  await reload();
  check('a customer added from a prefill survives a refresh', (await row('Lead Convert Co').count()) === 1 && (await row('Lead Convert Co').locator('.tag-btn').first().innerText()) === 'Tier-1');

  // ===================== focus, keyboard =====================
  await row('Gamma Tags Co').locator('.edit-btn').click();
  await page.waitForSelector('#dlg[open]');
  await page.keyboard.press('Escape');
  await closed('#dlg');
  await page.waitForFunction(() => { const a = document.activeElement; return a && a.classList.contains('edit-btn') && a.closest('tr').textContent.includes('Gamma Tags Co'); });
  check('focus returns to the Edit button after closing the dialog', true);

  // ===================== money, revenue and dispatch lines =====================
  const m = await t.fresh();
  const mp = m.page;
  const mrow = n => t.row(mp, n);
  // the stand-ins live in the page, so they are installed again after a refresh (a real module needs no help)
  const mreload = async () => { await t.reload(mp); await mp.waitForSelector('#rows tr'); await stub(mp); };
  await t.open(mp);
  await t.tab(mp, 'list');
  const stubFn = () => {
    const out = [];
    if (!window.CrmMoney) {
      out.push('money');
      window.CrmMoney = {
        has() { const d = Store.doc('money').get(); return !!(d && (d.aging || d.live)); },
        meta() { const d = Store.doc('money').get() || {}; return { aging: d.aging ? d.aging.meta : null, live: d.live ? d.live.meta : null }; },
        forCustomer(id) {
          const d = Store.doc('money').get(); if (!d) return null;
          const o = { outstanding: null, overdue: null, b1_30: null, b31_60: null, b61_90: null, b90: null, preApril: null, shared: null };
          let hit = false;
          const take = (r, f, kind) => {
            const mine = r.customerId === id, grp = Array.isArray(r.groupIds) && r.groupIds.indexOf(id) !== -1;
            if (!mine && !grp) return;
            hit = true; o[f] = (o[f] || 0) + (r[kind] || 0);
            if (grp) o.shared = { groupName: r.sourceName, n: r.groupIds.length };
          };
          ((d.live && d.live.rows) || []).forEach(r => take(r, 'outstanding', 'outstanding'));
          ((d.aging && d.aging.rows) || []).forEach(r => take(r, 'overdue', 'overdue'));
          return hit ? o : null;
        },
        openImport() { window.__importOpened = (window.__importOpened || 0) + 1; }
      };
    }
    if (!window.CrmRevenue) {
      out.push('revenue');
      window.CrmRevenue = {
        has() { const d = Store.doc('revenue').get(); return !!(d && d.rows && d.rows.length); },
        forCustomer(id) {
          const d = Store.doc('revenue').get(); if (!d) return null;
          const rs = d.rows.filter(r => r.customerId === id && r.date >= '2026-04-01' && r.date <= '2027-03-31');
          return { fytd: rs.reduce((s, r) => s + r.taxable, 0), mtd: 0, lastInvoice: rs.map(r => r.date).sort().pop() || '' };
        }
      };
    }
    if (!window.CrmSchedule || !window.CrmSchedule.lastDispatch) {
      out.push('dispatch');
      window.CrmSchedule = Object.assign(window.CrmSchedule || {}, {
        lastDispatch(id) { return Store.col('dispatches').all().filter(r => r.customer_id === id).map(r => r.date).sort().pop() || ''; }
      });
    }
    App.show('list');
    return out;
  };
  const stub = pg => pg.evaluate(stubFn);
  const stubbed = await stub(mp);
  const SANG = ['sangkaj-auto-components-private-limited', 'sangkaj-industries-pvt-ltd'];
  const moneyDoc = {
    v: 1,
    aging: { meta: { asOf: istToday(-2), fileName: 'test-aging.csv', rowsRead: 3, rowsKept: 3 }, rows: [
      { sourceName: 'ZF STEERING GEAR (INDIA) LTD', customerId: ID.zf, groupIds: null, overdue: 456000, b1_30: 456000, b31_60: 0, b61_90: 0, b90: 0 },
      { sourceName: 'NEEL METAL PRODUCTS LIMITED', customerId: ID.neel, groupIds: null, overdue: 0 },
      { sourceName: 'SANGKAJ INDUSTRIES PVT. LTD.', customerId: null, groupIds: SANG, overdue: 300000 }] },
    live: { meta: { asOf: istToday(-2), fileName: 'test-live.csv', rowsRead: 3, rowsKept: 3 }, rows: [
      { sourceName: 'ZF STEERING GEAR (INDIA) LTD', customerId: ID.zf, groupIds: null, outstanding: 1234567 },
      { sourceName: 'NEEL METAL PRODUCTS LIMITED', customerId: ID.neel, groupIds: null, outstanding: 250000 },
      { sourceName: 'SANGKAJ INDUSTRIES PVT. LTD.', customerId: null, groupIds: SANG, outstanding: 900000 }] }
  };
  const colBefore = { td: await mp.locator('td.money').count(), th: await mp.locator('#thMoney').isHidden(), imp: await mp.locator('#moneyImportBtn2').isVisible() };
  await mp.evaluate(async d => { await Store.doc('money').set(d); App.flush(); }, moneyDoc);
  check('money column appears only after a money import',
    colBefore.td === 0 && colBefore.th && colBefore.imp && (await mp.locator('td.money').count()) === 42 && await mp.locator('#thMoney').isVisible() && await mp.locator('#moneyImportBtn2').isHidden() &&
    (await text(mp.locator('#thMoney button[data-sort="overdue"]'))) === 'Outstanding / overdue',
    JSON.stringify([colBefore, stubbed, await mp.locator('td.money').count(), await mp.locator('#thMoney').isVisible(), await mp.locator('#moneyImportBtn2').isHidden(), await text(mp.locator('#thMoney button[data-sort="overdue"]'))]));
  const zfMoney = mrow('ZF STEERING').locator('td.money');
  const over = zfMoney.locator('.amt-over');
  check('overdue amount is red and says Overdue',
    (await text(over)) === 'Overdue ₹4,56,000' && (await over.evaluate(e => getComputedStyle(e).color)) === 'rgb(180, 35, 24)' && (await text(zfMoney.locator('.money-line').first())) === '₹12,34,567' &&
    (await zfMoney.getAttribute('title')) === 'Data as of ' + fmtDate(istToday(-2)) && (await text(mrow('NEEL METAL').locator('td.money'))).includes('No overdue') && (await mrow('NEEL METAL').locator('.amt-over').count()) === 0 &&
    (await text(mrow('FORCE MOTORS').locator('td.money'))) === '—');
  check('an overdue amount shared by an ERP group says so', await (async () => {
    const s = await text(mp.locator('#rows tr[data-id="' + SANG[0] + '"] .amt-over'));
    return /Overdue ₹3,00,000 \(shared by 2\)$/.test(s) && s.startsWith('Group ') && /Overdue ₹3,00,000 \(shared by 2\)$/.test(await text(mp.locator('#rows tr[data-id="' + SANG[1] + '"] .amt-over')));
  })());
  await mp.click('th button[data-sort="overdue"]');
  const order = await mp.locator('#rows tr td.name .nm').allInnerTexts();
  check('sort by overdue puts the largest first', order[0].startsWith('ZF STEERING') && order[1].startsWith('SANGKAJ') && order[2].startsWith('SANGKAJ'), order.slice(0, 3).join(' | '));
  await mreload();
  check('money column and its sort survive a refresh', (await mp.locator('td.money').count()) === 42 && (await mp.locator('#rows tr').first().locator('.nm').innerText()).startsWith('ZF STEERING') &&
    (await text(mrow('ZF STEERING').locator('.amt-over'))) === 'Overdue ₹4,56,000');
  await mp.evaluate(() => App.setHideAmounts(true));
  await mp.waitForFunction(() => document.querySelector('#rows td.money').textContent.includes('•••'));
  check('hidden amounts are masked on rows', !(await text(mrow('ZF STEERING').locator('td.money'))).includes('4,56,000') && (await text(mrow('ZF STEERING').locator('td.money'))).includes('Overdue ₹ •••') &&
    (await mrow('ZF STEERING').locator('td.money [aria-label="amount hidden"]').count()) >= 1);
  await mp.evaluate(() => App.setHideAmounts(false));
  await mp.click('th button[data-sort="name"]');
  await mp.evaluate(() => App.show('list', { extra: { kind: 'money', value: 'overdue' } }));
  check('the "Has overdue amount" filter works on the money data', (await t.rows(mp)) === 3 && (await text(mp.locator('#extraLabel'))) === 'Has overdue amount');
  await mp.evaluate(() => App.show('list', {}));

  // revenue line: appears below the money lines, own sort key
  const revDoc = { v: 1, meta: { fileName: 'test-invoices.csv', firstDate: '2026-04-01', lastDate: '2026-07-05' }, rows: [
    { invoiceNo: 'T-1', date: '2026-07-05', customerId: ID.zf, sourceName: 'ZF', onInvoice: 'ZF', erpGroup: '', taxable: 1000000 },
    { invoiceNo: 'T-2', date: '2026-05-10', customerId: ID.zf, sourceName: 'ZF', onInvoice: 'ZF', erpGroup: '', taxable: 500000 },
    { invoiceNo: 'T-0', date: '2026-03-15', customerId: ID.zf, sourceName: 'ZF', onInvoice: 'ZF', erpGroup: '', taxable: 999999 },
    { invoiceNo: 'T-3', date: '2026-06-20', customerId: ID.neel, sourceName: 'NEEL', onInvoice: 'NEEL', erpGroup: '', taxable: 2000000 }] };
  const noRev = await mp.locator('.amt-rev').count();
  await mp.evaluate(async d => { await Store.doc('revenue').set(d); App.flush(); }, revDoc);
  check('FY revenue line appears after an invoice import',
    noRev === 0 && (await text(mrow('ZF STEERING').locator('.amt-rev'))) === 'FY revenue ₹15,00,000' && (await text(mrow('NEEL METAL').locator('.amt-rev'))) === 'FY revenue ₹20,00,000' &&
    await mp.locator('#thMoney button[data-sort="revenue"]').isVisible() && (await text(mp.locator('#thMoney button[data-sort="revenue"]'))) === 'FY revenue');
  await mp.click('th button[data-sort="revenue"]');
  const rorder = await mp.locator('#rows tr td.name .nm').allInnerTexts();
  check('sort by revenue puts the largest first', rorder[0].startsWith('NEEL METAL') && rorder[1].startsWith('ZF STEERING'), rorder.slice(0, 2).join(' | '));
  await mreload();
  check('FY revenue line and its sort survive a refresh', (await text(mrow('NEEL METAL').locator('.amt-rev'))) === 'FY revenue ₹20,00,000' && (await mp.locator('#rows tr').first().locator('.nm').innerText()).startsWith('NEEL METAL'));

  // dispatch line
  const noDisp = await mp.locator('.ld').count();
  await mp.evaluate(async args => {
    await Store.col('dispatches').replaceAll([
      { date: '2026-10-14', customer_id: args.zf, source_name: 'ZF', part_code: 'VF1050', qty: 100, slip_type: 'Sales' },
      { date: '2026-10-02', customer_id: args.zf, source_name: 'ZF', part_code: 'VF1051', qty: 50, slip_type: 'Sales' },
      { date: '2026-09-30', customer_id: args.neel, source_name: 'NEEL', part_code: 'VF2001', qty: 10, slip_type: 'Sales' }]);
    await Store.doc('dispatch_meta').set({ fileName: 'test-dispatch.csv', firstDate: '2026-09-30', lastDate: '2026-10-14', rows: 3, slipTypes: ['Sales'] });
    App.flush();
  }, { zf: ID.zf, neel: ID.neel });
  check('Last dispatch line shows under Last order when dispatch data exists',
    noDisp === 0 && (await text(mrow('ZF STEERING').locator('.ld'))) === 'Last dispatch 14 Oct 2026' && (await text(mrow('NEEL METAL').locator('.ld'))) === 'Last dispatch 30 Sep 2026' &&
    (await mrow('FORCE MOTORS').locator('.ld').count()) === 0 && (await mp.locator('.ld').count()) === 2);
  await mp.click('th button[data-sort="dispatch"]');
  const dorder = await mp.locator('#rows tr td.name .nm').allInnerTexts();
  check('sort by dispatch puts the most recent first', dorder[0].startsWith('ZF STEERING') && dorder[1].startsWith('NEEL METAL'), dorder.slice(0, 2).join(' | '));
  await mreload();
  check('Last dispatch line survives a refresh', (await text(mrow('ZF STEERING').locator('.ld'))) === 'Last dispatch 14 Oct 2026');

  // the money import button before any import calls the money module
  const m2 = await t.fresh();
  await t.open(m2.page);
  await t.tab(m2.page, 'list');
  await m2.page.evaluate(() => { window.CrmMoney = { has() { return false; }, forCustomer() { return null; }, meta() { return {}; }, openImport() { window.__imp = 1; } }; App.show('list'); });
  await m2.page.click('#moneyImportBtn2');
  check('"Import money" on the Customers tab opens the money import', (await m2.page.evaluate(() => window.__imp)) === 1);

  // ===================== layout =====================
  // desktop: the table fits its card with every line and button showing
  for (const w of [1280, 1180, 1179, 900]) {
    const d = await t.fresh({ viewport: { width: w, height: 900 } });
    await t.open(d.page);
    await t.tab(d.page, 'list');
    await d.page.evaluate(async args => {
      window.CrmMoney = { has() { return true; }, meta() { return { aging: { asOf: args.d } }; }, forCustomer(id) { return { outstanding: 12345678, overdue: 4560000, shared: null }; }, openImport() {} };
      window.CrmRevenue = { has() { return true; }, forCustomer() { return { fytd: 98765432 }; } };
      await Store.saveCustomer(args.zf, { group: 'Long Group Name Industries', segment: 'Tier-1', vehicleSegment: 'Off-highway', relatedParty: true,
        plants: [{ name: 'A', city: 'Chakan', state: 'Maharashtra' }, { name: 'B', city: 'Hosur', state: 'Tamil Nadu' }] });
      await Store.addLog(args.zf, { type: 'Call', note: 'x' });
      await Store.setFollowUp(args.zf, args.past);
      App.show('list');
    }, { zf: ID.zf, d: today, past: istToday(-3) });
    const fit = await d.page.evaluate(() => { const c = document.querySelector('#panel-list .card'); return { sw: c.scrollWidth, cw: c.clientWidth, doc: document.documentElement.scrollWidth, win: window.innerWidth }; });
    check('the table fits its card at ' + w + 'px with tags, money and action buttons', fit.sw <= fit.cw + 1 && fit.doc <= fit.win, JSON.stringify(fit));
    if (process.env.A2_SHOTS) await d.page.screenshot({ path: process.env.A2_SHOTS + '/desktop' + w + '.png' });
  }

  // phone
  const ph = await t.fresh({ viewport: { width: 375, height: 667 } });
  const pp = ph.page;
  await t.open(pp);
  await t.tab(pp, 'list');
  const sw = () => pp.evaluate(() => document.documentElement.scrollWidth);
  await pp.evaluate(async args => {
    window.CrmMoney = { has() { return true; }, meta() { return { aging: { asOf: args.d } }; }, forCustomer() { return { outstanding: 12345678, overdue: 4560000, shared: { groupName: 'Sangkaj Industries', n: 2 } }; }, openImport() {} };
    window.CrmRevenue = { has() { return true; }, forCustomer() { return { fytd: 98765432 }; } };
    window.CrmSchedule = { lastDispatch() { return '2026-10-14'; } };
    await Store.saveCustomer(args.zf, { group: 'A Very Long Group Name Industries Private Limited', segment: 'Tier-1', vehicleSegment: 'Off-highway', relatedParty: true,
      plants: [{ name: 'Chakan plant with a long name', city: 'Chakan', state: 'Maharashtra' }, { name: 'B', city: 'Hosur', state: 'Tamil Nadu' }, { name: 'C', city: 'Sanand', state: 'Gujarat' }] });
    await Store.setFollowUp(args.zf, args.past);
    App.show('list');
  }, { zf: ID.zf, d: today, past: istToday(-3) });
  check('no sideways scroll at 375px with tags, plants, money, revenue and dispatch lines', (await sw()) === 375, String(await sw()));
  check('the phone card lists every plant and hides the +N badge', (await pp.locator('#rows tr', { hasText: 'ZF STEERING' }).locator('td.plants-cell').isVisible()) && !(await pp.locator('#rows tr', { hasText: 'ZF STEERING' }).locator('.badge-lite').isVisible()));
  check('the three filter lists stack full width at 375px', await pp.evaluate(() => ['fSegment', 'fVseg', 'fGroup'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 300 && r.right <= 375; })));
  const zfp = pp.locator('#rows tr', { hasText: 'ZF STEERING' });
  await zfp.locator('.done-btn').click();
  await pp.waitForSelector('#doneDlg[open]');
  await pp.fill('#doneNote', 'z'.repeat(300));
  check('no sideways scroll at 375px with the Done dialog open', (await sw()) === 375 && await pp.evaluate(() => { const r = document.querySelector('#doneDlg').getBoundingClientRect(); return r.left >= 0 && r.right <= 375 && r.bottom <= 667; }));
  await pp.keyboard.press('Escape');
  await pp.waitForFunction(() => !document.getElementById('doneDlg').open);
  await zfp.locator('.notes-btn').click();
  await pp.waitForSelector('#notesDlg[open]');
  await pp.fill('#noteText', 'w'.repeat(240));
  await pp.click('#noteSave');
  const dr = await pp.evaluate(() => { const r = document.querySelector('#notesDlg').getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height }; });
  check('no sideways scroll at 375px with the Notes drawer open', (await sw()) === 375 && dr.l >= 0 && dr.r <= 375 && dr.h === 667 && (await pp.evaluate(() => { const l = document.querySelector('#notesList'); return l.scrollWidth <= l.clientWidth + 1; })), JSON.stringify(dr));
  check('the Notes drawer is full width on a phone and its list scrolls inside', dr.l === 0 && dr.r === 375);
  await pp.keyboard.press('Escape');
  await pp.waitForFunction(() => !document.getElementById('notesDlg').open);

  // Edit dialog at 375x667 with several plants
  await zfp.locator('.edit-btn').click();
  await pp.waitForSelector('#dlg[open]');
  for (let i = 0; i < 2; i++) await pp.click('#addPlant');
  const geo = await pp.evaluate(() => {
    const d = document.getElementById('dlg').getBoundingClientRect(), f = document.getElementById('form');
    return { top: d.top, bottom: d.bottom, left: d.left, right: d.right, scrolls: f.scrollHeight > f.clientHeight + 1, doc: document.documentElement.scrollWidth, formW: f.scrollWidth <= f.clientWidth + 1 };
  });
  await pp.locator('#saveCustomer').scrollIntoViewIfNeeded();
  const saveBox = await pp.locator('#saveCustomer').boundingBox();
  check('Edit dialog scrolls and fits at 375px', geo.top >= 0 && geo.bottom <= 667 && geo.left >= 0 && geo.right <= 375 && geo.scrolls && geo.doc === 375 && geo.formW &&
    saveBox.y >= 0 && saveBox.y + saveBox.height <= 667, JSON.stringify({ geo, saveBox }));
  if (process.env.A2_SHOTS) await pp.screenshot({ path: process.env.A2_SHOTS + '/edit375.png' });
};
