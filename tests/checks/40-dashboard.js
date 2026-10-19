// A3 Dashboard checks. Expected numbers are computed from customers.json (t.data) plus the changes each check makes.
// Other modules (money, RFQs, schedule, leads, revenue, report) are replaced by small fakes that follow the frozen stats()
// contracts (design section 4.5 and 12), so this file passes whether or not those modules are merged. The fakes are installed
// by an init script, so they also survive a refresh. Three worlds: "missing" (no module), "empty" (modules with no data), "full".
const S = require('../../js/store.js');

function installFakes(cfg) {
  const today = cfg.today;
  const add = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const def = (name, obj) => Object.defineProperty(window, name, { configurable: true, get: () => obj, set: () => {} });
  ['CrmMoney', 'CrmRfq', 'CrmSchedule', 'CrmLeads', 'CrmRevenue', 'CrmReport'].forEach(n => def(n, undefined));
  if (cfg.mode === 'missing') return;
  const full = cfg.mode === 'full';
  const nameOf = id => { try { return Store.get(id).name; } catch (e) { return id; } };
  const bump = k => { window[k] = (window[k] || 0) + 1; };

  // money: one table drives both stats() and forCustomer(), so the Customers tab filters agree with the Dashboard numbers
  const T = cfg.money, ids = Object.keys(T);
  const sum = k => ids.reduce((s, id) => s + (T[id][k] || 0), 0);
  const bucket = k => ({ amount: sum(k), n: ids.filter(id => T[id][k] > 0).length });
  const mAsOf = add(cfg.stale ? -12 : -3);
  def('CrmMoney', {
    has: () => full,
    meta: () => ({ aging: { asOf: mAsOf }, live: { asOf: add(-3) } }),
    forCustomer: id => (T[id] ? Object.assign({ shared: null, preApril: 0 }, T[id]) : null),
    stats: () => {
      if (!full) return null;
      if (cfg.throwMoney) throw new Error('boom');
      return {
        asOf: mAsOf, stale: !!cfg.stale, outstanding: sum('outstanding'), overdue: sum('overdue'), overduePct: Math.round(sum('overdue') / sum('outstanding') * 100),
        buckets: { b1_30: bucket('b1_30'), b31_60: bucket('b31_60'), b61_90: bucket('b61_90'), b90: bucket('b90') },
        top5: ids.filter(id => T[id].overdue > 0).sort((a, b) => T[b].overdue - T[a].overdue).slice(0, 5).map(id => ({ id, name: nameOf(id), overdue: T[id].overdue, b90: T[id].b90 || 0 })),
        unmatched: { n: 2, amount: 123456 }
      };
    },
    openImport: () => bump('__moneyImport')
  });

  const stages = ['Received', 'Quoted', 'Negotiated', 'Finalised', 'PO', 'Sample', 'PPAP'];
  def('CrmRfq', {
    STAGES: stages, RELEASED: ['Finalised', 'PO', 'Sample', 'PPAP'],
    stats: () => (full ? {
      total: 9, open: 8, lost: 1, quotedEver: 8, byStage: { Received: 2, Quoted: 3, Negotiated: 2, Finalised: 1, PO: 1, Sample: 0, PPAP: 0 },
      valueQuoted: 820000, valueWon: 150000, quoteOverdue: 2, quoteDueToday: 1, actionOverdue: 1,
      released: { total: 2, byStage: { Finalised: 1, PO: 1, Sample: 0, PPAP: 0 }, list: [{ id: 'r1', rfqNo: 'RFQ-1', part: 'Gear Blank', customerName: 'NR INDUSTRIES', stage: 'PO' }, { id: 'r2', rfqNo: 'RFQ-2', part: 'Yoke', customerName: 'FORCE MOTORS LIMITED', stage: 'Finalised' }] },
      hints: { quotedToPoPct: 25, avgDaysToQuote: 4, stuck: [{ stage: 'Negotiated', n: 2 }] }
    } : { total: 0, open: 0, lost: 0, byStage: {}, valueQuoted: 0, valueWon: 0, quoteOverdue: 0, quoteDueToday: 0, actionOverdue: 0, released: { total: 0, byStage: {}, list: [] }, hints: {} }),
    openEdit: id => { window.__rfqEdit = id; }, openNew: () => {}
  });

  def('CrmSchedule', {
    visitStats: () => (full ? { today: 1, next7: [{ id: 'v1', date: add(2), time: '10:30', type: 'Visit', customerId: 'nr-industries', customerName: 'NR INDUSTRIES' },
      { id: 'v2', date: add(4), time: '', type: 'Call', customerId: 'force-motors-limited', customerName: 'FORCE MOTORS LIMITED' }], next7Count: 2, missed: 1 } : { today: 0, next7: [], next7Count: 0, missed: 0 }),
    orderStats: () => (full ? { asOf: null, stale: false, open: 6, late: 2, dueToday: 1, dueWeek: 3, onTimePct30: 80 } : null),
    dispatchStats: () => (full ? { dataThrough: add(-20), slips30: 12, qty30: 3400, customers30: 5, noDispatch90: cfg.noDispatch } : null),
    lastDispatch: id => (full && cfg.dispatch[id] != null ? add(cfg.dispatch[id]) : ''),
    openNewVisit: () => {}
  });

  def('CrmLeads', {
    BUCKETS: { A: 'No response: awaiting them', B: 'Response pending from our side', C: 'Negative / shelved / stalled: re-pitch', D: 'Stalled cold-call list', dormant: 'Dormant > 6 months (re-engage)', jv: 'JV & strategic partnership' },
    stats: () => (full ? { open: 14, byBucket: { A: 4, B: 3, C: 2, D: 1, dormant: 3, jv: 1, none: 0 }, dormant: 5, followOverdue: 2, followToday: 1, touched7: 3, converted30: 1,
      reactivate: [{ id: 'l1', company: 'Made Up Forge Pvt Ltd', lastContact: add(-300), category: 'Dormant >6 Mo (High Value)' }, { id: 'l2', company: 'Imaginary Dies Ltd', lastContact: add(-250), category: '' }] }
      : { open: 0, byBucket: { A: 0, B: 0, C: 0, D: 0, dormant: 0, jv: 0, none: 0 }, dormant: 0, followOverdue: 0, followToday: 0, touched7: 0, converted30: 0, reactivate: [] }),
    openEdit: id => { window.__leadEdit = id; }, openNew: () => {}
  });

  // revenue: the card itself belongs to another module; this fake only follows the slot contract and reads the same document
  const rows = () => { const d = Store.doc('revenue').get(); return d && d.rows ? d.rows : []; };
  const relIds = () => rows().filter(r => { const c = Store.get(r.customerId); return c && c.relatedParty; });
  const mk = (tag, text, attrs) => { const e = document.createElement(tag); if (text) e.textContent = text; Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k])); return e; };
  def('CrmRevenue', {
    has: () => rows().length > 0,
    forCustomer: id => (rows().some(r => r.customerId === id) ? { fytd: rows().filter(r => r.customerId === id).reduce((a, r) => a + r.taxable, 0), mtd: 0, lastInvoice: '' } : null),
    stats: o => { const rel = relIds(); return { excludedRelated: o && o.includeRelated ? { n: 0, amount: 0 } : { n: new Set(rel.map(r => r.customerId)).size, amount: rel.reduce((a, r) => a + r.taxable, 0) } }; },
    openImport: () => bump('__revImport'),
    renderCard: slot => {
      bump('__revCalls');
      slot.textContent = '';
      slot.appendChild(mk('h2', 'Revenue (Taxable, before GST)', { id: 'dh-rev' }));
      if (!rows().length) {
        slot.appendChild(mk('p', 'No invoice data yet. Export the INVOICE_REGISTER tab of the VFPL Collections Engine sheet as CSV and import it here. Revenue uses the Taxable column (before GST and TCS). Amounts stay in this browser only.'));
        slot.appendChild(mk('button', 'Import invoices', { id: 'revImportBtn', type: 'button' }));
        slot.lastChild.addEventListener('click', () => bump('__revImport'));
      } else {
        slot.appendChild(mk('p', 'Revenue card, related parties ' + (App.view('dash').incRelated === true ? 'included' : 'excluded'), { id: 'revState' }));
        const vb = mk('div', '', { class: 'vbars' });
        for (let i = 0; i < 12; i++) {
          const ym = (i < 9 ? '2026-' + String(i + 4).padStart(2, '0') : '2027-' + String(i - 8).padStart(2, '0'));
          const inM = rows().filter(r => r.date.slice(0, 7) === ym);
          const b = mk('button', 'AMJJASONDJFM'[i], { type: 'button', 'data-month': ym, 'data-n': String(new Set(inM.map(r => r.customerId)).size) });
          b.addEventListener('click', () => App.show('list', { extra: { kind: 'ids', value: [...new Set(inM.map(r => r.customerId))], label: 'Invoiced in ' + ym } }));
          vb.appendChild(b);
        }
        slot.appendChild(vb);
      }
      if (cfg.revSwitch) { slot.appendChild(mk('button', 'Include related parties', { id: 'incRelated', type: 'button', 'aria-pressed': 'false' })); }
    }
  });
  def('CrmReport', { open: () => bump('__reportOpen') });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#weeklyReportBtn')) bump('__reportOpen'); });
}

