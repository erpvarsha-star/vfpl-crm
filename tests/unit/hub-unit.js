// A4 unit checks for the Hub RFQ import rules (design 12.3). Pure functions only; every name, subject and amount is made up.
const Rfq = require('../../js/rfqs.js');
const Csv = require('../../js/csv.js');
const Store = require('../../js/store.js');

module.exports = async (t) => {
  const { check } = t;
  const TODAY = '2026-10-19';
  const ctx = (extra) => Object.assign({
    today: TODAY, customers: [{ id: 'zeta-forge', name: 'Zeta Forge Pvt Ltd', relatedParty: false }, { id: 'kctr-varsha', name: 'KCTR Varsha Automotive', relatedParty: true }],
    leads: [{ id: 'lead-1', company: 'Omega Castings Inc' }], canCreateLead: false,
    matchCustomer: (n) => (Store.nameKey(n) === Store.nameKey('Zeta Forge Pvt Ltd') ? 'zeta-forge' : Store.nameKey(n) === Store.nameKey('KCTR Varsha Automotive') ? 'kctr-varsha' : null),
    matchLead: (n) => (/omega/i.test(n) ? 'lead-1' : null), isInternal: null
  }, extra || {});
  const act = (o) => Object.assign({ item_id: 'ACT-101', priority: '', category: '', subject: '', counterparty: '', delegated: '', action: '', date_received: '2026-10-10', due: '2026-10-15', status: '', row: 2 }, o);
  const awa = (o) => Object.assign({ tracking_id: 'EXT-101', category: '', account: 'Zeta Forge Pvt Ltd', contact: '', outreach: '2026-10-01', last_follow: '2026-10-08', follow_count: '2', deliverable: '', status: '', row: 2 }, o);
  const build = (sheet, row, c) => Rfq.buildHubItem(sheet, row, c || ctx());

  // ---- exact headers
  const H1 = 'Item ID,Priority,Category,Subject / Matter,Counterparty / Organization,Delegated To,Action Required,Date Received,Target Due Date,Status';
  const H2 = 'Tracking ID,Category,Account / Counterparty,Contact Email / Reference,Outreach Date,Last Follow-up Date,Follow-up Count,Expected Deliverable,Status';
  const find = (head, spec) => Csv.findHeader(Csv.parse(head + '\n'), spec.fields);
  check('Hub Action Pending headers are recognised exactly', find(H1, Rfq.SPECS.hub_action).missing.length === 0 && find(H2, Rfq.SPECS.hub_action).missing.length > 0);
  check('Hub Awaiting Customer headers are recognised exactly', find(H2, Rfq.SPECS.hub_awaiting).missing.length === 0 && find(H1, Rfq.SPECS.hub_awaiting).missing.length > 0);
  check('the RFQ list spec does not claim a Hub file', find(H1, Rfq.SPECS.rfqs).missing.length > 0 && find(H2, Rfq.SPECS.rfqs).missing.length > 0);

  // ---- stage words
  const stage = (s) => Rfq.deriveStage(s).stage;
  check('stage: PPAP', stage('ppap submission done') === 'PPAP' && stage('PSW approved') === 'PPAP');
  check('stage: Sample', stage('first article sample sent') === 'Sample' && stage('trial lot') === 'Sample');
  check('stage: PO', stage('po received for 500 pcs') === 'PO' && stage('purchase order placed') === 'PO');
  check('stage: Finalised', stage('price agreed with buyer') === 'Finalised' && stage('nominated supplier') === 'Finalised');
  check('stage: Negotiated', stage('in negotiation on price') === 'Negotiated' && stage('revised quote requested') === 'Negotiated');
  check('stage: Quoted', stage('quotation submitted last week') === 'Quoted' && stage('offer sent to buyer') === 'Quoted');
  check('stage: Received', stage('new rfq from customer') === 'Received' && Rfq.deriveStage('new rfq from customer').source === 'rule');
  check('stage: latest stage wins when several words are present', stage('quotation submitted and then ppap done') === 'PPAP');
  check('stage: awaiting a PO is Quoted, not PO', stage('quote sent, awaiting po for 2,500 pcs') === 'Quoted' && Rfq.deriveStage('pending the purchase order from buyer').source === 'guess');
  check('stage: unclear text is a Received guess', Rfq.deriveStage('please review this item').stage === 'Received' && Rfq.deriveStage('please review this item').source === 'guess');

  // ---- lost, priority
  check('lost: regret, declined, not feasible, dropped, lost', ['regret letter sent', 'customer declined', 'not feasible for us', 'enquiry dropped', 'the order was lost'].every((s) => Rfq.deriveLost(s).lost) && !Rfq.deriveLost('quoted last week').lost);
  check('lost: reason is the matched phrase', Rfq.deriveLost('we sent a regret to the buyer').reason === 'regret' && Rfq.deriveLost('Not Feasible').reason === 'not feasible');
  check('priority: column wins, else high-priority or urgent in the text', Rfq.derivePriority('Low', 'x') === 'Low' && Rfq.derivePriority('', 'high-priority new rfq') === 'High' && Rfq.derivePriority('', 'urgent call') === 'High' && Rfq.derivePriority('', 'routine') === '');

  // ---- redaction and customer guess
  const red = Rfq.redact('Call Asha on +91 98765 43210 or asha@zeta-example.com, alt 9876543210.');
  check('redact: emails and phone numbers leave the text', !/@/.test(red.text) && !/9876/.test(red.text) && red.found.length === 3 && red.found[0] === 'asha@zeta-example.com', JSON.stringify(red));
  check('redact: plain dates and counts are not phone numbers', Rfq.redact('Due 2026-10-17 for 10-12 parts, 6,174 units').text === 'Due 2026-10-17 for 10-12 parts, 6,174 units');
  const g = Rfq.guessCustomer('Omega Castings: 8 hub forgings RFQ', ctx().customers, ctx().leads);
  const g2 = Rfq.guessCustomer('Zeta Forge steering knuckle enquiry', ctx().customers, ctx().leads);
  check('guess: the longest customer or lead name inside the subject', g && g.type === 'lead' && g.id === 'lead-1' && g2 && g2.type === 'customer' && g2.id === 'zeta-forge');
  check('guess: nothing found gives null; short names are not guessed', Rfq.guessCustomer('Some unrelated thing', ctx().customers, ctx().leads) === null && Rfq.guessCustomer('abc part', [{ id: 'x', name: 'ABC Ltd' }], []) === null);

  // ---- classification
  const it1 = build('hub_action', act({ category: 'HIGH-PRIORITY NEW RFQ', subject: 'Imaginary Railways Co: 12 forged fittings RFQ', status: 'HIGH-PRIORITY NEW RFQ', action: 'Reply to Asha (asha@imaginary-example.com, +91 90000 11111).' }));
  check('classify: "HIGH-PRIORITY NEW RFQ" is an RFQ at Received with priority High (rule, not guessed)', it1.kind === 'rfq' && it1.stage === 'Received' && it1.stageSource === 'rule' && it1.priority === 'High');
  const it2 = build('hub_action', act({ category: 'URGENT (PAYMENT RELEASE)', subject: 'Imaginary GmbH: issue EUR 5,000 Tooling Invoice', status: 'URGENT (PAYMENT RELEASE)', action: 'Accounts to email the invoice.' }));
  check('classify: a tooling invoice request is Other and not included', it2.kind === 'other' && it2.include === false);
  const it3 = build('hub_action', act({ category: 'RFQ', subject: 'Invoice question about an RFQ package', action: 'rfq rfq' }));
  check('classify: the word RFQ beats the Other words', it3.kind === 'rfq');
  const it4 = build('hub_action', act({ category: 'BOARD', subject: 'Varsha Forgings annual accounts', action: 'review the quotation' }));
  check('classify: internal entities are skipped', it4.kind === 'internal' && it4.include === false);
  const it5 = build('hub_action', act({ category: 'PERSONAL', subject: 'Credit card upgrade offer', action: 'evaluate' }));
  check('classify: personal and banking rows without RFQ words are Other', it5.kind === 'other');
  const it6 = build('hub_awaiting', awa({ category: 'Offer Submitted', deliverable: 'Standard end bodies offer sent', status: 'Offer Submitted' }));
  check('classify: an "offer sent" row is an RFQ at Quoted', it6.kind === 'rfq' && it6.stage === 'Quoted' && it6.stageSource === 'rule');
  const it7 = build('hub_action', act({ counterparty: 'KCTR Varsha Automotive', subject: 'quotation for pins', action: 'quote' }));
  check('classify: a related-party customer is internal', it7.kind === 'internal');

  // ---- stage-word fixtures (quoted, negotiation, PO, sample, PPAP) through the full mapping
  const map = (txt) => build('hub_awaiting', awa({ deliverable: txt, status: txt })).stage;
  check('stage words map to stages through the row mapping', map('quotation submitted') === 'Quoted' && map('in negotiation') === 'Negotiated' && map('po received') === 'PO' && map('sample dispatched') === 'Sample' && map('ppap approved') === 'PPAP');
  const lostItem = build('hub_action', act({ subject: 'Imaginary Ltd drop arm RFQ', action: 'Buyer sent a regret; part is not feasible' }));
  check('regret sets the Lost marker with the phrase as the reason', lostItem.lost === true && lostItem.lostReason === 'regret');

  // ---- Action Pending mapping
  check('action: ID, part name, dates and waiting_on', it1.id === 'ACT-101' && it1.partName.startsWith('Imaginary Railways') && it1.received === '2026-10-10' && it1.waitingOn === 'us');
  check('action: quote_due and next_action come from the target date while Received', Rfq.rowFromItem(it1, TODAY, 'x').quote_due === '2026-10-15' && Rfq.rowFromItem(it1, TODAY, 'x').next_action === '2026-10-15');
  const quoted = build('hub_action', act({ subject: 'Imaginary Ltd bracket RFQ', status: 'quotation submitted' }));
  check('action: quote_due is blank once the stage is past Received', Rfq.rowFromItem(quoted, TODAY, 'x').quote_due === '' && Rfq.rowFromItem(quoted, TODAY, 'x').next_action === '2026-10-15');
  check('action: notes hold Action Required, Delegated to, Status, Category (when different)', build('hub_action', act({ category: 'Cat A', status: 'Stat B', delegated: 'Someone', action: 'Do the thing', subject: 'rfq x' })).notes === 'Do the thing · Delegated to: Someone · Status: Stat B · Category: Cat A');
  check('action: Category is left out when it repeats Status', build('hub_action', act({ category: 'SAME', status: 'SAME', action: 'a', subject: 'rfq' })).notes === 'a · Status: SAME');
  check('action: emails and phones are not in the notes; they go to the private contact reference', !/@|90000|11111/.test(it1.notes) && /asha@imaginary-example\.com/.test(it1.contactRef));
  const longSubject = 'Imaginary RFQ ' + 'for a very long forged component name '.repeat(6);
  const longItem = build('hub_action', act({ subject: longSubject }));
  check('action: part name is cut at 120 characters and the full subject is kept in the notes', longItem.partName.length <= 120 && longItem.notes.indexOf('Subject: Imaginary RFQ') !== -1);
  const blank = build('hub_action', act({ counterparty: '', subject: 'Zeta Forge: drop arm RFQ' }));
  check('blank counterparty is guessed from the subject and flagged', blank.customerGuessed === true && blank.customerId === 'zeta-forge' && blank.choice === 'c:zeta-forge');
  const blank2 = build('hub_action', act({ counterparty: '', subject: 'Nobody Known: drop arm RFQ' }));
  check('blank counterparty with no guess stays unmatched', blank2.customerGuessed === false && blank2.customerId === null && blank2.choice === 'text');

  // ---- Awaiting mapping
  const aw = build('hub_awaiting', awa({ contact: 'Asha Rao', category: 'Offer Submitted', status: 'Offer Submitted', deliverable: 'End bodies offer', follow_count: '3' }));
  check('awaiting: customer, dates, follow-ups and waiting_on', aw.counterparty === 'Zeta Forge Pvt Ltd' && aw.customerId === 'zeta-forge' && aw.received === '2026-10-01' && aw.lastTouch === '2026-10-08' && aw.followupCount === 3 && aw.waitingOn === 'customer');
  check('awaiting: no quote due and no next action are invented', aw.due === '' && Rfq.rowFromItem(aw, TODAY, 'x').next_action === '' && Rfq.rowFromItem(aw, TODAY, 'x').quote_due === '');
  check('awaiting: notes are Status and Category; the contact reference is private', aw.notes === 'Status: Offer Submitted' && aw.contactRef === 'Asha Rao');
  const lead = build('hub_awaiting', awa({ account: 'Omega Castings Inc', deliverable: 'rfq pack' }));
  check('awaiting: a lead is matched when there is no customer', lead.customerId === null && lead.leadId === 'lead-1' && lead.choice === 'l:lead-1');
  const unk = build('hub_awaiting', awa({ account: 'Brand New Buyer Ltd', deliverable: 'rfq pack' }), ctx({ canCreateLead: true }));
  check('awaiting: an unknown counterparty defaults to "Create lead" when leads exist', unk.choice === 'new');
  check('awaiting: without a Leads module an unknown counterparty is kept as text', build('hub_awaiting', awa({ account: 'Brand New Buyer Ltd', deliverable: 'rfq pack' })).choice === 'text');

  // ---- duplicates on re-import
  const first = build('hub_awaiting', awa({ deliverable: 'rfq pack', status: 'Received' }));
  const c1 = Rfq.planImport([first], []);
  check('re-import: a new item is New', first.status === 'new' && c1['new'] === 1);
  const stored = Object.assign({ id: 'r1', stage_source: 'rule', lost: false }, Rfq.rowFromItem(first, TODAY, 'r1'));
  const again = build('hub_awaiting', awa({ deliverable: 'rfq pack', status: 'Received' }));
  Rfq.planImport([again], [stored]);
  check('re-import: the same sheet row is Unchanged and matches by sheet + ID', again.status === 'unchanged' && again.existingId === 'r1');
  const edited = build('hub_awaiting', awa({ deliverable: 'rfq pack', status: 'Received', follow_count: '5', last_follow: '2026-10-12' }));
  Rfq.planImport([edited], [stored]);
  check('re-import: refreshed sheet fields make it an Update', edited.status === 'update' && edited.plan.patch.followup_count === 5 && edited.plan.patch.last_touch === '2026-10-12');
  const fwd = build('hub_awaiting', awa({ deliverable: 'rfq pack', status: 'quotation submitted' }));
  Rfq.planImport([fwd], [stored]);
  check('re-import: a later rule-derived stage moves the RFQ forward', fwd.plan.advance === true && fwd.plan.patch.stage === 'Quoted');
  const userSet = Object.assign({}, stored, { stage: 'Negotiated', stage_source: 'user' });
  const fwd2 = build('hub_awaiting', awa({ deliverable: 'rfq pack', status: 'po received' }));
  Rfq.planImport([fwd2], [userSet]);
  check('re-import: a user-set stage is never overwritten', fwd2.plan.advance === false && fwd2.plan.patch.stage === undefined);
  const ahead = Object.assign({}, stored, { stage: 'PO', stage_source: 'rule' });
  const back = build('hub_awaiting', awa({ deliverable: 'rfq pack', status: 'quotation submitted' }));
  Rfq.planImport([back], [ahead]);
  check('re-import: the stage never moves backwards', back.plan.advance === false && back.plan.patch.stage === undefined);
  const lostLater = build('hub_awaiting', awa({ deliverable: 'rfq pack', status: 'regret from buyer' }));
  Rfq.planImport([lostLater], [stored]);
  const userLost = Object.assign({}, stored, { stage_source: 'user' });
  const lostLater2 = build('hub_awaiting', awa({ deliverable: 'rfq pack', status: 'regret from buyer' }));
  Rfq.planImport([lostLater2], [userLost]);
  check('re-import: Lost is applied to untouched rows only', lostLater.plan.newLost === true && lostLater2.plan.newLost === false);
  const noId1 = build('hub_action', act({ item_id: '', counterparty: 'Zeta Forge Pvt Ltd', subject: 'Zeta rfq part A' }));
  const noIdRow = Object.assign({ id: 'r2', stage_source: 'rule', lost: false }, Rfq.rowFromItem(noId1, TODAY, 'r2'));
  const noId2 = build('hub_action', act({ item_id: '', counterparty: 'ZETA FORGE PRIVATE LIMITED', subject: 'Zeta rfq part A' }));
  Rfq.planImport([noId2], [noIdRow]);
  check('re-import: with no ID the key is customer + received date + part name', noId2.existingId === 'r2');
  const dup1 = build('hub_awaiting', awa({ deliverable: 'rfq pack' })), dup2 = build('hub_awaiting', awa({ deliverable: 'rfq pack' }));
  Rfq.planImport([dup1, dup2], []);
  check('re-import: an ID repeated inside one file is flagged and not included twice', dup2.dupInFile === true && dup2.include === false && dup1.include === true);
  const manual = { id: 'm1', rfq_no: 'EXT-101', customer_name: 'Zeta Forge Pvt Ltd', received: '2026-10-01', part_name: 'rfq pack', stage: 'Quoted', stage_source: 'user' };
  const vsManual = build('hub_awaiting', awa({ deliverable: 'rfq pack' }));
  Rfq.planImport([vsManual], [manual]);
  check('re-import: a manually typed RFQ is never treated as a Hub duplicate', vsManual.status === 'new');

  // ---- new row shape
  const row = Rfq.rowFromItem(aw, TODAY, 'abc');
  check('new row: Hub fields are stored (source, waiting_on, follow-ups, stage source)', row.source_ref.sheet === 'hub_awaiting' && row.source_ref.id === 'EXT-101' && row.waiting_on === 'customer' && row.followup_count === 3 && row.last_touch === '2026-10-08' && row.stage_source === 'rule' && row.rfq_no === 'EXT-101');
  check('new row: a guessed stage is recorded as "guess"', Rfq.rowFromItem(build('hub_awaiting', awa({ deliverable: 'please review' })), TODAY, 'g').stage_source === 'guess');
  check('new row: a row stays under the 10 KB collection limit even with long text', JSON.stringify(Rfq.rowFromItem(build('hub_action', act({ subject: 'x'.repeat(5000), action: 'y'.repeat(5000), category: 'c'.repeat(3000) })), TODAY, 'z')).length < 10240);
};
