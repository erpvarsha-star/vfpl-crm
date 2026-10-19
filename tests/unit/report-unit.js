// Unit checks for js/report.js compute() (pure, made-up data, fake stats injected; no other module needed).
const R = require('../../js/report.js');

module.exports = async (t) => {
  const { check } = t;
  const TODAY = '2026-10-19';
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const cust = (id, name, o = {}) => Object.assign({ id, name, contact: '', phone: '', last: '', followUp: '', status: 'Active', relatedParty: false }, o);
  const base = () => ({
    today: TODAY,
    customers: [
      cust('a', 'Alpha Forge', { contact: 'Asha', phone: '+91 98200 11111', followUp: '2026-10-10' }),
      cust('b', 'Bravo Parts', { contact: 'Bala', phone: '98200 22222', followUp: '2026-10-17' }),
      cust('c', 'Charlie Dies', { followUp: '2026-10-19', contact: 'Chitra' }),
      cust('d', 'Delta Gears', { followUp: '2026-10-22' }),
      cust('e', 'Echo Rings', { followUp: '2026-10-27' }),
      cust('f', 'Foxtrot Axles', { followUp: '2026-10-26' }),
      cust('g', 'Golf Hubs', { status: 'At risk', last: '2026-09-01' }),
      cust('h', 'Hotel Shafts', { status: 'At risk', last: '2026-06-01' }),
      cust('i', 'India Cams', { status: 'At risk', last: '2026-05-01' })
    ],
    log: [], visits: [], rfqs: [], rfqHistory: [], leads: [], orders: [], stats: {}
  });
  const names = m => m.items.map(x => x.name);

  // ---- range and defaults
  check('report-unit: default range is the 7 days ending today (India)', eq(R.defaultRange(TODAY), { from: '2026-10-13', to: '2026-10-19' }));
  check('report-unit: compute defaults the range from today and swaps a reversed range', (() => {
    const m = R.compute({}, base()), s = R.compute({ from: '2026-10-19', to: '2026-10-13' }, base());
    return eq(m.range, { from: '2026-10-13', to: '2026-10-19' }) && eq(s.range, m.range);
  })());

  // ---- follow-ups
  const f = R.compute({}, base());
  check('report-unit: overdue follow-ups are oldest first with days overdue', eq(names(f.overdue), ['Alpha Forge', 'Bravo Parts']) && f.overdue.items[0].days === 9 && f.overdue.items[1].days === 2);
  check('report-unit: due next 7 days is soonest first and includes today, not day 8', eq(names(f.dueNext), ['Charlie Dies', 'Delta Gears', 'Foxtrot Axles']) && f.dueNext.items[0].days === 0);
  check('report-unit: headline counts follow-ups', f.headline.overdue === 2 && f.headline.dueNext === 3);

  // ---- contact details and privacy
  const noPhone = JSON.stringify(R.compute({}, base()));
  check('report-unit: no phone or email in the model unless contact details are ticked', !/98200|\+91/.test(noPhone) && f.overdue.items[0].phone === undefined);
  const withPhone = R.compute({}, Object.assign(base(), { includeContacts: true }));
  check('report-unit: contact details ticked adds the phone', withPhone.overdue.items[0].phone === '+91 98200 11111');

  // ---- contact this week: range filter and no double counting
  const d = base();
  d.log = [
    { id: 1, customerId: 'a', at: '2026-10-14', type: 'Call', note: 'Spoke. Call me on +91 98765 43210 or asha@example.com', createdAt: '2026-10-14T05:00:00Z' },
    { id: 2, customerId: 'a', at: '2026-10-15', type: 'Visit', note: 'Plant visit', createdAt: '2026-10-15T05:00:00Z' },
    { id: 3, customerId: 'b', at: '2026-10-12', type: 'Call', note: 'before the range' },
    { id: 4, customerId: 'b', at: '2026-10-16', type: 'Note', note: 'internal note only' },
    { id: 5, customerId: 'c', at: '2026-10-17', type: 'Email', note: '' },
    { id: 6, customerId: null, leadId: 'L1', at: '2026-10-16', type: 'Call', note: 'lead call' },
    { id: 7, customerId: 'd', at: '2026-10-18', type: 'Telegram', note: 'ping' }
  ];
  d.visits = [
    { id: 'v1', customer_id: 'e', type: 'Visit', done: true, done_at: '2026-10-18', log_id: null, note: 'Visited Echo' },
    { id: 'v2', customer_id: 'f', type: 'Call', done: true, done_at: '2026-10-17', log_id: 'x', note: 'already logged' },
    { id: 'v3', customer_id: 'g', type: 'Meeting', done: true, done_at: '2026-10-16', log_id: null, note: '' },
    { id: 'v4', customer_id: 'h', type: 'Call', done: false, done_at: null, log_id: null },
    { id: 'v5', customer_id: 'i', type: 'Call', done: true, done_at: '2026-10-01', log_id: null }
  ];
  d.leads = [{ id: 'L1', company: 'Lead One Ltd', status: 'Open' }];
  const c1 = R.compute({}, d);
  check('report-unit: contact counts by type, inside the range only', eq(c1.contact.byType, { Call: 1, Visit: 3, Email: 1, Telegram: 1 }), JSON.stringify(c1.contact.byType));
  check('report-unit: a done visit that already made a log entry is not counted twice', c1.contact.total === 6 && !c1.contact.names.includes('Foxtrot Axles'));
  check('report-unit: customer names are listed once each, sorted, without Note-only entries', eq(c1.contact.names, ['Alpha Forge', 'Charlie Dies', 'Delta Gears', 'Echo Rings', 'Golf Hubs']), JSON.stringify(c1.contact.names));
  check('report-unit: a Meeting counts as a Visit, a not-done visit does not count', c1.contact.byType.Visit === 3);
  check('report-unit: note text is absent unless included', c1.contact.notes === null && !/Spoke|Plant visit|internal note/.test(JSON.stringify(c1)));
  const c2 = R.compute({}, Object.assign({}, d, { includeNotes: true }));
  const txt = JSON.stringify(c2.contact.notes);
  check('report-unit: note text included when ticked, newest first', c2.contact.notes.total === 5 && c2.contact.notes.items[0].at >= c2.contact.notes.items[1].at && /Plant visit/.test(txt));
  check('report-unit: phones and emails inside note text are hidden unless contact details are ticked', !/98765|asha@example/.test(txt) && /phone hidden/.test(txt) && /email hidden/.test(txt));
  const c3 = R.compute({}, Object.assign({}, d, { includeNotes: true, includeContacts: true }));
  check('report-unit: note text keeps contact details when ticked', /98765 43210/.test(JSON.stringify(c3.contact.notes)));
  check('report-unit: scrub keeps dates and short numbers', R.scrub('Meet 2026-10-19 at 10:30, qty 1200, ref 12-10-26') === 'Meet 2026-10-19 at 10:30, qty 1200, ref 12-10-26');
  check('report-unit: headline calls and visits', c1.headline.contacts === 4);
  check('report-unit: leads touched by company, from lead log rows in range', eq(c1.leads.touched.names, ['Lead One Ltd']) && c1.leads.touched.total === 1 && c1.leads.available);

  // ---- at risk order
  d.log.push({ id: 8, customerId: 'g', at: '2026-10-05', type: 'Call', note: '' }, { id: 9, customerId: 'h', at: '2026-08-01', type: 'Call', note: '' });
  d.log.push({ id: 10, customerId: 'i', at: '2026-10-01', type: 'Note', note: 'notes do not count as contact' });
  const risk = R.compute({}, d).atRisk;
  check('report-unit: at-risk sorted by last contacted, never or oldest first (notes do not count)', eq(names(risk), ['India Cams', 'Hotel Shafts', 'Golf Hubs']) && risk.items[0].lastContacted === '' && risk.items[1].lastContacted === '2026-08-01', JSON.stringify(risk.items));

  // ---- RFQ pipeline
  const r = base();
  r.stats.rfq = { total: 9, byStage: { Received: 4, Quoted: 3, Negotiated: 2, Finalised: 1, PO: 2, PPAP: 1 }, quoteOverdue: 2 };
  r.rfqs = [{ id: 'r1', rfq_no: 'Q-1', customer_id: 'a', received: '2026-10-14' }, { id: 'r2', rfq_no: 'Q-2', customer_name: 'Zeta Imaginary', received: '2026-10-01' },
            { id: 'r3', rfq_no: '', part_name: 'Hub', customer_id: 'b', received: '2026-10-19' }];
  r.rfqHistory = [
    { id: 'h1', rfq_id: 'r1', from: null, to: 'Received', at: '2026-10-14' },
    { id: 'h2', rfq_id: 'r1', from: 'Received', to: 'Quoted', at: '2026-10-15', created_at: '2026-10-15T02:00:00Z' },
    { id: 'h3', rfq_id: 'r2', from: 'Quoted', to: 'Negotiated', at: '2026-10-12' },           // before the range
    { id: 'h4', rfq_id: 'r2', from: 'Negotiated', to: 'Finalised', at: '2026-10-17' },
    { id: 'h5', rfq_id: 'r3', from: 'Received', to: 'Lost', at: '2026-10-19', note: 'lost' },
    { id: 'h6', rfq_id: 'r2', from: 'Finalised', to: 'PO', at: '2026-10-20' }                  // after the range
  ];
  const rr = R.compute({}, r);
  check('report-unit: funnel comes from the RFQ stats in stage order', rr.funnel.map(x => x.stage + x.n).join() === 'Received4,Quoted3,Negotiated2,Finalised1,PO2,Sample0,PPAP1');
  check('report-unit: stage movements list only moves inside the range, newest first, skipping creation rows', rr.moves.total === 3 && rr.moves.items[0].to === 'Lost' && rr.moves.items[1].to === 'Finalised' && rr.moves.items[2].to === 'Quoted', JSON.stringify(rr.moves.items));
  check('report-unit: a move names the RFQ and the customer (CRM name, raw name, or part)', rr.moves.items[2].rfq === 'RFQ Q-1' && rr.moves.items[2].customer === 'Alpha Forge' && rr.moves.items[1].customer === 'Zeta Imaginary' && rr.moves.items[0].rfq === 'RFQ Hub');
  check('report-unit: new RFQs are counted by received date in range, quote overdue from stats', rr.newRfqs === 2 && rr.quoteOverdue === 2 && rr.headline.rfqMoved === 3);
  const noRfq = R.compute({}, base());
  check('report-unit: without RFQ stats the pipeline has no funnel and the headline box is omitted', noRfq.funnel === null && noRfq.headline.rfqMoved === null);

  // ---- money, orders, revenue appear only with stats
  const s = base();
  check('report-unit: money, late orders and revenue are null without stats and listed as missing', noRfq.money === null && noRfq.lateOrders === null && noRfq.revenue === null && noRfq.missing.length === 3);
  s.stats.money = { asOf: '2026-10-18', stale: false, outstanding: 5000, overdue: 1200, overduePct: 24, buckets: { b1_30: { amount: 300, n: 2 }, b31_60: { amount: 400, n: 1 }, b61_90: { amount: 0, n: 0 }, b90: { amount: 500, n: 1 } },
                    top5: [1, 2, 3, 4, 5, 6, 7].map(i => ({ id: 'x' + i, name: 'Cust ' + i, overdue: 100 * i, b90: 0 })) };
  s.stats.orders = { asOf: null, stale: false, open: 5, late: 3, dueToday: 1, dueWeek: 2, onTimePct30: null };
  s.orders = [
    { id: 'o1', customer_id: 'a', order_no: 'PO-9', part_code: 'VF1', promised: '2026-10-15', status: 'Open' },
    { id: 'o2', customer_id: 'b', order_no: 'PO-8', part: 'Gear', promised: '2026-10-01', status: 'Open' },
    { id: 'o3', customer_id: 'c', order_no: 'PO-7', promised: '2026-10-02', status: 'Dispatched' },
    { id: 'o4', customer_name: 'Zeta Imaginary', order_no: 'PO-6', promised: '2026-10-30', status: 'Open' }
  ];
  s.stats.revenue = { fy: '2026-27', to: '2026-07-12', dataThrough: '2026-07-12', fytd: 90000, mtd: 20000, mtdLabel: 'July 2026', excludedRelated: { n: 2, amount: 5000 },
                      prior: { fytd: 1, changePct: 12 }, targets: { basis: 'customers', total: 300000, actual: 90000, pct: 30, pacePct: 55, behind: true } };
  const sm = R.compute({}, s);
  check('report-unit: money section carries overdue, buckets and the top 5 only', sm.money.overdue === 1200 && sm.money.buckets.length === 4 && sm.money.top.items.length === 5 && sm.money.top.more === 2);
  check('report-unit: late orders are open and past promise, oldest first, count from stats', sm.lateOrders.count === 3 && eq(sm.lateOrders.items.map(o => o.orderNo), ['PO-8', 'PO-9']) && sm.lateOrders.items[0].days === 18 && sm.lateOrders.items[0].customer === 'Bravo Parts');
  check('report-unit: revenue shows FYTD, target progress, pace and the related-party note', sm.revenue.fytd === 90000 && sm.revenue.target.behind && sm.revenue.target.pct === 30 && sm.revenue.excludedRelated.n === 2 && sm.headline.revenue.pct === 30);
  check('report-unit: the related-party note disappears when related parties are included', R.compute({}, Object.assign({}, s, { includeRelated: true })).revenue.excludedRelated === null);
  check('report-unit: nothing is missing when all three modules have data', sm.missing.length === 0 && sm.asOf.money === '2026-10-18' && sm.asOf.revenue === '2026-07-12');
  const sNoTarget = base(); sNoTarget.stats.revenue = { fy: '2026-27', dataThrough: '2026-07-12', fytd: 5, mtd: null, targets: null };
  check('report-unit: revenue without targets has no target block', R.compute({}, sNoTarget).revenue.target === null && R.compute({}, sNoTarget).headline.revenue.pct === null);

  // ---- leads
  const l = base();
  l.stats.leads = { open: 5, followOverdue: 3, reactivate: [1, 2, 3, 4, 5, 6].map(i => ({ id: 'l' + i, company: 'Co ' + i, lastContact: '2026-01-0' + i, category: 'Dormant >6 Mo (High Value)' })) };
  l.leads = [
    { id: 'L2', company: 'Older Lead', status: 'Open', next_follow_up: '2026-10-05' },
    { id: 'L3', company: 'Newer Lead', status: 'Open', next_follow_up: '2026-10-15' },
    { id: 'L4', company: 'Closed Lead', status: 'Closed', next_follow_up: '2026-10-01' },
    { id: 'L5', company: 'Future Lead', status: 'Open', next_follow_up: '2026-11-01' }
  ];
  const lm = R.compute({}, l);
  check('report-unit: dormant leads to reactivate show at most 5 with +1 more', lm.leads.reactivate.items.length === 5 && lm.leads.reactivate.more === 1);
  check('report-unit: lead follow-ups overdue uses the Leads stats count, list is open leads oldest first', lm.leads.followOverdue === 3 && eq(lm.leads.overdueList.map(x => x.company), ['Older Lead', 'Newer Lead']));
  check('report-unit: no Leads data at all marks the leads block unavailable', R.compute({}, base()).leads.available === false);

  // ---- top 5 actions
  const a = R.compute({}, l).actions.items;
  check('report-unit: actions are customer overdue oldest first, then due soonest, then lead follow-ups', eq(a.map(x => x.kind + ':' + x.name), ['overdue:Alpha Forge', 'overdue:Bravo Parts', 'due:Charlie Dies', 'due:Delta Gears', 'due:Foxtrot Axles']), JSON.stringify(a.map(x => x.kind + ':' + x.name)));
  const only = base(); only.customers = only.customers.filter(c => c.id === 'a');
  only.leads = l.leads;
  check('report-unit: with few customer follow-ups the actions fall back to overdue lead follow-ups', eq(R.compute({}, only).actions.items.map(x => x.kind + ':' + x.name), ['overdue:Alpha Forge', 'lead:Older Lead', 'lead:Newer Lead']));
  const manyOver = base();
  manyOver.customers = [];
  for (let i = 0; i < 12; i++) manyOver.customers.push(cust('o' + i, 'Over ' + String.fromCharCode(65 + i), { followUp: '2026-10-' + String(18 - i).padStart(2, '0') }));
  const mo = R.compute({}, manyOver);
  check('report-unit: actions stop at 5, the oldest overdue first', mo.actions.items.length === 5 && mo.actions.items[0].name === 'Over L' && mo.actions.items[0].days === 12);
  check('report-unit: actions carry no phone unless contact details are ticked', mo.actions.items.every(x => x.phone === undefined) && R.compute({}, Object.assign(base(), { includeContacts: true })).actions.items[0].phone === '+91 98200 11111');

  // ---- caps and "+N more"
  check('report-unit: default caps are 8 overdue, 8 due, 8 moves, 10 at-risk, 5 actions', R.DEFAULT_CAPS.overdue === 8 && R.DEFAULT_CAPS.dueNext === 8 && R.DEFAULT_CAPS.moves === 8 && R.DEFAULT_CAPS.atRisk === 10 && R.DEFAULT_CAPS.actions === 5);
  check('report-unit: 12 overdue gives 8 items, total 12 and 4 more', mo.overdue.items.length === 8 && mo.overdue.total === 12 && mo.overdue.more === 4 && mo.headline.overdue === 12);
  const lowCaps = R.compute({}, Object.assign({}, manyOver, { caps: { overdue: 3 } }));
  check('report-unit: caps can be lowered (used to fit one page)', lowCaps.overdue.items.length === 3 && lowCaps.overdue.more === 9);
  check('report-unit: capsAtLevel never goes below 3 and keeps 5 actions', R.capsAtLevel(8).moves === 3 && R.capsAtLevel(8).actions === 5 && R.capsAtLevel(0).moves === 8);
  const risk13 = base(); risk13.customers = []; for (let i = 0; i < 13; i++) risk13.customers.push(cust('r' + i, 'Risk ' + i, { status: 'At risk' }));
  const rk = R.compute({}, risk13).atRisk;
  check('report-unit: at-risk is capped at 10 with +3 more', rk.items.length === 10 && rk.total === 13 && rk.more === 3);

  // ---- robustness
  check('report-unit: compute copes with empty or missing deps', (() => { try { const m = R.compute({}, {}); return m.overdue.total === 0 && m.actions.total === 0 && m.contact.total === 0; } catch (e) { return false; } })());
  check('report-unit: compute does not change its input', (() => { const x = base(); const before = JSON.stringify(x); R.compute({}, x); return JSON.stringify(x) === before; })());
};
