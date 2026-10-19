/* Money: import of the Collections AGING and LIVE_POSITION tabs, per-customer amounts and the stats() contract (design 2.4, 4.5, 5.3).
   Defines window.CrmMoney = { has, meta, forCustomer, stats, openImport, clear, renderCard }.
   renderCard(slotEl) is an additive helper: a complete, self-contained money card (Data as of, stale warning, Hide amounts,
   outstanding, overdue, aging bar with legend, top 5, unmatched names with manual match, Clear). The Dashboard may host it or build its own.
   Pure functions (moneyStats, agingWarnings, buildRows) are also module.exports for Node unit tests.
   Amounts live only in localStorage (Store.doc("money")); they are never in customers.json or the backup. Owned by A5. */
(function () {
  "use strict";

  var hasWindow = typeof window !== "undefined";
  var StoreRef = hasWindow ? window.Store : require("./store.js");
  var BUCKETS = ["b1_30", "b31_60", "b61_90", "b90"];
  var BUCKET_LABEL = { b1_30: "1–30 days", b31_60: "31–60 days", b61_90: "61–90 days", b90: "Over 90 days" };
  var STALE_DAYS = 7;
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* ---------- header specs (exact headers from the Collections sheet; matching ignores case, spaces and punctuation) ---------- */
  var lastErpHeader = "";
  // "ERP 15-Oct": the date in the header changes, so a pattern matches it. The matched header is remembered to read the base date.
  var ERP_BASE = /^ERP \d{1,2}-[A-Za-z]{3}(-\d{2,4})?$/;
  var erpTest = ERP_BASE.test;
  ERP_BASE.test = function (s) { var r = erpTest.call(ERP_BASE, s); if (r) lastErpHeader = String(s).trim(); return r; };

  function skipTotal(cells, map) {
    var n = String(cells[map.customer] == null ? "" : cells[map.customer]).trim();
    if (!n) return "blank name";
    return /^(grand\s*)?total\b/i.test(n) ? "total row" : null;
  }
  var AGING_FIELDS = [
    { key: "customer", label: "Customer", required: true, type: "text" },
    { key: "termsDays", label: "Printed Terms Days", required: false, type: "int" },
    { key: "erpTotal", label: "ERP Total", required: true, type: "amount" },
    { key: "erpNotDue", label: "ERP Not Due", required: false, type: "amount" },
    { key: "overdue", label: "ERP Overdue", required: true, type: "amount" },
    { key: "modelNotDue", label: "Model Not Due", required: false, type: "amount" },
    { key: "b1_30", label: "1-30", required: true, type: "amount", synonyms: ["1-30 days"] },
    { key: "b31_60", label: "31-60", required: true, type: "amount", synonyms: ["31-60 days"] },
    { key: "b61_90", label: "61-90", required: true, type: "amount", synonyms: ["61-90 days"] },
    { key: "b90", label: ">90", required: true, type: "amount", synonyms: [">90 days", "90+", "Over 90"] },
    { key: "preApril", label: "Pre April", required: false, type: "amount" },
    { key: "creditBalance", label: "Credit Balance", required: false, type: "amount" },
    { key: "modelOverdue", label: "Model Overdue", required: false, type: "amount" },
    { key: "asOn", label: "As On", required: false, type: "date" }
  ];
  var LIVE_FIELDS = [
    { key: "customer", label: "Customer", required: true, type: "text" },
    { key: "erpBase", label: "ERP <date> (for example ERP 15-Oct)", required: true, type: "amount", pattern: ERP_BASE },
    { key: "invoicesSince", label: "Invoices Since", required: false, type: "amount" },
    { key: "receiptsSince", label: "Receipts Since", required: false, type: "amount" },
    { key: "outstanding", label: "Estimated Live", required: true, type: "amount" },
    { key: "asOn", label: "As On", required: false, type: "date" }
  ];

  /* ---------- pure helpers ---------- */
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function b90Of(r) { return num(r.b90) + num(r.preApril); }      // ">90 days" includes Pre April (open question 2)
  function dbetween(a, b) { return StoreRef.daysBetween(a, b); }
  function byIdMap(customers) { var m = {}; (customers || []).forEach(function (c) { m[c.id] = c; }); return m; }

  /* Where a row's amount goes: { ids, group } or null when the row is unmatched. */
  function targetOf(row, byId) {
    if (row.customerId && byId[row.customerId]) return { ids: [row.customerId], group: false };
    if (Array.isArray(row.groupIds)) {
      var ids = row.groupIds.filter(function (id) { return byId[id]; });
      if (ids.length) return { ids: ids, group: true };
    }
    return null;
  }

  /* Per-customer totals. Group rows (matched by ERP Group) give the whole amount to every member, marked shared. */
  function perCustomer(doc, byId) {
    var per = {};
    function acc(id) {
      return per[id] || (per[id] = { hasAging: false, hasLive: false, outstanding: 0, overdue: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90Raw: 0, preApril: 0, creditBalance: 0, shared: null });
    }
    if (doc.aging) doc.aging.rows.forEach(function (r) {
      var t = targetOf(r, byId);
      if (!t) return;
      t.ids.forEach(function (id) {
        var a = acc(id);
        a.hasAging = true;
        a.overdue += num(r.overdue); a.b1_30 += num(r.b1_30); a.b31_60 += num(r.b31_60); a.b61_90 += num(r.b61_90);
        a.b90Raw += num(r.b90); a.preApril += num(r.preApril); a.creditBalance += num(r.creditBalance);
        if (t.group) a.shared = { groupName: r.sourceName, n: t.ids.length };
      });
    });
    if (doc.live) doc.live.rows.forEach(function (r) {
      var t = targetOf(r, byId);
      if (!t) return;
      t.ids.forEach(function (id) {
        var a = acc(id);
        a.hasLive = true;
        a.outstanding += num(r.outstanding);
        if (t.group && !a.shared) a.shared = { groupName: r.sourceName, n: t.ids.length };
      });
    });
    return per;
  }
  function shapeCustomer(a) {
    var g = a.hasAging;
    return {
      outstanding: a.hasLive ? round2(a.outstanding) : null,
      overdue: g ? round2(a.overdue) : null,
      b1_30: g ? round2(a.b1_30) : null, b31_60: g ? round2(a.b31_60) : null, b61_90: g ? round2(a.b61_90) : null,
      b90: g ? round2(a.b90Raw + a.preApril) : null,        // already includes Pre April: do not add preApril again
      b90Raw: g ? round2(a.b90Raw) : null,
      preApril: g ? round2(a.preApril) : null,
      creditBalance: g ? round2(a.creditBalance) : null,
      shared: a.shared
    };
  }

  /* moneyStats(doc, customers, today): the CrmMoney.stats() shape (design 4.5). Totals use EVERY row (matched or not);
     per-customer counts and the top 5 use matched rows only. Bucket "n" counts customers (a group row counts each member). */
  function moneyStats(doc, customers, today) {
    if (!doc || !(doc.aging || doc.live)) return null;
    var byId = byIdMap(customers), per = perCustomer(doc, byId);
    var ag = doc.aging ? doc.aging.rows : null, lv = doc.live ? doc.live.rows : null;
    var sum = function (rows, f) { return round2(rows.reduce(function (s, r) { return s + f(r); }, 0)); };

    var outstanding = lv ? sum(lv, function (r) { return num(r.outstanding); }) : null;
    var overdue = ag ? sum(ag, function (r) { return num(r.overdue); }) : null;
    var overduePct = outstanding != null && overdue != null && outstanding > 0 ? Math.round(overdue / outstanding * 1000) / 10 : null;

    var buckets = {};
    BUCKETS.forEach(function (k) {
      var amount = ag ? sum(ag, function (r) { return k === "b90" ? b90Of(r) : num(r[k]); }) : null, n = 0;
      Object.keys(per).forEach(function (id) {
        var a = per[id];
        if (a.hasAging && (k === "b90" ? a.b90Raw + a.preApril : a[k]) > 0) n++;
      });
      buckets[k] = { amount: amount, n: ag ? n : 0 };
    });
    buckets.b90.preApril = ag ? sum(ag, function (r) { return num(r.preApril); }) : null;

    // top 5 by overdue: a customer's rows are added together; a group row is one entry
    var entries = {}, order = [];
    if (ag) ag.forEach(function (r) {
      var t = targetOf(r, byId), key;
      if (!t) return;
      key = t.group ? "g:" + r.sourceName : "c:" + t.ids[0];
      var e = entries[key];
      if (!e) {
        e = entries[key] = { id: t.group ? null : t.ids[0], ids: t.ids, group: t.group, overdue: 0, b90: 0,
          name: t.group ? r.sourceName + " (group of " + t.ids.length + ")" : byId[t.ids[0]].name };
        order.push(key);
      }
      e.overdue += num(r.overdue); e.b90 += b90Of(r);
    });
    var top5 = order.map(function (k) { return entries[k]; })
      .filter(function (e) { return e.overdue > 0; })
      .sort(function (a, b) { return b.overdue - a.overdue || a.name.localeCompare(b.name); })
      .slice(0, 5)
      .map(function (e) { return { id: e.id, ids: e.ids, name: e.name, group: e.group, overdue: round2(e.overdue), b90: round2(e.b90) }; });

    // unmatched names (both files): amount = overdue when AGING is imported, else outstanding
    var un = {}, unOrder = [];
    function addUn(r, field, which) {
      if (targetOf(r, byId)) return;
      var e = un[r.sourceName] || (un[r.sourceName] = { sourceName: r.sourceName, overdue: ag ? 0 : null, outstanding: lv ? 0 : null, ignored: !!r.ignored });
      if (unOrder.indexOf(r.sourceName) === -1) unOrder.push(r.sourceName);
      e[which] = (e[which] || 0) + num(r[field]);
    }
    if (ag) ag.forEach(function (r) { addUn(r, "overdue", "overdue"); });
    if (lv) lv.forEach(function (r) { addUn(r, "outstanding", "outstanding"); });
    var list = unOrder.map(function (n) {
      var e = un[n];
      return { sourceName: n, overdue: e.overdue == null ? null : round2(e.overdue), outstanding: e.outstanding == null ? null : round2(e.outstanding), ignored: e.ignored };
    });
    var unAmount = list.reduce(function (s, e) { return s + (ag ? num(e.overdue) : num(e.outstanding)); }, 0);

    var asOfAging = doc.aging && doc.aging.meta ? doc.aging.meta.asOf : "";
    var asOfLive = doc.live && doc.live.meta ? doc.live.meta.asOf : "";
    var present = [asOfAging, asOfLive].filter(Boolean).sort();
    var asOf = present.length ? present[0] : "";            // the OLDER of the two: the figure is only as fresh as its oldest part
    var stale = !!asOf && !!today && dbetween(asOf, today) > STALE_DAYS;

    return {
      asOf: asOf, asOfAging: asOfAging || null, asOfLive: asOfLive || null, stale: stale,
      outstanding: outstanding, overdue: overdue, overduePct: overduePct, buckets: buckets, top5: top5,
      unmatched: { n: list.length, amount: round2(unAmount), list: list }
    };
  }

  /* Soft check shown in the import dialog (a warning, never a block). */
  function agingWarnings(items, fm) {
    fm = fm || function (n) { return "₹" + Math.round(n).toLocaleString("en-IN"); };
    var out = [];
    function check(label, field) {
      var bad = [];
      items.forEach(function (it) {
        if (it[field] == null) return;
        var s = num(it.b1_30) + num(it.b31_60) + num(it.b61_90) + num(it.b90) + num(it.preApril);
        if (Math.abs(s - num(it[field])) > 1) bad.push({ row: it.row, s: s, v: num(it[field]) });
      });
      bad.slice(0, 5).forEach(function (b) {
        out.push("Row " + b.row + ": buckets add up to " + fm(b.s) + " but " + label + " says " + fm(b.v) + ".");
      });
      if (bad.length > 5) out.push("+" + (bad.length - 5) + " more rows where the buckets differ from " + label + ".");
      return bad.length;
    }
    var nErp = check("ERP Overdue", "overdue");
    var nModel = check("Model Overdue", "modelOverdue");
    if (nErp && !nModel && items.some(function (it) { return it.modelOverdue != null; })) {
      out.push("The buckets (with Pre April) match Model Overdue in every row; the headline overdue uses ERP Overdue.");
    }
    return out;
  }

  /* "ERP 15-Oct" header + the as-of date -> the base date (year taken from the as-of date; never after it). */
  function erpBaseDateOf(header, asOf) {
    var m = /^ERP\s+(\d{1,2})-([A-Za-z]{3})(?:-(\d{2,4}))?$/.exec(String(header || "").trim());
    if (!m || !MONTHS[m[2].toLowerCase()]) return null;
    var mon = MONTHS[m[2].toLowerCase()], d = +m[1], y;
    if (m[3]) y = m[3].length === 2 ? 2000 + (+m[3]) : +m[3];
    else {
      y = asOf ? +String(asOf).slice(0, 4) : new Date().getFullYear();
      var iso = ymd(y, mon, d);
      if (asOf && iso && iso > asOf) y--;
    }
    return ymd(y, mon, d);
  }
  function ymd(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }

  /* Importer rows -> stored rows (design 2.4). */
  function buildRows(kind, rows, aliases, erpHeader, asOf) {
    var keys = kind === "aging"
      ? ["termsDays", "erpTotal", "erpNotDue", "overdue", "modelNotDue", "b1_30", "b31_60", "b61_90", "b90", "preApril", "creditBalance", "modelOverdue", "asOn"]
      : ["erpBase", "invoicesSince", "receiptsSince", "outstanding", "asOn"];
    var baseDate = kind === "live" ? erpBaseDateOf(erpHeader, asOf) : null;
    return rows.map(function (r) {
      var o = { sourceName: r.sourceName, customerId: r.customerId || null, groupIds: r.customerId ? null : (r.groupIds || null) };
      if (aliases && aliases[r.sourceName] === "") o.ignored = true;
      else if (r.ignored) o.ignored = true;
      keys.forEach(function (k) { o[k] = r[k] == null ? null : r[k]; });
      if (kind === "live") o.erpBaseDate = baseDate;
      return o;
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { moneyStats: moneyStats, agingWarnings: agingWarnings, buildRows: buildRows, erpBaseDateOf: erpBaseDateOf, perCustomer: perCustomer, shapeCustomer: shapeCustomer };
  }
  if (!hasWindow) return;

  /* =============================== browser part =============================== */
  var Store = window.Store, Ui = window.Ui, App = window.App;
  var el = Ui.el;

  /* ---------- live document: rows re-matched against today's customers and aliases ---------- */
  var cache = null;
  function rawDoc() { return Store.doc("money").get(); }
  /* A name that is a shared ERP group (2+ customers carry it as their ERP Group) is a GROUP row even when it also equals one
     customer's name: the Collections sheet puts the whole group's amount on that one line. An explicit manual match wins. */
  function sharedGroup(name) {
    var al = Store.aliases();
    if (Object.prototype.hasOwnProperty.call(al, String(name).trim())) return null;
    var g = Store.matchGroup(name);
    return g && g.length > 1 ? g : null;
  }
  function resolveRow(r) {
    var o = Object.assign({}, r), g = sharedGroup(r.sourceName), m = Store.matchCustomer(r.sourceName);
    if (g) { o.customerId = null; o.groupIds = g; o.ignored = false; }
    else if (m) { o.customerId = m; o.groupIds = null; o.ignored = false; }
    else if (m === "") { o.customerId = null; o.groupIds = null; o.ignored = true; }
    else if (r.customerId && Store.get(r.customerId)) { o.groupIds = null; o.ignored = false; }
    else { o.customerId = null; o.groupIds = Store.matchGroup(r.sourceName); o.ignored = false; }
    return o;
  }
  function liveDoc() {
    var d = rawDoc();
    if (!d || !((d.aging && Array.isArray(d.aging.rows)) || (d.live && Array.isArray(d.live.rows)))) return null;
    var today = Store.todayISO();
    if (cache && cache.src === d && cache.today === today) return cache.doc;
    var doc = { v: 1 };
    ["aging", "live"].forEach(function (k) {
      if (d[k] && Array.isArray(d[k].rows)) doc[k] = { meta: d[k].meta, rows: d[k].rows.map(resolveRow) };
    });
    cache = { src: d, today: today, doc: doc, per: null, stats: null };
    return doc;
  }
  Store.onChange(function () { cache = null; });

  function has() { return !!liveDoc(); }
  function meta() {
    var d = rawDoc() || {};
    return { aging: d.aging && d.aging.meta ? d.aging.meta : null, live: d.live && d.live.meta ? d.live.meta : null };
  }
  function forCustomer(id) {
    var d = liveDoc();
    if (!d) return null;
    if (!cache.per) cache.per = perCustomer(d, byIdMap(Store.customers()));
    return cache.per[id] ? shapeCustomer(cache.per[id]) : null;
  }
  function stats() {
    var d = liveDoc();
    if (!d) return null;
    if (!cache.stats) cache.stats = moneyStats(d, Store.customers(), Store.todayISO());
    return cache.stats;
  }
  function clear(which) {
    var d = rawDoc();
    if (!d) return Promise.resolve({ ok: true, queued: false });
    if (which === "aging" || which === "live") {
      var next = { v: 1, aging: d.aging || null, live: d.live || null };
      next[which] = null;
      if (!next.aging && !next.live) return Store.doc("money").clear();
      return Store.doc("money").set(next);
    }
    return Store.doc("money").clear();
  }

  /* ---------- import ---------- */
  function onConfirm(res) {
    var key = res.specKey === "live" ? "live" : "aging";
    var rows = buildRows(key, res.rows.map(function (r) {
      var g = res.aliases && Object.prototype.hasOwnProperty.call(res.aliases, r.sourceName) ? null : sharedGroup(r.sourceName);
      return g ? Object.assign({}, r, { customerId: null, groupIds: g }) : r;
    }), res.aliases, lastErpHeader, res.meta.asOf);
    var meta = Object.assign({}, res.meta, {
      kind: key, unmatched: rows.filter(function (r) { return !r.customerId && !r.groupIds && !r.ignored; }).length
    });
    var cur = rawDoc() || {};
    var next = { v: 1, aging: cur.aging || null, live: cur.live || null };
    next[key] = { meta: meta, rows: rows };
    return Store.doc("money").set(next);
  }
  function openImport() {
    lastErpHeader = "";
    CrmImport.open({
      title: "Import money data",
      intro: "Export the AGING or LIVE_POSITION tab of the Collections sheet (File > Download > Comma-separated values) and choose the file.",
      specs: [
        { key: "aging", label: "AGING tab", fields: AGING_FIELDS, skipRow: skipTotal, warnings: function (items) { return agingWarnings(items, App.fmt.money); } },
        { key: "live", label: "LIVE_POSITION tab", fields: LIVE_FIELDS, skipRow: skipTotal }
      ],
      customerField: "customer", asOf: true, onConfirm: onConfirm
    });
  }

  /* ---------- the money card ---------- */
  var cards = [];
  function openList(filter) { App.show("list", filter); }

  function amountText(n, cls, label) {
    var s = el("span", { class: "mny-amt" + (cls ? " " + cls : "") });
    s.appendChild(Ui.amountEl(n));
    if (label) s.insertBefore(document.createTextNode(label + " "), s.firstChild);
    return s;
  }

  function drawTiles(card, st) {
    var tiles = el("div", { class: "mny-tiles" });
    var out = el("div", { class: "mny-tile" }, [el("div", { class: "mny-tile-label", text: "Outstanding" })]);
    if (st.outstanding != null) out.appendChild(Ui.amountEl(st.outstanding, "mny-big", true));
    else out.appendChild(el("div", { class: "mny-hint", text: "Import the LIVE_POSITION tab to see the outstanding amount." }));
    var ov = el("div", { class: "mny-tile mny-tile-over" }, [el("div", { class: "mny-tile-label", text: "Overdue" })]);
    if (st.overdue != null) {
      ov.appendChild(Ui.amountEl(st.overdue, "mny-big" + (st.overdue > 0 ? " mny-over" : ""), true));
      ov.appendChild(el("div", { class: "mny-sub" + (st.overdue > 0 ? " mny-over" : ""), text: st.overdue > 0 ? "Overdue" + (st.overduePct != null ? " · " + st.overduePct + "% of outstanding" : "") : "Nothing overdue" }));
    } else ov.appendChild(el("div", { class: "mny-hint", text: "Import the AGING tab to see the overdue amount and the aging." }));
    tiles.appendChild(out); tiles.appendChild(ov);
    card.appendChild(tiles);
  }

  function drawAging(card, st) {
    if (st.overdue == null) return;
    var wrap = el("div", { class: "mny-aging" }, [el("h3", { text: "Overdue by age" })]);
    var total = BUCKETS.reduce(function (s, k) { return s + Math.max(0, st.buckets[k].amount || 0); }, 0);
    var bar = el("div", { class: "mny-bar", role: "img", "aria-label": "Overdue split by age" });
    BUCKETS.forEach(function (k) {
      var a = Math.max(0, st.buckets[k].amount || 0);
      if (!a || !total) return;
      var seg = el("span", { class: "mny-seg mny-seg-" + k });
      seg.style.width = (a / total * 100).toFixed(1) + "%";
      bar.appendChild(seg);
    });
    wrap.appendChild(bar);
    var legend = el("ul", { class: "mny-legend" });
    BUCKETS.forEach(function (k) {
      var b = st.buckets[k];
      var btn = el("button", { type: "button", class: "mny-leg", dataset: { bucket: k } }, [
        el("span", { class: "mny-dot mny-seg-" + k }),
        el("span", { class: "mny-leg-name", text: BUCKET_LABEL[k] }),
        Ui.amountEl(b.amount, "mny-leg-amt"),
        el("span", { class: "mny-leg-n", text: b.n + (b.n === 1 ? " customer" : " customers") })
      ]);
      btn.addEventListener("click", function () { openList({ extra: { kind: "aging", value: k } }); });
      var li = el("li", null, btn);
      if (k === "b90" && b.preApril) {
        li.appendChild(el("div", { class: "mny-of" }, ["of which before April ", Ui.amountEl(b.preApril)]));
      }
      legend.appendChild(li);
    });
    wrap.appendChild(legend);
    card.appendChild(wrap);
  }

  function drawTop(card, st) {
    if (st.overdue == null) return;
    var wrap = el("div", { class: "mny-top" }, [el("h3", { text: "Top 5 overdue" })]);
    if (!st.top5.length) wrap.appendChild(el("p", { class: "note", text: "No customer has an overdue amount." }));
    var ul = el("ul", { class: "mny-toplist" });
    st.top5.forEach(function (e) {
      var btn = el("button", { type: "button", class: "mny-topbtn", dataset: { ids: e.ids.join(",") } }, [
        el("span", { class: "mny-topname", text: e.name }),
        amountText(e.overdue, "mny-over", "Overdue")
      ]);
      btn.addEventListener("click", function () { openList({ extra: { kind: "ids", value: e.ids.slice(), label: e.name } }); });
      ul.appendChild(el("li", null, btn));
    });
    wrap.appendChild(ul);
    card.appendChild(wrap);
  }

  function drawUnmatched(card, st) {
    var open = st.unmatched.list.filter(function (e) { return !e.ignored; });
    var not = st.unmatched.list.length - open.length;
    if (!open.length && !not) return;
    var wrap = el("div", { class: "mny-unm" }, [el("h3", { text: "Names not matched to a customer" })]);
    if (open.length) {
      wrap.appendChild(el("p", { class: "note", text: "These rows are in the totals but not on any customer. Pick the customer; the choice is remembered for the next import." }));
      var ul = el("ul", { class: "mny-unmlist" });
      var custs = Store.customers().slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
      open.forEach(function (e) {
        var sel = el("select", { "aria-label": "Match " + e.sourceName }, [
          el("option", { value: "?", text: "Choose customer…" }),
          custs.map(function (c) { return el("option", { value: c.id, text: c.name }); }),
          el("option", { value: "-", text: "Not a CRM customer" })
        ]);
        var btn = el("button", { type: "button", class: "btn-sm", text: "Save match" });
        btn.addEventListener("click", function () {
          if (sel.value === "?") { sel.focus(); return; }
          var map = {}; map[e.sourceName] = sel.value === "-" ? "" : sel.value;
          Store.setAliases(map).then(function () { App.flush(); App.announce("Saved the match for " + e.sourceName + "."); });
        });
        var amt = e.overdue != null ? amountText(e.overdue, "", "Overdue") : amountText(e.outstanding, "", "Outstanding");
        ul.appendChild(el("li", null, [el("span", { class: "mny-unmname", text: e.sourceName }), amt, sel, btn]));
      });
      wrap.appendChild(ul);
    }
    if (not) wrap.appendChild(el("p", { class: "note", text: not + (not === 1 ? " name is" : " names are") + " marked as not a CRM customer; still counted in the totals." }));
    card.appendChild(wrap);
  }

  function draw(slot) {
    Ui.clear(slot);
    var card = el("section", { class: "mny-card card", "aria-label": "Money" });
    var st = stats(), today = Store.todayISO();
    var head = el("div", { class: "mny-head" }, [el("h2", { text: "Money" })]);
    var actions = el("div", { class: "mny-actions no-print" });
    var imp = el("button", { type: "button", class: "btn primary", id: "moneyImportBtn", text: st ? "Import more money data" : "Import money data" });
    imp.addEventListener("click", openImport);
    var hide = el("button", { type: "button", class: "btn", id: "moneyHide", "aria-pressed": String(App.hideAmounts()), text: App.hideAmounts() ? "Show amounts" : "Hide amounts" });
    hide.addEventListener("click", function () { App.setHideAmounts(!App.hideAmounts()); });
    actions.appendChild(imp); actions.appendChild(hide);
    if (st) {
      var clr = el("button", { type: "button", class: "btn", id: "moneyClear", text: "Clear imported money data" });
      clr.addEventListener("click", function () {
        if (!confirm("Remove all imported amounts from this browser?")) return;
        clear("all").then(function () { App.flush(); App.announce("Imported money data removed."); });
      });
      actions.appendChild(clr);
    }
    head.appendChild(actions);
    card.appendChild(head);

    if (!st) {
      card.appendChild(el("p", { class: "mny-empty", id: "moneyEmpty", text: "No money data yet. Export the AGING and LIVE_POSITION tabs of the VFPL Collections Engine sheet as CSV and import them here. Amounts stay in this browser only and are never saved to git." }));
      slot.appendChild(card);
      return;
    }
    var asof = el("p", { class: "mny-asof", id: "moneyAsOf" });
    if (st.asOfAging && st.asOfLive && st.asOfAging !== st.asOfLive) {
      asof.textContent = "Data as of " + App.fmt.date(st.asOfAging) + " (aging) and " + App.fmt.date(st.asOfLive) + " (live position)";
    } else asof.textContent = "Data as of " + App.fmt.date(st.asOf);
    card.appendChild(asof);
    if (st.stale) {
      var d = Store.daysBetween(st.asOf, today);
      card.appendChild(el("p", { class: "mny-stale", id: "moneyStale", role: "status", text: "Money data is " + d + " days old. Import a fresh file." }));
    }
    drawTiles(card, st);
    drawAging(card, st);
    drawTop(card, st);
    drawUnmatched(card, st);
    slot.appendChild(card);
  }

  function drawAll() {
    cards = cards.filter(function (s) { return s.isConnected; });
    cards.forEach(draw);
  }
  function renderCard(slot) {
    if (cards.indexOf(slot) === -1) cards.push(slot);
    draw(slot);
  }
  App.onData(drawAll);

  window.CrmMoney = { has: has, meta: meta, forCustomer: forCustomer, stats: stats, openImport: openImport, clear: clear, renderCard: renderCard };
})();
