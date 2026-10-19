// Unit checks for the pure part of js/revenue.js (no browser). Made-up customers, names and amounts only.
const R = require('../../js/revenue.js');
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

module.exports = async (t) => {
  const { check } = t;

  // ---- India financial year ----
  check('fyOf: April starts a year, March ends it', R.fyOf('2026-04-01') === '2026-27' && R.fyOf('2027-03-31') === '2026-27' && R.fyOf('2026-03-31') === '2025-26' && R.fyOf('2099-12-31') === '2099-00');
  check('fyRange gives 1 Apr to 31 Mar', JSON.stringify(R.fyRange('2026-27')) === JSON.stringify({ start: '2026-04-01', end: '2027-03-31' }));
  check('monthsOf runs April to March', (() => { const m = R.monthsOf('2026-27'); return m.length === 12 && m[0].ym === '2026-04' && m[0].label === 'Apr' && m[8].ym === '2026-12' && m[9].ym === '2027-01' && m[11].ym === '2027-03' && m[11].label === 'Mar'; })());

  // ---- import rows: Taxable only, dedupe, min and max dates whatever the row order ----
  const norm = R.normalizeRows([
    { invoiceNo: 'X1', date: '2026-07-08', customerId: 'a', sourceName: 'Alpha', onInvoice: 'Alpha', erpGroup: 'G', taxable: 100, invoiceAmount: 118, gstin: '27ABCDE1234F1Z5', cgst: 9, tcs: 1 },
    { invoiceNo: 'X2', date: '2026-04-01', customerId: null, sourceName: 'Zeta', taxable: null },
    { invoiceNo: ' x1 ', date: '2026-07-08', customerId: 'a', sourceName: 'Alpha', taxable: 100 },
    { invoiceNo: 'X1', date: '2026-07-09', customerId: 'a', sourceName: 'Alpha', taxable: 50 },
    { invoiceNo: 'X3', date: '', taxable: 5 }
  ]);
  check('normalizeRows keeps only the design fields (no GSTIN, no tax, no Invoice Amount)', JSON.stringify(Object.keys(norm.rows[0])) === JSON.stringify(['invoiceNo', 'date', 'customerId', 'sourceName', 'onInvoice', 'erpGroup', 'taxable']) && !JSON.stringify(norm).includes('27ABCDE1234F1Z5'));
  check('normalizeRows: same Invoice No + date is a duplicate (first kept), a blank Taxable is 0, a row with no date is dropped',
    norm.rows.length === 3 && norm.duplicates === 1 && norm.rows[0].taxable === 100 && norm.rows[1].taxable === 0 && norm.rows.every(r => r.invoiceNo !== 'X3'));
  check('normalizeRows: first and last date are min and max, not first and last row', norm.firstDate === '2026-04-01' && norm.lastDate === '2026-07-09');

  // ---- fixture ----
  const C = [
    { id: 'a', name: 'Alpha Forge Ltd', segment: 'OEM', relatedParty: false, last: '2026-07-03', group: '' },
    { id: 'b', name: 'Beta Works', segment: 'OEM', relatedParty: false, last: '2026-01-01', group: '' },
    { id: 'c', name: 'Gamma Metals', segment: 'Tier-1', relatedParty: false, last: '', group: 'Existing' },
    { id: 'd', name: 'Delta Traders', segment: '', relatedParty: false, last: '2026-08-01', group: '' },
    { id: 'e', name: 'Echo Group Ltd', segment: '', relatedParty: false, last: '', group: '' },
    { id: 'm', name: 'Own Company One', segment: 'OEM', relatedParty: true, last: '2026-12-01', group: '' },
    { id: 'k', name: 'Own Company Two', segment: 'Trader', relatedParty: true, last: '2026-12-01', group: '' }
  ];
  const row = (invoiceNo, date, customerId, sourceName, erpGroup, taxable) => ({ invoiceNo, date, customerId, sourceName, onInvoice: sourceName, erpGroup, taxable });
  const rowsCur = [   // deliberately out of date order
    row('1', '2026-07-12', 'k', 'Own Company Two', 'Two Grp', 100000),
    row('2', '2026-04-10', 'a', 'Alpha Forge Ltd', 'Alpha Grp', 100000),
    row('3', '2026-07-12', 'b', 'Beta Works', 'Alpha Grp', 25000),
    row('4', '2026-05-05', 'a', 'Alpha Forge Ltd', 'Alpha Grp', 200000),
    row('5', '2026-05-15', 'c', 'Gamma Metals', 'Gamma', 30000),
    row('6', '2026-05-20', 'c', 'Gamma Metals', 'Gamma', -5000),
    row('7', '2026-06-02', 'd', 'Delta Traders', '', 20000),
    row('8', '2026-06-20', 'm', 'Own Company One', 'One Grp', 450000),
    row('9', '2026-07-03', 'a', 'Alpha Forge Ltd', 'Alpha Grp', 100000),
    row('10', '2026-07-08', null, 'Zeta Unknown', 'Zeta Grp', 15000),
    row('11', '2026-04-20', 'b', 'Beta Works', 'Alpha Grp', 50000),
    row('12', '2026-06-25', 'e', 'Echo Group Ltd', 'Echo Group Ltd', 7000)
  ];
  const rowsPrior = [row('P1', '2025-04-15', 'a', 'Alpha Forge Ltd', 'Alpha Grp', 80000), row('P2', '2025-06-10', 'b', 'Beta Works', 'Alpha Grp', 40000),
    row('P3', '2025-07-05', 'a', 'Alpha Forge Ltd', 'Alpha Grp', 60000), row('P4', '2025-07-20', 'c', 'Gamma Metals', 'Gamma', 10000),
    row('P5', '2025-07-12', 'm', 'Own Company One', 'One Grp', 9000)];
  const mk = (rows) => ({ v: 1, meta: { lastDate: rows.reduce((m, r) => r.date > m ? r.date : m, '') }, rows });
  const doc = mk(rowsCur), docP = mk(rowsCur.concat(rowsPrior));
  const TODAY = '2026-10-19';
  const S = (d, targets, o) => R.revenueStats(d, C, targets || null, TODAY, o || {});

  // ---- FYTD / MTD with both "measure to" choices ----
  const s = S(doc);
  // excluding related parties: a 400000, b 75000, c 25000, d 20000, e 7000, unmatched 15000 = 542000
  check('FY to date excludes related parties by default and uses the last invoice date', s.fy === '2026-27' && s.to === '2026-07-12' && s.dataThrough === '2026-07-12' && s.fytd === 542000, JSON.stringify([s.fy, s.to, s.fytd]));
  check('excludedRelated counts the two related parties and their amount', s.excludedRelated.n === 2 && s.excludedRelated.amount === 550000, JSON.stringify(s.excludedRelated));
  check('month to date is the month of the date measured to (July: 100000 + 25000 + 15000)', s.mtd === 140000 && s.mtdLabel === 'July 2026', JSON.stringify([s.mtd, s.mtdLabel]));
  const sIn = S(doc, null, { includeRelated: true });
  check('includeRelated adds them back (FYTD 1092000)', sIn.fytd === 1092000 && sIn.mtd === 240000, String(sIn.fytd));
  const sTodayJune = R.revenueStats(doc, C, null, '2026-06-30', { to: 'today' });
  check('measure to "today" stops at that date (30 Jun: July invoices are out)', sTodayJune.to === '2026-06-30' && sTodayJune.fytd === 402000 && sTodayJune.mtd === 27000 && sTodayJune.mtdLabel === 'June 2026', JSON.stringify([sTodayJune.fytd, sTodayJune.mtd]));
  const sTodayLate = S(doc, null, { to: 'today' });
  check('measure to "today" after the data gives the same FYTD and an empty current month', sTodayLate.to === TODAY && sTodayLate.fytd === 542000 && sTodayLate.mtd === 0 && sTodayLate.mtdLabel === 'October 2026');
  check('a financial year beyond the data is not picked: default falls back to the newest FY in the data', R.revenueStats(doc, C, null, '2031-01-01', {}).fy === '2026-27');

  // ---- monthly trend ----
  check('12 months, April to March, with the right amounts', s.months.length === 12 && s.months[0].ym === '2026-04' && s.months[11].ym === '2027-03' &&
    s.months[0].amount === 150000 && s.months[1].amount === 225000 && s.months[2].amount === 27000 && s.months[3].amount === 140000 && s.months.slice(4).every(m => m.amount === 0), JSON.stringify(s.months.map(m => m.amount)));
  check('a month lists the customers invoiced in it, largest first (no related parties, no unmatched)', JSON.stringify(s.months[1].ids) === JSON.stringify(['a', 'c']) && JSON.stringify(s.months[0].ids) === JSON.stringify(['a', 'b']) && JSON.stringify(s.mtdIds) === JSON.stringify(['a', 'b']), JSON.stringify([s.months[1].ids, s.mtdIds]));

  // ---- top 10, shares, concentration ----
  check('top10 is sorted by amount and has the shares', s.top10.map(e => e.id).join() === 'a,b,c,d,e' && s.top10[0].amount === 400000 && near(s.top10[0].share, 400000 / 542000 * 100) && s.top10[0].name === 'Alpha Forge Ltd');
  check('top1Share and top5Share are percent of all revenue (unmatched stays in the total)', near(s.top1Share, 400000 / 542000 * 100) && near(s.top5Share, (400000 + 75000 + 25000 + 20000 + 7000) / 542000 * 100));
  check('concentration flag: red above the 25% default, off when the limit is raised', s.concentration.thresholdPct === 25 && s.concentration.risk === true && s.concentration.id === 'a' &&
    S(doc, { settings: { concentrationPct: 80 } }).concentration.risk === false && S(doc, { settings: { concentrationPct: 80 } }).concentration.thresholdPct === 80 && S(doc, { settings: { concentrationPct: 3 } }).concentration.thresholdPct === 25);
  check('related parties are back in top10 and concentration when included', sIn.top10[0].id === 'm' && sIn.concentration.id === 'm' && near(sIn.top1Share, 450000 / 1092000 * 100));
  const sum = (list) => list.reduce((x, e) => x + e.share, 0);
  check('bySegment and byGroup shares add up to 100% (Not set and No group included)', near(sum(s.bySegment), 100, 1e-9) && near(sum(s.byGroup), 100, 1e-9) && near(sum(sIn.bySegment), 100, 1e-9) && near(sum(sIn.byGroup), 100, 1e-9));
  check('bySegment: OEM, Tier-1, then "Not set" last, with ids', s.bySegment.map(e => e.segment).join('|') === 'OEM|Tier-1|' && s.bySegment[0].amount === 475000 && s.bySegment[0].ids.slice().sort().join() === 'a,b' && s.bySegment[2].amount === 42000, JSON.stringify(s.bySegment));
  check('byGroup uses the ERP Group column and "" (no group) goes last', s.byGroup[0].group === 'Alpha Grp' && s.byGroup[0].amount === 475000 && s.byGroup[s.byGroup.length - 1].group === '' && s.byGroup.some(g => g.group === 'Zeta Grp' && g.ids.length === 0), JSON.stringify(s.byGroup.map(g => g.group)));
  check('unmatched rows stay in the totals and are listed by name', s.unmatched.n === 1 && s.unmatched.amount === 15000 && s.unmatched.names[0].name === 'Zeta Unknown');
  check('a customer that no longer exists counts as unmatched', R.revenueStats({ v: 1, rows: [row('Q', '2026-05-01', 'gone', 'Gone Ltd', '', 500)] }, C, null, TODAY, {}).unmatched.amount === 500);

  // ---- prior year ----
  check('no prior-year rows: prior is null and the months carry no prior value', s.prior === null && s.months.every(m => m.prior === null));
  const sp = S(docP);
  // prior window is 1 Apr 2025 to 12 Jul 2025, related parties out: 80000 + 40000 + 60000 = 180000
  check('prior-year rows: same-period total, change %, and a prior value per month up to the month measured',
    sp.prior && sp.prior.fytd === 180000 && near(sp.prior.changePct, (542000 - 180000) / 180000 * 100) && sp.months[0].prior === 80000 && sp.months[2].prior === 40000 && sp.months[3].prior === 60000 && sp.months[4].prior === null, JSON.stringify(sp.prior));
  check('prior value counts related parties only when included', S(docP, null, { includeRelated: true }).prior.fytd === 189000);
  check('picking the earlier FY measures the whole FY and has no prior of its own', (() => { const o = S(docP, null, { fy: '2025-26' }); return o.fy === '2025-26' && o.to === '2026-03-31' && o.fytd === 190000 && o.prior === null; })());
  check('prior comparison needs rows in the previous FY, not just any older date', S(mk(rowsCur.concat([row('Z', '2024-05-05', 'a', 'Alpha Forge Ltd', '', 10)])), null, {}).prior === null);

  // ---- targets ----
  const T = (customers, segments, extra) => Object.assign({ v: 1, byFy: { '2026-27': { customers: customers || {}, segments: segments || {} } }, settings: {} }, extra || {});
  check('no targets: null', S(doc).targets === null && S(doc, T({}, {})).targets === null);
  const tBehind = S(doc, T({ a: 2000000, b: 500000 })).targets;
  // 103 of 365 days have passed on 12 Jul
  check('pace is days elapsed in the financial year (103 of 365 on 12 Jul)', near(tBehind.pacePct, 103 / 365 * 100));
  check('customer targets: total, actual, pct, per-customer behind flags', tBehind.basis === 'customers' && tBehind.total === 2500000 && tBehind.actual === 475000 && near(tBehind.pct, 19) && tBehind.behind === true &&
    tBehind.customers.length === 2 && tBehind.customers.find(c => c.id === 'a').pct === 20 && tBehind.customers.every(c => c.behind), JSON.stringify(tBehind));
  const tOn = S(doc, T({ a: 1000000, b: 100000 })).targets;
  check('on pace: pct above the pace, not behind', tOn.behind === false && tOn.pct > tOn.pacePct && tOn.customers.find(c => c.id === 'b').behind === false);
  const tMixed = S(doc, T({ a: 1000000, b: 500000 })).targets;
  check('overall on pace can still list a customer that is behind', tMixed.behind === false && tMixed.customers.find(c => c.id === 'b').behind === true && tMixed.customers.find(c => c.id === 'a').behind === false);
  const tSeg = S(doc, T({}, { OEM: 5000000, 'Tier-1': 50000, Bogus: 5 })).targets;
  check('segment targets: basis segments, actual from the CRM segment, unknown segments ignored', tSeg.basis === 'segments' && tSeg.total === 5050000 && tSeg.actual === 500000 && tSeg.segments.length === 2 && tSeg.customers.length === 0 && tSeg.segments.find(x => x.segment === 'OEM').behind === true && tSeg.segments.find(x => x.segment === 'Tier-1').behind === false, JSON.stringify(tSeg));
  const tBoth = S(doc, T({ a: 1000000 }, { OEM: 5000000 })).targets;
  check('customer targets are used before segment targets', tBoth.basis === 'customers' && tBoth.total === 1000000 && tBoth.segments.length === 1);
  check('a target of 0, blank or negative, and a target for an unknown customer, are ignored', S(doc, T({ a: 0, b: '', c: -5, zz: 1000 })).targets === null);
  check('related-party customer targets are left out until related parties are included', (() => {
    const tg = T({ a: 1000000, m: 600000 });
    const ex = S(doc, tg).targets, inc = S(doc, tg, { includeRelated: true }).targets;
    return ex.total === 1000000 && ex.customers.length === 1 && inc.total === 1600000 && inc.actual === 850000 && inc.customers.length === 2;
  })());
  check('targets belong to one financial year', S(docP, T({ a: 1000000 }), { fy: '2025-26' }).targets === null);
  check('at the end of the year pace is 100% and any shortfall is behind', (() => { const o = R.revenueStats(doc, C, T({ a: 2000000 }), '2027-04-10', { to: 'today' }).targets; return near(o.pacePct, 100) && o.behind; })());

  // ---- per customer figures and "update Last order" ----
  const f = R.customerFigures(doc, C, 'a', TODAY, {});
  check('forCustomer: FY to date, month to date and the MAX invoice date (not the first or last row)', f.fytd === 400000 && f.mtd === 100000 && f.lastInvoice === '2026-07-03', JSON.stringify(f));
  check('forCustomer: a credit note does not count as the last order date', R.customerFigures(doc, C, 'c', TODAY, {}).lastInvoice === '2026-05-15' && R.customerFigures(doc, C, 'c', TODAY, {}).fytd === 25000);
  check('forCustomer: a customer with no invoices has zeros; no data is null', (() => { const z = R.customerFigures(doc, C, 'zz', TODAY, {}); return z.fytd === 0 && z.lastInvoice === '' && R.customerFigures(null, C, 'a', TODAY, {}) === null; })());
  check('Update Last order lists only customers whose newest invoice is later than Last order (or who have none)', JSON.stringify(R.lastOrderUpdates(doc, C).map(u => u.id + ':' + u.last).sort()) === JSON.stringify(['b:2026-07-12', 'c:2026-05-15', 'e:2026-06-25']), JSON.stringify(R.lastOrderUpdates(doc, C)));
  const nk = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
  check('Fill blank groups: only blank groups, one ERP Group on every row, and never just the customer\'s own name',
    JSON.stringify(R.groupFills(doc, C, nk).map(u => u.id + ':' + u.group).sort()) === JSON.stringify(['a:Alpha Grp', 'b:Alpha Grp', 'k:Two Grp', 'm:One Grp']), JSON.stringify(R.groupFills(doc, C, nk)));
  check('Fill blank groups skips a customer whose rows disagree', R.groupFills({ rows: [row('1', '2026-05-01', 'a', 'x', 'G1', 1), row('2', '2026-05-02', 'a', 'x', 'G2', 1)] }, C, nk).length === 0);

  // ---- empty and odd input ----
  check('no data gives null', S(null) === null && S({ rows: [] }) === null && S({ v: 1 }) === null);
  check('stats do not change the input rows', JSON.stringify(doc) === JSON.stringify(mk(rowsCur)));
};
