/* Revenue analytics (P2-L, task A7): INVOICE_REGISTER import, revenue stats, targets, and the whole Dashboard revenue card.
   Contract: design section 4.5 (CrmRevenue). Owned by A7.
   Revenue = the Taxable column (before GST and TCS). Invoice Amount is never read. GSTIN and every tax column are dropped at import.
   Units: money in rupees; every *Pct field AND every `share` field is a PERCENT number (0 to 100, not rounded).
   The pure part (top of the file) has no browser dependency and is also module.exports for Node unit tests. */
(function () {
  "use strict";

  var hasWin = typeof window !== "undefined";
  var SEGMENTS = ["OEM", "Tier-1", "Tier-2", "Trader", "Export"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DEFAULT_CONC = 25, CONC_MIN = 5, CONC_MAX = 90;
  var STALE_DAYS = 30;

  /* ====================================================================== pure part ====================================================================== */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayNum(iso) { return Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  /* India financial year: 1 Apr to 31 Mar. fyOf("2026-04-01") = "2026-27", fyOf("2027-03-31") = "2026-27". */
  function fyOf(iso) {
    var y = +String(iso).slice(0, 4), m = +String(iso).slice(5, 7);
    var s = m >= 4 ? y : y - 1;
    return s + "-" + pad2((s + 1) % 100);
  }
  function fyRange(fy) {
    var s = +String(fy).slice(0, 4);
    return { start: s + "-04-01", end: (s + 1) + "-03-31" };
  }
  function prevFy(fy) { return fyOf((+String(fy).slice(0, 4) - 1) + "-04-01"); }
  function shiftYear(iso, n) {
    var y = +iso.slice(0, 4) + n, md = iso.slice(5);
    if (md === "02-29") {
      var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      if (!leap) md = "02-28";
    }
    return y + "-" + md;
  }
  /* The 12 months of a financial year, April first. */
  function monthsOf(fy) {
    var sy = +String(fy).slice(0, 4), out = [];
    for (var i = 0; i < 12; i++) {
      var m = ((3 + i) % 12) + 1, y = m >= 4 ? sy : sy + 1;
      out.push({ ym: y + "-" + pad2(m), label: MON[m - 1], full: MONTH_FULL[m - 1] + " " + y });
    }
    return out;
  }
  function monthName(iso) { return MONTH_FULL[+iso.slice(5, 7) - 1] + " " + iso.slice(0, 4); }

  /* Import rows -> stored rows. Duplicate = same Invoice No + Invoice Date: the first is kept. Order is never assumed:
     firstDate and lastDate are the min and max invoice date. Only the fields in the design are kept (no GSTIN, no tax columns, no Invoice Amount). */
  function normalizeRows(items) {
    var seen = {}, rows = [], dup = 0, first = "", last = "";
    (items || []).forEach(function (it) {
      if (!it || !it.date) return;
      var no = String(it.invoiceNo == null ? "" : it.invoiceNo).trim();
      var key = no.toLowerCase() + "|" + it.date;
      if (seen[key]) { dup++; return; }
      seen[key] = 1;
      var r = {
        invoiceNo: no.slice(0, 40), date: it.date, customerId: it.customerId || null,
        sourceName: String(it.sourceName == null ? (it.customer == null ? "" : it.customer) : it.sourceName).trim().slice(0, 120),
        onInvoice: String(it.onInvoice == null ? "" : it.onInvoice).trim().slice(0, 120),
        erpGroup: String(it.erpGroup == null ? "" : it.erpGroup).trim().slice(0, 120),
        taxable: typeof it.taxable === "number" && isFinite(it.taxable) ? it.taxable : 0
      };
      rows.push(r);
      if (!first || r.date < first) first = r.date;
      if (r.date > last) last = r.date;
    });
    return { rows: rows, duplicates: dup, firstDate: first, lastDate: last };
  }

  /* Index of the stored rows against the current customers (memoised on identity; rebuilt when either changes). */
  var memo = { doc: null, customers: null, rematch: null, ix: null };
  function getIndex(doc, customers, rematch) {
    if (memo.ix && memo.doc === doc && memo.customers === customers && memo.rematch === (rematch || null)) return memo.ix;
    var byId = {};
    (customers || []).forEach(function (c) { byId[c.id] = c; });
    var rows = [], byCid = {}, fyCount = {}, first = "", last = "";
    ((doc && doc.rows) || []).forEach(function (r) {
      if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) return;
      var cid = r.customerId && byId[r.customerId] ? r.customerId : null;
      if (!cid && rematch) { var m = rematch(r.sourceName); if (m && byId[m]) cid = m; }
      var n = { no: r.invoiceNo || "", date: r.date, cid: cid, cust: cid ? byId[cid] : null, name: r.sourceName || "", group: r.erpGroup || "", amt: Number(r.taxable) || 0 };
      rows.push(n);
      if (cid) (byCid[cid] || (byCid[cid] = [])).push(n);
      var fy = fyOf(n.date);
      fyCount[fy] = (fyCount[fy] || 0) + 1;
      if (!first || n.date < first) first = n.date;
      if (n.date > last) last = n.date;
    });
    var fys = Object.keys(fyCount).sort().reverse();
    memo = { doc: doc, customers: customers, rematch: rematch || null, ix: { rows: rows, byCid: byCid, byId: byId, fyCount: fyCount, fys: fys, firstDate: first, lastDate: last } };
    return memo.ix;
  }

  function pickFy(fys, want, today) {
    if (want && fys.indexOf(want) !== -1) return want;
    var cur = fyOf(today);
    return fys.indexOf(cur) !== -1 ? cur : fys[0];
  }
  /* The date measured to: the last invoice date ("data") or today, kept inside the financial year. */
  function measureTo(range, lastDate, today, mode) {
    var base = mode === "today" ? today : lastDate;
    var to = base > range.end ? range.end : base;
    return to < range.start ? range.start : to;
  }
  function thresholdOf(targets) {
    var v = targets && targets.settings ? Number(targets.settings.concentrationPct) : NaN;
    return isFinite(v) && v >= CONC_MIN && v <= CONC_MAX ? v : DEFAULT_CONC;
  }
  function posNumber(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function sortAmtDesc(a, b) { return (b.amount - a.amount) || String(a.name || a.segment || a.group || "").localeCompare(String(b.name || b.segment || b.group || "")); }

  function revenueStats(doc, customers, targets, today, opts) {
    opts = opts || {};
    if (!doc || !Array.isArray(doc.rows) || !doc.rows.length) return null;
    var ix = getIndex(doc, customers, opts.rematch);
    if (!ix.rows.length) return null;
    var incl = opts.includeRelated === true;
    var fy = pickFy(ix.fys, opts.fy, today);
    var range = fyRange(fy);
    var to = measureTo(range, ix.lastDate, today, opts.to);
    var toYm = to.slice(0, 7);
    var pfy = prevFy(fy), pr = fyRange(pfy), hasPrior = (ix.fyCount[pfy] || 0) > 0;
    var priorEnd = shiftYear(to, -1);
    if (priorEnd > pr.end) priorEnd = pr.end;

    var months = monthsOf(fy), mIdx = {};
    months.forEach(function (m, i) { m.amount = 0; m.prior = hasPrior ? 0 : null; m._ids = {}; mIdx[m.ym] = i; });
    var fytd = 0, mtd = 0, priorFytd = 0, count = 0;
    var relIds = {}, relAmt = 0;
    var perCust = {}, perSeg = {}, perGroup = {}, segIds = {}, groupIds = {}, unm = {}, unmN = 0, unmAmt = 0;

    ix.rows.forEach(function (r) {
      var inCur = r.date >= range.start && r.date <= to;
      var inPrior = hasPrior && !inCur && r.date >= pr.start && r.date <= priorEnd;
      if (!inCur && !inPrior) return;
      var rel = !!(r.cust && r.cust.relatedParty);
      if (inCur && rel) { relIds[r.cid] = 1; relAmt += r.amt; }
      if (rel && !incl) return;
      if (inPrior) {
        priorFytd += r.amt;
        var pi = mIdx[shiftYear(r.date, 1).slice(0, 7)];
        if (pi != null) months[pi].prior += r.amt;
        return;
      }
      count++;
      fytd += r.amt;
      var mi = mIdx[r.date.slice(0, 7)];
      if (mi != null) {
        months[mi].amount += r.amt;
        if (r.cid) months[mi]._ids[r.cid] = (months[mi]._ids[r.cid] || 0) + r.amt;
      }
      if (r.date.slice(0, 7) === toYm) mtd += r.amt;
      var seg = r.cust ? (r.cust.segment || "") : "";
      perSeg[seg] = (perSeg[seg] || 0) + r.amt;
      var g = r.group || "";
      perGroup[g] = (perGroup[g] || 0) + r.amt;
      if (r.cid) {
        perCust[r.cid] = (perCust[r.cid] || 0) + r.amt;
        (segIds[seg] || (segIds[seg] = {}))[r.cid] = 1;
        (groupIds[g] || (groupIds[g] = {}))[r.cid] = 1;
      } else {
        unm[r.name] = (unm[r.name] || 0) + r.amt;
        unmAmt += r.amt;
      }
    });

    var share = function (v) { return fytd > 0 ? (v / fytd) * 100 : 0; };
    var nameOf = function (id) { return ix.byId[id] ? ix.byId[id].name : id; };
    var idsByAmount = function (map) {
      return Object.keys(map).sort(function (a, b) { return (map[b] - map[a]) || nameOf(a).localeCompare(nameOf(b)); });
    };

    months.forEach(function (m, i) {
      m.ids = idsByAmount(m._ids);
      delete m._ids;
      if (m.ym > toYm) { m.amount = 0; if (hasPrior) m.prior = null; }
    });

    var ranked = Object.keys(perCust).map(function (id) { return { id: id, name: nameOf(id), amount: perCust[id] }; })
      .filter(function (e) { return e.amount > 0; }).sort(sortAmtDesc);
    var top10 = ranked.slice(0, 10).map(function (e) { return { id: e.id, name: e.name, amount: e.amount, share: share(e.amount) }; });
    var top1Share = top10.length ? top10[0].share : 0;
    var top5Share = top10.slice(0, 5).reduce(function (s, e) { return s + e.share; }, 0);
    var thr = thresholdOf(targets);
    var concentration = { thresholdPct: thr, risk: top1Share > thr, id: top10.length ? top10[0].id : null, name: top10.length ? top10[0].name : "", share: top1Share };

    var bySegment = Object.keys(perSeg).map(function (s) {
      return { segment: s, amount: perSeg[s], share: share(perSeg[s]), ids: Object.keys(segIds[s] || {}) };
    }).sort(function (a, b) { return (a.segment === "") - (b.segment === "") || (b.amount - a.amount); });
    var byGroup = Object.keys(perGroup).map(function (g) {
      return { group: g, amount: perGroup[g], share: share(perGroup[g]), ids: Object.keys(groupIds[g] || {}) };
    }).sort(function (a, b) { return (a.group === "") - (b.group === "") || (b.amount - a.amount); });

    var unmNames = Object.keys(unm).map(function (n) { return { name: n, amount: unm[n] }; }).sort(sortAmtDesc);
    unmN = unmNames.length;

    // target vs actual
    var total = daysBetween(range.start, range.end) + 1;
    var elapsed = Math.max(0, Math.min(total, daysBetween(range.start, to) + 1));
    var pacePct = (elapsed / total) * 100;
    var tfy = targets && targets.byFy && typeof targets.byFy === "object" ? targets.byFy[fy] : null;
    var tcalc = null;
    if (tfy && typeof tfy === "object") {
      var custRows = [];
      Object.keys(tfy.customers || {}).forEach(function (id) {
        var c = ix.byId[id], t = posNumber(tfy.customers[id]);
        if (!c || !t) return;
        if (c.relatedParty && !incl) return;
        var a = perCust[id] || 0, p = (a / t) * 100;
        custRows.push({ id: id, name: c.name, target: t, actual: a, pct: p, behind: p < pacePct });
      });
      custRows.sort(function (a, b) { return a.name.localeCompare(b.name); });
      var segRows = [];
      SEGMENTS.forEach(function (s) {
        var t = posNumber((tfy.segments || {})[s]);
        if (!t) return;
        var a = perSeg[s] || 0, p = (a / t) * 100;
        segRows.push({ segment: s, target: t, actual: a, pct: p, behind: p < pacePct });
      });
      var rowsUsed = custRows.length ? custRows : segRows;
      if (rowsUsed.length) {
        var tt = rowsUsed.reduce(function (s, r) { return s + r.target; }, 0), ta = rowsUsed.reduce(function (s, r) { return s + r.actual; }, 0);
        var pc = (ta / tt) * 100;
        tcalc = { basis: custRows.length ? "customers" : "segments", total: tt, actual: ta, pct: pc, pacePct: pacePct, behind: pc < pacePct, customers: custRows, segments: segRows };
      }
    }

    var ids = idsByAmount(perCust);
    return {
      excludedRelated: { n: Object.keys(relIds).length, amount: relAmt },
      fy: fy, to: to, toMode: opts.to === "today" ? "today" : "data", dataThrough: ix.lastDate, firstDate: ix.firstDate,
      fytd: fytd, mtd: mtd, mtdLabel: monthName(to), count: count,
      prior: hasPrior ? { fytd: priorFytd, changePct: priorFytd > 0 ? ((fytd - priorFytd) / priorFytd) * 100 : null } : null,
      months: months, ids: ids, mtdIds: (months[mIdx[toYm]] || { ids: [] }).ids,
      top10: top10, top1Share: top1Share, top5Share: top5Share, concentration: concentration,
      bySegment: bySegment, byGroup: byGroup,
      unmatched: { n: unmN, amount: unmAmt, names: unmNames },
      targets: tcalc
    };
  }

  /* One customer's figures: { fytd, mtd, lastInvoice } or null when nothing is imported.
     lastInvoice is the MAX invoice date over all of the customer's rows with a positive Taxable (a credit note is not an order). Row order is never used. */
  function customerFigures(doc, customers, id, today, opts) {
    opts = opts || {};
    if (!doc || !Array.isArray(doc.rows) || !doc.rows.length) return null;
    var ix = getIndex(doc, customers, opts.rematch);
    if (!ix.rows.length) return null;
    var fy = pickFy(ix.fys, opts.fy, today), range = fyRange(fy), to = measureTo(range, ix.lastDate, today, opts.to), toYm = to.slice(0, 7);
    var f = 0, m = 0, last = "";
    (ix.byCid[id] || []).forEach(function (r) {
      if (r.amt > 0 && r.date > last) last = r.date;
      if (r.date >= range.start && r.date <= to) { f += r.amt; if (r.date.slice(0, 7) === toYm) m += r.amt; }
    });
    return { fytd: f, mtd: m, lastInvoice: last };
  }

  /* Customers whose newest invoice date in the file (positive Taxable only) is later than their Last order, or who have none. */
  function lastOrderUpdates(doc, customers, opts) {
    if (!doc || !Array.isArray(doc.rows)) return [];
    var ix = getIndex(doc, customers, opts && opts.rematch), out = [];
    Object.keys(ix.byCid).forEach(function (id) {
      var max = "";
      ix.byCid[id].forEach(function (r) { if (r.amt > 0 && r.date > max) max = r.date; });
      var c = ix.byId[id];
      if (c && max && (!c.last || max > c.last)) out.push({ id: id, name: c.name, last: max });
    });
    return out;
  }
  /* Blank groups that can be filled: every invoice row of the customer has the same ERP Group, and that name is not just the customer's own name. */
  function groupFills(doc, customers, nameKey, opts) {
    if (!doc || !Array.isArray(doc.rows)) return [];
    var ix = getIndex(doc, customers, opts && opts.rematch), out = [];
    Object.keys(ix.byCid).forEach(function (id) {
      var c = ix.byId[id];
      if (!c || c.group) return;
      var g = null, same = true;
      ix.byCid[id].forEach(function (r) { if (g === null) g = r.group; else if (g !== r.group) same = false; });
      if (!same || !g || g.length > 80) return;
      if (nameKey && nameKey(g) === nameKey(c.name)) return;
      out.push({ id: id, name: c.name, group: g });
    });
    return out;
  }

  var pure = {
    fyOf: fyOf, fyRange: fyRange, prevFy: prevFy, monthsOf: monthsOf, normalizeRows: normalizeRows, revenueStats: revenueStats,
    customerFigures: customerFigures, lastOrderUpdates: lastOrderUpdates, groupFills: groupFills, shiftYear: shiftYear,
    DEFAULT_CONC: DEFAULT_CONC, _resetMemo: function () { memo = { doc: null, customers: null, rematch: null, ix: null }; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = pure;
  if (!hasWin || !window.App || !window.Store || !window.Ui) return;

  /* ====================================================================== browser part ====================================================================== */
  var h = Ui.el;
  var fmt = App.fmt;

  /* ---------- data access ---------- */
  function revDoc() { var d = Store.doc("revenue").get(); return d && Array.isArray(d.rows) ? d : null; }
  function targetsDoc() { var d = Store.doc("targets").get(); return d && typeof d === "object" ? d : null; }
  var matchCache = { customers: null, map: {} };
  function rematch(name) {
    var cs = Store.customers();
    if (matchCache.customers !== cs) matchCache = { customers: cs, map: {} };
    if (!Object.prototype.hasOwnProperty.call(matchCache.map, name)) matchCache.map[name] = Store.matchCustomer(name) || null;
    return matchCache.map[name];
  }
  function has() { return !!revDoc(); }
  function meta() {
    var d = revDoc();
    if (!d || !d.meta) return null;
    var m = d.meta;
    return Object.assign({}, m, { firstDate: m.firstDate || "", lastDate: m.lastDate || "" });
  }
  function ix() { var d = revDoc(); return d ? getIndex(d, Store.customers(), rematch) : null; }
  function fys() { var i = ix(); return i ? i.fys.slice() : []; }

  /* ---------- view state (the Dashboard slice: incRelated is shared with the other dashboard cards and the weekly report) ---------- */
  function viewState() {
    var v = App.view("dash") || {};
    return { fy: typeof v.revFy === "string" ? v.revFy : "", to: v.revTo === "today" ? "today" : "data", inc: v.incRelated === true, all: v.revGroupsAll === true };
  }
  function setViewKeys(o) {
    var v = App.view("dash");
    Object.keys(o).forEach(function (k) { v[k] = o[k]; });
    App.setView("dash", v);
  }
  function viewOpts() { var s = viewState(); return { fy: s.fy || undefined, to: s.to, includeRelated: s.inc }; }

  function stats(o) {
    o = o || {};
    return revenueStats(revDoc(), Store.customers(), targetsDoc(), Store.todayISO(), { fy: o.fy, to: o.to === "today" ? "today" : "data", includeRelated: o.includeRelated === true, rematch: rematch });
  }
  function forCustomer(id, fy) {
    var vs = viewState();
    return customerFigures(revDoc(), Store.customers(), id, Store.todayISO(), { fy: fy || vs.fy || undefined, to: "data", rematch: rematch });
  }

  /* ---------- writes ---------- */
  function writeTargets(fn) {
    var cur = targetsDoc();
    var next = cur ? JSON.parse(JSON.stringify(cur)) : {};
    next.v = 1;
    if (!next.byFy || typeof next.byFy !== "object" || Array.isArray(next.byFy)) next.byFy = {};
    if (!next.settings || typeof next.settings !== "object" || Array.isArray(next.settings)) next.settings = {};
    fn(next);
    return Store.doc("targets").set(next);
  }
  function setConcentration(pct) {
    var n = typeof pct === "number" ? pct : Number(String(pct).trim());
    if (String(pct).trim() === "" || !isFinite(n) || Math.floor(n) !== n || n < CONC_MIN || n > CONC_MAX) {
      return Promise.resolve({ ok: false, error: "Enter a whole number from " + CONC_MIN + " to " + CONC_MAX + ".", field: "concentrationPct" });
    }
    return writeTargets(function (t) { t.settings.concentrationPct = n; });
  }
  function clear() { return Store.doc("revenue").clear(); }

  function lastOrderPending() { var d = revDoc(); return d ? lastOrderUpdates(d, Store.customers(), { rematch: rematch }) : []; }
  function groupFillPending() { var d = revDoc(); return d ? groupFills(d, Store.customers(), Store.nameKey, { rematch: rematch }) : []; }
  function updateLastOrder() {
    var list = lastOrderPending();
    return Promise.all(list.map(function (u) { return Store.saveCustomer(u.id, { last: u.last }); })).then(function (rs) {
      var n = rs.filter(function (r) { return r.ok; }).length;
      return { ok: true, n: n };
    });
  }
  function fillGroups() {
    var list = groupFillPending();
    return Promise.all(list.map(function (u) { return Store.saveCustomer(u.id, { group: u.group }); })).then(function (rs) {
      return { ok: true, n: rs.filter(function (r) { return r.ok; }).length };
    });
  }

  /* ---------- import ---------- */
  var FIELDS = [
    { key: "invoiceNo", label: "Invoice No", required: true, type: "text" },
    { key: "date", label: "Invoice Date", required: true, type: "date" },
    { key: "customer", label: "Customer", required: true, type: "text" },
    { key: "onInvoice", label: "Customer On Invoice", required: false, type: "text" },
    { key: "erpGroup", label: "ERP Group", required: false, type: "text" },
    { key: "taxable", label: "Taxable", required: true, type: "amount" }
  ];
  var INTRO = "Export the INVOICE_REGISTER tab of the Collections sheet as CSV. Revenue uses the Taxable column (before GST and TCS). Invoice Amount is not used. The file is read in this browser only.";
  function cellOf(cells, idx) { return idx == null || cells[idx] == null ? "" : String(cells[idx]).trim(); }
  var SPEC = {
    key: "invoices", label: "INVOICE_REGISTER tab", fields: FIELDS,
    skipRow: function (cells, map) {
      var no = cellOf(cells, map.invoiceNo), cu = cellOf(cells, map.customer);
      if (/^(grand\s*)?total\b/i.test(no) || /^(grand\s*)?total\b/i.test(cu)) return "total row";
      if (!no) return "blank invoice no";
      if (!cellOf(cells, map.date)) return "no invoice date";
      return null;
    },
    warnings: function (items) {
      var out = [], seen = {}, dup = 0, blank = 0;
      items.forEach(function (it) {
        var k = String(it.invoiceNo || "").trim().toLowerCase() + "|" + it.date;
        if (seen[k]) dup++; else seen[k] = 1;
        if (it.taxable == null) blank++;
      });
      if (dup) out.push(dup + " duplicate invoice row" + (dup === 1 ? "" : "s") + " (same Invoice No and date) will be ignored.");
      if (blank) out.push(blank + " row" + (blank === 1 ? " has" : "s have") + " a blank Taxable and count as 0.");
      return out;
    }
  };
  CrmImport.register("invoices", SPEC);

  function resultLine(m) {
    return "Data through " + fmt.date(m.lastDate) + " · " + fmt.int(m.invoices) + " invoices" +
      (m.duplicates ? " · " + m.duplicates + " duplicate" + (m.duplicates === 1 ? "" : "s") + " ignored" : "");
  }
  function onConfirm(res) {
    var n = normalizeRows(res.rows);
    if (!n.rows.length) return Promise.resolve({ ok: false, error: "No invoice rows could be read from this file." });
    var m = Object.assign({}, res.meta, {
      skipped: (res.meta.skipped || []).slice(0, 50), firstDate: n.firstDate, lastDate: n.lastDate, asOf: n.lastDate,
      duplicates: n.duplicates, invoices: n.rows.length
    });
    return Store.doc("revenue").set({ v: 1, meta: m, rows: n.rows }).then(function (r) {
      if (r && r.ok) setTimeout(function () { App.notice(resultLine(m) + ".", "info"); }, 0);
      return r;
    });
  }
  function openImport() {
    CrmImport.open({ title: "Import invoices", intro: INTRO, specs: ["invoices"], customerField: "customer", asOf: false, onConfirm: onConfirm });
  }

  /* ---------- the card ---------- */
  var version = 0;
  var slots = [];
  var pendingFocus = "";
  Store.onChange(function () { version++; });
  function stamp() { return version + (App.hideAmounts() ? "h" : ""); }

  function money(n, short) { return Ui.amountEl(n, "amt", short); }
  function pctText(v) { if (v > 0 && v < 1) return "<1%"; return Math.round(v) + "%"; }
  function segLabel(s) { return s === "" ? "Not set" : s; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function go(filter) { App.show("list", filter); }
  function idsFilter(ids, label, sort) {
    var f = { extra: { kind: "ids", value: ids.slice(), label: label } };
    if (sort) f.sort = sort;
    go(f);
  }
  function btn(text, attrs, onclick) {
    var a = Object.assign({ type: "button" }, attrs || {});
    var b = h("button", a, text);
    if (onclick) b.addEventListener("click", onclick);
    return b;
  }
  function refresh() {
    version++;
    slots = slots.filter(function (s) { return s.isConnected; });
    slots.forEach(draw);
  }
  function activeKey(slot) {
    var a = document.activeElement;
    return a && slot.contains(a) && a.getAttribute ? a.getAttribute("data-fk") || "" : "";
  }
  function restoreKey(slot, key) {
    if (!key) return;
    var t = slot.querySelector('[data-fk="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
    if (t && t.focus) t.focus({ preventScroll: true });
  }

  function section(title, id) {
    var s = h("section", { class: "rev-sec", id: id || null, "aria-label": title }, h("h3", { text: title }));
    return s;
  }
  function hbar(opts) {
    // opts: { name, valueEls, widthPct, fk, label, onclick, disabled, red }
    var b = h("button", { type: "button", class: "hbar", "data-fk": opts.fk || null, "aria-label": opts.label || null, disabled: !!opts.disabled, dataset: opts.data || null }, [
      h("span", { class: "nm", text: opts.name }),
      h("span", { class: "val" }, opts.valueEls),
      h("span", { class: "track" }, h("span", { class: "bar", style: { width: Math.max(0, Math.min(100, opts.widthPct || 0)) + "%" } }))
    ]);
    if (opts.onclick) b.addEventListener("click", opts.onclick);
    return b;
  }
  function amountText(n, short) { return short ? fmt.moneyShort(n) : fmt.money(n); }

  function drawEmpty(card) {
    card.dataset.state = "empty";
    card.appendChild(h("h2", { text: "Revenue (Taxable, before GST)" }));
    card.appendChild(h("p", { class: "rev-empty", id: "revEmpty", text: "No invoice data yet. Export the INVOICE_REGISTER tab of the VFPL Collections Engine sheet as CSV and import it here. Revenue uses the Taxable column (before GST and TCS). Amounts stay in this browser only." }));
    card.appendChild(h("p", null, btn("Import invoices", { class: "btn primary", id: "revImportBtn", "data-fk": "import" }, openImport)));
  }

  function drawControls(card, st, vs, m) {
    var fyList = fys();
    var fySel = h("select", { id: "revFy", "aria-label": "Financial year", "data-fk": "fy" }, fyList.map(function (f) { return h("option", { value: f, text: "FY " + f }); }));
    fySel.value = st.fy;
    fySel.addEventListener("change", function () { pendingFocus = "fy"; setViewKeys({ revFy: fySel.value }); refresh(); });
    var to = h("div", { class: "rev-seg", role: "group", "aria-label": "Measure to" }, [
      h("span", { class: "rev-lbl", text: "Measure to" }),
      btn("Last invoice date", { class: "chip", id: "revToData", "aria-pressed": String(vs.to === "data"), "data-fk": "to-data" }, function () { pendingFocus = "to-data"; setViewKeys({ revTo: "data" }); refresh(); }),
      btn("Today", { class: "chip", id: "revToToday", "aria-pressed": String(vs.to === "today"), "data-fk": "to-today" }, function () { pendingFocus = "to-today"; setViewKeys({ revTo: "today" }); refresh(); })
    ]);
    var sw = btn("Include related parties", { class: "chip", id: "incRelated", "aria-pressed": String(vs.inc), "data-fk": "inc" }, function () {
      pendingFocus = "inc";
      setViewKeys({ incRelated: !viewState().inc });
      refresh();
      if (App.tab() === "dash") {
        // the other Dashboard cards (segment bars) follow the same switch: ask the panel to draw again, then give the focus back
        App.show("dash", undefined, { keepScroll: true });
        slots = slots.filter(function (s) { return s.isConnected; });
        slots.forEach(function (s) { restoreKey(s, "inc"); });
      }
    });
    var hide = btn("Hide amounts", { class: "chip", id: "revHide", "aria-pressed": String(App.hideAmounts()), "data-fk": "hide" }, function () { pendingFocus = "hide"; App.setHideAmounts(!App.hideAmounts()); App.flush(); });
    card.appendChild(h("div", { class: "rev-ctrl" }, [h("label", { class: "rev-fy" }, ["Financial year", fySel]), to, sw, hide]));

    var stale = daysBetween(st.dataThrough, Store.todayISO());
    var line = h("p", { class: "rev-through", id: "revThrough" }, [
      h("strong", { id: "revThroughText", text: "Data through " + fmt.date(st.dataThrough) + " · " + fmt.int(m && m.invoices ? m.invoices : 0) + " invoices" +
        (m && m.duplicates ? " · " + m.duplicates + " duplicate" + (m.duplicates === 1 ? "" : "s") + " ignored" : "") })
    ]);
    if (stale > STALE_DAYS) line.appendChild(h("span", { class: "rev-stale", id: "revStale", text: "Invoice data is " + stale + " days old" }));
    card.appendChild(line);
    var ex = st.excludedRelated;
    if (ex.n > 0 && !vs.inc) {
      var t = "Excludes " + plural(ex.n, "related party", "related parties") + " (" + fmt.money(ex.amount) + ")";
      card.appendChild(h("p", { class: "rev-excl" }, btn(t, { class: "linkbtn", id: "revExcl", "data-fk": "excl", "aria-label": t + ". Show them on the Customers tab." }, function () { go({ extra: { kind: "related" } }); })));
    } else if (ex.n > 0) {
      card.appendChild(h("p", { class: "rev-excl muted", id: "revIncl", text: "Includes " + plural(ex.n, "related party", "related parties") + " (" + fmt.money(ex.amount) + ")" }));
    }
  }

  function drawTiles(card, st) {
    var tiles = h("div", { class: "rev-tiles" });
    var sub1 = "Invoices up to " + fmt.date(st.to);
    var t1 = h("button", { type: "button", class: "rev-tile", id: "revTileFytd", "data-fk": "tile-fytd", disabled: !st.ids.length,
      "aria-label": "FY " + st.fy + " to date " + fmt.money(st.fytd) + ". Show these customers." }, [
      h("span", { class: "k", text: "FY " + st.fy + " to date" }), h("span", { class: "v" }, money(st.fytd)), h("span", { class: "s", text: sub1 })
    ]);
    if (st.prior && st.prior.changePct != null) {
      var c = st.prior.changePct;
      t1.appendChild(h("span", { class: "s", id: "revPrior", text: "vs same period last FY " + (c >= 0 ? "+" : "−") + Math.abs(Math.round(c)) + "%" }));
    }
    t1.addEventListener("click", function () { idsFilter(st.ids, "Invoiced in FY " + st.fy, "revenue"); });
    var t2 = h("button", { type: "button", class: "rev-tile", id: "revTileMtd", "data-fk": "tile-mtd", disabled: !st.mtdIds.length,
      "aria-label": "Month to date, " + st.mtdLabel + ", " + fmt.money(st.mtd) + ". Show these customers." }, [
      h("span", { class: "k", text: "Month to date (" + st.mtdLabel + ")" }), h("span", { class: "v" }, money(st.mtd)), h("span", { class: "s", text: "Up to " + fmt.date(st.to) })
    ]);
    t2.addEventListener("click", function () { idsFilter(st.mtdIds, "Invoiced in " + st.mtdLabel); });
    tiles.appendChild(t1); tiles.appendChild(t2);
    card.appendChild(tiles);
  }

  function drawTrend(card, st) {
    var sec = section("Monthly trend (April to March)", "revTrendSec");
    var max = 0;
    st.months.forEach(function (m) { max = Math.max(max, m.amount, m.prior || 0); });
    var grid = h("div", { class: "vbars", id: "revTrend", role: "group", "aria-label": "Revenue by month" });
    st.months.forEach(function (m) {
      var label = m.full + ": " + fmt.money(m.amount) + (m.prior != null ? ", last FY " + fmt.money(m.prior) : "") + (m.ids.length ? ", " + plural(m.ids.length, "customer", "customers") : "");
      var col = h("span", { class: "col" }, h("span", { class: "fill", style: { height: (max > 0 ? Math.max(0, m.amount) / max * 100 : 0) + "%" } }));
      if (m.prior != null && max > 0) col.appendChild(h("span", { class: "prior", style: { bottom: (Math.max(0, m.prior) / max * 100) + "%" } }));
      var b = h("button", { type: "button", class: "vbar", dataset: { ym: m.ym }, "data-fk": "bar-" + m.ym, disabled: !m.ids.length, "aria-label": label }, [
        h("span", { class: "amt" }, m.amount ? money(m.amount, true) : ""),
        col,
        h("span", { class: "lbl" }, [h("span", { class: "m-full", text: m.label }), h("span", { class: "m-short", text: m.label.charAt(0) })])
      ]);
      b.addEventListener("click", function () { idsFilter(m.ids, "Invoiced in " + m.full); });
      grid.appendChild(b);
    });
    sec.appendChild(grid);
    if (st.prior) sec.appendChild(h("p", { class: "note rev-legend" }, [h("span", { class: "key-prior" }), " Last FY (same period)"]));
    var det = h("details", { class: "rev-months" }, [h("summary", { text: "Monthly amounts" })]);
    var ul = h("ul");
    st.months.forEach(function (m) {
      var li = h("li");
      li.appendChild(h("span", { text: m.full + ": " }));
      li.appendChild(money(m.amount));
      if (m.prior != null) { li.appendChild(h("span", { class: "muted", text: " · last FY " })); li.appendChild(money(m.prior)); }
      ul.appendChild(li);
    });
    det.appendChild(ul);
    sec.appendChild(det);
    card.appendChild(sec);
  }

  function drawTop(parent, st) {
    var sec = section("Top 10 customers", "revTop10Sec");
    if (!st.top10.length) { sec.appendChild(h("p", { class: "muted", text: "No matched customers have revenue in this period." })); parent.appendChild(sec); return; }
    var top = st.top10[0].amount, list = h("div", { class: "rev-list", id: "revTop10" });
    st.top10.forEach(function (e, i) {
      list.appendChild(hbar({
        name: (i + 1) + ". " + e.name, valueEls: [money(e.amount, true), " · " + pctText(e.share)], widthPct: top > 0 ? e.amount / top * 100 : 0,
        fk: "top-" + e.id, data: { id: e.id }, label: e.name + ", " + fmt.money(e.amount) + ", " + pctText(e.share) + " of revenue",
        onclick: function () { idsFilter([e.id], e.name); }
      }));
    });
    sec.appendChild(list);
    sec.appendChild(btn("Show these " + st.top10.length, { class: "btn-sm", id: "revTop10All", "data-fk": "top-all" }, function () { idsFilter(st.top10.map(function (e) { return e.id; }), "Top " + st.top10.length + " customers"); }));
    parent.appendChild(sec);
  }

  function drawConcentration(parent, st) {
    var sec = section("Concentration", "revConcSec");
    var c = st.concentration;
    var t1 = btn("Top customer " + pctText(st.top1Share), { class: "linkbtn big", id: "revTop1Btn", "data-fk": "top1", disabled: !st.top10.length }, function () { idsFilter(st.top10.slice(0, 1).map(function (e) { return e.id; }), st.top10[0].name); });
    var t5 = btn("Top 5 " + pctText(st.top5Share), { class: "linkbtn big", id: "revTop5Btn", "data-fk": "top5", disabled: !st.top10.length }, function () { idsFilter(st.top10.slice(0, 5).map(function (e) { return e.id; }), "Top " + Math.min(5, st.top10.length) + " customers"); });
    sec.appendChild(h("p", { class: "rev-conc", id: "revConc" }, [t1, " · ", t5]));
    if (c.risk) sec.appendChild(h("p", { class: "rev-risk", id: "revRisk", role: "status", text: "Concentration risk: " + c.name + " is " + pctText(c.share) + " of revenue (limit " + c.thresholdPct + "%)" }));
    else sec.appendChild(h("p", { class: "muted", id: "revRisk", text: "Top customer below the " + c.thresholdPct + "% limit" }));
    var inp = h("input", { type: "number", id: "concPct", min: String(CONC_MIN), max: String(CONC_MAX), step: "1", value: String(c.thresholdPct), "data-fk": "conc", "aria-label": "Concentration limit in percent" });
    var err = h("p", { class: "form-err", id: "concErr", role: "alert", hidden: true });
    inp.addEventListener("change", function () {
      setConcentration(inp.value).then(function (r) {
        if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
        err.hidden = true; pendingFocus = "conc"; refresh();
      });
    });
    sec.appendChild(h("label", { class: "rev-conc-in" }, ["Risk limit for the top customer (%)", inp]));
    sec.appendChild(err);
    parent.appendChild(sec);
  }

  function drawShares(parent, st, vs) {
    var seg = section("Share by segment", "revSegSec");
    var segTotal = st.bySegment.reduce(function (s, e) { return s + (e.segment === "" ? 0 : e.amount); }, 0);
    var smax = st.bySegment.reduce(function (m, e) { return Math.max(m, e.amount); }, 0);
    var list = h("div", { class: "rev-list", id: "revSegments" });
    st.bySegment.forEach(function (e) {
      list.appendChild(hbar({
        name: segLabel(e.segment), valueEls: [money(e.amount, true), " · " + pctText(e.share)], widthPct: smax > 0 ? e.amount / smax * 100 : 0,
        fk: "seg-" + (e.segment || "none"), data: { segment: e.segment || "none" }, label: segLabel(e.segment) + ", " + fmt.money(e.amount) + ", " + pctText(e.share) + " of revenue. Show these customers.",
        onclick: function () { go({ segment: e.segment || "none" }); }
      }));
    });
    seg.appendChild(list);
    if (!segTotal) seg.appendChild(h("p", { class: "note", id: "revSegHint", text: "Set segments on the Customers tab (Edit) to fill this chart." }));
    parent.appendChild(seg);

    var grp = section("Share by ERP group", "revGrpSec");
    var gmax = st.byGroup.reduce(function (m, e) { return Math.max(m, e.amount); }, 0);
    var glist = h("div", { class: "rev-list", id: "revGroups" });
    var shown = vs.all ? st.byGroup : st.byGroup.slice(0, 8);
    shown.forEach(function (e) {
      var nm = e.group === "" ? "No ERP group" : e.group;
      glist.appendChild(hbar({
        name: nm, valueEls: [money(e.amount, true), " · " + pctText(e.share)], widthPct: gmax > 0 ? e.amount / gmax * 100 : 0, disabled: !e.ids.length,
        fk: "grp-" + (e.group || "none"), data: { group: e.group || "none" }, label: nm + ", " + fmt.money(e.amount) + ", " + pctText(e.share) + " of revenue",
        onclick: function () { idsFilter(e.ids, "ERP Group: " + nm); }
      }));
    });
    grp.appendChild(glist);
    if (st.byGroup.length > 8) {
      grp.appendChild(btn(vs.all ? "Show top 8" : "Show all " + st.byGroup.length, { class: "btn-sm", id: "revGroupsMore", "data-fk": "grp-more" }, function () { pendingFocus = "grp-more"; setViewKeys({ revGroupsAll: !viewState().all }); refresh(); }));
    }
    parent.appendChild(grp);
  }

  function drawTargets(card, st) {
    var sec = section("Target vs actual", "revTargets");
    var t = st.targets;
    var setBtn = btn("Set targets", { class: "btn-sm", id: "revSetTargets", "data-fk": "set-targets" }, openTargets);
    if (!t) {
      sec.appendChild(h("p", { id: "revTargetText", class: "muted", text: "No targets set for FY " + st.fy + "." }));
      sec.appendChild(setBtn);
      card.appendChild(sec);
      return;
    }
    sec.appendChild(h("p", { id: "revTargetText", class: "rev-target-text", text: "Targets FY " + st.fy + ": " + fmt.money(t.actual) + " of " + fmt.money(t.total) + " (" + pctText(t.pct) + ")" }));
    if (t.basis === "segments") sec.appendChild(h("p", { class: "note", id: "revBasis", text: "Based on segment targets" }));
    else sec.appendChild(h("p", { class: "note", id: "revBasis", text: "Based on customer targets (" + plural(t.customers.length, "customer", "customers") + ")" }));
    var prog = h("div", { class: "prog", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(Math.min(100, t.pct))), "aria-label": "Share of the annual target reached" }, [
      h("span", { class: "track" }, h("span", { class: "fill", style: { width: Math.min(100, Math.max(0, t.pct)) + "%" } })),
      h("span", { class: "pace", style: { left: Math.min(100, t.pacePct) + "%" }, "aria-hidden": "true" })
    ]);
    sec.appendChild(prog);
    var behindWord = t.behind
      ? h("p", { class: "rev-behind", id: "revPace", role: "status", text: "Behind pace: " + Math.round(t.pct) + "% of target, " + Math.round(t.pacePct) + "% expected" })
      : h("p", { class: "rev-on", id: "revPace", role: "status", text: "On pace" });
    sec.appendChild(behindWord);
    sec.appendChild(h("p", { class: "note", text: "The orange mark is where the year should be by " + fmt.date(st.to) + " (" + Math.round(t.pacePct) + "% of the financial year)." }));

    var rows = (t.basis === "customers" ? t.customers : t.segments).filter(function (r) { return r.behind; })
      .sort(function (a, b) { return (a.pct - t.pacePct) - (b.pct - t.pacePct); });
    var unit = t.basis === "customers" ? ["customer", "customers"] : ["segment", "segments"];
    if (rows.length) {
      var list = h("div", { class: "rev-list", id: "revBehindList" });
      rows.slice(0, 5).forEach(function (r) {
        var nm = t.basis === "customers" ? r.name : segLabel(r.segment);
        list.appendChild(hbar({
          name: nm, valueEls: [pctText(r.pct) + " of target · ", h("span", { class: "rev-behind-w", text: "Behind pace" })], widthPct: Math.min(100, r.pct),
          fk: "behind-" + (r.id || r.segment), data: { id: r.id || "", segment: r.segment || "" }, label: nm + ", " + pctText(r.pct) + " of target, behind pace",
          onclick: function () { if (t.basis === "customers") idsFilter([r.id], r.name); else go({ segment: r.segment }); }
        }));
      });
      sec.appendChild(list);
      var behindIds = [];
      if (t.basis === "customers") behindIds = rows.map(function (r) { return r.id; });
      else rows.forEach(function (r) { st.bySegment.forEach(function (s) { if (s.segment === r.segment) behindIds = behindIds.concat(s.ids); }); });
      sec.appendChild(btn("Behind pace (" + plural(rows.length, unit[0], unit[1]) + ")", { class: "btn-sm", id: "revBehindBtn", "data-fk": "behind-all", disabled: !behindIds.length }, function () { idsFilter(behindIds, "Behind target pace"); }));
    } else {
      sec.appendChild(h("p", { class: "muted", id: "revBehindNone", text: "No " + unit[0] + " is behind pace." }));
    }
    sec.appendChild(setBtn);
    card.appendChild(sec);
  }

  function drawFromFile(card, st) {
    var upd = lastOrderPending(), fill = groupFillPending();
    var sec = h("section", { class: "rev-sec rev-file", id: "revFromFile", "aria-label": "Use this file" });
    if (upd.length) {
      sec.appendChild(btn("Update Last order for " + plural(upd.length, "customer", "customers") + " from this file", { class: "btn", id: "revUpdateLast", "data-fk": "upd-last" }, function () {
        updateLastOrder().then(function (r) {
          App.notice("Updated Last order for " + plural(r.n, "customer", "customers") + " from the invoice file.", "info");
          App.announce("Updated Last order for " + plural(r.n, "customer", "customers") + ".");
          pendingFocus = ""; refresh();
        });
      }));
    }
    if (fill.length) {
      sec.appendChild(btn("Fill " + plural(fill.length, "blank group", "blank groups") + " from ERP Group", { class: "btn", id: "revFillGroups", "data-fk": "fill-groups" }, function () {
        fillGroups().then(function (r) {
          App.notice("Filled " + plural(r.n, "blank group", "blank groups") + " from the ERP Group column.", "info");
          App.announce("Filled " + plural(r.n, "group", "groups") + ".");
          pendingFocus = ""; refresh();
        });
      }));
    }
    if (sec.childNodes.length) card.appendChild(sec);
  }

  function drawUnmatched(card, st) {
    var u = st.unmatched;
    if (!u.n) return;
    var det = h("details", { class: "rev-unm", id: "revUnmatched" }, [
      h("summary", { text: "Includes " + fmt.money(u.amount) + " from " + plural(u.n, "name", "names") + " not in the CRM" })
    ]);
    det.appendChild(h("p", { class: "note", text: "These names cannot be matched to a customer, so they are counted in the totals but not in the top 10 or the targets. They also cannot be told apart as related parties, so they stay included." }));
    var ul = h("ul");
    u.names.slice(0, 20).forEach(function (n) {
      var li = h("li"); li.appendChild(h("span", { text: n.name + ": " })); li.appendChild(money(n.amount)); ul.appendChild(li);
    });
    if (u.names.length > 20) ul.appendChild(h("li", { class: "muted", text: "+" + (u.names.length - 20) + " more" }));
    det.appendChild(ul);
    det.appendChild(btn("Import again to match them", { class: "btn-sm", "data-fk": "unm-import" }, openImport));
    card.appendChild(det);
  }

  function drawData(card, doc) {
    card.dataset.state = "data";
    var vs = viewState();
    var st = stats({ fy: vs.fy || undefined, to: vs.to, includeRelated: vs.inc });
    var m = meta();
    card.appendChild(h("h2", { text: "Revenue (Taxable, before GST)" }));
    card.appendChild(h("p", { class: "note", id: "revBasisNote", text: "Revenue uses the Taxable column (before GST and TCS). Invoice Amount is not used." }));
    drawControls(card, st, vs, m);
    drawTiles(card, st);
    drawTrend(card, st);
    var two = h("div", { class: "rev-grid" });
    drawTop(two, st);
    drawConcentration(two, st);
    card.appendChild(two);
    var two2 = h("div", { class: "rev-grid" });
    drawShares(two2, st, vs);
    card.appendChild(two2);
    drawTargets(card, st);
    drawFromFile(card, st);
    drawUnmatched(card, st);
    var foot = h("div", { class: "rev-foot" }, [
      btn("Import invoices again", { class: "btn-sm", id: "revImportBtn", "data-fk": "import" }, openImport),
      btn("Clear invoice data", { class: "btn-sm", id: "revClearBtn", "data-fk": "clear" }, function () {
        if (!confirm("Remove all imported invoice data from this browser?")) return;
        clear().then(function () { App.announce("Invoice data cleared."); refresh(); });
      })
    ]);
    card.appendChild(foot);
  }

  function draw(slot) {
    var key = pendingFocus || activeKey(slot);
    pendingFocus = "";
    Ui.clear(slot);
    var card = h("div", { class: "rev", id: "revCard" });
    slot.appendChild(card);
    try {
      if (has()) drawData(card); else drawEmpty(card);
    } catch (e) {
      if (typeof console !== "undefined") console.warn("Revenue card failed", e && e.message ? e.message : e);
      Ui.clear(card);
      card.appendChild(h("p", { class: "muted", text: "The revenue card had a problem. Reload the page." }));
    }
    slot._revStamp = stamp();
    restoreKey(slot, key);
  }

  /* Builds the whole Dashboard revenue card into slotEl (A3 provides the slot). Safe to call on every Dashboard render. */
  function renderCard(slot) {
    if (!slot || !slot.appendChild) return;
    if (slots.indexOf(slot) === -1) slots.push(slot);
    slots = slots.filter(function (s) { return s.isConnected || s === slot; });
    draw(slot);
  }
  App.onData(function () {
    slots = slots.filter(function (s) { return s.isConnected; });
    slots.forEach(function (s) { if (s._revStamp !== stamp()) draw(s); });
  });

  /* ---------- targets dialog ---------- */
  var dlg = null, T = {};
  var draft = {};            // fy -> { c: { id: "text" }, s: { segment: "text" } }
  function plainNum(n) { return String(Math.round(n * 100) / 100); }
  function draftFor(fy) {
    if (draft[fy]) return draft[fy];
    var t = targetsDoc(), f = t && t.byFy && t.byFy[fy] ? t.byFy[fy] : {}, d = { c: {}, s: {} };
    Object.keys(f.customers || {}).forEach(function (id) { var v = posNumber(f.customers[id]); if (v) d.c[id] = plainNum(v); });
    Object.keys(f.segments || {}).forEach(function (s) { var v = posNumber(f.segments[s]); if (v) d.s[s] = plainNum(v); });
    draft[fy] = d;
    return d;
  }
  function buildTargets() {
    if (dlg) return;
    T.fy = h("select", { id: "tgtFy", "aria-label": "Financial year" });
    T.filter = h("input", { type: "search", id: "tgtFilter", placeholder: "Find a customer", "aria-label": "Find a customer", autocomplete: "off" });
    T.cust = h("div", { class: "tgt-list", id: "tgtCust" });
    T.seg = h("div", { class: "tgt-list", id: "tgtSeg" });
    T.err = h("p", { class: "form-err", id: "tgtErr", role: "alert", hidden: true });
    T.save = h("button", { type: "submit", class: "btn primary", id: "tgtSave", text: "Save targets" });
    T.cancel = h("button", { type: "button", class: "btn", id: "tgtCancel", text: "Cancel" });
    var body = h("div", { class: "dlg-body" }, [
      h("p", { class: "note", text: "Targets are kept in this browser and in the private backup. They are never saved to git. Type the annual target in rupees; leave a row empty for no target." }),
      h("p", { class: "note", text: "Customer targets are used before segment targets. Related parties count only when \"Include related parties\" is on." }),
      h("label", null, ["Financial year", T.fy]),
      h("h3", { text: "By customer" }),
      h("label", null, ["Find a customer", T.filter]),
      T.cust,
      h("h3", { text: "By segment" }),
      T.seg
    ]);
    var form = h("form", { id: "tgtForm", method: "dialog" }, [body, T.err, h("div", { class: "actions tgt-foot" }, [T.cancel, T.save])]);
    dlg = h("dialog", { id: "targetsDlg", "aria-labelledby": "tgtTitle" }, [h("div", { class: "dlg-head", id: "tgtTitle", text: "Revenue targets" }), form]);
    document.body.appendChild(dlg);
    T.cancel.addEventListener("click", function () { dlg.close(); });
    T.fy.addEventListener("change", function () { fillTargets(T.fy.value); });
    T.filter.addEventListener("input", applyFilter);
    form.addEventListener("submit", function (e) { e.preventDefault(); saveTargets(); });
  }
  function targetRow(name, actual, value, label, onInput, extra) {
    var inp = h("input", { type: "text", inputmode: "decimal", placeholder: "No target", value: value || "", "aria-label": "Annual target for " + label, autocomplete: "off" });
    inp.addEventListener("input", function () { onInput(inp.value); });
    var nm = h("span", { class: "nm", text: name });
    if (extra) nm.appendChild(h("span", { class: "tag-lite", text: extra }));
    return h("div", { class: "tgt-row", dataset: { name: name.toLowerCase() } }, [
      nm, h("span", { class: "act" }, ["FY to date ", money(actual)]), inp
    ]);
  }
  function fillTargets(fy) {
    var d = draftFor(fy), inData = fys().indexOf(fy) !== -1;
    Ui.clear(T.cust); Ui.clear(T.seg);
    Store.customers().slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); }).forEach(function (c) {
      var f = inData ? forCustomer(c.id, fy) : null;
      var row = targetRow(c.name, f ? f.fytd : 0, d.c[c.id], c.name, function (v) { if (v.trim()) d.c[c.id] = v; else delete d.c[c.id]; }, c.relatedParty ? "Related party" : "");
      row.dataset.id = c.id;
      T.cust.appendChild(row);
    });
    var s = inData ? stats({ fy: fy, to: viewState().to, includeRelated: true }) : null;
    SEGMENTS.forEach(function (sg) {
      var seg = s ? s.bySegment.filter(function (e) { return e.segment === sg; })[0] : null;
      var row = targetRow(sg, seg ? seg.amount : 0, d.s[sg], "segment " + sg, function (v) { if (v.trim()) d.s[sg] = v; else delete d.s[sg]; });
      row.dataset.segment = sg;
      T.seg.appendChild(row);
    });
    applyFilter();
  }
  function applyFilter() {
    var q = T.filter.value.trim().toLowerCase();
    Array.prototype.forEach.call(T.cust.children, function (r) { r.hidden = !!q && r.dataset.name.indexOf(q) === -1; });
  }
  function shortName(n) { return n.length > 30 ? n.slice(0, 30) + "…" : n; }
  function saveTargets() {
    var parsed = {}, fyKeys = Object.keys(draft), err = "", errInput = null;
    var nameOf = {};
    Store.customers().forEach(function (c) { nameOf[c.id] = c.name; });
    function parseOne(text, label, input) {
      var t = String(text || "").trim();
      if (!t) return 0;
      var p = CrmCsv.parseAmount(t);
      if (!p.ok || p.value == null) { if (!err) { err = "Row " + shortName(label) + ": target is not a number."; errInput = input; } return 0; }
      if (p.value < 0) { if (!err) { err = "Row " + shortName(label) + ": target can't be negative."; errInput = input; } return 0; }
      if (p.value > 1e12) { if (!err) { err = "Row " + shortName(label) + ": target is too large."; errInput = input; } return 0; }
      return p.value;
    }
    fyKeys.forEach(function (fy) {
      var d = draft[fy], out = { customers: {}, segments: {} };
      Object.keys(d.c).forEach(function (id) {
        var row = T.cust.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] input');
        var v = parseOne(d.c[id], nameOf[id] || id, fy === T.fy.value ? row : null);
        if (v > 0) out.customers[id] = v;
      });
      Object.keys(d.s).forEach(function (sg) {
        var row = T.seg.querySelector('[data-segment="' + sg + '"] input');
        var v = parseOne(d.s[sg], sg, fy === T.fy.value ? row : null);
        if (v > 0) out.segments[sg] = v;
      });
      parsed[fy] = out;
    });
    if (err) {
      T.err.textContent = (fyKeys.length > 1 ? err + " (check each financial year you changed)" : err); T.err.hidden = false;
      if (errInput && errInput.focus) errInput.focus();
      return;
    }
    T.err.hidden = true;
    writeTargets(function (t) {
      Object.keys(parsed).forEach(function (fy) {
        var o = parsed[fy];
        if (Object.keys(o.customers).length || Object.keys(o.segments).length) t.byFy[fy] = o; else delete t.byFy[fy];
      });
    }).then(function (r) {
      if (!r.ok) { T.err.textContent = r.error || "Targets could not be saved."; T.err.hidden = false; return; }
      draft = {};
      dlg.close();
      App.announce("Targets saved.");
      refresh();
    });
  }
  function openTargets() {
    buildTargets();
    draft = {};
    T.err.hidden = true;
    T.filter.value = "";
    var curFy = fyOf(Store.todayISO());
    var list = fys();
    if (list.indexOf(curFy) === -1) list.unshift(curFy);
    var t = targetsDoc();
    Object.keys((t && t.byFy) || {}).forEach(function (f) { if (/^\d{4}-\d{2}$/.test(f) && list.indexOf(f) === -1) list.push(f); });
    list.sort().reverse();
    Ui.clear(T.fy);
    list.forEach(function (f) { T.fy.appendChild(h("option", { value: f, text: "FY " + f })); });
    var st = stats({ fy: viewState().fy || undefined, to: viewState().to, includeRelated: true });
    T.fy.value = st && list.indexOf(st.fy) !== -1 ? st.fy : list[0];
    fillTargets(T.fy.value);
    App.openDialog(dlg, document.activeElement);
  }

  function setIncludeRelated(b) { setViewKeys({ incRelated: b === true }); refresh(); return Promise.resolve({ ok: true }); }

  window.CrmRevenue = {
    has: has, meta: meta, openImport: openImport, clear: clear,
    fyOf: fyOf, fyRange: fyRange, fys: fys, forCustomer: forCustomer, stats: stats,
    openTargets: openTargets, setConcentration: setConcentration, renderCard: renderCard,
    /* additive helpers (not in the frozen contract): the persisted Dashboard choices, and the two explicit "use this file" actions */
    viewOpts: viewOpts, setIncludeRelated: setIncludeRelated,
    lastOrderPending: lastOrderPending, updateLastOrder: updateLastOrder, groupFillPending: groupFillPending, fillGroups: fillGroups
  };
})();
