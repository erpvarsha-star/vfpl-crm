// Unit checks for CrmDash.compute (js/dashboard.js): pure, on a hand-made set of customers and log entries.
const Store = require('../../js/store.js');
const { compute } = require('../../js/dashboard.js');

module.exports = async (t) => {
  const { check } = t;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const today = '2026-10-19';
  const c = (id, name, o = {}) => Object.assign({ id, name, contact: '', phone: '', city: '', state: '', last: '', followUp: '', status: 'Active', disputed: false,
    group: '', segment: '', vehicleSegment: '', plants: [], relatedParty: false }, o);
  const people = [
    c('a', 'Alpha Forge', { followUp: '2026-10-10', state: 'Maharashtra', last: '2026-10-01', segment: 'OEM', group: 'Zeta Group', status: 'At risk' }),
    c('b', 'beta works', { followUp: '2026-10-10', state: 'Maharashtra', last: '2026-09-01', segment: 'OEM', vehicleSegment: 'CV', disputed: true }),
    c('c', 'Gamma Parts', { followUp: '2026-10-17', state: 'Tamil Nadu', last: '2026-08-01', group: 'Zeta Group', status: 'Follow up' }),
    c('d', 'Delta Auto', { followUp: '2026-10-19', last: '2026-01-01' }),
    c('e', 'Echo Dies', { followUp: '2026-10-19', state: 'Gujarat', segment: 'Tier-1' }),
    c('f', 'Foxtrot Metal', { followUp: '2026-10-21', state: 'Tamil Nadu', last: '2026-10-18' }),
    c('g', 'Golf Casting', { followUp: '2026-10-21', state: 'Tamil Nadu', last: '2026-10-19' }),
    c('h', 'Hotel Tools', { followUp: '2026-10-24' }),
    c('i', 'India Gears', { followUp: '2026-11-30', plants: [{ id: 'p1', name: '', city: 'Hosur', state: 'Tamil Nadu' }, { id: 'p2', name: '', city: 'Nashik', state: 'Maharashtra' }], state: 'Tamil Nadu' }),
    c('j', 'Juliet Forgings')
  ];
  const log = [
    { id: 'l1', customerId: 'a', at: '2026-10-18', type: 'Call', note: 'called', doneFollowUp: false, createdAt: '2026-10-18T05:00:00Z' },
    { id: 'l2', customerId: 'a', at: '2026-10-12', type: 'Visit', note: 'visited', doneFollowUp: true, createdAt: '2026-10-12T05:00:00Z' },
    { id: 'l3', customerId: 'b', at: '2026-10-19', type: 'Note', note: 'just a note', doneFollowUp: false, createdAt: '2026-10-19T05:00:00Z' },
    { id: 'l4', customerId: 'c', at: '2026-09-25', type: 'Email', note: '', doneFollowUp: false, createdAt: '2026-09-25T05:00:00Z' },
    { id: 'l5', customerId: 'zz', at: '2026-10-19', type: 'Call', note: 'unknown customer', doneFollowUp: false, createdAt: '2026-10-19T06:00:00Z' },
    { id: 'l6', customerId: null, at: '2026-10-19', type: 'Call', note: 'a lead touch', doneFollowUp: false, createdAt: '2026-10-19T07:00:00Z' }
  ];
  const r = compute(people, log, today, {});

  check('compute: customer counts by status and follow-up kind', eq(r.customers, {
    total: 10, status: { Active: 8, 'Follow up': 1, 'At risk': 1 }, overdue: 3, today: 2, week: 3, later: 1, none: 1, disputed: 1 }), JSON.stringify(r.customers));
  check('compute: attention is overdue oldest first (ties by name), then due today by name',
    eq(r.attention.map(a => a.id), ['a', 'b', 'c', 'd', 'e']), r.attention.map(a => a.id).join());
  check('compute: attention carries words, days and last contacted',
    r.attention[0].text === 'Overdue by 9 days' && r.attention[0].days === 9 && r.attention[0].lastContacted === '2026-10-18' && r.attention[0].lastDays === 1 &&
    r.attention[3].text === 'Due today' && r.attention[3].days === 0 && r.attention[3].lastContacted === '' && r.attention[3].lastDays === null);
  check('compute: a Note does not count as Last contacted, an Email does', r.attention[1].lastContacted === '' && r.attention[2].lastContacted === '2026-09-25');
  check('compute: notes count only entries of known customers', r.attention[0].notes === 2 && r.attention[1].notes === 1 && r.attention[3].notes === 0);
  check('compute: upcoming groups the next 7 days by date, soonest first, not today',
    eq(r.upcoming.map(g => [g.date, g.n]), [['2026-10-21', 2], ['2026-10-24', 1]]) && r.upcoming[0].ids.join() === 'f,g');
  check('compute: upcoming total equals the "week" count', r.upcoming.reduce((s, g) => s + g.n, 0) === r.customers.week);

  const bk = x => Object.fromEntries(x.buckets.map(b => [b.key, b.n]));
  check('compute: last-order buckets count from today', eq(bk(r.lastOrder), { '0-30': 3, '31-60': 1, '61-90': 1, '91+': 1, never: 4 }) && r.lastOrder.ref === today, JSON.stringify(bk(r.lastOrder)));
  const dr = compute(people, log, today, { from: 'data', latestOrder: '2026-10-19' });
  check('compute: "from data" without a latest date falls back to today', compute(people, log, today, { from: 'data' }).lastOrder.from === 'today');
  const later = compute(people, log, today, { from: 'data', latestOrder: '2026-09-15' });
  check('compute: counting from the latest order in the data changes the buckets', later.lastOrder.from === 'data' && later.lastOrder.ref === '2026-09-15' &&
    eq(bk(later.lastOrder), { '0-30': 4, '31-60': 1, '61-90': 0, '91+': 1, never: 4 }) && dr.lastOrder.ref === '2026-10-19', JSON.stringify(bk(later.lastOrder)));
  const disp = compute(people, log, today, { based: 'dispatch', lastDispatch: id => (id === 'a' ? '2026-10-10' : id === 'b' ? '2026-05-01' : '') });
  check('compute: based on last dispatch uses the dispatch dates', disp.lastOrder.based === 'dispatch' && eq(bk(disp.lastOrder), { '0-30': 1, '31-60': 0, '61-90': 0, '91+': 1, never: 8 }) && compute(people, log, today, { based: 'dispatch' }).lastOrder.based === 'invoice');

  check('compute: states by count then name, a plant state counts too, "not known" last',
    eq(r.byState.map(s => [s.state, s.n]), [['Tamil Nadu', 4], ['Maharashtra', 3], ['Gujarat', 1], ['', 3]]), JSON.stringify(r.byState.map(s => [s.state, s.n])));
  check('compute: the "not known" ids are the customers with no state', eq(r.byState[3].ids, ['d', 'h', 'j']));
  check('compute: contact counts (7 days, 30 days, not contacted in 30+ days)', eq(r.contact, { d7: 1, d30: 2, stale30: 8 }), JSON.stringify(r.contact));
  check('compute: recent activity is the newest entries of known customers only, newest first',
    eq(r.recent.map(e => e.id), ['l3', 'l1', 'l2', 'l4']) && r.recent[0].name === 'beta works' && r.recent[2].doneFollowUp === true);
  const many = []; for (let i = 0; i < 14; i++) many.push({ id: 'm' + i, customerId: 'a', at: '2026-10-' + String(i + 1).padStart(2, '0'), type: 'Call', note: 'n' + i, createdAt: '2026-10-01T00:00:00Z' });
  check('compute: recent activity is capped at 10', compute(people, many, today, {}).recent.length === 10 && compute(people, many, today, {}).recent[0].id === 'm13');
  const none = compute(people, [], today, {});
  check('compute: an empty call log gives no recent activity and 0 contacted', none.recent.length === 0 && none.contact.d7 === 0 && none.contact.d30 === 0 && none.contact.stale30 === 10);

  check('compute: segments follow the fixed list order with "none" last',
    eq(r.segments.map(s => [s.key, s.n]), [['OEM', 2], ['Tier-1', 1], ['Tier-2', 0], ['Trader', 0], ['Export', 0], ['none', 7]]), JSON.stringify(r.segments.map(s => [s.key, s.n])));
  check('compute: vehicle segments', r.vehicleSegments.find(s => s.key === 'CV').n === 1 && r.vehicleSegments.find(s => s.key === 'none').n === 9);
  check('compute: groups by count then name, and the no-group count', eq(r.groups.map(g => [g.group, g.n]), [['Zeta Group', 2]]) && r.noGroup === 8);
  check('compute: segments and groups are flagged as set', r.anySegmentOrGroup === true && compute([c('x', 'X'), c('y', 'Y')], [], today, {}).anySegmentOrGroup === false);

  const fake = { total: 3 };
  const p = compute(people, log, today, { money: fake, rfq: null, leads: undefined });
  check('compute: module stats are passed through, missing ones are null', p.money === fake && p.rfq === null && p.leads === null && p.visits === null && p.orders === null && p.dispatch === null);
  check('compute: no customers gives zeros and no errors', eq(compute([], [], today, {}).customers.total, 0) && compute([], [], today, {}).attention.length === 0 && compute([], [], today, {}).byState.length === 0);
  check('compute: uses the same fuKind as the Customers tab', people.every(x => ({ overdue: 1, today: 1, week: 1, later: 1, none: 1 })[Store.fuKind(x, today)]));
};
