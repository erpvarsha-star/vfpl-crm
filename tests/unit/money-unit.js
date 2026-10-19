// Unit checks for the pure money functions in js/money.js (Node). Made-up names and made-up amounts only.
const Money = require('../../js/money.js');

module.exports = async (t) => {
  const { check } = t;
  const customers = [{ id: 'a', name: 'Alpha Forge' }, { id: 'b', name: 'Beta Works' }, { id: 'c', name: 'Gamma One' }, { id: 'd', name: 'Gamma Two' }];
  const ag = (o) => Object.assign({ sourceName: '', customerId: null, groupIds: null, overdue: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90: 0, preApril: 0, creditBalance: 0 }, o);
  const lv = (o) => Object.assign({ sourceName: '', customerId: null, groupIds: null, outstanding: 0 }, o);
  const doc = {
    v: 1,
    aging: { meta: { asOf: '2026-10-15' }, rows: [
      ag({ sourceName: 'Alpha Forge', customerId: 'a', overdue: 100, b1_30: 40, b31_60: 60 }),
      ag({ sourceName: 'Alpha Forge', customerId: 'a', overdue: 50, b61_90: 20, b90: 10, preApril: 20 }),
      ag({ sourceName: 'Beta Works', customerId: 'b', overdue: 200, b90: 150, preApril: 50 }),
      ag({ sourceName: 'Gamma Group', groupIds: ['c', 'd'], overdue: 300, b1_30: 100, b90: 100, preApril: 100 }),
      ag({ sourceName: 'Zeta Imaginary', overdue: 10, b1_30: 10 })
    ] },
    live: { meta: { asOf: '2026-10-08' }, rows: [
      lv({ sourceName: 'Alpha Forge', customerId: 'a', outstanding: 1000 }),
      lv({ sourceName: 'Gamma Group', groupIds: ['c', 'd'], outstanding: 500 }),
      lv({ sourceName: 'Zeta Imaginary', outstanding: 70 })
    ] }
  };
  const s = Money.moneyStats(doc, customers, '2026-10-19');

  check('moneyStats: totals include unmatched rows', s.overdue === 660 && s.outstanding === 1570, JSON.stringify([s.overdue, s.outstanding]));
  check('moneyStats: overduePct is overdue / outstanding', s.overduePct === 42, String(s.overduePct));
  check('moneyStats: buckets add every row; >90 includes Pre April', s.buckets.b1_30.amount === 150 && s.buckets.b31_60.amount === 60 && s.buckets.b61_90.amount === 20 && s.buckets.b90.amount === 430 && s.buckets.b90.preApril === 170, JSON.stringify(s.buckets));
  check('moneyStats: bucket n counts customers, a group row counts each member, unmatched rows count none', s.buckets.b1_30.n === 3 && s.buckets.b31_60.n === 1 && s.buckets.b90.n === 4, JSON.stringify(s.buckets));
  check('moneyStats: top 5 sorts by overdue, adds same-customer rows, lists a group once', s.top5.length === 3 && s.top5[0].name === 'Gamma Group (group of 2)' && s.top5[0].id === null && s.top5[0].ids.join() === 'c,d' &&
    s.top5[1].name === 'Beta Works' && s.top5[2].name === 'Alpha Forge' && s.top5[2].overdue === 150 && s.top5[2].b90 === 30, JSON.stringify(s.top5));
  check('moneyStats: unmatched rows are listed once per name and counted', s.unmatched.n === 1 && s.unmatched.amount === 10 && s.unmatched.list[0].sourceName === 'Zeta Imaginary' && s.unmatched.list[0].outstanding === 70, JSON.stringify(s.unmatched));
  check('moneyStats: asOf is the older file date and a 11-day-old file is stale', s.asOf === '2026-10-08' && s.asOfAging === '2026-10-15' && s.asOfLive === '2026-10-08' && s.stale === true);
  check('moneyStats: a 7-day-old file is not stale yet', Money.moneyStats(doc, customers, '2026-10-15').stale === false);

  // per customer: matched rows only, same-name rows summed, group rows shared
  const per = Money.perCustomer(doc, { a: 1, b: 1, c: 1, d: 1 });
  const a = Money.shapeCustomer(per.a), c = Money.shapeCustomer(per.c), d = Money.shapeCustomer(per.d);
  check('per customer: same-name rows are added together', a.overdue === 150 && a.b1_30 === 40 && a.b61_90 === 20 && a.outstanding === 1000);
  check('per customer: b90 already includes Pre April, preApril is the "of which" part', a.b90 === 30 && a.preApril === 20 && a.b90Raw === 10, JSON.stringify(a));
  check('per customer: a group row gives the whole amount to every member and marks it shared', c.overdue === 300 && d.overdue === 300 && c.outstanding === 500 && c.shared.groupName === 'Gamma Group' && c.shared.n === 2 && a.shared === null);
  check('per customer: the unmatched row belongs to nobody', !per.zeta && Object.keys(per).sort().join() === 'a,b,c,d');

  // one file only: the other side is null, never zero
  const only = Money.moneyStats({ v: 1, aging: doc.aging, live: null }, customers, '2026-10-19');
  check('moneyStats: with AGING only, outstanding and overduePct are null', only.outstanding === null && only.overdue === 660 && only.overduePct === null && only.unmatched.amount === 10);
  const onlyLive = Money.moneyStats({ v: 1, aging: null, live: doc.live }, customers, '2026-10-19');
  check('moneyStats: with LIVE_POSITION only, overdue and buckets are null', onlyLive.overdue === null && onlyLive.buckets.b1_30.amount === null && onlyLive.outstanding === 1570 && onlyLive.top5.length === 0 && onlyLive.unmatched.amount === 70);
  check('moneyStats: no money gives null', Money.moneyStats(null, customers, '2026-10-19') === null && Money.moneyStats({ v: 1, aging: null, live: null }, customers, '2026-10-19') === null);

  // credits (negative overdue) stay in totals but never make the top 5
  const neg = Money.moneyStats({ v: 1, aging: { meta: { asOf: '2026-10-15' }, rows: [ag({ sourceName: 'Alpha Forge', customerId: 'a', overdue: -40 }), ag({ sourceName: 'Beta Works', customerId: 'b', overdue: 90 })] }, live: null }, customers, '2026-10-19');
  check('moneyStats: a negative overdue lowers the total and is not in the top 5', neg.overdue === 50 && neg.top5.length === 1 && neg.top5[0].name === 'Beta Works');

  // soft check
  const items = [
    { row: 2, overdue: 100, modelOverdue: 90, b1_30: 40, b31_60: 40, b61_90: 0, b90: 0, preApril: 10 },
    { row: 3, overdue: 100, modelOverdue: 100, b1_30: 100, b31_60: 0, b61_90: 0, b90: 0, preApril: 0 }
  ];
  const w = Money.agingWarnings(items, (n) => '₹' + n);
  check('agingWarnings: names the row, the bucket total and ERP Overdue', w.length >= 1 && /Row 2: buckets add up to ₹90 but ERP Overdue says ₹100\./.test(w[0]), JSON.stringify(w));
  check('agingWarnings: also compares with Model Overdue', Money.agingWarnings(items, (n) => '₹' + n).some(m => /but Model Overdue says/.test(m)) === false && Money.agingWarnings([{ row: 2, overdue: 90, modelOverdue: 100, b1_30: 90, b31_60: 0, b61_90: 0, b90: 0, preApril: 0 }], (n) => '₹' + n).some(m => /Model Overdue says ₹100/.test(m)));
  check('agingWarnings: says when the buckets follow Model Overdue', Money.agingWarnings([{ row: 2, overdue: 100, modelOverdue: 90, b1_30: 90, b31_60: 0, b61_90: 0, b90: 0, preApril: 0 }], (n) => '₹' + n).some(m => /match Model Overdue/.test(m)));
  check('agingWarnings: a difference of ₹1 or less is fine', Money.agingWarnings([{ row: 2, overdue: 100, modelOverdue: 100, b1_30: 99.5, b31_60: 0, b61_90: 0, b90: 0, preApril: 0 }]).length === 0);
  const many = []; for (let i = 0; i < 9; i++) many.push({ row: i + 2, overdue: 100, modelOverdue: null, b1_30: 1, b31_60: 0, b61_90: 0, b90: 0, preApril: 0 });
  const wm = Money.agingWarnings(many);
  check('agingWarnings: lists the first 5 rows, then a count', wm.length === 6 && /\+4 more/.test(wm[5]), JSON.stringify(wm));

  // the "ERP 15-Oct" base date
  check('erp base date: year comes from the as-of date and is never after it', Money.erpBaseDateOf('ERP 15-Oct', '2026-10-19') === '2026-10-15' && Money.erpBaseDateOf('ERP 28-Dec', '2026-01-10') === '2025-12-28' && Money.erpBaseDateOf('ERP 01-Apr-26', '2026-10-19') === '2026-04-01' && Money.erpBaseDateOf('Estimated Live', '2026-10-19') === null);

  // importer rows -> stored rows
  const rows = Money.buildRows('live', [
    { sourceName: 'Alpha Forge', customerId: 'a', groupIds: null, erpBase: 10, invoicesSince: null, receiptsSince: 2, outstanding: 8, asOn: '2026-10-15', row: 2, customer: 'Alpha Forge' },
    { sourceName: 'Not Us Ltd', customerId: null, groupIds: null, erpBase: 1, invoicesSince: 0, receiptsSince: 0, outstanding: 1, asOn: null, row: 3 }
  ], { 'Not Us Ltd': '' }, 'ERP 15-Oct', '2026-10-15');
  check('buildRows: keeps the typed fields, the base date and the "not a CRM customer" mark, and drops file row numbers',
    rows[0].outstanding === 8 && rows[0].erpBaseDate === '2026-10-15' && rows[0].invoicesSince === null && rows[0].row === undefined && rows[1].ignored === true && rows[0].ignored === undefined, JSON.stringify(rows));
};