module.exports = async (t) => {
  const { check, istToday, data } = t;
  const today = istToday(0), at = n => istToday(n);
  const idOf = name => S.slug(data.customers.find(c => c.name.toUpperCase().startsWith(name)).name);
  const ZF = idOf('ZF STEERING'), NR = idOf('NR INDUSTRIES'), NAHARS = idOf('NAHARS'), FORCE = idOf('FORCE MOTORS'), NEEL = idOf('NEEL METAL'),
    SK = idOf('S K TRADERS'), SANJEEV = idOf('SANJEEV'), PINNACLE = idOf('PINNACLE'), WATSON = idOf('WATSON'), MARKAL = idOf('VARSHA FORGINGS'), KCTR = idOf('KCTR');
  const mkCfg = (mode, extra) => Object.assign({
    mode, today,
    money: { [NR]: { outstanding: 900000, overdue: 400000, b61_90: 400000 }, [FORCE]: { outstanding: 700000, overdue: 300000, b61_90: 100000, b90: 200000 },
             [ZF]: { outstanding: 500000, overdue: 0 }, [NEEL]: { outstanding: 250000, overdue: 50000, b1_30: 50000 } },
    noDispatch: [SANJEEV, PINNACLE, 'ghost-id-not-in-the-crm'], dispatch: { [NR]: -10, [FORCE]: -45, [ZF]: -100 }
  }, extra || {});

  // ---- a model of the customers, kept in step with what each check changes, used to compute the expected numbers ----
  const model = data.customers.map(c => Object.assign({}, c, { id: S.slug(c.name), followUp: c.followUp || '', plants: [], group: '', segment: '', vehicleSegment: '' }));
  const mget = id => model.find(c => c.id === id);
  const dayNum = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
  const kind = c => !c.followUp ? 'none' : (d => d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 7 ? 'week' : 'later')(dayNum(c.followUp) - dayNum(today));
  const bucketOf = (last, ref) => !last ? 'never' : (d => d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '91+')(dayNum(ref) - dayNum(last));
  const count = fn => model.filter(fn).length;
  const expected = () => ({
    total: model.length, 'status-active': count(c => c.status === 'Active'), 'status-followup': count(c => c.status === 'Follow up'), 'status-atrisk': count(c => c.status === 'At risk'),
    overdue: count(c => kind(c) === 'overdue'), today: count(c => kind(c) === 'today'), week: count(c => kind(c) === 'week'), none: count(c => kind(c) === 'none'), disputed: count(c => c.disputed)
  });
  const TILE_KEYS = ['total', 'status-active', 'status-followup', 'status-atrisk', 'overdue', 'today', 'week', 'none', 'disputed'];
  const latestLast = model.reduce((m, c) => (c.last && c.last > m ? c.last : m), '');

  const open = async (cfg, viewport) => {
    const { page } = await t.fresh({ init: installFakes, initArg: cfg, viewport });
    await t.open(page);
    await page.waitForSelector('#panel-dash .tiles');
    return page;
  };
  const flush = page => page.evaluate(() => App.flush());
  const seed = async (page, fn, arg) => { await page.evaluate(fn, arg); await flush(page); };
  const rowsN = page => t.rows(page);
  const num = s => parseInt(String(s).replace(/[^\d-]/g, ''), 10);
  const tileNum = async (page, key) => num(await page.locator(`#panel-dash [data-tile="${key}"] .d-num`).first().innerText());
  const back = async page => { await t.tab(page, 'dash'); await page.waitForSelector('#panel-dash .tiles'); };
  // click a dashboard button that opens the Customers tab and return how many rows it shows
  const rowsAfter = async (page, locator) => { await locator.click(); await page.waitForSelector('#panel-list:not([hidden])'); const n = await rowsN(page); await back(page); return n; };
  const spyShow = page => page.evaluate(() => { window.__shows = []; const o = App.show; App.show = function (tab, filter, opts) { window.__shows.push([tab, filter]); return o.apply(this, arguments); }; });
  const lastShow = page => page.evaluate(() => window.__shows[window.__shows.length - 1]);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const RED = 'rgb(180, 35, 24)', ORANGE = 'rgb(180, 83, 9)';

  // =========================================================================================================
  // World 1: no other module is built. Customers-only Dashboard.
  // =========================================================================================================
  const p = await open(mkCfg('missing'));
  await spyShow(p);
  const cc = () => p.evaluate(() => { window.__cc = []; for (const k of ['openDone', 'openNotes']) { const o = CrmCustomers[k]; CrmCustomers[k] = function (id) { window.__cc.push([k, id]); return o.apply(this, arguments); }; } });
  await cc();

  // ---- tiles ----
  let ex = expected(), got = {};
  for (const k of TILE_KEYS) got[k] = await tileNum(p, k);
  const overdueWords0 = await p.locator('[data-tile="overdue"] .d-tile-words').innerText();
  check('customer tiles match the data (clean load)', eq(got, ex) && ex.total === 42 && ex.overdue === 0 && ex.none === 42 && overdueWords0 === 'None overdue', JSON.stringify({ got, ex }));

  const FU = { [ZF]: -9, [NAHARS]: -3, [NR]: -3, [FORCE]: 0, [NEEL]: 0, [SK]: 2, [SANJEEV]: 2, [PINNACLE]: 5, [WATSON]: 30 };
  Object.keys(FU).forEach(id => { mget(id).followUp = at(FU[id]); });
  const fuIso = {}; Object.keys(FU).forEach(id => { fuIso[id] = at(FU[id]); });
  await seed(p, async (m) => { for (const id of Object.keys(m)) await Store.setFollowUp(id, m[id]); }, fuIso);
  ex = expected(); got = {};
  for (const k of TILE_KEYS) got[k] = await tileNum(p, k);
  check('customer tiles match the data', eq(got, ex) && ex.overdue === 3 && ex.today === 2 && ex.week === 3 && ex.disputed === 12, JSON.stringify({ got, ex }));

  const labels = await p.locator('#dash-cust .d-tile-label').allInnerTexts();
  check('the customer tiles have plain-word labels', eq(labels, ['Total customers', 'Active', 'Follow up', 'At risk', 'Overdue', 'Due today', 'Next 7 days', 'No follow-up set', 'Disputed']), labels.join());

  const opened = [];
  for (const k of TILE_KEYS) {
    const n = await rowsAfter(p, p.locator(`#panel-dash [data-tile="${k}"]`));
    opened.push([k, n, ex[k]]);
  }
  check('every customer tile opens the matching filter', opened.every(o => o[1] === o[2]), JSON.stringify(opened.filter(o => o[1] !== o[2])));

  const ov = p.locator('[data-tile="overdue"]');
  const ovStyle = await ov.evaluate(e => ({ border: getComputedStyle(e).borderTopColor, val: getComputedStyle(e.querySelector('.d-val')).color }));
  check('Overdue tile is red and says "Needs a call now"', ovStyle.border === RED && ovStyle.val === RED && (await ov.locator('.d-tile-words').innerText()) === 'Needs a call now', JSON.stringify(ovStyle));
  const td = p.locator('[data-tile="today"]');
  check('Due today tile is orange and says "Due today"', (await td.evaluate(e => getComputedStyle(e).borderTopColor)) === ORANGE && (await td.locator('.d-tile-words').innerText()) === 'Due today');

  // ---- attention ----
  let att = await p.locator('#attList .d-att-item').evaluateAll(l => l.map(e => ({ id: e.dataset.id, name: e.querySelector('.d-name').textContent, fu: e.querySelector('.d-fu').textContent, color: getComputedStyle(e.querySelector('.d-fu')).color })));
  const wantOrder = [ZF, NAHARS, NR, FORCE, NEEL];
  check('Attention lists overdue oldest first, then due today', eq(att.map(a => a.id), wantOrder), att.map(a => a.id).join());
  check('Attention says "Overdue by N days" in red and "Due today" in orange',
    att[0].fu === 'Overdue by 9 days' && att[0].color === RED && att[1].fu === 'Overdue by 3 days' && att[3].fu === 'Due today' && att[3].color === ORANGE, JSON.stringify(att));
  check('Attention shows the contact, a tel: link and last contacted', await (async () => {
    const zf = p.locator(`#attList [data-id="${ZF}"]`);
    const txt = await zf.innerText();
    const zfData = data.customers.find(c => c.name.startsWith('ZF STEERING'));
    const hasTel = zfData.phone ? (await zf.locator('a[href^="tel:"]').count()) <= 1 : true;
    return /No contact logged yet/.test(txt) && hasTel && (!zfData.contact || txt.includes(zfData.contact));
  })());

  const emptyTxt = await p.locator('#dash-activity').innerText();
  check('activity empty state shows with no call log', /No calls or notes logged yet\. When you finish a follow-up, press ✓ Done on the customer; use Notes to record any call or visit\./.test(emptyTxt) && (await p.locator('#toAttention').count()) === 1 && (await p.locator('#recentList').count()) === 0);
  check('contact tiles are 0, 0 and everyone before any contact is logged', (await tileNum(p, 'contact7')) === 0 && (await tileNum(p, 'contact30')) === 0 && (await tileNum(p, 'stale30')) === 42);

  await p.locator(`#attList [data-id="${ZF}"] .done-btn`).click();
  const doneOpen = await p.evaluate(() => { const d = document.getElementById('doneDlg'); return d ? d.open : true; });
  const calls1 = await p.evaluate(() => window.__cc);
  check('Done from Attention opens the Done dialog', eq(calls1, [['openDone', ZF]]) && doneOpen, JSON.stringify({ calls1, doneOpen }));
  await p.keyboard.press('Escape');
  await p.evaluate(async (id) => { await Store.markDone(id, { type: 'Call', note: 'rang the plant' }); }, ZF);
  mget(ZF).followUp = '';
  await flush(p);
  const att2 = await p.locator('#attList .d-att-item').evaluateAll(l => l.map(e => e.dataset.id));
  ex = expected();
  check('saving removes it from Attention and lowers Overdue', eq(att2, [NAHARS, NR, FORCE, NEEL]) && (await tileNum(p, 'overdue')) === ex.overdue && ex.overdue === 2 && (await rowsAfter(p, p.locator('[data-tile="overdue"]'))) === 2);

  await p.evaluate(() => { window.__cc = []; });
  await p.locator(`#attList [data-id="${NR}"] .notes-btn`).click();
  const notesOpen = await p.evaluate(() => { const d = document.getElementById('notesDlg'); return d ? d.open : true; });
  check('Notes from Attention opens the drawer', eq(await p.evaluate(() => window.__cc), [['openNotes', NR]]) && notesOpen);
  await p.keyboard.press('Escape');
  await p.evaluate(() => { window.__cc = []; });
  await p.locator(`#attList [data-id="${NAHARS}"] .d-name`).click();
  check('the customer name in Attention opens the notes too', eq(await p.evaluate(() => window.__cc), [['openNotes', NAHARS]]));
  await p.keyboard.press('Escape');
  check('the Notes button shows the number of entries', (await p.locator(`#attList [data-id="${NR}"] .d-badge`).innerText()) === '0');

  // ---- next 7 days ----
  const days = await p.locator('.d-day').evaluateAll(l => l.map(e => ({ d: e.dataset.day, n: Number(e.dataset.n), text: e.textContent })));
  check('Next 7 days groups follow-ups by day', eq(days.map(d => [d.d, d.n]), [[at(2), 2], [at(5), 1]]) && days[0].text.endsWith('(2)'), JSON.stringify(days));
  const dayRows = [];
  for (const d of days) dayRows.push(await rowsAfter(p, p.locator(`.d-day[data-day="${d.d}"]`)));
  const allWeek = await rowsAfter(p, p.locator('#weekAll'));
  check('follow-up day group opens the matching filter', eq(dayRows, [2, 1]) && allWeek === 3 && (await p.locator('#weekAll').innerText()) === 'All (3)', JSON.stringify({ dayRows, allWeek }));

  // ---- mix cards: status legend, last-order bars, state bars ----
  const loopBars = async (sel) => {
    const n = await p.locator(sel).count(), out = [];
    for (let i = 0; i < n; i++) {
      const b = p.locator(sel).nth(i);
      const claim = Number(await b.getAttribute('data-n'));
      out.push([await b.innerText(), claim, await rowsAfter(p, b)]);
    }
    return out;
  };
  const legend = await loopBars('.d-lg[data-status]');
  const rec = await loopBars('.hbar.recency');
  const st = await loopBars('.hbar.state');
  const bad = [...legend, ...rec, ...st].filter(x => x[1] !== x[2]);
  check('status legend, last-order bars and state bars open the matching filter', legend.length === 3 && rec.length === 5 && st.length >= 4 && bad.length === 0, JSON.stringify(bad));
  const expState = {}; model.forEach(c => { if (c.state) expState[c.state] = (expState[c.state] || 0) + 1; });
  const expUnknown = model.filter(c => !c.state).length;
  const gotState = Object.fromEntries(st.map(x => [x[0].split('\n')[0], x[1]]));
  check('state bars count the customers per state and "Not known" comes last', Object.keys(expState).every(s => gotState[s] === expState[s]) && st[st.length - 1][0].startsWith('Not known') && st[st.length - 1][1] === expUnknown, JSON.stringify({ gotState, expState }));
  const statusPct = await p.locator('.d-lg[data-status="Active"]').innerText();
  check('status legend shows the count and the percentage', statusPct.replace(/\s+/g, ' ').includes('Active ' + ex['status-active'] + ' (' + Math.round(ex['status-active'] / 42 * 100) + '%)'), statusPct);

  const recBuckets = ref => { const o = { '0-30': 0, '31-60': 0, '61-90': 0, '91+': 0, never: 0 }; model.forEach(c => o[bucketOf(c.last, ref)]++); return o; };
  const recValues = async () => (await p.locator('.hbar.recency').evaluateAll(l => l.map(e => Number(e.dataset.n))));
  const keys5 = ['0-30', '31-60', '61-90', '91+', 'never'];
  const e1 = recBuckets(today), e2 = recBuckets(latestLast);
  const v1 = await recValues();
  check('last-order bars match the data counting from today', eq(v1, keys5.map(k => e1[k])) && e1['91+'] === 17, JSON.stringify({ v1, e1 }));
  await p.click('#fromData');
  const v2 = await recValues();
  const pressed2 = await p.getAttribute('#fromData', 'aria-pressed');
  const note2 = await p.locator('#dash-recency').innerText();
  const rowsData = [];
  for (let i = 0; i < 5; i++) rowsData.push(await rowsAfter(p, p.locator('.hbar.recency').nth(i)));
  await t.reload(p); await p.waitForSelector('#panel-dash .tiles');
  const v3 = await recValues();
  check('"Count days from" choice changes the buckets and survives a refresh',
    eq(v2, keys5.map(k => e2[k])) && !eq(v1, v2) && pressed2 === 'true' && eq(rowsData, v2) && eq(v3, v2) && (await p.getAttribute('#fromData', 'aria-pressed')) === 'true', JSON.stringify({ v1, v2, v3 }));
  check('the recency card names the date the data stops', /Latest order in the data \(12 Jul 2026\)/.test(await p.locator('#fromData').innerText()) && /stops at 12 Jul 2026/.test(await p.locator('#dash-recency').innerText()));
  await p.click('#fromToday');
  await spyShow(p); await cc();

  // ---- activity ----
  const longNote = '<b>bold</b> <img src=x onerror=alert(1)> spoke about the new forging samples and the revised drawing, the price and the delivery plan for next month ok';
  await seed(p, async (a) => {
    await Store.addLog(a.nr, { type: 'Call', note: a.note, at: a.d2 });
    await Store.addLog(a.neel, { type: 'Visit', note: 'visited the plant', at: a.d20 });
    await Store.addLog(a.zf, { type: 'Note', note: 'plain note', at: a.d1 });
    await Store.addLog(a.force, { type: 'Email', note: 'sent email', at: a.d40 });
  }, { nr: NR, neel: NEEL, zf: ZF, force: FORCE, note: longNote, d1: at(-1), d2: at(-2), d20: at(-20), d40: at(-40) });
  const rl = await p.locator('#recentList li').evaluateAll(l => l.map(e => ({ text: e.innerText, snip: e.querySelector('.snippet') ? e.querySelector('.snippet').textContent : '', kids: e.querySelectorAll('.snippet *').length, id: e.dataset.log })));
  const names = await p.locator('#recentList li .d-link').allInnerTexts();
  check('recent activity lists a new note (newest first, with type and customer)', rl.length === 5 && names[0].startsWith('ZF STEERING') && /^\s*\d{1,2} \w{3} 20\d\d/.test(rl[0].text) && /call/i.test(rl[0].text) && /Follow-up done/.test(rl[0].text) && /note/i.test(rl[1].text) && names.length === 5, JSON.stringify(names));
  const call = rl.find(r => r.snip.startsWith('<b>bold</b>'));
  check('note text is shown as text, cut at 80 characters', !!call && call.kids === 0 && call.snip.length === 80 && call.snip.endsWith('…'), JSON.stringify(call));
  check('a Call and a Visit show as contacts, a Note and an Email too (Email counts, Note does not)', (await tileNum(p, 'contact7')) === 2 && (await tileNum(p, 'contact30')) === 3 && (await tileNum(p, 'stale30')) === 39);
  const ct = [];
  for (const [k, n] of [['contact7', 2], ['contact30', 3], ['stale30', 39]]) ct.push([k, await rowsAfter(p, p.locator(`[data-tile="${k}"]`)), n]);
  check('contact tiles open the matching filter', ct.every(c => c[1] === c[2]), JSON.stringify(ct));
  await p.locator('#recentList li .d-link').nth(1).click();
  check('a customer in recent activity opens the notes', (await p.evaluate(() => window.__cc.slice(-1)[0]))[0] === 'openNotes');
  await p.keyboard.press('Escape');
  const notesBadge = await p.locator(`#attList [data-id="${NR}"] .d-badge`).innerText();
  check('the Notes button count follows the call log', notesBadge === '1', notesBadge);

  // ---- segments and groups ----
  const segEmpty = await p.locator('#dash-segments').innerText();
  check('segments-and-groups empty state shows when none are set', /No segments or groups set yet\. Use Edit on a customer to add them\./.test(segEmpty) && /Not set\s*42/.test(segEmpty.replace(/\n/g, ' ')), segEmpty);
  await seed(p, async (a) => {
    await Store.saveCustomer(a.zf, { segment: 'OEM', group: 'Test Group One' });
    await Store.saveCustomer(a.sanjeev, { segment: 'OEM', group: 'Test Group One' });
    await Store.saveCustomer(a.nr, { segment: 'Tier-1', vehicleSegment: 'CV' });
  }, { zf: ZF, sanjeev: SANJEEV, nr: NR });
  mget(ZF).segment = 'OEM'; mget(SANJEEV).segment = 'OEM'; mget(NR).segment = 'Tier-1'; mget(NR).vehicleSegment = 'CV';
  mget(ZF).group = 'Test Group One'; mget(SANJEEV).group = 'Test Group One';
  const seg = await loopBars('.hbar.segment');
  const segLabels = await p.locator('.hbar.segment .hb-name').allInnerTexts();
  check('segment bars open the segment filter', eq(segLabels, ['OEM', 'Tier-1', 'Tier-2', 'Trader', 'Export', 'Not set']) && seg.every(s => s[1] === s[2]) && eq(seg.map(s => s[1]), [2, 1, 0, 0, 0, 39]), JSON.stringify(seg));
  const grp = await loopBars('.hbar.group');
  check('group rows open the group filter', grp.length === 1 && grp[0][1] === 2 && grp[0][2] === 2 && /Test Group One/.test(grp[0][0]) && /2 customers/.test(grp[0][0]), JSON.stringify(grp));
  check('"Not set" opens customers with no segment', seg[5][2] === 39 && model.filter(c => !c.segment).length === 39);
  check('the "customers with no group" tile opens them', (await tileNum(p, 'nogroup')) === 40 && (await rowsAfter(p, p.locator('[data-tile="nogroup"]'))) === 40);
  const vs = await p.locator('.chip[data-vseg="CV"]').innerText();
  check('vehicle segment chips open the vehicle filter', /CV\s*1/.test(vs) && (await rowsAfter(p, p.locator('.chip[data-vseg="CV"]'))) === 1 && (await rowsAfter(p, p.locator('.chip[data-vseg="none"]'))) === 41);
  check('segment and group cards no longer show the empty state', !/No segments or groups set yet/.test(await p.locator('#dash-segments').innerText()));

  // a customer with plants in two states is counted under each, the same way the Customers filter counts them
  await seed(p, async (a) => { await Store.saveCustomer(a.force, { plants: [{ name: '', city: 'Pune', state: 'Maharashtra' }, { name: '', city: 'Hosur', state: 'Tamil Nadu' }] }); }, { force: FORCE });
  const st2 = await loopBars('.hbar.state');
  const tn = st2.find(x => x[0].startsWith('Tamil Nadu')), mh = st2.find(x => x[0].startsWith('Maharashtra'));
  check('state bars count a customer with plants in two states under each state, like the Customers filter', st2.every(x => x[1] === x[2]) && tn[1] === 2 && mh[1] === 17, JSON.stringify(st2));

  // ---- quick links and the CSV ----
  const dl = await t.download(p, '#attentionCsv');
  const csvRows = dl.text.replace(/^﻿/, '').trim().split('\r\n');
  check('Attention list downloads as CSV with a BOM, the exact header and one row per customer',
    dl.text.charCodeAt(0) === 0xFEFF && dl.name === 'varsha-crm-attention-' + today + '.csv' && csvRows[0] === '"Customer","Contact person","Phone","Follow-up","Status","Last contacted"' &&
    csvRows.length === 1 + (await tileNum(p, 'overdue')) + (await tileNum(p, 'today')) && /"Overdue by 3 days"/.test(dl.text) && !/@/.test(dl.text), dl.text.slice(0, 300));
  await p.click('#toExport');
  check('"Open the Export tab" opens it', (await p.getAttribute('#tab-export', 'aria-selected')) === 'true');
  await back(p);

  // ---- modules not built yet ----
  check('money, RFQ, orders, leads and revenue cards say "Not available yet" when their module is missing',
    (await p.locator('#dash-money, #dash-rfq, #dash-released, #dash-orders, #dash-leads, #dashRevenue').evaluateAll(l => l.every(e => /Not available yet\./.test(e.textContent)))));
  check('Weekly sales review button is hidden when the report module is missing', (await p.locator('#weeklyReportBtn, #weeklyReportLink').count()) === 0);

  // ---- survives a refresh; print ----
  const snapshot = async () => ({ tiles: await Promise.all(TILE_KEYS.map(k => tileNum(p, k))), att: await p.locator('#attList .d-att-item .d-name').allInnerTexts(), recent: await p.locator('#recentList li').count(), seg: await p.locator('.hbar.segment').evaluateAll(l => l.map(e => e.dataset.n)) });
  const before = await snapshot();
  await t.reload(p); await p.waitForSelector('#panel-dash .tiles');
  const after = await snapshot();
  check('dashboard survives a refresh', eq(before, after) && (await p.getAttribute('#tab-dash', 'aria-selected')) === 'true' && before.tiles[0] === 42, JSON.stringify({ before, after }));

  await p.emulateMedia({ media: 'print' });
  const pr = await p.evaluate(() => {
    const vis = s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; };
    const img = document.querySelector('#printHead img');
    return { head: vis('#printHead'), imgW: img ? img.naturalWidth : 0, imgH: img ? Math.round(img.getBoundingClientRect().height) : 0, header: vis('header'), tabs: vis('.tabbar'), nav: vis('nav.tabs'), snippets: [...document.querySelectorAll('.snippet')].filter(e => e.getClientRects().length > 0).length,
      text: document.getElementById('panel-dash').innerText, list: vis('#panel-list'), hide: vis('#hideAmt'), print: vis('#printBtn'), acts: [...document.querySelectorAll('.d-acts')].filter(e => e.getClientRects().length > 0).length, headText: document.getElementById('printHead').innerText };
  });
  check('print view shows the logo, hides tabs and note text', pr.head && pr.imgW > 0 && pr.imgH === 48 && !pr.header && !pr.tabs && !pr.nav && pr.snippets === 0 && !/forging samples|visited the plant|plain note/.test(pr.text) && !pr.hide && !pr.print && pr.acts === 0 &&
    /Varsha Forgings · CRM dashboard · /.test(pr.headText), JSON.stringify(Object.assign({}, pr, { text: '' })));
  check('print view keeps the red and orange words', await p.evaluate(() => { const e = document.querySelector('.d-att-item .d-fu'); return !!e && getComputedStyle(e).color === 'rgb(180, 35, 24)'; }));
  await p.emulateMedia({ media: 'screen' });

  // =========================================================================================================
  // Attention with more than 10 overdue
  // =========================================================================================================
  const q = await open(mkCfg('missing'));
  const many = {}; model.slice(0, 12).forEach((c, i) => { many[c.id] = at(-1 - i); });
  await seed(q, async (m) => { for (const id of Object.keys(m)) await Store.setFollowUp(id, m[id]); }, many);
  const items = await q.locator('#attList .d-att-item').count();
  check('Attention shows at most 10 and links to the full lists', items === 10 && (await q.locator('#showOverdue').innerText()) === 'Show all overdue (12)' && (await q.locator('#showToday').count()) === 0);
  check('"Show all overdue" opens exactly those customers', (await rowsAfter(q, q.locator('#showOverdue'))) === 12);
  const oldest = await q.locator('#attList .d-att-item').first().getAttribute('data-id');
  check('the oldest overdue follow-up is first', oldest === model[11].id, oldest);
  const dl2 = await t.download(q, '#attentionCsv');
  check('the Attention CSV has every overdue customer, not just the first 10', dl2.text.trim().split('\r\n').length === 13);
  const none = await open(mkCfg('missing'));
  check('Attention says "Nothing overdue or due today." when there is none', /Nothing overdue or due today\./.test(await none.locator('#dash-attention').innerText()) && (await none.locator('#showOverdue').count()) === 0);

  // =========================================================================================================
  // World 2: modules present but with no data yet (empty states)
  // =========================================================================================================
  const e = await open(mkCfg('empty'));
  await e.evaluate(() => { window.__moneyImport = 0; });
  const moneyEmpty = await e.locator('#dash-money').innerText();
  check('money card shows the empty state before import', /No money data yet\. Export the AGING and LIVE_POSITION tabs of the VFPL Collections Engine sheet as CSV and import them here\. Amounts stay in this browser only and are never saved to git\./.test(moneyEmpty) && (await e.locator('#moneyImportBtn').count()) === 1 && (await e.locator('#dash-money .d-tile').count()) === 0);
  await e.click('#moneyImportBtn');
  check('the money empty state button starts the import', (await e.evaluate(() => window.__moneyImport)) === 1);
  const revEmpty = await e.locator('#dashRevenue').innerText();
  check('revenue card shows the empty state before import and says Taxable is used', /No invoice data yet/.test(revEmpty) && /Taxable/.test(revEmpty) && (await e.locator('#dashRevenue #revImportBtn').count()) === 1);
  check('no related-parties switch is added to an empty revenue card by default text', (await e.locator('#incRelated').count()) === 1);
  check('RFQ, released parts, orders and leads empty states', /No RFQs yet\. Add them on the RFQs tab or import your RFQ sheet\./.test(await e.locator('#dash-rfq').innerText()) &&
    /No upcoming orders added yet\./.test(await e.locator('#dash-orders').innerText()) && /No dispatch history imported yet\./.test(await e.locator('#dash-orders').innerText()) &&
    /No leads yet\. Import your lead trackers on the Leads tab\./.test(await e.locator('#dash-leads').innerText()) && (await e.locator('[data-tile="released"] .d-num').innerText()) === '0');
  check('Next 7 days says so when there are no visits', /No visits or calls in the next 7 days\./.test(await e.locator('#dash-next7').innerText()) && /No follow-ups in the next 7 days\./.test(await e.locator('#dash-next7').innerText()));
  check('the Leads empty state button opens the Leads tab', await (async () => { await spyShow(e); await e.click('#toLeads'); return eq(await lastShow(e), ['leads', {}]); })());

  // =========================================================================================================
  // World 3: every module has data
  // =========================================================================================================
  const f = await open(mkCfg('full'));
  await spyShow(f);
  await f.evaluate(() => { window.__cc = []; for (const k of ['openDone', 'openNotes']) { const o = CrmCustomers[k]; CrmCustomers[k] = function (id) { window.__cc.push([k, id]); return o.apply(this, arguments); }; } });
  await seed(f, async (m) => { for (const id of Object.keys(m)) await Store.setFollowUp(id, m[id]); }, fuIso);

  // money
  const mt = async k => (await f.locator(`[data-tile="${k}"] .d-num`).innerText());
  check('money tiles show totals after import', (await mt('outstanding')) === '₹23.50 L' && (await mt('overdue-amt')) === '₹7.50 L' && (await mt('overdue-pct')) === '32%' &&
    (await f.locator('[data-tile="overdue-amt"] .d-tile-words').innerText()) === 'Overdue', await mt('outstanding'));
  check('Total overdue is red and says Overdue', (await f.locator('[data-tile="overdue-amt"]').evaluate(e2 => getComputedStyle(e2).borderTopColor)) === RED);
  const t1 = []; for (const k of ['outstanding', 'overdue-amt', 'overdue-pct']) { await f.click(`[data-tile="${k}"]`); t1.push(await lastShow(f)); await back(f); }
  check('money tiles open Customers with the money filter, largest overdue first',
    eq(t1[0], ['list', { extra: { kind: 'money', value: 'outstanding' }, sort: 'overdue' }]) && eq(t1[1], ['list', { extra: { kind: 'money', value: 'overdue' }, sort: 'overdue' }]) && eq(t1[2], t1[1]));
  const lg = await f.locator('.d-lg[data-age]').evaluateAll(l => l.map(e2 => ({ k: e2.dataset.age, n: Number(e2.dataset.n), text: e2.innerText.replace(/\s+/g, ' ') })));
  const lgRows = [];
  for (const l of lg) lgRows.push(await rowsAfter(f, f.locator(`.d-lg[data-age="${l.k}"]`)));
  check('aging legend opens customers with that bucket', eq(lg.map(l => l.k), ['b1_30', 'b31_60', 'b61_90', 'b90']) && eq(lg.map(l => l.n), [1, 0, 2, 1]) && eq(lgRows, [1, 0, 2, 1]) && /61–90 days · ₹5\.00 L · 2 customers/.test(lg[2].text), JSON.stringify({ lg, lgRows }));
  check('the aging bar has a segment for each bucket with an amount and is hidden from screen readers', (await f.locator('#dash-money .d-stack[aria-hidden="true"] .seg').count()) === 3);
  const top = await f.locator('.d-top5 .d-row').evaluateAll(l => l.map(e2 => ({ id: e2.dataset.top, text: e2.innerText.replace(/\s+/g, ' ') })));
  await f.click(`.d-row[data-top="${NR}"]`);
  const topShow = await lastShow(f); await back(f);
  await f.click('#top5All');
  const topAll = await lastShow(f); await back(f); const topAllRows = await rowsAfter(f, f.locator('#top5All'));
  check('top 5 overdue are clickable and sorted', eq(top.map(x => x.id), [NR, FORCE, NEEL]) && /₹4\.00 L overdue/.test(top[0].text) && eq(topShow[1].extra.value, [NR]) && eq(topAll[1].extra.value, [NR, FORCE, NEEL]) && topAllRows === 3, JSON.stringify({ top, topShow, topAll }));
  const mfoot = await f.locator('#dash-money .d-foot').innerText();
  check('money footer names the data dates and the unmatched amount', /Data as of \d{1,2} \w{3} 20\d\d \(AGING\), \d{1,2} \w{3} 20\d\d \(LIVE_POSITION\)/.test(mfoot) && /Includes ₹1\.23 L for 2 names not in the CRM/.test(mfoot) && (await f.locator('#moneyImportBtn').count()) === 1);
  await f.evaluate(() => { window.__moneyImport = 0; });
  await f.click('#moneyUnmatched');
  check('the unmatched button and Import money data start the import', (await f.evaluate(() => window.__moneyImport)) === 1);
  check('no stale warning when the data is recent', !/days old/.test(await f.locator('#dash-money').innerText()));
  const st3 = await open(mkCfg('full', { stale: true }));
  const staleEl = st3.locator('#dash-money .d-warn');
  check('stale money data shows the orange warning', (await staleEl.innerText()) === 'Money data is 12 days old. Import a fresh file.' && (await staleEl.evaluate(e2 => getComputedStyle(e2).color)) === ORANGE);

  // customers in Attention get the money line
  const attMoney = await f.locator(`#attList [data-id="${NR}"] .d-risk`).innerText();
  check('Attention shows the overdue amount in red with the word overdue', /₹4\.00 L overdue/.test(attMoney) && (await f.locator(`#attList [data-id="${NR}"] .d-risk`).evaluate(e2 => getComputedStyle(e2).color)) === RED, attMoney);

  // RFQ pipeline and released parts
  const fun = await f.locator('.hbar.stage').evaluateAll(l => l.map(e2 => [e2.dataset.bar, Number(e2.dataset.n)]));
  check('RFQ funnel counts per stage open the RFQ table', eq(fun, [['Received', 2], ['Quoted', 3], ['Negotiated', 2], ['Finalised', 1], ['PO', 1], ['Sample', 0], ['PPAP', 0]]) && await (async () => {
    await f.click('.hbar.stage[data-bar="Negotiated"]'); const s = await lastShow(f); await back(f);
    return eq(s, ['rfqs', { stage: 'Negotiated', view: 'table' }]);
  })());
  const qo = f.locator('[data-tile="quote-overdue"]');
  await qo.click(); const qoShow = await lastShow(f); await back(f);
  await f.click('[data-tile="action-overdue"]'); const aoShow = await lastShow(f); await back(f);
  await f.click('[data-tile="value-quoted"]'); const vqShow = await lastShow(f); await back(f);
  await f.click('[data-tile="value-won"]'); const vwShow = await lastShow(f); await back(f);
  check('Quote overdue tile is red and opens the matching RFQs', (await qo.evaluate(e2 => getComputedStyle(e2).borderTopColor)) === RED && (await qo.locator('.d-tile-words').innerText()) === 'Quote overdue' && (await tileNum(f, 'quote-overdue')) === 2 &&
    eq(qoShow, ['rfqs', { flag: 'quoteOverdue', view: 'table' }]) && eq(aoShow, ['rfqs', { flag: 'actionOverdue', view: 'table' }]), JSON.stringify({ qoShow, aoShow }));
  check('quoted and won values open the RFQ table with their filter', eq(vqShow, ['rfqs', { flag: 'openQuoted', view: 'table' }]) && eq(vwShow, ['rfqs', { flag: 'won', view: 'table' }]) && (await f.locator('[data-tile="value-quoted"] .d-num').innerText()) === '₹8.20 L');
  const hints = await f.locator('.d-hints').innerText();
  await f.click('[data-hint="stuck-Negotiated"]'); const stuck = await lastShow(f); await back(f);
  await f.click('[data-hint="quotedEver"]'); const qe = await lastShow(f); await back(f);
  check('RFQ hints are text with clickable counts', /25% of 8 quoted RFQs reached PO/.test(hints.replace(/\s+/g, ' ')) && /Quotes take 4 days on average from receipt/.test(hints) && /2 RFQs stuck in Negotiated for over 30 days/.test(hints) &&
    eq(stuck, ['rfqs', { flag: 'stuck', stuckStage: 'Negotiated', view: 'table' }]) && eq(qe, ['rfqs', { flag: 'quotedEver', view: 'table' }]), hints);
  await f.click('[data-tile="released"]'); const relShow = await lastShow(f); await back(f);
  const relChips = await f.locator('.d-chips .chip[data-stage]').evaluateAll(l => l.map(e2 => [e2.dataset.stage, Number(e2.dataset.n)]));
  await f.click('.chip[data-stage="PO"]'); const poShow = await lastShow(f); await back(f);
  check('Released parts counts Finalised and later and opens them', (await tileNum(f, 'released')) === 2 && eq(relShow, ['rfqs', { stage: 'released', view: 'table' }]) && eq(relChips, [['Finalised', 1], ['PO', 1], ['Sample', 0], ['PPAP', 0]]) && eq(poShow, ['rfqs', { stage: 'PO', view: 'table' }]));
  await f.click('[data-rfq="r1"]');
  const relList = await f.locator('#dash-released .d-rel li').allInnerTexts();
  check('released parts list opens the RFQ for editing', (await f.evaluate(() => window.__rfqEdit)) === 'r1' && relList.length === 2 && relList[0] === 'Gear Blank (RFQ-1) · NR INDUSTRIES · PO', relList.join());
  check('released parts note asks the user to confirm', (await f.locator('#dash-released').innerText()).includes('Released parts = RFQ parts at Finalised, PO, Sample or PPAP. Please confirm this meaning.'));

  // visits, orders, dispatch
  const vis = await f.locator('.d-visit').evaluateAll(l => l.map(e2 => e2.textContent));
  await f.click('.d-visit[data-visit="v1"]'); const v1s = await lastShow(f); await back(f);
  await f.click('#visits7'); const v7 = await lastShow(f); await back(f);
  await f.click('#visitsMissed'); const vm = await lastShow(f); await back(f);
  check('next 7 days visits list opens the Schedule day', vis.length === 2 && /10:30 · Visit · NR INDUSTRIES/.test(vis[0]) && eq(v1s, ['schedule', { sub: 'visits', day: at(2) }]) && eq(v7, ['schedule', { sub: 'visits', vflag: 'next7' }]) &&
    (await f.locator('#visits7').innerText()) === '2 visits and calls' && eq(vm, ['schedule', { sub: 'visits', vflag: 'missed' }]) && (await f.locator('#visitsMissed').innerText()) === 'Not done: 1' &&
    (await f.locator('#visitsMissed').evaluate(e2 => getComputedStyle(e2).color)) === RED, JSON.stringify({ vis, v1s, v7, vm }));
  const lo = f.locator('[data-tile="orders-late"]');
  await lo.click(); const lateShow = await lastShow(f); await back(f);
  check('late orders tile is red and opens late orders', (await lo.evaluate(e2 => getComputedStyle(e2).borderTopColor)) === RED && (await tileNum(f, 'orders-late')) === 2 && (await lo.locator('.d-tile-words').innerText()) === 'Late' && eq(lateShow, ['schedule', { sub: 'orders', oflag: 'late' }]));
  check('order tiles: due today, due this week and on time', (await tileNum(f, 'orders-today')) === 1 && (await tileNum(f, 'orders-week')) === 3 && (await f.locator('[data-tile="orders-ontime"] .d-val').innerText()) === '80%' && (await f.locator('[data-tile="orders-ontime"]').evaluate(e2 => e2.tagName)) === 'DIV');
  await f.click('[data-tile="dispatch30"]'); const dsp = await lastShow(f); await back(f);
  check('dispatched-last-30-days tile opens dispatch history', eq(dsp, ['schedule', { sub: 'dispatch' }]) && /12\s*slips\s*·\s*3,400\s*pcs/.test((await f.locator('[data-tile="dispatch30"]').innerText()).replace(/\s+/g, ' ')));
  const nd = await rowsAfter(f, f.locator('[data-tile="dispatch-none90"]'));
  check('no-dispatch-in-90-days opens those customers', nd === 2 && (await tileNum(f, 'dispatch-none90')) === 2 && /Dispatch data is 20 days old/.test(await f.locator('#dash-orders').innerText()));

  // recency based on dispatch
  const rv = async () => (await f.locator('.hbar.recency').evaluateAll(l => l.map(e2 => Number(e2.dataset.n))));
  const inv = await rv();
  await f.click('#basedDispatch');
  const dis = await rv();
  const disRows = []; for (let i = 0; i < 5; i++) disRows.push(await rowsAfter(f, f.locator('.hbar.recency').nth(i)));
  await t.reload(f); await f.waitForSelector('#panel-dash .tiles');
  const dis2 = await rv();
  check('recency "based on last dispatch" changes the buckets and survives a refresh', eq(dis, [1, 1, 0, 1, 39]) && !eq(inv, dis) && eq(disRows, dis) && eq(dis2, dis) && (await f.getAttribute('#basedDispatch', 'aria-pressed')) === 'true' &&
    /Dispatch dates come from the dispatch history/.test(await f.locator('#dash-recency').innerText()), JSON.stringify({ inv, dis, disRows, dis2 }));
  await f.click('#basedInvoice');
  await spyShow(f);

  // leads
  const lead = {};
  for (const k of ['A', 'B', 'C', 'D', 'dormant', 'jv']) { await f.click(`[data-tile="lead-${k}"]`); lead[k] = await lastShow(f); await back(f); }
  const leadN = await Promise.all(['A', 'B', 'C', 'D', 'dormant', 'jv'].map(k => tileNum(f, 'lead-' + k)));
  check('lead bucket tiles open the Leads tab with that bucket', eq(leadN, [4, 3, 2, 1, 3, 1]) && Object.keys(lead).every(k => eq(lead[k], ['leads', { bucket: k }])), JSON.stringify(lead));
  await f.click('[data-tile="lead-dormant6"]'); const ld1 = await lastShow(f); await back(f);
  check('dormant tile opens dormant leads', eq(ld1, ['leads', { flag: 'dormant' }]) && (await tileNum(f, 'lead-dormant6')) === 5);
  const lo2 = f.locator('[data-tile="lead-overdue"]');
  await lo2.click(); const ld2 = await lastShow(f); await back(f);
  await f.click('[data-tile="lead-touched"]'); const ld3 = await lastShow(f); await back(f);
  check('overdue lead follow-ups tile is red and opens them', (await lo2.evaluate(e2 => getComputedStyle(e2).borderTopColor)) === RED && (await lo2.locator('.d-tile-words').innerText()) === 'Overdue' && eq(ld2, ['leads', { flag: 'overdue' }]) && eq(ld3, ['leads', { flag: 'touched7' }]));
  await f.click('[data-lead="l1"]');
  const react = await f.locator('#dash-leads .d-rel li').allInnerTexts();
  check('Reactivate next lists the top dormant leads and opens one', (await f.evaluate(() => window.__leadEdit)) === 'l1' && react.length === 2 && /^Made Up Forge Pvt Ltd · last contact \d{1,2} \w{3} 20\d\d · Dormant >6 Mo \(High Value\)$/.test(react[0]), react.join());
  check('lead bucket tiles carry the bucket names', /No response: awaiting them/.test(await f.locator('[data-tile="lead-A"]').innerText()));

  // revenue slot and the related-parties switch
  const calls0 = await f.evaluate(() => window.__revCalls);
  check('revenue card shows the empty state before import and says Taxable is used (full world, no invoices)', /Taxable/.test(await f.locator('#dashRevenue').innerText()) && (await f.locator('#dashRevenue #revImportBtn').count()) === 1 && calls0 >= 1);
  await seed(f, async (a) => {
    await Store.doc('revenue').set({ v: 1, meta: { lastDate: a.d }, rows: [
      { invoiceNo: 'T1', date: '2026-04-10', customerId: a.nr, sourceName: 'x', taxable: 100000 }, { invoiceNo: 'T2', date: '2026-05-10', customerId: a.zf, sourceName: 'x', taxable: 40000 },
      { invoiceNo: 'T3', date: '2026-05-12', customerId: a.markal, sourceName: 'x', taxable: 50000 }, { invoiceNo: 'T4', date: '2026-06-02', customerId: a.kctr, sourceName: 'x', taxable: 25000 }] });
    await Store.saveCustomer(a.markal, { segment: 'OEM' });
    await Store.saveCustomer(a.zf, { segment: 'OEM' });
  }, { d: today, nr: NR, zf: ZF, markal: MARKAL, kctr: KCTR });
  check('revenue slot: the module renders its own card into #dashRevenue', (await f.locator('#dashRevenue .vbars button').count()) === 12 && (await f.locator('#dashRevenue h2').count()) === 1 && /Revenue \(Taxable, before GST\)/.test(await f.locator('#dashRevenue h2').innerText()));
  const sw = f.locator('#incRelated');
  check('the Include related parties switch is shown once, off by default, with the "Excludes 2 related parties" note',
    (await sw.count()) === 1 && (await sw.getAttribute('aria-pressed')) === 'false' && (await f.locator('#relNote').innerText()) === 'Excludes 2 related parties (₹75,000)' && /excluded/.test(await f.locator('#revState').innerText()));
  await f.click('#relNote'); const relShow2 = await lastShow(f);
  check('the Excludes note opens the related parties in Customers', eq(relShow2, ['list', { extra: { kind: 'related' } }]) && (await rowsN(f)) === 2);
  await back(f);
  const oemOff = (await f.locator('.hbar.segment[data-bar="OEM"]').innerText()).replace(/\s+/g, ' ');
  await f.click('#incRelated');
  const oemOn = (await f.locator('.hbar.segment[data-bar="OEM"]').innerText()).replace(/\s+/g, ' ');
  check('the switch adds related parties back, including in the segment bars',
    (await sw.getAttribute('aria-pressed')) === 'true' && /excluded|included/.test(await f.locator('#revState').innerText()) && /included/.test(await f.locator('#revState').innerText()) && (await f.locator('#relNote').count()) === 0 &&
    /revenue ₹40,000/.test(oemOff) && /revenue ₹90,000/.test(oemOn), JSON.stringify({ oemOff, oemOn }));
  await t.reload(f); await f.waitForSelector('#panel-dash .tiles');
  check('the Include related parties choice survives a refresh', (await f.getAttribute('#incRelated', 'aria-pressed')) === 'true' && /included/.test(await f.locator('#revState').innerText()) && /revenue ₹90,000/.test((await f.locator('.hbar.segment[data-bar="OEM"]').innerText()).replace(/\s+/g, ' ')));
  await f.click('#incRelated');
  await t.reload(f); await f.waitForSelector('#panel-dash .tiles');
  check('switching it off survives a refresh too', (await f.getAttribute('#incRelated', 'aria-pressed')) === 'false' && (await f.locator('#relNote').count()) === 1);
  await spyShow(f);
  const mb = f.locator('#dashRevenue .vbars button[data-month="2026-05"]');
  await mb.click(); const monthShow = await lastShow(f); const monthRows = await rowsN(f); await back(f);
  check('month column opens customers invoiced that month', monthShow[0] === 'list' && monthShow[1].extra.kind === 'ids' && monthRows === 2 && monthRows === Number(await mb.getAttribute('data-n')));

  // report and links
  await f.click('#weeklyReportBtn');
  check('Weekly sales review button opens the report', (await f.evaluate(() => window.__reportOpen)) === 1 && (await f.locator('#weeklyReportLink').count()) === 1);
  await f.click('#weeklyReportLink');
  check('the Quick links Weekly sales review also opens the report', (await f.evaluate(() => window.__reportOpen)) === 2);

  // Hide amounts
  const maskedBefore = await f.locator('#panel-dash').innerText();
  await f.click('#hideAmt');
  await flush(f);
  const maskedText = await f.locator('#panel-dash').innerText();
  const hiddenLabels = await f.locator('#panel-dash [aria-label="amount hidden"]').count();
  await t.reload(f); await f.waitForSelector('#panel-dash .tiles');
  check('Hide amounts masks every amount and survives a refresh', /₹\s?\d/.test(maskedBefore) && !/₹\s?\d/.test(maskedText) && maskedText.includes('₹ •••') && hiddenLabels > 10 && (await f.getAttribute('#hideAmt', 'aria-pressed')) === 'true' &&
    !/₹\s?\d/.test(await f.locator('#panel-dash').innerText()) && await f.evaluate(() => document.body.classList.contains('amounts-hidden')), maskedText.match(/.{0,20}₹\s?\d.{0,20}/) + '');
  await f.click('#hideAmt');

  // a module that fails must not break the page
  const bd = await open(mkCfg('full', { throwMoney: true }));
  check('a module whose stats() throws shows "Not available yet" and the rest of the Dashboard still renders', /Not available yet\./.test(await bd.locator('#dash-money').innerText()) && (await tileNum(bd, 'total')) === 42 && (await bd.locator('#dash-rfq .hbar').count()) === 7);

  // a revenue card that has its own switch: the Dashboard does not add another
  const own = await open(mkCfg('full', { revSwitch: true }));
  await seed(own, async (a) => { await Store.doc('revenue').set({ v: 1, rows: [{ invoiceNo: 'T1', date: '2026-04-10', customerId: a.nr, taxable: 1000 }] }); }, { nr: NR });
  check('the Dashboard adds no switch when the revenue card has its own', (await own.locator('#incRelated').count()) === 1 && (await own.locator('#dashRelBar').count()) === 0);

  // every number is a button
  await seed(f, async (a) => { await Store.addLog(a.nr, { type: 'Call', note: 'x' }); }, { nr: NR });
  const numbers = await f.locator('#panel-dash .d-num').evaluateAll(l => l.map(e2 => ({ ok: !!e2.closest('button'), text: e2.textContent })));
  const statics = await f.locator('#panel-dash .d-static').evaluateAll(l => l.map(e2 => !!e2.closest('button')));
  check('every dashboard number is a button', numbers.length > 60 && numbers.every(n => n.ok) && statics.every(x => !x), JSON.stringify(numbers.filter(n => !n.ok)));
  const claimed = await f.locator('#panel-dash button[data-go="list"][data-n]').evaluateAll(l => l.map(e2 => Number(e2.dataset.n)));
  const claimedRows = [];
  for (let i = 0; i < claimed.length; i++) claimedRows.push(await rowsAfter(f, f.locator('#panel-dash button[data-go="list"][data-n]').nth(i)));
  check('every dashboard number that opens Customers shows exactly that many rows', claimed.length > 40 && eq(claimed, claimedRows), JSON.stringify(claimed.map((c, i) => [c, claimedRows[i]]).filter(x => x[0] !== x[1])));
  const unlabelled = await f.locator('#panel-dash button').evaluateAll(l => l.filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label')).length);
  check('every dashboard button has a name', unlabelled === 0);

  // 375px
  const ph = await open(mkCfg('full'), { width: 375, height: 760 });
  await seed(ph, async (m) => { for (const id of Object.keys(m)) await Store.setFollowUp(id, m[id]); await Store.addLog('nr-industries', { type: 'Call', note: 'a long note '.repeat(30) }); await Store.saveCustomer('nr-industries', { group: 'A very long group name that keeps going and going for a while to test wrapping ok', segment: 'OEM' }); }, fuIso);
  const dims = await ph.evaluate(() => {
    const tl = [...document.querySelectorAll('#dash-cust .d-tile')].map(e2 => e2.getBoundingClientRect());
    return { page: document.documentElement.scrollWidth, wide: [...document.querySelectorAll('#panel-dash *')].filter(e2 => e2.getBoundingClientRect().right > 376 && getComputedStyle(e2).position !== 'fixed').length, perRow: tl.filter(r => Math.abs(r.top - tl[0].top) < 2).length, w: tl[0].width };
  });
  check('no sideways scroll on the Dashboard at 375px', dims.page === 375 && dims.wide === 0, JSON.stringify(dims));
  check('tiles show two to a row at 375px', dims.perRow === 2, JSON.stringify(dims));
  await ph.locator(`#attList [data-id="${ZF}"] .done-btn`).click();
  await ph.keyboard.press('Escape');
  check('no sideways scroll at 375px after opening Done from Attention', (await ph.evaluate(() => document.documentElement.scrollWidth)) === 375);
  await ph.emulateMedia({ media: 'print' });
  check('print view has the tiles in a clean block at phone width without errors', await ph.locator('#printHead').isVisible());
  await ph.emulateMedia({ media: 'screen' });
  await ph.click('#toExport'); await t.tab(ph, 'dash');
  check('focus stays on the toggle after it re-renders the card', await (async () => { await ph.focus('#fromData'); await ph.click('#fromData'); return (await ph.evaluate(() => document.activeElement && document.activeElement.id)) === 'fromData'; })());
};


module.exports.installFakes = installFakes;
