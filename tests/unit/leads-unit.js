// Unit checks for js/leads.js (pure logic + Store-backed contract). Synthetic, made-up companies only.
const Store = require('../../js/store.js');
const CrmLeads = require('../../js/leads.js');

module.exports = async (t) => {
  const { check, data } = t;
  const L = CrmLeads._;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const today = '2026-10-19';
  const fresh = async () => { Store._reset(); await Store.init({ data }); await Store.load(); };
  await fresh();

  // leadKey
  const k = CrmLeads.leadKey;
  check('leadKey merges "Acme Forge Pvt Ltd" / "ACME FORGE PRIVATE LIMITED" / "Acme Forge India"',
    k('Acme Forge Pvt Ltd') === k('ACME FORGE PRIVATE LIMITED') && k('Acme Forge Pvt Ltd') === k('Acme Forge India') && k('Acme Forge Pvt. Ltd.') === 'acmeforge', k('Acme Forge India'));
  check('leadKey cuts company words only at the end of a word', k('Tesco') === 'tesco' && k('Delco Inc') === 'delco' && k('Zeta & Sons Co. Ltd') === 'zetaandsons' && k('India') === 'india');
  check('leadKey keeps different companies apart', k('Acme Forge') !== k('Acme Foundry'));

  // internal entities
  check('isInternal: the five default patterns, any case',
    ['KCTR Varsha', 'Prima FT', 'SCM Maxility Pvt Ltd', 'tng korea', 'Varsha Forgings Ltd'].every(n => CrmLeads.isInternal(n)) && !CrmLeads.isInternal('Acme Forge Pvt Ltd'));
  check('isInternal: an email counts by its domain only',
    CrmLeads.isInternal('someone@varshaforgings.example') && CrmLeads.isInternal('x@kctr.example') && !CrmLeads.isInternal('varsha.s@mailhost.example'));
  await Store.doc('internal_entities').set({ v: 1, patterns: ['assistant.example', 'zeta internal'] });
  check('isInternal: the list is editable (a domain is matched, old defaults are gone)',
    CrmLeads.isInternal('pa@assistant.example') && CrmLeads.isInternal('Zeta Internal Ltd') && !CrmLeads.isInternal('KCTR Varsha'));
  await Store.doc('internal_entities').clear();
  check('isInternal: clearing the list restores the defaults', CrmLeads.isInternal('KCTR Varsha'));

  // bucket rule and categories
  const b = L.bucketFromStatus;
  check('bucket rule: A / B / C / D / JV, first match wins',
    b('Awaiting data from customer') === 'A' && b('No response after reminder') === 'A' && b('Response Pending from Our Side (Urgent)') === 'B' &&
    b('Quote to prepare') === 'B' && b('Declined (capacity)') === 'C' && b('Stalled on tooling') === 'C' && b('Cold call list') === 'D' &&
    b('Joint venture talks') === 'jv' && b('Strategic partnership') === 'jv' && b('Something else') === '' && b('Awaiting our reply; stalled') === 'A');
  check('bucket rule: "Pending Action from Us" is ours (B)', b('Pending Action from Us') === 'B' && b('Pending status') === '');
  const C2B = { 'Action Pending (Urgent)': 'B', 'No Response (Awaiting Data)': 'A', 'Dormant >6 Mo (High Value)': 'dormant', 'JV & Strategic Partnership': 'jv', 'No Positive / Stalled': 'C', 'Mismatched / Cold': 'D' };
  const catRow = (c) => L.mapRow('recent', { f_company: 'Zeta Imaginary Pvt Ltd', f_category: c, f_date: '2026-09-01' }, today);
  check('CATEGORY_TO_BUCKET: every category suggests its bucket, flagged guessed',
    CrmLeads.ACTION_CATEGORIES.length === 6 && CrmLeads.ACTION_CATEGORIES.every(c => { const d = catRow(c); return d.action_category === c && d.bucket === C2B[c] && d.bucket_guessed === true; }));
  check('categories are matched loosely ("Action Pending", "Dormant >6 Mo")', L.matchCategory('Action Pending') === 'Action Pending (Urgent)' && L.matchCategory('dormant >6 mo') === 'Dormant >6 Mo (High Value)' &&
    L.matchCategory('Pending Action from Us') === '' && L.matchCategory('') === '');
  check('an unknown category goes to the context and the bucket comes from its words',
    (() => { const d = catRow('Awaiting Customer Response'); return d.action_category === '' && d.bucket === 'A' && /Category: Awaiting Customer Response/.test(d.context); })());
  check('urgency words give a priority', ['High', 'Medium', 'Low', 'Urgent'].map(u => L.mapRow('recent', { f_company: 'X Co', f_urgency: u }, today).priority).join() === 'High,Medium,Low,High');

  // dates
  const pd = (s) => L.parseLeadDate(s, today);
  check('parseLeadDate: ISO and day-first', pd('2026-03-04').value === '2026-03-04' && pd('04/03/2026').value === '2026-03-04' && pd('4-Mar-26').value === '2026-03-04' && pd('').value === '' && pd('').issue === '');
  check('parseLeadDate: one cell with two dates takes the newest and says so', eq(pd('2026-01-05 / 2026-03-01'), { value: '2026-03-01', issue: 'multiple' }));
  check('parseLeadDate: dates inside words', pd('Follow-up sent (Aug 8, 2026)').value === '2026-08-08' && pd('quoted 12 May 2025; no PO').value === '2025-05-12' && pd('Review (Nov 2024)').value === '2024-11-01');
  check('parseLeadDate: text with no date is not an error', eq(pd('soon'), { value: '', issue: 'unparsed' }) && pd('Marketing 2026 plan').issue === 'unparsed');
  check('parseLeadDate: a future date is not used as last contact', eq(pd('2027-01-01'), { value: '', issue: 'future' }));

  // contacts
  check('"Key Contact & Email" is split into name and email',
    eq(L.splitContact('Jane Roe (jane@example.invalid)'), { name: 'Jane Roe', email: 'jane@example.invalid', phone: '' }) &&
    L.splitContact('Jane Roe <jane@example.invalid>').name === 'Jane Roe' && L.splitContact('Jane Roe, VP Sales / jane.roe@example.invalid').name === 'Jane Roe, VP Sales' &&
    L.splitContact('Plain Name').email === '' && L.splitContact('jane@example.invalid').name === '');
  check('phones are read only when asked', L.splitContact('Jane +91 98765 43210', true).phone === '+91 98765 43210' && L.splitContact('Jane +91 98765 43210', true).name === 'Jane' && L.splitContact('Jane 98765 43210').phone === '');

  // the six formats
  const hub = L.mapRow('hub_dormant', { f_ref: 'LD-1', f_company: 'Acme Forge Pvt Ltd', f_segment: 'Tractor / Auto', f_contact: 'Jane Roe (jane@example.invalid)', f_date: '2026-01-10', f_context: 'Quoted last year', f_angle: 'Capacity free', f_strategy: 'Call in Nov' }, today);
  check('Hub dormant row: fields, dormant bucket and category, both guessed',
    hub.ref === 'LD-1' && hub.contact_name === 'Jane Roe' && hub.email === 'jane@example.invalid' && hub.segment_domain === 'Tractor / Auto' && hub.last_contact === '2026-01-10' &&
    hub.context === 'Quoted last year' && hub.value_angle === 'Capacity free' && hub.strategy === 'Call in Nov' && hub.bucket === 'dormant' && hub.action_category === 'Dormant >6 Mo (High Value)' && hub.bucket_guessed);
  const re = L.mapRow('reengage', { f_company: 'Beta Test Co', f_contact: 'Raj', f_scope: 'Shafts', f_date: '2026-01-05 / 2026-03-01', f_status: 'Declined (capacity)', f_angle: 'x', f_strategy: 'y' }, today);
  check('re-engagement row: Status goes to the context, bucket from the rule, two dates keep the text',
    re.scope === 'Shafts' && re.last_contact === '2026-03-01' && re.dateIssue === 'multiple' && /^Status: Declined \(capacity\) \| Last contact \(text\): 2026-01-05 \/ 2026-03-01$/.test(re.context) && re.bucket === 'C' && re.bucket_guessed);
  check('re-engagement row: no rule match falls back to dormant', L.mapRow('reengage', { f_company: 'X Co', f_status: 'Initial intro' }, today).bucket === 'dormant');
  const pe = L.mapRow('pending', { f_company: 'Gamma Test Ltd', f_contact: 'Li', f_ref: 'TH-9', f_date: '2026-09-01', f_status: 'Response Pending from Our Side', f_scope: 'Gears' }, today);
  check('pending row: ref, status in context, bucket B', pe.ref === 'TH-9' && pe.context === 'Status: Response Pending from Our Side' && pe.bucket === 'B' && pe.scope === 'Gears' && pe.last_contact === '2026-09-01');
  const od = L.mapRow('dormant_old', { f_company: 'Delta Test Inc', f_contact: 'Sam', f_emailphone: 'sam@example.invalid, +91 90000 11111', f_scope: 'Flanges', f_date: '12/03/2025', f_status: 'Quote stalled', f_strategy: 'Cold call' }, today);
  check('older dormant row: email and phone split, Past Status is the context, bucket dormant',
    od.email === 'sam@example.invalid' && od.phone === '+91 90000 11111' && od.context === 'Quote stalled' && od.last_contact === '2025-03-12' && od.bucket === 'dormant' && od.strategy === 'Cold call');
  const rc = L.mapRow('recent', { f_company: 'Eps Test Co', f_category: 'Action Pending (Urgent)', f_contact: 'Ann <ann@example.invalid>', f_scope: 'RFQ for hubs', f_date: '2026-10-01', f_urgency: 'High', f_strategy: 'Send quote' }, today);
  check('recent row: category, contact email, priority and bucket', rc.action_category === 'Action Pending (Urgent)' && rc.bucket === 'B' && rc.email === 'ann@example.invalid' && rc.priority === 'High' && rc.scope === 'RFQ for hubs');
  const mx = L.mapRow('matrix', { f_company: 'Zeta Test Pvt Ltd', f_contact: 'Max Roe (Head)\nmax@example.invalid\n\n+91 91111 22222', f_region: 'EU / EV', f_scope: 'Knuckles', f_date: 'Awaiting data (Aug 8, 2026)', f_category: 'Dormant >6 Mo', f_strategy: 'Re-pitch' }, today);
  check('prospect matrix row: multi-line contact, date inside text, category fuzzy',
    mx.contact_name === 'Max Roe (Head)' && mx.email === 'max@example.invalid' && mx.phone === '+91 91111 22222' && mx.last_contact === '2026-08-08' && mx.region_program === 'EU / EV' &&
    mx.action_category === 'Dormant >6 Mo (High Value)' && mx.bucket === 'dormant' && /^Status: Awaiting data/.test(mx.context) && mx.dateIssue === '');
  check('every import format needs its company and date columns', CrmLeads._.SPEC_ORDER.every(key => { const fl = L.SPEC_FIELDS[key]; return fl.some(x => x.required && /company|organization|counterparty|customer/i.test(x.label)) && fl.some(x => x.required && /date/i.test(x.label)); }) && L.SPEC_ORDER.length === 6);
  check('internal rows are recognised from company, contact and email domain',
    L.draftInternal({ company: 'KCTR Varsha Automotive', contact_name: '', email: '' }) && L.draftInternal({ company: 'Acme Forge', contact_name: '', email: 'x@varshaforgings.example' }) && !L.draftInternal({ company: 'Acme Forge', contact_name: 'Jane', email: 'j@acme.example' }));
  check('bank, card, hotel and airline rows look like "not a lead"', ['Example Bank Ltd', 'Card Services', 'Grand Hotel', 'Sky Airlines'].every(n => L.looksNotLead({ company: n, contact_name: '', scope: '' })) && !L.looksNotLead({ company: 'Acme Forge', contact_name: 'Jane', scope: 'Closed-die forgings' }));

  // dormant
  const dm = (l) => L.dormantInfo(L.norm(l), today);
  check('dormant: empty or over 183 days, or the dormant bucket', dm({ company: 'A' }) !== null && dm({ company: 'A', last_contact: '2026-04-19' }) !== null && dm({ company: 'A', last_contact: '2026-04-20' }) === null &&
    dm({ company: 'A', last_contact: '2026-10-01', bucket: 'dormant' }) !== null && dm({ company: 'A', last_contact: '2026-10-01', bucket: 'A' }) === null);
  check('dormant: badge text says how many months; closed leads are never dormant', dm({ company: 'A', last_contact: '2026-02-10' }).label === 'Dormant 8 months' && dm({ company: 'A', status: 'Closed' }) === null && dm({ company: 'A' }).label === 'Dormant (no contact on record)');

  // merge defaults
  const row = (sheet, over) => Object.assign({ sheet, ref: '', company: 'Acme Forge Pvt Ltd', contact_name: '', email: '', phone: '', region_program: '', scope: '', segment_domain: '', last_contact: '', context: '', value_angle: '', strategy: '', bucket: '', action_category: '', priority: '', bucket_guessed: false, dateIssue: '' }, over);
  const m1 = row('Hub dormant', { contact_name: 'Jane Roe', email: 'jane@example.invalid', last_contact: '2026-01-10', context: 'Quoted last year', bucket: 'dormant', bucket_guessed: true, strategy: 'Call in Nov' });
  const m2 = row('Pending tracker', { company: 'ACME FORGE PRIVATE LIMITED', contact_name: 'J. Roe', last_contact: '2026-08-01', context: 'Status: awaiting data', bucket: 'A', bucket_guessed: true, scope: 'Hubs', strategy: 'Call in Nov' });
  const m3 = row('Recent status', { company: 'Acme Forge India', last_contact: '2026-05-05', context: 'Quoted last year', phone: '+91 90000 00000' });
  const g = L.mergeGroup([m1, m2, m3], null), v = L.resolve(g);
  check('merge defaults: newest row wins, texts joined newest first without repeats, first contact kept, sources unioned',
    v.last_contact === '2026-08-01' && v.bucket === 'A' && v.company === 'ACME FORGE PRIVATE LIMITED' && v.contact_name === 'J. Roe' && v.email === 'jane@example.invalid' && v.phone === '+91 90000 00000' &&
    v.context.indexOf('Status: awaiting data | Quoted last year') === 0 && v.context.split('Quoted last year').length === 2 && v.strategy === 'Call in Nov' && v.scope === 'Hubs' && g.sheets.length === 3 && v.bucket_guessed === true);
  check('merge: other contact names go to the context, never their emails', /Other contacts: Jane Roe/.test(v.context) && v.context.indexOf('@') === -1);
  check('merge: a different choice can be picked per field', L.resolve(g, { contact_name: 1 }).contact_name === 'Jane Roe' && L.resolve(g, { context: 0 }).context.indexOf('Status: awaiting data') === 0 && L.resolve(g, { context: 0 }).context.indexOf('Quoted') === -1);
  const existing = L.norm({ id: 'x1', company: 'Acme Forge Pvt Ltd', contact_name: 'Existing Person', last_contact: '2026-02-02', context: 'Old note', bucket: 'C', bucket_guessed: false, sources: [{ sheet: 'Manual', ref: '' }] });
  const gx = L.mergeGroup([m1, m2], existing), vx = L.resolve(gx);
  check('merge with an existing lead: its values win, dates take the newest, texts are added',
    vx.contact_name === 'Existing Person' && vx.bucket === 'C' && vx.bucket_guessed === false && vx.last_contact === '2026-08-01' && vx.context.indexOf('Old note | ') === 0);
  const again = L.mergeGroup([m1, m2], L.norm(Object.assign({}, existing, { context: vx.context })));
  check('merging the same rows again changes nothing (no duplicated text)', L.resolve(again).context === vx.context && L.resolve(again).strategy === vx.strategy);

  // cards
  const staged = [Object.assign({ importedAt: 'x' }, m1), m2, m3, row('Hub dormant', { company: 'Other Test Works', ref: 'R7' })];
  const cards = L.buildCards(staged, [], [], {});
  check('duplicates across files merge into one card with 3 sources', cards.length === 2 && cards.filter(c => c.members.length === 3).length === 1);
  const sp = L.buildCards(staged, [], [], { [CrmLeads.leadKey('Acme Forge')]: true });
  check('"These are different companies" splits a card into one per original name', sp.length === 4 && sp.filter(c => c.splitPart).length === 3);
  const byRef = L.buildCards([row('Hub dormant', { company: 'Renamed Works Ltd', ref: 'R7' })], [L.norm({ id: 'e9', company: 'Other Test Works', sources: [{ sheet: 'Hub dormant', ref: 'R7' }] })], [], {});
  check('re-import finds the existing lead by its source reference', byRef[0].existing && byRef[0].existing.id === 'e9');
  const asCust = L.buildCards([row('Hub dormant', { company: 'Zf Steering Gear India Private Limited' })], [], Store.customers(), {});
  check('a company that is already a customer is flagged', asCust.length === 1 && !!asCust[0].customerId, JSON.stringify(asCust.map(c => c.customerId)));

  // validation
  let r = L.validateLead({ company: 'KCTR Varsha' });
  check('internal companies are refused with the design text', !r.ok && r.error === 'KCTR Varsha is an internal or related company and is not tracked as a lead.');
  check('internal email domain is refused too', !L.validateLead({ company: 'Fine Co', email: 'a@varsha.example' }).ok);
  check('validation: dates, lengths, lists', !L.validateLead({ company: 'A', last_contact: '2099-01-01' }).ok && !L.validateLead({ company: 'A', last_contact: '2026-02-31' }).ok &&
    !L.validateLead({ company: 'A', context: 'x'.repeat(2001) }).ok && !L.validateLead({ company: 'A', bucket: 'Z' }).ok && !L.validateLead({ company: 'A', phone: 'abc' }).ok &&
    !L.validateLead({ company: '' }).ok && L.validateLead({ company: 'A', next_follow_up: '2020-01-01', bucket: 'B', fit: 'sweet' }).ok);

  // store-backed contract
  r = await CrmLeads.createFromImport({ company: 'Hub Made Up Pvt Ltd', contact_name: 'Pat', email: 'pat@example.invalid', scope: 'Brackets', last_contact: '2026-09-01', source: 'Hub RFQ' });
  check('createFromImport makes an open lead', r.ok && !!r.id && Store.col('leads').get(r.id).status === 'Open' && Store.col('leads').get(r.id).company_key === 'hubmadeup' && Store.col('leads').get(r.id).source === 'Hub RFQ');
  const again2 = await CrmLeads.createFromImport({ company: 'HUB MADE UP PRIVATE LIMITED' });
  check('createFromImport does not duplicate (same company key)', again2.ok && again2.id === r.id && Store.col('leads').all().length === 1);
  check('createFromImport refuses internal and empty names', !(await CrmLeads.createFromImport({ company: 'TNG Korea' })).ok && !(await CrmLeads.createFromImport({ company: '  ' })).ok);
  check('match finds a lead by leadKey and ignores internal names', CrmLeads.match('hub made up inc') === r.id && CrmLeads.match('Nobody Ltd') === null && CrmLeads.match('Varsha') === null);

  // stats
  await fresh();
  const ins = (o) => Store.col('leads').insert(Object.assign({ company_key: CrmLeads.leadKey(o.company), status: 'Open' }, o));
  const dAgo = (n) => Store.addDays(Store.todayISO(), n);
  const A1 = (await ins({ company: 'A One', bucket: 'A', last_contact: dAgo(-10), next_follow_up: dAgo(-3) })).row;
  await ins({ company: 'B One', bucket: 'B', last_contact: dAgo(-300), next_follow_up: dAgo(0), action_category: 'Dormant >6 Mo (High Value)' });
  await ins({ company: 'Dorm Two', bucket: 'dormant', last_contact: dAgo(-400) });
  await ins({ company: 'No Bucket Co', last_contact: dAgo(-5) });
  await ins({ company: 'Closed Co', bucket: 'A', status: 'Closed', last_contact: dAgo(-500) });
  await ins({ company: 'Won Co', status: 'Converted', converted_at: dAgo(-5) });
  await Store.addLeadLog(A1.id, { type: 'Note', note: 'hello', at: dAgo(-2) });
  const st = CrmLeads.stats(Store.todayISO());
  check('stats: counts by bucket, dormant, overdue, today, touched and converted',
    st.open === 4 && eq(st.byBucket, { A: 1, B: 1, C: 0, D: 0, dormant: 1, jv: 0, none: 1 }) && st.dormant === 2 && st.followOverdue === 1 && st.followToday === 1 && st.touched7 === 1 && st.converted30 === 1, JSON.stringify(st));
  check('stats: reactivate lists the High Value category first, then the oldest', eq(st.reactivate.map(x => x.company), ['B One', 'Dorm Two']) && st.reactivate[0].category === 'Dormant >6 Mo (High Value)' && st.reactivate[1].lastContact === dAgo(-400));
  check('stats: the Dashboard shape has every key', ['open', 'byBucket', 'dormant', 'followOverdue', 'followToday', 'touched7', 'converted30', 'reactivate'].every(x => x in st));
  const call = (flt) => { L.setCurrent(flt); return CrmLeads.visible().map(x => x.company).join(); };
  check('visible: default sort puts overdue first, then follow-up date, then company; closed hidden', call({}) === 'A One,B One,Dorm Two,No Bucket Co');
  check('visible: bucket, category, fit and flag filters', call({ bucket: 'A' }) === 'A One' && call({ bucket: 'none' }) === 'No Bucket Co' && call({ category: 'Dormant >6 Mo (High Value)' }) === 'B One' &&
    call({ flag: 'overdue' }) === 'A One' && call({ flag: 'today' }) === 'B One' && call({ flag: 'dormant' }) === 'B One,Dorm Two' && call({ flag: 'touched7' }) === 'A One' && call({ q: 'dorm' }) === 'Dorm Two' && call({ showClosed: true }).indexOf('Closed Co') !== -1);
  L.setCurrent({});
  check('summary says how many are showing', CrmLeads.summary() === 'Showing 4 of 4 leads.');
};
