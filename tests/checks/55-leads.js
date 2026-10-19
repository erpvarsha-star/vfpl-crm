// A9 Leads tab checks. Synthetic made-up companies, contacts and emails only (example.invalid). Every action has a refresh check.
module.exports = async (t) => {
  const { check, skip, istToday } = t;
  const T = (n) => istToday(n);
  const leadRow = (page, text) => page.locator('#leadRows tr', { hasText: text });
  const nRows = (page) => page.locator('#leadRows tr').count();
  const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).then(() => true, () => false);
  const color = (loc) => loc.evaluate(el => getComputedStyle(el).color);
  const RISK = 'rgb(180, 35, 24)', WARN = 'rgb(180, 83, 9)';
  const open = async (opts) => { const c = await t.fresh(opts); await t.open(c.page); await t.tab(c.page, 'leads'); return c.page; };
  const reload = async (page) => { await t.reload(page); await page.waitForSelector('#panel-leads:not([hidden])'); };
  const seed = (page, list) => page.evaluate(async (list) => {
    for (const l of list) await Store.col('leads').insert(Object.assign({ company_key: CrmLeads.leadKey(l.company), status: 'Open' }, l));
    App.flush();
  }, list);
  const leadsIn = (page) => page.evaluate(() => Store.col('leads').all());
  const fillLead = async (page, v) => {
    for (const k of Object.keys(v)) {
      const loc = page.locator('#leadDlg [name=' + k + ']');
      if (await loc.evaluate(e => e.tagName) === 'SELECT') await loc.selectOption(v[k]); else await loc.fill(v[k]);
    }
  };

  /* ---------------- fixtures (all made up) ---------------- */
  const HUB = 'Lead ID,Organization,Segment / Domain,Key Contact & Email,Date of Last Contact,Historical Context,Value Proposition / Angle,Recommended Outreach Action\n' +
    'LD-1,Acme Forge Pvt Ltd,Tractor,Jane Roe (jane@example.invalid),2026-01-10,Quoted last year,Spare press capacity,Call in November\n' +
    'LD-2,Zeta Imaginary Pvt Ltd,EV,Raj Test <raj@example.invalid>,2025-12-01,Sample sent,Weight saving,Send a note\n' +
    'LD-3,KCTR Varsha Automotive,Group,Staff Person (staff@kctr.example),2026-02-02,internal,,\n' +
    'LD-4,Example Bank Ltd,Finance,Teller One (teller@example.invalid),2026-03-03,account item,,\n';
  const REENGAGE = 'Company,Contact,Requirement,Last Date,Status,Re-engagement Rationale,Action Plan\n' +
    'Beta Test Works,Li Test,Shafts,2026-01-05 / 2026-03-01,Declined (capacity),Capacity is free now,Re-pitch in Q4\n' +
    'Gamma Test Ltd,Sam Test,Flanges,2025-11-11,Quote stalled,New tool room,Phone call\n';
  const PENDING = 'Company,Contact,Thread ID,Date,Status,Scope\n' +
    'ACME FORGE PRIVATE LIMITED,J. Roe,TH-1,2026-08-01,Response Pending from Our Side,Wheel hubs\n' +
    'Delta Test Inc,Pat Test,TH-2,2026-09-01,Awaiting drawings,Gears\n';
  const DORMANT_OLD = 'Customer / Company,Key Contact,Email / Phone,Component / Scope,Last Interaction Date,Past Status,Outreach / Cold Call Strategy\n' +
    'ZF Steering Gear India Pvt Ltd,Ann Test,ann@example.invalid,Rack bars,2025-10-10,Quote stalled,Cold call\n' +
    'Epsilon Test Co,Tom Test,"tom@example.invalid, +91 90000 11111",Hubs,2025-09-09,Old quote,Phone\n';
  const RECENT = 'Category,Counterparty / Entity,Contact / Sender,Subject / Key Requirement,Interaction Date,Urgency,Action Required / Next Step\n' +
    'Action Pending (Urgent),Acme Forge India,Jane <jane@example.invalid>,RFQ for hubs,2026-10-01,High,Send quote\n' +
    'Awaiting Customer Response,Beta Test Works,Li Test,Drawing review,2026-09-20,Medium,Chase reply\n';
  const MATRIX = 'Company Name,Key Contact & Details,Region/Program,Scope/Component Requirement,Historical Status/Last Date,CRM Action Category,Recommended Strategy & Next Step\n' +
    'Eta Test Pvt Ltd,"Max Roe (Head)\nmax@example.invalid\n\n+91 91111 22222",EU / EV,Knuckles,"Intro call (Aug 8, 2026)",,Send profile\n';
  const KINDS = { hub: 0, reengage: 1, pending: 2, dormant_old: 3, recent: 4, matrix: 5 };
  const stage = async (page, file, text, first) => {
    await page.click(first ? '#leadImport' : '#leadStageAdd');
    await page.setInputFiles('#importFile', t.csvFile(file, text));
    await page.waitForSelector('#importSummary li');
    const kind = await page.inputValue('#importKind');
    const enabled = await page.locator('#importOk').isEnabled();
    const summary = await page.locator('#importSummary').innerText();
    if (enabled) {
      await page.click('#importOk');
      await until(page, () => !document.getElementById('importDlg').open);
      await page.waitForSelector('#leadStaging:not([hidden])');
    }
    return { kind, enabled, summary };
  };

  /* ---------------- new lead, edit, follow-up, bucket ---------------- */
  const p = await open();
  check('Leads tab shows an empty message before any lead', (await p.locator('#leadEmpty').innerText()).startsWith('No leads yet') && (await nRows(p)) === 0);
  await p.click('#leadNew');
  await fillLead(p, { company: 'Acme Forge Pvt Ltd', contact_name: 'Jane Roe', email: 'jane@example.invalid', phone: '+91 98765 43210', scope: 'Closed-die forgings, 4 kg', segment_domain: 'Tractor',
    region_program: 'Pune / Gen-2', last_contact: T(-20), next_follow_up: T(5), action_category: 'Action Pending (Urgent)', fit: 'sweet', strategy: 'Send the quote', context: 'Met at the expo' });
  check('choosing a category with no bucket suggests the bucket', (await p.locator('#leadDlg [name=bucket]').inputValue()) === 'B' && await p.locator('#leadBucketHint').isVisible());
  await p.click('#leadSave');
  await leadRow(p, 'Acme Forge').waitFor();
  const afterAdd = await leadRow(p, 'Acme Forge').innerText();
  await reload(p);
  const r1 = leadRow(p, 'Acme Forge');
  check('new lead is saved and survives a refresh', (await nRows(p)) === 1 && /Jane Roe/.test(await r1.innerText()) && /Closed-die forgings/.test(await r1.innerText()) && /Sweet spot/.test(await r1.innerText()) &&
    (await r1.locator('.lfu input').inputValue()) === T(5) && (await r1.locator('select.lbucket').inputValue()) === 'B' && /Action Pending \(Urgent\)/.test(afterAdd), afterAdd);
  const stored = (await leadsIn(p))[0];
  check('a new lead keeps its private fields, key and a guessed-bucket mark', stored.email === 'jane@example.invalid' && stored.phone === '+91 98765 43210' && stored.company_key === 'acmeforge' && stored.status === 'Open' && stored.bucket_guessed === true && stored.source === 'Manual');
  check('Email and Call buttons carry the address in the title only', (await r1.locator('a:has-text("Email")').getAttribute('href')) === 'mailto:jane@example.invalid' && (await r1.locator('a:has-text("Call")').getAttribute('href')) === 'tel:+919876543210' &&
    !(await r1.innerText()).includes('jane@example.invalid') && (await r1.locator('a:has-text("Email")').getAttribute('title')) === 'jane@example.invalid');
  await p.click('#leadNew');
  await fillLead(p, { company: 'ACME FORGE PRIVATE LIMITED' });
  await p.click('#leadSave');
  check('a second lead with the same company is refused in #leadErr', /is already in the leads list/.test(await p.locator('#leadErr').innerText()) && (await nRows(p)) === 1);
  await p.click('#leadCancel');

  // internal entities
  await p.click('#leadNew');
  await fillLead(p, { company: 'KCTR Varsha' });
  await p.click('#leadSave');
  const e1 = await p.locator('#leadErr').innerText();
  await fillLead(p, { company: 'Prima FT' });
  await p.click('#leadSave');
  const e2 = await p.locator('#leadErr').innerText();
  await fillLead(p, { company: 'Some Real Co', email: 'pa@varshaforgings.example' });
  await p.click('#leadSave');
  const e3 = await p.locator('#leadErr').innerText();
  await p.click('#leadCancel');
  check('internal entities are refused', e1 === 'KCTR Varsha is an internal or related company and is not tracked as a lead.' && /^Prima FT is an internal or related company/.test(e2) && /Some Real Co is an internal/.test(e3) && (await nRows(p)) === 1, [e1, e2, e3].join(' | '));
  await p.click('#leadInternal');
  const defaults = await p.inputValue('#internalList');
  await p.fill('#internalList', defaults + '\nassistant.example\n  Zeta Internal ');
  await p.click('#internalSave');
  await p.waitForFunction(() => !document.getElementById('internalDlg').open);
  await reload(p);
  await p.click('#leadInternal');
  const listed = (await p.inputValue('#internalList')).split('\n');
  await p.click('#internalCancel');
  check('the internal entities list is editable and survives a refresh', defaults.split('\n').join() === 'varsha,kctr,prima ft,scm maxility,tng korea' && listed.join() === 'varsha,kctr,prima ft,scm maxility,tng korea,assistant.example,zeta internal', listed.join());
  await p.click('#leadNew');
  await fillLead(p, { company: 'Fine Co', email: 'x@assistant.example' });
  await p.click('#leadSave');
  check('an email domain added to the list is refused too', /internal or related company/.test(await p.locator('#leadErr').innerText()));
  await p.click('#leadCancel');
  await p.click('#leadInternal');
  await p.click('#internalDefaults');
  check('Restore the standard list refills the five defaults', (await p.inputValue('#internalList')).split('\n').join() === 'varsha,kctr,prima ft,scm maxility,tng korea');
  await p.click('#internalCancel');

  // edit
  await leadRow(p, 'Acme Forge').locator('.l-edit').click();
  check('Edit opens the lead with its values', (await p.inputValue('#leadDlg [name=company]')) === 'Acme Forge Pvt Ltd' && (await p.inputValue('#leadDlg [name=email]')) === 'jane@example.invalid');
  await p.fill('#leadDlg [name=scope]', 'Hubs and flanges');
  await p.selectOption('#leadDlg [name=priority]', 'High');
  await p.click('#leadSave');
  await p.waitForFunction(() => !document.getElementById('leadDlg').open);
  await reload(p);
  check('an edit survives a refresh', /Hubs and flanges/.test(await leadRow(p, 'Acme Forge').innerText()) && /High priority/.test(await leadRow(p, 'Acme Forge').innerText()));

  // follow-up dates: red with words, orange, calendar input, clear
  const fu = leadRow(p, 'Acme Forge').locator('.lfu input');
  await fu.fill(T(-3));
  const rel = leadRow(p, 'Acme Forge').locator('.lrel2');
  await rel.waitFor();
  check('lead follow-up in the past is red and says "Overdue by N days"', (await rel.innerText()) === 'Overdue by 3 days' && (await color(rel)) === RISK && (await leadRow(p, 'Acme Forge').getAttribute('class')).includes('lead-over'));
  check('Follow-up overdue chip counts it', (await p.locator('#lf-overdue').innerText()) === '1');
  await reload(p);
  check('a follow-up date set on the calendar survives a refresh', (await leadRow(p, 'Acme Forge').locator('.lfu input').inputValue()) === T(-3));
  await leadRow(p, 'Acme Forge').locator('.lfu input').fill(T(0));
  await p.waitForFunction(() => /Due today/.test(document.querySelector('#leadRows .lrel2').textContent));
  check('due today is orange', (await color(leadRow(p, 'Acme Forge').locator('.lrel2'))) === WARN && (await leadRow(p, 'Acme Forge').locator('.lrel2').innerText()) === 'Due today');
  await leadRow(p, 'Acme Forge').locator('.lclr').click();
  await reload(p);
  check('a cleared follow-up stays cleared after a refresh', (await leadRow(p, 'Acme Forge').locator('.lfu input').inputValue()) === '' && (await leadRow(p, 'Acme Forge').locator('.lrel2').count()) === 0);

  // inline bucket
  await leadRow(p, 'Acme Forge').locator('select.lbucket').selectOption('jv');
  await reload(p);
  const bl = await leadsIn(p);
  check('the bucket changed on the row survives a refresh and clears "guessed"', (await leadRow(p, 'Acme Forge').locator('select.lbucket').inputValue()) === 'jv' && bl[0].bucket_guessed === false && (await leadRow(p, 'Acme Forge').locator('.lguess').count()) === 0);

  // text not HTML
  await p.click('#leadNew');
  await fillLead(p, { company: '<img src=x onerror="window.__xss=1"> Evil Co', scope: '<b>bold</b> & <script>window.__xss=2</script>', contact_name: '<i>Name</i>' });
  await p.click('#leadSave');
  await leadRow(p, 'Evil Co').waitFor();
  check('lead text is shown as text, not HTML', (await p.locator('#leadRows img, #leadRows b, #leadRows i, #leadRows script').count()) === 0 && (await p.evaluate(() => window.__xss)) === undefined &&
    (await leadRow(p, 'Evil Co').innerText()).includes('<img src=x') && (await leadRow(p, 'Evil Co').innerText()).includes('<b>bold</b>'));
  await leadRow(p, 'Evil Co').locator('.l-close').click();
  await p.click('#leadCloseOk');
  await p.waitForFunction(() => !document.getElementById('leadCloseDlg').open);

  /* ---------------- chips, filters, dormant ---------------- */
  const f = await open();
  await seed(f, [
    { company: 'Alpha A Co', bucket: 'A', last_contact: T(-10), action_category: 'No Response (Awaiting Data)', fit: 'sweet', segment_domain: 'Truck', contact_name: 'Ann Test' },
    { company: 'Beta B Co', bucket: 'B', last_contact: T(-30), action_category: 'Action Pending (Urgent)', fit: 'check', scope: 'Gearbox shafts' },
    { company: 'Gamma C Co', bucket: 'C', last_contact: T(-300), fit: 'regret', next_follow_up: T(-4), region_program: 'Nashik' },
    { company: 'Delta D Co', bucket: 'D', last_contact: T(-100) },
    { company: 'Eps Dormant Co', bucket: 'dormant', last_contact: T(-400), action_category: 'Dormant >6 Mo (High Value)', next_follow_up: T(0) },
    { company: 'Zeta JV Co', bucket: 'jv', last_contact: T(-60), action_category: 'JV & Strategic Partnership' },
    { company: 'Eta Nobucket Co', last_contact: T(-5) },
    { company: 'Old Date Co', last_contact: T(-200), bucket: 'A' },
    { company: 'Done Closed Co', bucket: 'A', status: 'Closed', closed_reason: 'no fit', last_contact: T(-9) }
  ]);
  const counts = async () => p2c(f);
  const p2c = (page) => page.evaluate(() => ['all', 'A', 'B', 'C', 'D', 'dormant', 'jv', 'none'].map(k => document.getElementById('lb-' + k).textContent).join());
  check('bucket chips show the counts of open leads', (await counts()) === '8,2,1,1,1,1,1,1', await counts());
  check('closed leads are hidden by default', (await nRows(f)) === 8 && (await leadRow(f, 'Done Closed').count()) === 0);
  check('default order: overdue first, then the nearest follow-up, then company', (await f.locator('#leadRows tr .lco').allInnerTexts()).slice(0, 3).join() === 'Gamma C Co,Eps Dormant Co,Alpha A Co');
  await f.click('.chip[data-b="A"]');
  check('bucket chip A filters the rows', (await nRows(f)) === 2 && (await f.getAttribute('.chip[data-b="A"]', 'aria-pressed')) === 'true');
  await reload(f);
  check('bucket chips count and filter, and survive a refresh', (await nRows(f)) === 2 && (await f.getAttribute('.chip[data-b="A"]', 'aria-pressed')) === 'true' && (await counts()) === '8,2,1,1,1,1,1,1');
  await f.click('.chip[data-b="none"]');
  const noneRows = await f.locator('#leadRows .lco').allInnerTexts();
  await f.click('.chip[data-b="dormant"]');
  const dormRows = await f.locator('#leadRows .lco').allInnerTexts();
  await f.click('.chip[data-b="jv"]');
  const jvRows = await f.locator('#leadRows .lco').allInnerTexts();
  check('the Not set, Dormant and JV chips filter by their bucket', noneRows.join() === 'Eta Nobucket Co' && dormRows.join() === 'Eps Dormant Co' && jvRows.join() === 'Zeta JV Co');
  await f.click('.chip[data-b=""]');
  await f.selectOption('#leadCategory', 'Action Pending (Urgent)');
  const catRows = await f.locator('#leadRows .lco').allInnerTexts();
  await f.selectOption('#leadFit', 'sweet');
  const both = await nRows(f);
  await f.selectOption('#leadCategory', '');
  const fitSweet = await f.locator('#leadRows .lco').allInnerTexts();
  await f.selectOption('#leadFit', 'none');
  const fitNone = await nRows(f);
  await f.selectOption('#leadFit', 'regret');
  await reload(f);
  check('action category and fit filters work', catRows.join() === 'Beta B Co' && both === 0 && fitSweet.join() === 'Alpha A Co' && fitNone === 5 &&
    (await f.inputValue('#leadFit')) === 'regret' && (await f.locator('#leadRows .lco').allInnerTexts()).join() === 'Gamma C Co');
  await f.selectOption('#leadFit', '');
  await f.selectOption('#leadCategory', 'none');
  check('the "No category" filter lists leads without a category', (await nRows(f)) === 4);
  await f.selectOption('#leadCategory', '');
  const flagRows = async (flag) => { await f.click('.chip[data-flag="' + flag + '"]'); const r = await f.locator('#leadRows .lco').allInnerTexts(); await f.click('.chip[data-flag="' + flag + '"]'); return r.join(); };
  check('overdue, due-today and dormant flag chips filter', (await flagRows('overdue')) === 'Gamma C Co' && (await flagRows('today')) === 'Eps Dormant Co' &&
    (await flagRows('dormant')) === 'Gamma C Co,Eps Dormant Co,Old Date Co', await flagRows('dormant'));
  check('flag counts show on the chips', (await f.locator('#lf-overdue').innerText()) === '1' && (await f.locator('#lf-today').innerText()) === '1' && (await f.locator('#lf-dormant').innerText()) === '3');
  check('the overdue chip is red text when something is overdue', (await color(f.locator('.chip[data-flag="overdue"]'))) === RISK);
  await f.fill('#leadQ', 'shafts');
  check('search finds scope text', (await nRows(f)) === 1);
  await f.fill('#leadQ', 'nashik');
  check('search finds region text', (await nRows(f)) === 1);
  await f.fill('#leadQ', 'ann test');
  await reload(f);
  check('search text survives a refresh', (await f.inputValue('#leadQ')) === 'ann test' && (await nRows(f)) === 1);
  await f.fill('#leadQ', '');
  await f.click('#leadClosedToggle');
  const withClosed = await nRows(f);
  await reload(f);
  check('"Show converted / closed" lists closed leads with a Closed badge and survives a refresh', withClosed === 9 && (await nRows(f)) === 9 && /Closed/.test(await leadRow(f, 'Done Closed').innerText()) && (await leadRow(f, 'Done Closed').locator('.l-reopen').count()) === 1);
  await leadRow(f, 'Done Closed').locator('.l-reopen').click();
  await f.click('#leadClosedToggle');
  await reload(f);
  check('Reopen puts the lead back and the choice survives a refresh', (await nRows(f)) === 9 && (await leadRow(f, 'Done Closed').locator('.l-close').count()) === 1);
  await leadRow(f, 'Done Closed').locator('.l-close').click();
  await f.fill('#leadCloseDlg [name=reason]', 'Not a fit');
  await f.click('#leadCloseOk');
  await f.waitForFunction(() => !document.getElementById('leadCloseDlg').open);
  await reload(f);
  const closedRow = (await leadsIn(f)).find(l => l.company === 'Done Closed Co');
  check('Close keeps the reason, hides the lead and survives a refresh', (await nRows(f)) === 8 && closedRow.status === 'Closed' && closedRow.closed_reason === 'Not a fit' && (await counts()) === '8,2,1,1,1,1,1,1');
  await f.evaluate(() => App.show('leads', { bucket: 'B' }));
  check('App.show("leads", { bucket }) opens that bucket (the Dashboard link)', (await nRows(f)) === 1 && (await f.getAttribute('.chip[data-b="B"]', 'aria-pressed')) === 'true');
  await f.evaluate(() => App.show('leads', { flag: 'dormant' }));
  check('App.show("leads", { flag: "dormant" }) replaces the filters', (await nRows(f)) === 3 && (await f.getAttribute('.chip[data-b=""]', 'aria-pressed')) === 'true' && (await f.getAttribute('.chip[data-flag="dormant"]', 'aria-pressed')) === 'true');
  await f.evaluate(() => App.show('leads', {}));
  check('the dormant badge shows for last contact over 6 months',
    /Dormant 13 months/.test(await leadRow(f, 'Eps Dormant').innerText()) && /Dormant 6 months/.test(await leadRow(f, 'Old Date').innerText()) && (await leadRow(f, 'Delta D').locator('.lbadge.dorm').count()) === 0 && (await leadRow(f, 'Alpha A').locator('.lbadge.dorm').count()) === 0);
  check('a lead with no last contact is dormant by definition', await (async () => { await seed(f, [{ company: 'No Contact Co' }]); return /Dormant \(no contact on record\)/.test(await leadRow(f, 'No Contact').innerText()); })());
  const st = await f.evaluate(() => CrmLeads.stats(Store.todayISO()));
  check('CrmLeads.stats gives the Dashboard numbers', st.open === 9 && st.byBucket.A === 2 && st.byBucket.none === 2 && st.followOverdue === 1 && st.followToday === 1 && st.dormant === 4 && st.reactivate[0].company === 'Eps Dormant Co', JSON.stringify(st));
  check('CrmLeads.visible and summary follow the filter', await f.evaluate(() => { App.show('leads', { bucket: 'A' }); return CrmLeads.visible().length === 2 && /^Showing 2 of 9 leads/.test(CrmLeads.summary()); }));

  /* ---------------- log touch ---------------- */
  const tp = await open();
  await seed(tp, [{ company: 'Touch Test Co', last_contact: T(-90), bucket: 'A', contact_name: 'Tia Test' }, { company: 'Other Cust Co', last_contact: T(-90) }]);
  const lid = (await leadsIn(tp)).find(l => l.company === 'Touch Test Co').id;
  await leadRow(tp, 'Touch Test').locator('.l-touch').click();
  await tp.waitForSelector('#touchDlg[open]');
  await tp.selectOption('#touchDlg [name=type]', 'Call');
  await tp.fill('#touchDlg [name=at]', T(-2));
  await tp.fill('#touchDlg [name=note]', 'Intro call, asked for drawings');
  await tp.fill('#touchDlg [name=next]', T(7));
  await tp.click('#touchSave');
  await until(tp, () => document.querySelectorAll('#touchList li').length === 1);
  let rowTxt = await leadRow(tp, 'Touch Test').innerText();
  check('log touch adds to the call log and updates Last contact', (await tp.evaluate((id) => Store.leadLog(id).length === 1 && Store.allLog().some(e => e.leadId === id && e.type === 'Call' && e.customerId === ''), lid)) &&
    (await tp.locator('#touchList li').first().innerText()).includes('Intro call') && rowTxt.includes('2 days ago') && (await leadRow(tp, 'Touch Test').locator('.lfu input').inputValue()) === T(7), rowTxt);
  await tp.selectOption('#touchDlg [name=type]', 'Note');
  await tp.fill('#touchDlg [name=at]', T(0));
  await tp.fill('#touchDlg [name=note]', 'Internal note only');
  await tp.click('#touchSave');
  await until(tp, () => document.querySelectorAll('#touchList li').length === 2);
  rowTxt = await leadRow(tp, 'Touch Test').innerText();
  check('a Note does not change Last contact', rowTxt.includes('2 days ago') && !rowTxt.includes('today') && (await tp.evaluate((id) => Store.leadLog(id).length, lid)) === 2);
  await tp.fill('#touchDlg [name=note]', '');
  await tp.click('#touchSave');
  check('an empty touch is refused in #touchErr', /Write a note first/.test(await tp.locator('#touchErr').innerText()));
  await tp.fill('#touchDlg [name=note]', 'x');
  await tp.fill('#touchDlg [name=next]', T(-1));
  await tp.click('#touchSave');
  check('a past "next follow-up" is refused', /today or a later date/.test(await tp.locator('#touchErr').innerText()) && (await tp.evaluate((id) => Store.leadLog(id).length, lid)) === 2);
  await tp.click('#touchClose');
  await reload(tp);
  const after = await tp.evaluate((id) => ({ log: Store.leadLog(id).map(e => e.type + ':' + e.note), cust: Store.allLog().filter(e => e.customerId).length }), lid);
  check('logged touches survive a refresh', after.log.join() === 'Note:Internal note only,Call:Intro call, asked for drawings' && (await leadRow(tp, 'Touch Test').innerText()).includes('2 days ago') && after.cust === 0);
  await leadRow(tp, 'Touch Test').locator('.l-touch').click();
  check('the touch dialog shows the history, newest first', (await tp.locator('#touchList li').count()) === 2 && /Internal note only/.test(await tp.locator('#touchList li').first().innerText()));
  await tp.click('#touchClose');
  const tchip = await tp.locator('#lf-touched7').innerText();
  await tp.click('.chip[data-flag="touched7"]');
  check('the "touched in last 7 days" chip counts and filters', tchip === '1' && (await nRows(tp)) === 1);

  /* ---------------- imports ---------------- */
  const ip = await open();
  const wrong = await (async () => {
    await ip.click('#leadImport');
    await ip.setInputFiles('#importFile', t.csvFile('rfq.csv', 'Item ID,Priority,Category,Subject / Matter\nX-1,High,Quote,Something\n'));
    await ip.waitForSelector('#importErr:not([hidden])');
    const msg = await ip.locator('#importErr').innerText();
    const off = await ip.locator('#importOk').isDisabled();
    await ip.click('#importCancel');
    return { msg, off };
  })();
  check('a file that is not a lead export is refused with the missing columns', /does not have the columns we need/.test(wrong.msg) && /Missing: /.test(wrong.msg) && wrong.off, wrong.msg);
  const hub = await stage(ip, 'hub_dormant.csv', HUB, true);
  check('Hub "Dormant Leads (>6 Months)" import recognises the exact headers', hub.kind === '0' && hub.enabled && /4 rows read · 4 kept/.test(hub.summary) && !/does not have/.test(hub.summary), hub.summary);
  check('internal rows are skipped at import with the reason', /3 rows staged from 1 file \(1 internal skipped: internal \/ related entity\)/.test(await ip.locator('#leadStageMsg').innerText()) &&
    !(await ip.evaluate(() => JSON.stringify(Store.doc('lead_staging').get()))).includes('KCTR'), await ip.locator('#leadStageMsg').innerText());
  const kinds = {};
  kinds.reengage = await stage(ip, 'reengage.csv', REENGAGE, false);
  kinds.pending = await stage(ip, 'pending.csv', PENDING, false);
  kinds.dormant_old = await stage(ip, 'dormant_old.csv', DORMANT_OLD, false);
  kinds.recent = await stage(ip, 'recent.csv', RECENT, false);
  kinds.matrix = await stage(ip, 'matrix.csv', MATRIX, false);
  check('each of the four older tracker formats is recognised', ['reengage', 'pending', 'dormant_old', 'recent'].every(k => kinds[k].kind === String(KINDS[k]) && kinds[k].enabled), JSON.stringify(Object.keys(kinds).map(k => [k, kinds[k].kind])));
  check('the prospect matrix (multi-line contact cells) is recognised', kinds.matrix.kind === '5' && kinds.matrix.enabled && /1 rows read · 1 kept/.test(kinds.matrix.summary));
  check('the staging bar adds up files and rows', /12 rows staged from 6 files/.test(await ip.locator('#leadStageMsg').innerText()), await ip.locator('#leadStageMsg').innerText());
  const staged = await ip.evaluate(() => Store.doc('lead_staging').get().rows);
  const acmeHub = staged.find(r => r.sheetKey === 'hub_dormant' && /Acme/.test(r.company));
  const mtx = staged.find(r => r.sheetKey === 'matrix');
  check('"Key Contact & Email" is split into name and email', acmeHub.contact_name === 'Jane Roe' && acmeHub.email === 'jane@example.invalid' && staged.find(r => /Zeta/.test(r.company)).contact_name === 'Raj Test' && staged.find(r => /Zeta/.test(r.company)).email === 'raj@example.invalid', JSON.stringify(acmeHub));
  check('staged rows carry guessed buckets, ISO dates and the second date of a double-date cell', acmeHub.bucket === 'dormant' && acmeHub.bucket_guessed && acmeHub.last_contact === '2026-01-10' &&
    staged.find(r => r.sheetKey === 'reengage' && /Beta/.test(r.company)).last_contact === '2026-03-01' && staged.find(r => r.sheetKey === 'pending' && /ACME/.test(r.company)).bucket === 'B' &&
    mtx.email === 'max@example.invalid' && mtx.phone === '+91 91111 22222' && mtx.last_contact === '2026-08-08', JSON.stringify(staged.map(r => [r.sheetKey, r.company, r.bucket, r.last_contact, r.bucket_guessed])));
  await reload(ip);
  check('staged rows survive a refresh', await ip.locator('#leadStaging').isVisible() && /12 rows staged from 6 files/.test(await ip.locator('#leadStageMsg').innerText()) && (await nRows(ip)) === 0);

  // merge preview
  await ip.click('#leadStageReview');
  await ip.waitForSelector('#leadMergeDlg[open] .mcard');
  const cardCount = await ip.locator('#mergeCards .mcard').count();
  const acmeCard = ip.locator('.mcard[data-key="acmeforge"]');
  const acmeTxt = await acmeCard.innerText();
  check('duplicates across files merge into one lead in the preview', cardCount === 9 && (await ip.locator('.mcard[data-key^="acmeforge"]').count()) === 1 && /Hub dormant · Pending tracker · Recent status|Recent status · Pending tracker · Hub dormant/.test(acmeTxt) && /3 rows/.test(acmeTxt) && /New lead/.test(acmeTxt), cardCount + ' ' + acmeTxt.slice(0, 200));
  check('conflicting values show as radio choices, joined texts default to "Join all"', (await acmeCard.locator('.mf').count()) >= 3 && (await acmeCard.locator('input[type=radio]:checked').count()) === (await acmeCard.locator('.mf').count()));
  check('the summary and button say what will happen', /9 companies from 12 rows · 7 new · 0 to update · 2 skipped/.test(await ip.locator('#mergeSummary').innerText()) && (await ip.locator('#mergeOk').innerText()) === 'Create 7 leads', await ip.locator('#mergeSummary').innerText());
  const bank = ip.locator('.mcard[data-key="examplebank"]');
  check('a bank row is pre-ticked as skip and flagged as not a lead', !(await bank.locator('.m-inc').isChecked()) && /not a lead/.test(await bank.innerText()));
  const zf = ip.locator('.mcard[data-key="zfsteeringgear"]');
  check('a lead that is already a customer defaults to Skip', /Already a customer/.test(await zf.innerText()) && !(await zf.locator('.m-inc').isChecked()) && (await zf.locator('input[type=radio][value="skip"]').isChecked()) && (await zf.locator('input[type=radio][value="note"]').count()) === 1 && (await zf.locator('input[type=radio][value="lead"]').count()) === 1);
  await zf.locator('input[type=radio][value="lead"]').check();
  const asLead = await ip.locator('#mergeOk').innerText();
  await ip.locator('.mcard[data-key="zfsteeringgear"] input[type=radio][value="skip"]').check();
  check('"Import as lead anyway" includes it, Skip takes it out again', asLead === 'Create 8 leads' && (await ip.locator('#mergeOk').innerText()) === 'Create 7 leads');
  check('no internal company reaches the preview', (await ip.locator('#mergeCards .mname').allInnerTexts()).join('|').indexOf('KCTR') === -1);
  await ip.check('#mergeAttn');
  const attnShown = await ip.locator('#mergeCards .mcard:visible').count();
  check('"Needs attention" hides cards with nothing to check', attnShown < cardCount && attnShown >= 1 && (await ip.locator('.mcard[data-key="etatest"]').isHidden()) && (await acmeCard.isVisible()), attnShown + '/' + cardCount + ' eta hidden=' + (await ip.locator('.mcard[data-key="etatest"]').isHidden()));
  await ip.uncheck('#mergeAttn');
  await acmeCard.locator('.m-split').click();
  const splitN = await ip.locator('.mcard[data-key^="acmeforge"]').count();
  check('"These are different companies" splits a merge card', splitN === 3 && (await ip.locator('#mergeCards .mcard').count()) === 11 && /Create 9 leads/.test(await ip.locator('#mergeOk').innerText()), splitN + ' ' + await ip.locator('#mergeOk').innerText());
  await ip.locator('.mcard[data-key^="acmeforge#"] .m-split').first().click();
  check('unticking the split joins the card again', (await ip.locator('.mcard[data-key^="acmeforge"]').count()) === 1);
  await ip.locator('.mcard[data-key="betatestworks"] .m-inc').uncheck();
  check('unticking Include leaves a company out', (await ip.locator('#mergeOk').innerText()) === 'Create 6 leads');
  await ip.locator('.mcard[data-key="betatestworks"] .m-inc').check();
  await ip.click('#mergeOk');
  await ip.waitForFunction(() => !document.getElementById('leadMergeDlg').open);
  await until(ip, () => document.getElementById('leadStaging').hidden);
  const doneNotice = await ip.locator('#notice').innerText();
  await reload(ip);
  const made = await leadsIn(ip);
  const acme = made.find(l => l.company_key === 'acmeforge');
  check('Create leads writes one lead per card, clears the staging and survives a refresh', made.length === 7 && (await nRows(ip)) === 7 && await ip.locator('#leadStaging').isHidden() &&
    !made.some(l => /Bank|ZF/i.test(l.company)) && /Created 7 leads, updated 0/.test(doneNotice), made.map(l => l.company).join());
  check('the merged lead keeps three sources, the newest date, the first email and no other emails in its text', acme.sources.length === 3 && acme.last_contact === '2026-10-01' && acme.email === 'jane@example.invalid' &&
    acme.company === 'Acme Forge India' && acme.status === 'Open' && acme.context.split('Quoted last year').length === 2 && !acme.context.includes('@') && acme.priority === 'High' && acme.action_category === 'Action Pending (Urgent)' && acme.bucket === 'B' && acme.bucket_guessed === true, JSON.stringify(acme));
  check('imported leads show their bucket as guessed and keep the source label', (await leadRow(ip, 'Acme Forge').locator('.lguess').count()) === 1 && /Recent status/.test(acme.source));

  // re-import updates and does not duplicate
  await stage(ip, 'hub_dormant.csv', HUB, true);
  await stage(ip, 'pending.csv', PENDING, false);
  await stage(ip, 'recent.csv', RECENT, false);
  await ip.click('#leadStageReview');
  await ip.waitForSelector('#leadMergeDlg[open] .mcard');
  const upd = await ip.locator('.mcard[data-key="acmeforge"]').innerText();
  const sum2 = await ip.locator('#mergeSummary').innerText();
  const btn2 = await ip.locator('#mergeOk').innerText();
  await ip.click('#mergeOk');
  await ip.waitForFunction(() => !document.getElementById('leadMergeDlg').open);
  await reload(ip);
  const made2 = await leadsIn(ip);
  const acme2 = made2.find(l => l.company_key === 'acmeforge');
  check('re-import updates and does not duplicate', /Update existing lead/.test(upd) && /0 new · 4 to update/.test(sum2) && btn2 === 'Update 4' && made2.length === 7 && acme2.id === acme.id && acme2.sources.length === 3 &&
    acme2.context === acme.context && acme2.strategy === acme.strategy, [upd.slice(0, 60), sum2, btn2, made2.length, acme2.sources.length].join(' | '));

  // match to a customer instead; discard
  await stage(ip, 'pending.csv', 'Company,Contact,Thread ID,Date,Status,Scope\nNote Only Test Co,Nia,TH-7,2026-09-30,Awaiting reply,Brackets\n', true);
  await ip.click('#leadStageReview');
  await ip.waitForSelector('#leadMergeDlg[open] .mcard');
  const logBefore = await ip.evaluate(() => Store.logCount('nr-industries'));
  await ip.locator('.mcard[data-key="noteonlytest"] .m-match').selectOption('nr-industries');
  const noteBtn = await ip.locator('#mergeOk').innerText();
  await ip.click('#mergeOk');
  await ip.waitForFunction(() => !document.getElementById('leadMergeDlg').open);
  await reload(ip);
  const logAfter = await ip.evaluate(() => Store.listLog('nr-industries').map(l => l.type + ':' + l.note));
  check('"Match to customer instead" saves the rows as a note on that customer and creates no lead', noteBtn === 'Save 1 note' && logAfter.length === logBefore + 1 && /^Note:Lead tracker \(Pending tracker\): /.test(logAfter[0]) && (await leadsIn(ip)).length === 7 && !logAfter[0].includes('@'), noteBtn + ' ' + logAfter[0]);
  await stage(ip, 'pending.csv', PENDING, true);
  ip.once('dialog', d => d.accept());
  await ip.click('#leadStageDiscard');
  await until(ip, () => document.getElementById('leadStaging').hidden);
  await reload(ip);
  check('Discard staged rows empties the staging and survives a refresh', await ip.locator('#leadStaging').isHidden() && (await ip.evaluate(() => Store.doc('lead_staging').get())) === null && (await leadsIn(ip)).length === 7);

  /* ---------------- convert ---------------- */
  const cv = await open();
  await seed(cv, [{ company: 'Convert Test Co', contact_name: 'Cass Test', phone: '+91 90000 22222', email: 'cass@example.invalid', segment_domain: 'OEM', scope: 'Axle shafts', last_contact: T(-40) }]);
  const cid = (await leadsIn(cv))[0].id;
  await cv.evaluate((id) => {
    Store.addLeadLog(id, { type: 'Call', note: 'first call', at: Store.addDays(Store.todayISO(), -6) });
    Store.addLeadLog(id, { type: 'Note', note: 'a note', at: Store.addDays(Store.todayISO(), -1) });
    Store.col('rfqs').insert({ lead_id: id, customer_id: null, customer_name: 'Convert Test Co', rfq_no: 'T-1' });
  }, cid);
  // the real Add dialog, when the Customers tab accepts a prefill (A2)
  const real = await cv.evaluate(() => {
    try {
      CrmCustomers.openAdd({ name: 'Probe Real Co' }, function () {});
      const d = document.getElementById('dlg'), ok = !!(d && d.open && d.querySelector('input[name=name]').value === 'Probe Real Co');
      if (d && d.open) d.close();
      return ok;
    } catch (e) { return false; }
  });
  await cv.evaluate(() => { window.__realAdd = window.CrmCustomers.openAdd; });
  if (!real) {
    await leadRow(cv, 'Convert Test').locator('.l-conv summary').click();
    await leadRow(cv, 'Convert Test').locator('.l-cust').click();
    check('convert to customer without a prefill-capable Add form shows a notice and no blank form', /Customers update that accepts a prefilled Add form/.test(await cv.locator('#notice').innerText()) && !(await cv.evaluate(() => { const d = document.getElementById('dlg'); return d && d.open; })) &&
      (await leadsIn(cv))[0].status === 'Open');
    skip('convert to customer through the real Add dialog marks the lead Converted', 'needs A2');
  } else {
    await leadRow(cv, 'Convert Test').locator('.l-conv summary').click();
    await leadRow(cv, 'Convert Test').locator('.l-cust').click();
    await cv.waitForSelector('#dlg[open]');
    const prefilled = await cv.evaluate(() => ({ name: document.querySelector('#dlg [name=name]').value, contact: document.querySelector('#dlg [name=contact]').value, phone: document.querySelector('#dlg [name=phone]').value }));
    await cv.click('#dlg button[type=submit]');
    await until(cv, () => Store.col('leads').all()[0].status === 'Converted');
    check('convert to customer opens Add prefilled and marks the lead Converted (real Add dialog)', prefilled.name === 'Convert Test Co' && prefilled.contact === 'Cass Test' && prefilled.phone === '+91 90000 22222' && (await leadsIn(cv))[0].status === 'Converted');
  }
  // a stand-in Add dialog proves the hand-over whatever the Customers tab does
  const cv2 = await open();
  await seed(cv2, [{ company: 'Convert Test Co', contact_name: 'Cass Test', phone: '+91 90000 22222', email: 'cass@example.invalid', segment_domain: 'OEM', scope: 'Axle shafts', last_contact: T(-40) }]);
  const cid2 = (await leadsIn(cv2))[0].id;
  await cv2.evaluate((id) => {
    Store.addLeadLog(id, { type: 'Call', note: 'first call', at: Store.addDays(Store.todayISO(), -6) });
    Store.addLeadLog(id, { type: 'Note', note: 'a note', at: Store.addDays(Store.todayISO(), -1) });
    Store.col('rfqs').insert({ lead_id: id, customer_id: null, customer_name: 'Convert Test Co', rfq_no: 'T-1' });
    window.CrmCustomers = Object.assign({}, window.CrmCustomers, { openAdd: function (prefill, onSaved) { window.__add = { prefill: prefill, onSaved: onSaved }; } });
  }, cid2);
  await leadRow(cv2, 'Convert Test').locator('.l-conv summary').click();
  await leadRow(cv2, 'Convert Test').locator('.l-cust').click();
  const pre = await cv2.evaluate(() => window.__add && window.__add.prefill);
  check('convert to customer hands the Add form a prefill (name, contact, phone, segment) and a callback', !!pre && pre.name === 'Convert Test Co' && pre.contact === 'Cass Test' && pre.phone === '+91 90000 22222' && pre.segment === 'OEM', JSON.stringify(pre));
  check('the lead stays open until the customer is really saved', (await leadsIn(cv2))[0].status === 'Open');
  const newCust = await cv2.evaluate(async () => { const r = await Store.addCustomer({ name: 'Convert Test Co', contact: 'Cass Test' }); window.__add.onSaved(r.id); return r.id; });
  await until(cv2, () => Store.col('leads').all()[0].status === 'Converted');
  await cv2.evaluate(() => App.flush());
  const conv = (await leadsIn(cv2))[0];
  check('convert to customer opens Add prefilled and marks the lead Converted', conv.status === 'Converted' && conv.converted_customer_id === newCust && conv.converted_at === T(0) && (await nRows(cv2)) === 0, JSON.stringify(conv).slice(0, 200));
  const moved = await cv2.evaluate((id) => ({ list: Store.listLog(id).map(l => l.type + ':' + l.note), last: Store.lastContacted(id), rfq: Store.col('rfqs').all()[0].customer_id }), newCust);
  check("converted lead's touches move to the customer", moved.list.join() === 'Note:a note,Call:first call' && moved.last === T(-6) && moved.rfq === newCust, JSON.stringify(moved));
  await reload(cv2);
  await cv2.click('#leadClosedToggle');
  check('a converted lead stays Converted after a refresh and can be shown', /Converted/.test(await leadRow(cv2, 'Convert Test').innerText()) && (await leadRow(cv2, 'Convert Test').locator('.l-cview').count()) === 1 &&
    (await cv2.evaluate(() => Store.col('leads').all()[0].status)) === 'Converted');
  check('stats counts the conversion in the last 30 days', (await cv2.evaluate(() => CrmLeads.stats(Store.todayISO()).converted30)) === 1);

  // convert to RFQ
  const rq = await open();
  await seed(rq, [{ company: 'Rfq Test Co', scope: 'Brake discs' }]);
  const rid = (await leadsIn(rq))[0].id;
  const realRfq = await t.has(rq, 'window.CrmRfq && window.CrmRfq.openNew');
  await rq.evaluate((real) => {
    window.__rfq = null;
    if (real) { const orig = CrmRfq.openNew; CrmRfq.openNew = function (c, o) { window.__rfq = [c, o]; return orig.apply(this, arguments); }; }
    else window.CrmRfq = { openNew: function (c, o) { window.__rfq = [c, o]; Store.col('rfqs').insert({ lead_id: o.leadId, customer_id: null, customer_name: o.customerName, part_name: o.partName, rfq_no: 'R-1' }); } };
  }, realRfq);
  await leadRow(rq, 'Rfq Test').locator('.l-conv summary').click();
  await leadRow(rq, 'Rfq Test').locator('.l-rfq').click();
  const args = await rq.evaluate(() => window.__rfq);
  let dlgFill = null;
  if (realRfq) {
    // the real New RFQ dialog opens with the lead's name; saving it creates an RFQ that belongs to the lead
    await rq.waitForSelector('#rfqDlg[open]');
    dlgFill = await rq.evaluate(() => ({ customer: document.getElementById('rfqCustomer').value, part: document.getElementById('rfqPartName').value }));
    await rq.click('#rfqSave');
    await rq.waitForFunction(() => !document.getElementById('rfqDlg').open);
  }
  await until(rq, () => (Store.col('leads').all()[0].converted_rfq_ids || []).length === 1);
  await t.tab(rq, 'leads');
  await rq.evaluate(() => App.flush());
  const afterRfq = (await leadsIn(rq))[0];
  const rfqRow = await rq.evaluate(() => Store.col('rfqs').all()[0] || null);
  check('convert to RFQ creates an RFQ linked to the lead', !!args && args[0] === null && args[1].leadId === rid && args[1].customerName === 'Rfq Test Co' && args[1].partName === 'Brake discs' &&
    !!rfqRow && rfqRow.lead_id === rid && !rfqRow.customer_id && afterRfq.converted_rfq_ids.length === 1 && /1 RFQ/.test(await leadRow(rq, 'Rfq Test').innerText()) &&
    (!realRfq || (dlgFill.customer === 'Rfq Test Co' && dlgFill.part === 'Brake discs')), JSON.stringify([args, dlgFill, rfqRow && rfqRow.lead_id]));
  await reload(rq);
  check('the RFQ link survives a refresh', /1 RFQ/.test(await leadRow(rq, 'Rfq Test').innerText()) && (await leadsIn(rq))[0].converted_rfq_ids.length === 1);
  await rq.evaluate(() => { delete window.CrmRfq; delete window.CrmCustomers.openAdd; });
  await leadRow(rq, 'Rfq Test').locator('.l-conv summary').click();
  await leadRow(rq, 'Rfq Test').locator('.l-rfq').click();
  const n1 = await rq.locator('#notice').innerText();
  await leadRow(rq, 'Rfq Test').locator('.l-conv summary').click();
  await leadRow(rq, 'Rfq Test').locator('.l-cust').click();
  const n2 = await rq.locator('#notice').innerText();
  check('convert without the RFQs or Customers module shows a clear notice', /Convert to RFQ is not available/.test(n1) && /Convert to customer is not available/.test(n2));

  /* ---------------- privacy ---------------- */
  const pv = await open();
  await seed(pv, [{ company: 'Privacy Test Co', email: 'secret.lead@example.invalid', phone: '+91 90000 33333', contact_name: 'Pia Test' }]);
  await pv.evaluate(async () => { const l = Store.col('leads').all()[0]; await Store.addLeadLog(l.id, { type: 'Call', note: 'a call' }); });
  await t.tab(pv, 'export');
  const dl = await t.download(pv, '#export');
  const bk = await pv.evaluate(() => JSON.stringify(Store.exportBackup()));
  check('contact email never appears in the customers.json export', !/secret\.lead|Privacy Test|90000 33333|Pia Test/.test(dl.text) && JSON.parse(dl.text).customers.every(c => !('email' in c)));
  check('leads are not in the default backup and lead emails and phones are not in it', !/secret\.lead|90000 33333/.test(bk) && !/Privacy Test/.test(bk));
  check('the lead is stored in this browser only (local database)', /secret\.lead/.test(await pv.evaluate(() => localStorage.getItem('varsha-crm-localdb-v1'))));

  /* ---------------- blocked storage, layout ---------------- */
  const bs = await open({ blockStorage: true });
  await bs.click('#leadNew');
  await fillLead(bs, { company: 'Memory Only Co' });
  await bs.click('#leadSave');
  await leadRow(bs, 'Memory Only').waitFor();
  check('blocked storage shows the warning and the lead still works in memory', await bs.locator('#storageWarn').isVisible() && (await nRows(bs)) === 1);

  const ph = await t.fresh({ viewport: { width: 375, height: 760 } });
  const pp = ph.page;
  await t.open(pp); await t.tab(pp, 'leads');
  await seed(pp, [
    { company: 'A Very Long Company Name Incorporated Of Somewhere Industrial Estate Phase Two Pvt Ltd', contact_name: 'A Contact With A Rather Long Name Indeed', email: 'long.address.for.a.contact@example.invalid', phone: '+91 90000 44444',
      scope: 'Closed-die forgings, crankshafts, connecting rods, steering knuckles and everything in between up to 25 kg', segment_domain: 'Tractor / Heavy commercial', region_program: 'Pune / Gen-2 platform', last_contact: T(-250),
      bucket: 'C', action_category: 'No Positive / Stalled', next_follow_up: T(-6), fit: 'sweet', context: 'x'.repeat(300) },
    { company: 'Short Co', bucket: 'A', next_follow_up: T(0) }
  ]);
  const sw = () => pp.evaluate(() => document.documentElement.scrollWidth);
  check('no sideways scroll on the Leads tab at 375px', (await sw()) === 375, String(await sw()));
  await pp.click('#leadNew');
  const dlgBox = await pp.evaluate(() => { const r = document.getElementById('leadDlg').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
  await pp.click('#leadCancel');
  await leadRow(pp, 'A Very Long').locator('.l-touch').click();
  const touchBox = await pp.evaluate(() => { const r = document.getElementById('touchDlg').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
  await pp.click('#touchClose');
  await pp.click('#leadInternal');
  const intSw = await sw();
  await pp.click('#internalCancel');
  await stage(pp, 'hub.csv', HUB + 'LD-5,A Very Long Company Name Incorporated Of Somewhere Industrial Estate Phase Two Pvt Ltd,Segment,Someone (some.one@example.invalid),2025-05-05,' + 'long text '.repeat(40) + ',,\n', true);
  await stage(pp, 'pending.csv', PENDING, false);
  await stage(pp, 'recent.csv', RECENT, false);
  await pp.click('#leadStageReview');
  await pp.waitForSelector('#leadMergeDlg[open] .mcard');
  const mBox = await pp.evaluate(() => { const r = document.getElementById('leadMergeDlg').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
  const inner = await pp.evaluate(() => { const b = document.querySelector('#leadMergeDlg .dlg-scroll'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
  check('no sideways scroll on the Leads tab and merge preview at 375px',
    dlgBox.sw === 375 && dlgBox.l >= 0 && dlgBox.r <= 375 && dlgBox.b <= dlgBox.vh + 1 && touchBox.sw === 375 && touchBox.l >= 0 && touchBox.r <= 375 && intSw === 375 &&
    mBox.sw === 375 && mBox.l >= 0 && mBox.r <= 375 && mBox.b <= mBox.vh + 1 && inner.sw <= inner.cw, JSON.stringify({ dlgBox, touchBox, intSw, mBox, inner }));
  await pp.click('#mergeCancel');
  check('the staging bar fits at 375px', (await sw()) === 375 && await pp.locator('#leadStaging').isVisible());

  // the tab on a wide screen
  const wide = await open({ viewport: { width: 1280, height: 900 } });
  await seed(wide, [{ company: 'Wide Test Co', scope: 'Hubs', contact_name: 'Wes Test', email: 'w@example.invalid', next_follow_up: T(-2), last_contact: T(-30), bucket: 'A', action_category: 'No Response (Awaiting Data)', segment_domain: 'Truck', region_program: 'Pune' }]);
  check('no sideways scroll on the Leads tab at 1280px', (await wide.evaluate(() => document.documentElement.scrollWidth)) === 1280);
};
