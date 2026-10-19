// A4 unit checks for rfqStats, the filters, status words and form validation. Made-up data only.
const Rfq = require('../../js/rfqs.js');
const Store = require('../../js/store.js');

module.exports = async (t) => {
  const { check } = t;
  const TODAY = '2026-10-19';
  const d = (n) => Store.addDays(TODAY, n);
  const customers = [{ id: 'c1', name: 'Alpha Forge' }, { id: 'c2', name: 'Beta Works' }];
  const mk = (o) => Object.assign({ customer_id: 'c1', customer_name: 'Alpha Forge', rfq_no: '', part_name: '', received: d(-10), quote_due: '', quoted_value: null, stage: 'Received', stage_at: d(-5), next_action: '', lost: false }, o);
  const rfqs = [
    mk({ id: 'a', rfq_no: 'R1', stage: 'Received', quote_due: d(-3), received: d(-20), stage_at: d(-40) }),
    mk({ id: 'b', rfq_no: 'R2', stage: 'Received', quote_due: d(0) }),
    mk({ id: 'c', rfq_no: 'R3', stage: 'Quoted', quoted_value: 100000, next_action: d(-2), customer_id: 'c2', customer_name: 'Beta Works', stage_at: d(-35) }),
    mk({ id: 'd', rfq_no: 'R4', stage: 'Negotiated', quoted_value: 200000 }),
    mk({ id: 'e', rfq_no: 'R5', stage: 'Finalised', quoted_value: 300000, part_name: 'Pin' }),
    mk({ id: 'f', rfq_no: 'R6', stage: 'PO', quoted_value: 400000 }),
    mk({ id: 'g', rfq_no: 'R7', stage: 'PPAP', quoted_value: 500000, next_action: d(-9), stage_at: d(-90) }),
    mk({ id: 'h', rfq_no: 'R8', stage: 'Quoted', lost: true, lost_reason: 'price', quoted_value: 999 }),
    mk({ id: 'i', rfq_no: 'R9', stage: 'Sample', quoted_value: 600000 })
  ];
  const hist = [
    { rfq_id: 'c', from: 'Received', to: 'Quoted', at: d(-6) }, { rfq_id: 'd', from: 'Quoted', to: 'Negotiated', at: d(-4) },
    { rfq_id: 'f', from: null, to: 'Received', at: d(-12) }, { rfq_id: 'f', from: 'Received', to: 'Quoted', at: d(-10) }, { rfq_id: 'f', from: 'Quoted', to: 'PO', at: d(-1) },
    { rfq_id: 'h', from: 'Received', to: 'Quoted', at: d(-8) }, { rfq_id: 'h', from: 'Quoted', to: 'Lost', at: d(-2) }
  ];
  const s = Rfq.rfqStats(rfqs, hist, customers, TODAY);

  check('rfqStats: total, open and lost', s.total === 9 && s.open === 8 && s.lost === 1, JSON.stringify([s.total, s.open, s.lost]));
  check('rfqStats: byStage counts open RFQs only', s.byStage.Received === 2 && s.byStage.Quoted === 1 && s.byStage.Negotiated === 1 && s.byStage.Finalised === 1 && s.byStage.PO === 1 && s.byStage.Sample === 1 && s.byStage.PPAP === 1, JSON.stringify(s.byStage));
  check('rfqStats: valueQuoted is Quoted+Negotiated+Finalised, not lost', s.valueQuoted === 600000, String(s.valueQuoted));
  check('rfqStats: valueWon is PO+Sample+PPAP', s.valueWon === 1500000, String(s.valueWon));
  check('rfqStats: quote overdue, due today and action overdue', s.quoteOverdue === 1 && s.quoteDueToday === 1 && s.actionOverdue === 1, JSON.stringify([s.quoteOverdue, s.quoteDueToday, s.actionOverdue]));
  check('rfqStats: action overdue ignores PPAP', !Rfq.matchesFlag(rfqs[6], 'actionOverdue', TODAY, 0) && Rfq.matchesFlag(rfqs[2], 'actionOverdue', TODAY, 0));
  check('rfqStats: released is Finalised, PO, Sample and PPAP with a per-stage count', s.released.total === 4 && s.released.byStage.Finalised === 1 && s.released.byStage.PO === 1 && s.released.byStage.Sample === 1 && s.released.byStage.PPAP === 1, JSON.stringify(s.released.byStage));
  const rel = s.released.list.find((x) => x.id === 'e');
  check('rfqStats: released list entries carry rfqNo, part, customer name and stage', rel && rel.rfqNo === 'R5' && rel.part === 'Pin' && rel.customerName === 'Alpha Forge' && rel.stage === 'Finalised', JSON.stringify(rel));
  check('rfqStats: quotedToPoPct counts every RFQ that ever reached Quoted, lost ones included', s.hints.quotedToPoPct === 43, String(s.hints.quotedToPoPct));
  check('rfqStats: avgDaysToQuote uses real Received -> Quoted moves only', s.hints.avgDaysToQuote === 2, String(s.hints.avgDaysToQuote));
  check('rfqStats: stuck lists open RFQs at the same stage for over 30 days, never PPAP', JSON.stringify(s.hints.stuck) === JSON.stringify([{ stage: 'Received', n: 1 }, { stage: 'Quoted', n: 1 }]), JSON.stringify(s.hints.stuck));
  const empty = Rfq.rfqStats([], [], [], TODAY);
  check('rfqStats: an empty list gives zeros and nulls', empty.total === 0 && empty.hints.quotedToPoPct === null && empty.hints.avgDaysToQuote === null && empty.released.list.length === 0 && empty.hints.stuck.length === 0);

  // filters
  const f = (o) => Rfq.filterRfqs(rfqs, hist, customers, o, TODAY).map((r) => r.id).sort().join('');
  check('filter: lost RFQs are hidden unless Show lost', f({}).indexOf('h') === -1 && f({ showLost: true }).indexOf('h') !== -1);
  check('filter: stage and "released"', f({ stage: 'Received' }) === 'ab' && f({ stage: 'released' }) === 'efgi');
  check('filter: flags', f({ flag: 'quoteOverdue' }) === 'a' && f({ flag: 'quoteToday' }) === 'b' && f({ flag: 'actionOverdue' }) === 'c' && f({ flag: 'stuck' }) === 'ac' && f({ flag: 'stuck', stuckStage: 'Quoted' }) === 'c');
  check('filter: openQuoted and won', f({ flag: 'openQuoted' }) === 'cde' && f({ flag: 'won' }) === 'fgi');
  check('filter: quotedEver is every RFQ that reached Quoted or later, lost ones included', f({ flag: 'quotedEver' }) === 'cdefghi', f({ flag: 'quotedEver' }));
  check('filter: customer and search', f({ customerId: 'c2' }) === 'c' && f({ q: 'r3' }) === 'c' && f({ q: 'beta' }) === 'c' && f({ q: 'pin' }) === 'e');
  const sorted = Rfq.filterRfqs(rfqs, hist, customers, { sort: 'value', dir: -1 }, TODAY).map((r) => r.id).join('');
  check('sort: value descending, blank values last', sorted === 'igfedcab' || sorted === 'igfedcba', sorted);
  check('sort: next action ascending puts the oldest first and blanks last', Rfq.filterRfqs(rfqs, hist, customers, { sort: 'next', dir: 1 }, TODAY)[0].id === 'g');

  // status words
  const w = (o) => Rfq.statusWords(mk(o), TODAY).map((x) => x.kind + ':' + x.text).join('|');
  check('status words: quote overdue is red and says how many days', w({ quote_due: d(-3) }) === 'risk:Quote overdue by 3 days' && w({ quote_due: d(-1) }) === 'risk:Quote overdue by 1 day');
  check('status words: quote due today is orange', w({ quote_due: d(0) }) === 'warn:Quote due today');
  check('status words: a future quote date shows "Quote due 21 Oct"', w({ quote_due: '2026-10-21' }) === 'muted:Quote due 21 Oct');
  check('status words: action overdue is red with words, due today is orange', w({ stage: 'Quoted', next_action: d(-2) }) === 'risk:Action overdue by 2 days' && w({ stage: 'Quoted', next_action: d(0) }) === 'warn:Action due today');
  check('status words: nothing for PPAP actions or lost RFQs', w({ stage: 'PPAP', next_action: d(-2) }) === '' && w({ lost: true, quote_due: d(-3) }) === '');
  check('status words: quote words only while Received', w({ stage: 'Quoted', quote_due: d(-3) }) === '');

  // validation
  Store._reset();
  await Store.init({ data: t.data }); await Store.load();
  const cust = t.data.customers[0].name;
  const base = { customer: cust, rfq_no: 'X1', part_name: '', part_no: '', qty: '', received: TODAY, quote_due: '', quoted_value: '', stage: 'Received', next_action: '', notes: '' };
  const v = (o, ctx) => Rfq.validateRfq(Object.assign({}, base, o), Object.assign({ today: TODAY, rows: [], editing: null, opts: null }, ctx || {}));
  check('validate: a good RFQ passes', !!v({}).fields && v({}).fields.customer_id === Store.slug(cust));
  check('validate: the customer must be picked from the list', v({ customer: 'Nobody Imaginary' }).error === 'Pick a customer from the list, or add the customer first.' && v({ customer: '' }).field === 'customer');
  check('validate: RFQ number or part name is needed', v({ rfq_no: '', part_name: '' }).error === 'Enter the RFQ number or the part name.' && !!v({ rfq_no: '', part_name: 'Pin' }).fields);
  check('validate: a duplicate RFQ number is refused, case-insensitively, except for itself', v({ rfq_no: 'x1' }, { rows: [{ id: 'a', rfq_no: 'X1' }] }).error === 'RFQ x1 already exists.' && !!v({ rfq_no: 'x1' }, { rows: [{ id: 'a', rfq_no: 'X1' }], editing: { id: 'a', customer_id: Store.slug(cust), stage: 'Received' } }).fields);
  check('validate: quantity must be a whole number', v({ qty: '12.5' }).error === 'Quantity must be a whole number.' && v({ qty: '1,200' }).fields.qty === 1200);
  check('validate: quoted value must be a number', v({ quoted_value: 'abc' }).error === 'Quoted value is not a number.' && v({ quoted_value: '₹12,50,000' }).fields.quoted_value === 1250000 && v({ quoted_value: '' }).fields.quoted_value === null);
  check('validate: received date cannot be in the future; dates must be real', v({ received: d(1) }).field === 'received' && v({ quote_due: '2026-02-31' }).field === 'quote_due');
  check('validate: an unknown stage is refused; aliases are accepted', v({ stage: 'Won' }).field === 'stage' && v({ stage: 'PO received' }).fields.stage === 'PO' && Rfq.normStage('Finalized') === 'Finalised');
  check('validate: notes over 1000 characters are refused', v({ notes: 'x'.repeat(1001) }).field === 'notes');
  check('validate: an RFQ kept as text may be saved unchanged but not re-typed', !!v({ customer: 'Text Only Co' }, { editing: { id: 'z', customer_id: null, customer_name: 'Text Only Co', stage: 'Received' } }).fields && !!v({ customer: '' }, { editing: { id: 'z', customer_id: null, customer_name: '', stage: 'Received' } }).fields && v({ customer: 'Other Text' }, { editing: { id: 'z', customer_id: null, customer_name: 'Text Only Co', stage: 'Received' } }).field === 'customer');
  check('validate: a lead conversion may keep the lead company as the customer text', v({ customer: 'Lead Co' }, { opts: { leadId: 'L1', customerName: 'Lead Co' } }).fields.lead_id === 'L1');
};
