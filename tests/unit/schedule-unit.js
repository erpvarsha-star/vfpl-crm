// Unit checks for the pure schedule functions in js/schedule.js (Node). Made-up names, parts and quantities only.
const Sch = require('../../js/schedule.js');

module.exports = async (t) => {
  const { check } = t;
  const T = '2026-10-19';       // a Monday
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // month grid
  const g = Sch.monthGrid('2026-10');
  check('monthGrid: 42 days, Monday first, starts on the Monday on or before the 1st', g.length === 42 && g[0] === '2026-09-28' && g[3] === '2026-10-01' && g[41] === '2026-11-08', g[0] + ' ' + g[41]);
  check('monthGrid: a month that starts on Monday starts on the 1st', Sch.monthGrid('2026-06')[0] === '2026-06-01');
  check('monthGrid: a month that starts on Sunday starts 6 days before', Sch.monthGrid('2026-02')[0] === '2026-01-26');
  check('addMonths: crosses the year both ways', Sch.addMonths('2026-12', 1) === '2027-01' && Sch.addMonths('2026-01', -1) === '2025-12' && Sch.addMonths('2026-10', -11) === '2025-11');

  // visits
  const v = (date, o) => Object.assign({ id: date + Math.random(), customer_id: 'a', type: 'Visit', date, time: '', note: '', done: false }, o);
  check('visitState: past not done is "Not done · N days ago"', Sch.visitState(v('2026-10-16'), T).text === 'Not done · 3 days ago' && Sch.visitState(v('2026-10-16'), T).kind === 'missed' && Sch.visitState(v('2026-10-18'), T).text === 'Not done · 1 day ago');
  check('visitState: today, tomorrow, later, done', Sch.visitState(v(T), T).text === 'Today' && Sch.visitState(v('2026-10-20'), T).text === 'Tomorrow' && Sch.visitState(v('2026-10-25'), T).text === 'In 6 days' && Sch.visitState(v('2026-10-01', { done: true }), T).text === 'Done');
  const list = [v('2026-10-10'), v('2026-10-18', { done: true }), v(T, { time: '14:00' }), v(T, { time: '09:30' }), v('2026-10-20'), v('2026-10-26'), v('2026-10-27'), v('2026-10-19', { done: true })];
  const vs = Sch.visitStats(list, [{ id: 'a', name: 'Alpha' }], T);
  check('visitStats: today and missed count only entries not done', vs.today === 2 && vs.missed === 1);
  check('visitStats: next7 is tomorrow to 7 days ahead, sorted, with names', vs.next7Count === 2 && vs.next7[0].date === '2026-10-20' && vs.next7[1].date === '2026-10-26' && vs.next7[0].customerName === 'Alpha');
  check('visitFlag: done entries never count', !Sch.visitFlag(v('2026-10-10', { done: true }), 'missed', T) && Sch.visitFlag(v('2026-10-10'), 'missed', T) && !Sch.visitFlag(v(T), 'missed', T));

  // orders
  const o = (promised, o2) => Object.assign({ status: 'Open', customer_id: 'a', promised, qty: 100, part_code: 'VX1001' }, o2);
  check('orderState: late is "Late by N days"', Sch.orderState(o('2026-10-16'), T).text === 'Late by 3 days' && Sch.orderState(o('2026-10-16'), T).kind === 'late' && Sch.orderState(o('2026-10-18'), T).text === 'Late by 1 day');
  check('orderState: due today, due in N days', Sch.orderState(o(T), T).text === 'Due today' && Sch.orderState(o('2026-10-24'), T).text === 'Due in 5 days' && Sch.orderState(o('2026-10-24'), T).kind === 'soon');
  check('orderState: dispatched late, dispatched, cancelled', Sch.orderState(o('2026-10-10', { status: 'Dispatched', dispatched: '2026-10-13' }), T).text === 'Dispatched 3 days late' &&
    Sch.orderState(o('2026-10-10', { status: 'Dispatched', dispatched: '2026-10-10' }), T).text === 'Dispatched' && Sch.orderState(o('2026-10-10', { status: 'Cancelled' }), T).text === 'Cancelled');
  const orders = [o('2026-10-10'), o('2026-10-18'), o(T), o('2026-10-22'), o('2026-10-26'), o('2026-10-27'), o('2026-10-01', { status: 'Cancelled' }),
    o('2026-10-12', { status: 'Dispatched', dispatched: '2026-10-11' }), o('2026-10-12', { status: 'Dispatched', dispatched: '2026-10-14' }), o('2026-08-12', { status: 'Dispatched', dispatched: '2026-08-12' })];
  const os = Sch.orderStats(orders, T);
  check('orderStats: open, late, due today and due this week (1 to 7 days) are exclusive', os.open === 6 && os.late === 2 && os.dueToday === 1 && os.dueWeek === 2 && os.asOf === null && os.stale === false, JSON.stringify(os));
  check('orderStats: on-time % uses orders dispatched in the last 30 days only', os.onTimePct30 === 50, String(os.onTimePct30));
  check('orderStats: no orders gives null; no recent dispatch gives a null %', Sch.orderStats([], T) === null && Sch.orderStats([o(T)], T).onTimePct30 === null);
  check('orderFlag: Cancelled and Dispatched are never late or open', !Sch.orderFlag(o('2026-10-01', { status: 'Cancelled' }), 'late', T) && !Sch.orderFlag(o('2026-10-01', { status: 'Dispatched', dispatched: '2026-10-02' }), 'open', T) && Sch.orderFlag(o('2026-10-01', { status: 'Cancelled' }), 'all', T));

  // looks dispatched
  const rows = [
    { date: '2026-10-14', customerId: 'a', part: 'VX1001', qty: 150 },
    { date: '2026-10-12', customerId: 'a', part: 'VX1001', qty: 150 },
    { date: '2026-10-15', customerId: 'a', part: 'VX1001', qty: 20 },
    { date: '2026-10-15', customerId: 'b', part: 'VX1001', qty: 500 }
  ];
  const ord = o('2026-10-20', { qty: 100, part_code: 'vx1001' });
  check('looksDispatched: same customer and part, qty enough, on or after creation; earliest date', eq(Sch.looksDispatched(ord, rows, '2026-10-13'), { date: '2026-10-14' }) && eq(Sch.looksDispatched(ord, rows, '2026-10-01'), { date: '2026-10-12' }));
  check('looksDispatched: not for another customer, a smaller qty, a done order or no part code', Sch.looksDispatched(o('2026-10-20', { qty: 600, part_code: 'VX1001' }), rows, '2026-10-01') === null &&
    Sch.looksDispatched(Object.assign({}, ord, { status: 'Dispatched' }), rows, '2026-10-01') === null && Sch.looksDispatched(Object.assign({}, ord, { part_code: '' }), rows, '2026-10-01') === null && Sch.looksDispatched(Object.assign({}, ord, { customer_id: 'c' }), rows, '2026-10-01') === null);
  check('looksDispatched: part codes compare without spaces being a problem when the case differs', Sch.normPart(' vx1002   m ') === 'VX1002 M' && Sch.isJobwork('Sales Jobwork Slip') && !Sch.isJobwork('Sales Dispatch Slip') && Sch.partOk('VF1050') && Sch.partOk('VF849 M') && !Sch.partOk('hello world'));

  // dispatch aggregation
  const D = (date, key, part, qty, job) => ({ date, key, name: key, customerId: key.length === 1 ? key : null, matched: key.length === 1, part, qty, slip: job ? 'Sales Jobwork Slip' : 'Sales Dispatch Slip', job: !!job });
  const dr = [D('2026-04-05', 'a', 'P1', 10), D('2026-09-01', 'a', 'P1', 20), D('2026-10-10', 'a', 'P2', 30, true), D('2026-10-17', 'b', 'P1', 40), D('2026-08-01', 'zeta', 'P3', 7)];
  const ag = Sch.dispatchAgg(dr, T);
  const ca = ag.customers.find(c => c.key === 'a');
  check('dispatchAgg: by customer has last date, 30 and 90 day quantities, parts and slips', ca.last === '2026-10-10' && ca.q30 === 30 && ca.q90 === 50 && ca.total === 60 && ca.partCount === 2 && ca.slips === 3 && ca.jobSlips === 1, JSON.stringify(ca));
  check('dispatchAgg: customers sort newest dispatch first', ag.customers[0].key === 'b' && ag.customers.map(c => c.key).join() === 'b,a,zeta');
  const p1 = ag.parts.find(p => p.part === 'P1');
  check('dispatchAgg: by part counts distinct customers and adds the same total as the file', p1.customers === 2 && p1.total === 70 && ag.parts.reduce((s, p) => s + p.total, 0) === 107 && ag.totalQty === 107);
  check('dispatchAgg: months run from the first to the last month with zero months in between, and add up', ag.months.map(m => m.ym).join() === '2026-04,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10' && ag.months.reduce((s, m) => s + m.qty, 0) === 107 && ag.months[6].jobQty === 30 && ag.months[6].slips === 2);
  const old = Sch.dispatchAgg([D('2024-01-05', 'a', 'P1', 5)].concat(dr), T);
  check('dispatchAgg: months keep only the last 12 months of data', old.months.length === 12 && old.months[0].ym === '2025-11' && old.months[11].ym === '2026-10');
  check('dispatchAgg: measuring from another date moves the windows', Sch.dispatchAgg(dr, '2026-09-05').customers.find(c => c.key === 'a').q30 === 20);
  check('dispatchAgg: nothing gives empty lists', eq(Sch.dispatchAgg([], T).months, []) && Sch.dispatchAgg([], T).customers.length === 0);

  // dispatch stats and last dispatch
  const cs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ds = Sch.dispatchStats(dr, cs, T);
  check('dispatchStats: slips, quantity and customers in the last 30 days, and the latest date', ds.dataThrough === '2026-10-17' && ds.slips30 === 2 && ds.qty30 === 70 && ds.customers30 === 2, JSON.stringify(ds));
  check('dispatchStats: noDispatch90 lists customers with none in 90 days, including those never dispatched', eq(ds.noDispatch90, ['c']) && eq(Sch.dispatchStats(dr, cs, '2027-02-01').noDispatch90, ['a', 'b', 'c']));
  check('dispatchStats: no rows gives null; lastDispatchMap uses the max date, not row order', Sch.dispatchStats([], cs, T) === null && Sch.lastDispatchMap(dr).a === '2026-10-10' && Sch.lastDispatchMap(dr).zeta === undefined);
};
