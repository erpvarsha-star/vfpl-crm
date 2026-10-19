/* Dashboard tab (A3): the bird's-eye view. Read-only. Every number is a button that opens the matching tab with the
   matching filter (design 5.6, 12.5). It reads other modules only through their frozen contracts and shows
   "Not available yet" when a module is missing, or its empty state when it has no data:
     CrmMoney.stats/has/meta/forCustomer/openImport, CrmRfq.stats/openEdit, CrmSchedule.visitStats/orderStats/
     dispatchStats/lastDispatch, CrmLeads.stats/openEdit/BUCKETS, CrmRevenue.renderCard/has/forCustomer/stats,
     CrmReport.open, CrmCustomers.openDone/openNotes.
   compute() is pure (Node unit tests): CrmDash.compute(customers, log, today, opts). */
(function () {
  "use strict";

  var hasWin = typeof window !== "undefined";
  var S = hasWin ? window.Store : require("./store.js");
  var CONTACT = ["Call", "Visit", "Email", "Telegram"];
  var BUCKETS = ["0-30", "31-60", "61-90", "91+", "never"];
  var BUCKET_LABEL = { "0-30": "0–30 days", "31-60": "31–60 days", "61-90": "61–90 days", "91+": "91+ days", "never": "No order on record" };
  var STATUSES = ["Active", "Follow up", "At risk"];
  var PASS = ["money", "rfq", "visits", "orders", "leads", "dispatch", "revenue"];

  function lc(s) { return String(s == null ? "" : s).toLowerCase(); }
  function byName(a, b) { return lc(a.name).localeCompare(lc(b.name)); }
  /* Same test the Customers tab uses for the "state" filter, so a bar's number equals the rows it opens. */
  function stateMatch(c, v) { return c.state === v || (c.plants || []).some(function (p) { return p.state === v; }); }

  /* ---------- pure compute ---------- */
  function compute(customers, log, today, o) {
    o = o || {};
    customers = customers || [];
    log = log || [];
    var byId = {};
    customers.forEach(function (c) { byId[c.id] = c; });

    var lastC = {}, logN = {};
    log.forEach(function (e) {
      if (!e || !byId[e.customerId]) return;
      logN[e.customerId] = (logN[e.customerId] || 0) + 1;
      if (CONTACT.indexOf(e.type) !== -1 && (!lastC[e.customerId] || e.at > lastC[e.customerId])) lastC[e.customerId] = e.at;
    });
    var lastOf = typeof o.lastContacted === "function" ? o.lastContacted : function (id) { return lastC[id] || ""; };

    var cu = { total: customers.length, status: { "Active": 0, "Follow up": 0, "At risk": 0 }, overdue: 0, today: 0, week: 0, later: 0, none: 0, disputed: 0 };
    var attention = [], dueByDay = {}, contact = { d7: 0, d30: 0, stale30: 0 };
    customers.forEach(function (c) {
      if (cu.status[c.status] != null) cu.status[c.status]++;
      if (c.disputed) cu.disputed++;
      var k = S.fuKind(c, today);
      cu[k]++;
      var l = lastOf(c.id), ld = l ? S.daysBetween(l, today) : null;
      if (k === "overdue" || k === "today") {
        attention.push({
          id: c.id, name: c.name, contact: c.contact || "", phone: c.phone || "", followUp: c.followUp, kind: k,
          days: k === "overdue" ? S.daysBetween(c.followUp, today) : 0, text: S.fuText(c, today),
          lastContacted: l, lastDays: ld, notes: logN[c.id] || 0
        });
      } else if (k === "week") {
        (dueByDay[c.followUp] = dueByDay[c.followUp] || []).push(c.id);
      }
      if (l && ld <= 7) contact.d7++;
      if (l && ld <= 30) contact.d30++;
      if (!l || ld > 30) contact.stale30++;
    });
    attention.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === "overdue" ? -1 : 1;
      if (a.kind === "overdue" && a.followUp !== b.followUp) return a.followUp < b.followUp ? -1 : 1;
      return byName(a, b);
    });
    var upcoming = Object.keys(dueByDay).sort().map(function (d) { return { date: d, n: dueByDay[d].length, ids: dueByDay[d] }; });

    // last-order recency
    var from = o.from === "data" && o.latestOrder ? "data" : "today";
    var ref = from === "data" ? o.latestOrder : today;
    var based = o.based === "dispatch" && typeof o.lastDispatch === "function" ? "dispatch" : "invoice";
    var lb = {};
    BUCKETS.forEach(function (k) { lb[k] = []; });
    customers.forEach(function (c) {
      var d = based === "dispatch" ? (o.lastDispatch(c.id) || "") : c.last;
      lb[S.lastBucket({ last: d }, ref)].push(c.id);
    });
    var lastOrder = { from: from, ref: ref, based: based, buckets: BUCKETS.map(function (k) { return { key: k, n: lb[k].length, ids: lb[k] }; }) };

    // states: a customer counts under its main state and under every plant state (as the Customers filter does)
    var seen = {}, unknown = [];
    customers.forEach(function (c) {
      if (c.state) seen[c.state] = 1; else unknown.push(c.id);
      (c.plants || []).forEach(function (p) { if (p.state) seen[p.state] = 1; });
    });
    var byState = Object.keys(seen).map(function (s) {
      var ids = customers.filter(function (c) { return stateMatch(c, s); }).map(function (c) { return c.id; });
      return { state: s, n: ids.length, ids: ids };
    }).sort(function (a, b) { return b.n - a.n || lc(a.state).localeCompare(lc(b.state)); });
    if (unknown.length) byState.push({ state: "", n: unknown.length, ids: unknown });

    // recent activity: the 10 newest entries that belong to a customer
    var recent = log.filter(function (e) { return e && byId[e.customerId]; }).slice().sort(function (a, b) {
      return String(b.at).localeCompare(String(a.at)) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    }).slice(0, 10).map(function (e) {
      return { id: e.id, at: e.at, type: e.type, customerId: e.customerId, name: byId[e.customerId].name, doneFollowUp: !!e.doneFollowUp, note: e.note || "" };
    });

    // segments, vehicle segments, groups
    function split(list, getter, none) {
      var m = {}, noneIds = [];
      customers.forEach(function (c) { var v = getter(c); if (v) (m[v] = m[v] || []).push(c.id); else noneIds.push(c.id); });
      var rows = list.map(function (k) { return { key: k, n: (m[k] || []).length, ids: m[k] || [] }; });
      rows.push({ key: none, n: noneIds.length, ids: noneIds });
      return rows;
    }
    var segments = split(S.SEGMENTS || [], function (c) { return c.segment; }, "none");
    var vseg = split(S.VEHICLE_SEGMENTS || [], function (c) { return c.vehicleSegment; }, "none");
    var gm = {};
    customers.forEach(function (c) { if (c.group) (gm[c.group] = gm[c.group] || []).push(c.id); });
    var groups = Object.keys(gm).map(function (g) { return { group: g, n: gm[g].length, ids: gm[g] }; })
      .sort(function (a, b) { return b.n - a.n || lc(a.group).localeCompare(lc(b.group)); });
    var anySet = groups.length > 0 || segments.some(function (r) { return r.key !== "none" && r.n; }) || vseg.some(function (r) { return r.key !== "none" && r.n; });

    var out = {
      today: today, customers: cu, attention: attention, upcoming: upcoming, lastOrder: lastOrder, byState: byState,
      contact: contact, recent: recent,
      segments: segments, vehicleSegments: vseg, groups: groups, noGroup: customers.length - customers.filter(function (c) { return c.group; }).length,
      anySegmentOrGroup: anySet
    };
    PASS.forEach(function (k) { out[k] = o[k] === undefined ? null : o[k]; });
    return out;
  }

  var CrmDash = { compute: compute, stateMatch: stateMatch };
  if (hasWin) window.CrmDash = CrmDash;
  if (typeof module !== "undefined" && module.exports) module.exports = CrmDash;
  if (!hasWin || !window.App || !window.Ui) return;

  /* =====================================================================================================
     View
     ===================================================================================================== */
  var App = window.App, Ui = window.Ui, el = Ui.el, fmt = App.fmt;
  var root = null;
  var DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function warn(msg, e) { if (typeof console !== "undefined") console.warn(msg, e && e.message ? e.message : e); }
  function longDate(iso) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!p) return "";
    return DOW[new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])).getUTCDay()] + ", " + (+p[3]) + " " + MON[+p[2] - 1] + " " + p[1];
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function ago(days) { return days <= 0 ? "today" : fmt.rel(days) + " ago"; }
  function snippet(t) {
    var s = String(t || "").replace(/\s+/g, " ").trim();
    return s.length > 80 ? s.slice(0, 79) + "…" : s;
  }
  function dashView() { return App.view("dash"); }
  function setDash(k, v) { var o = dashView(); o[k] = v; App.setView("dash", o); }

  /* Own state kept in the view slice panels.dash: from (today|data), based (invoice|dispatch), incRelated, allStates, allGroups. */
  function mod(name) { return hasWin ? window[name] : null; }
  function modFn(name, fn) { var m = mod(name); return m && typeof m[fn] === "function" ? m : null; }
  function stat(name, fn, arg) {
    var m = modFn(name, fn);
    if (!m) return { state: "missing" };
    try {
      var v = m[fn](arg);
      return v == null ? { state: "empty" } : { state: "data", v: v };
    } catch (e) { warn("Dashboard: " + name + "." + fn + " failed", e); return { state: "missing" }; }
  }

  /* ---------- small builders (text only) ---------- */
  function jump(tab, filter, n, attrs, kids) {
    var a = Object.assign({}, attrs || {});
    a.type = "button";
    a.dataset = Object.assign({ go: tab }, a.dataset || {});
    if (n != null) a.dataset.n = String(n);
    a.onclick = function () { App.show(tab, filter); };
    return el("button", a, kids);
  }
  function call(name, fn, arg) {
    return function () {
      var m = modFn(name, fn);
      if (m) m[fn](arg); else App.notice("That part of the app is not available yet.", "info");
    };
  }
  function actionBtn(label, onclick, attrs) {
    return el("button", Object.assign({ type: "button", class: "btn-sm", text: label, onclick: onclick }, attrs || {}));
  }
  function amount(n, cls) { return Ui.amountEl(n, cls, true); }
  function note(text, cls) { return el("p", { class: "d-note" + (cls ? " " + cls : ""), text: text }); }
  function empty(text) { return el("p", { class: "d-empty", text: text }); }

  /* A tile that is a button: label, big number, one line of words. */
  function tile(key, label, valueNode, words, tone, tab, filter, n) {
    var kids = [el("span", { class: "d-tile-label", text: label }), valueNode];
    if (words) kids.push(el("span", { class: "d-tile-words", text: words }));
    return jump(tab, filter, n, { class: "d-tile" + (tone ? " " + tone : ""), dataset: { tile: key } }, kids);
  }
  function num(n) { return el("span", { class: "d-val d-num", text: fmt.int(n) }); }
  function staticTile(key, label, valueText, words) {
    return el("div", { class: "d-tile static", dataset: { tile: key } }, [
      el("span", { class: "d-tile-label", text: label }), el("span", { class: "d-val d-static", text: valueText }),
      words ? el("span", { class: "d-tile-words", text: words }) : null
    ]);
  }
  function tiles(list) { return el("div", { class: "tiles" }, list); }

  /* Horizontal bar button: label | track | number. */
  function hbar(label, n, max, tab, filter, o) {
    o = o || {};
    var w = max > 0 && n > 0 ? Math.max(2, Math.round(n / max * 100)) : 0;
    var lab = [el("span", { class: "hb-name", text: label })];
    if (o.sub) lab.push(el("small", { class: "hb-sub", text: o.sub }));
    var val = [el("span", { class: "d-num", text: fmt.int(n) })];
    if (o.after) val.push(el("span", { class: "hb-after", text: o.after }));
    return jump(tab, filter, o.claim === false ? null : n, { class: "hbar" + (o.cls ? " " + o.cls : ""), dataset: o.key ? { bar: o.key } : {} }, [
      el("span", { class: "hb-label" }, lab),
      el("span", { class: "hb-track", "aria-hidden": "true" }, el("span", { class: "hb-fill" + (o.tone ? " " + o.tone : ""), style: { width: w + "%" } })),
      el("span", { class: "hb-val" }, val)
    ]);
  }
  function card(id, title, span, cls) {
    return el("section", { class: "dcard d-s" + span + (cls ? " " + cls : ""), id: "dash-" + id, "aria-labelledby": "dh-" + id },
      el("h2", { id: "dh-" + id, tabindex: "-1", text: title }));
  }
  function sub(text) { return el("h3", { class: "d-sub", text: text }); }
  function moduleMissing(sec) { sec.appendChild(empty("Not available yet.")); }

  /* ---------- gather ---------- */
  function lastDispatchFn() {
    var m = modFn("CrmSchedule", "lastDispatch");
    return m ? function (id) { try { return m.lastDispatch(id) || ""; } catch (e) { return ""; } } : null;
  }
  function moneyReady() { var m = mod("CrmMoney"); return !!(m && typeof m.has === "function" && m.has() && typeof m.forCustomer === "function"); }
  function revenueReady() { var m = mod("CrmRevenue"); return !!(m && typeof m.has === "function" && m.has() && typeof m.forCustomer === "function"); }
  function sumOverdue(ids) {
    var seen = {}, t = 0;
    ids.forEach(function (id) {
      var m = CrmMoney.forCustomer(id);
      if (!m || !(m.overdue > 0)) return;
      if (m.shared) { if (seen[m.shared.groupName]) return; seen[m.shared.groupName] = 1; }
      t += m.overdue;
    });
    return t;
  }
  function sumRevenue(ids, incRelated) {
    var t = 0;
    ids.forEach(function (id) {
      var c = S.get(id);
      if (!c || (c.relatedParty && !incRelated)) return;
      var r = CrmRevenue.forCustomer(id);
      if (r && r.fytd) t += r.fytd;
    });
    return t;
  }

  /* ---------- sections ---------- */
  function secCustomers(grid, d) {
    var c = d.customers, sec = card("cust", "Customers at a glance", 12);
    var t = [tile("total", "Total customers", num(c.total), "", "", "list", {}, c.total)];
    var tones = { "Active": "ok", "Follow up": "warn", "At risk": "risk" };
    STATUSES.forEach(function (s) {
      t.push(tile("status-" + s.toLowerCase().replace(/\s+/g, ""), s, num(c.status[s]), "", "edge-" + tones[s], "list", { filter: s }, c.status[s]));
    });
    t.push(tile("overdue", "Overdue", num(c.overdue), c.overdue ? "Needs a call now" : "None overdue", c.overdue ? "risk" : "", "list", { view: "overdue" }, c.overdue));
    t.push(tile("today", "Due today", num(c.today), c.today ? "Due today" : "Nothing due today", c.today ? "warn" : "", "list", { view: "today" }, c.today));
    t.push(tile("week", "Next 7 days", num(c.week), "", "", "list", { view: "week" }, c.week));
    t.push(tile("none", "No follow-up set", num(c.none), "", "", "list", { view: "none" }, c.none));
    t.push(tile("disputed", "Disputed", num(c.disputed), "", "", "list", { extra: { kind: "disputed" } }, c.disputed));
    sec.appendChild(tiles(t));
    grid.appendChild(sec);
  }

  var AGE = [["b1_30", "1–30 days"], ["b31_60", "31–60 days"], ["b61_90", "61–90 days"], ["b90", "Over 90 days"]];
  function secMoney(grid, m, today) {
    var sec = card("money", "Money", 12);
    grid.appendChild(sec);
    if (m.state === "missing") return moduleMissing(sec);
    var importBtn = actionBtn("Import money data", call("CrmMoney", "openImport"), { id: "moneyImportBtn", class: "btn-sm no-print" });
    if (m.state === "empty") {
      sec.appendChild(empty("No money data yet. Export the AGING and LIVE_POSITION tabs of the VFPL Collections Engine sheet as CSV and import them here. Amounts stay in this browser only and are never saved to git."));
      sec.appendChild(importBtn);
      return;
    }
    var s = m.v;
    if (s.stale) {
      var age = /^\d{4}-\d{2}-\d{2}$/.test(s.asOf || "") ? S.daysBetween(s.asOf, today) : null;
      sec.appendChild(note("Money data is " + (age == null ? "old" : plural(age, "day", "days") + " old") + ". Import a fresh file.", "d-warn"));
    }
    var t = [];
    if (s.outstanding != null) t.push(tile("outstanding", "Total outstanding", amount(s.outstanding, "d-val d-num"), "", "", "list", { extra: { kind: "money", value: "outstanding" }, sort: "overdue" }));
    else t.push(staticTile("outstanding", "Total outstanding", "—", "Import LIVE_POSITION to see it"));
    if (s.overdue != null) {
      t.push(tile("overdue-amt", "Total overdue", amount(s.overdue, "d-val d-num"), "Overdue", s.overdue > 0 ? "risk" : "", "list", { extra: { kind: "money", value: "overdue" }, sort: "overdue" }));
      t.push(tile("overdue-pct", "Overdue share", s.overduePct != null ? el("span", { class: "d-val d-num", text: Math.round(s.overduePct) + "%" }) : el("span", { class: "d-val d-static", text: "—" }),
        s.overduePct != null ? "of outstanding" : "Import both files to see it", "", "list", { extra: { kind: "money", value: "overdue" }, sort: "overdue" }));
    } else t.push(staticTile("overdue-amt", "Total overdue", "—", "Import AGING to see it"));
    sec.appendChild(tiles(t));

    var b = s.buckets || {}, total = 0;
    AGE.forEach(function (a) { total += (b[a[0]] && b[a[0]].amount) || 0; });
    if (total > 0) {
      sec.appendChild(sub("Overdue by age"));
      var stack = el("div", { class: "d-stack", "aria-hidden": "true" });
      AGE.forEach(function (a, i) {
        var amt = (b[a[0]] && b[a[0]].amount) || 0;
        if (amt > 0) stack.appendChild(el("span", { class: "seg seg-" + (i + 1), style: { width: (amt / total * 100) + "%" } }));
      });
      sec.appendChild(stack);
      var legend = el("div", { class: "d-legend" });
      AGE.forEach(function (a, i) {
        var x = b[a[0]] || { amount: 0, n: 0 };
        var kids = [el("span", { class: "sw seg-" + (i + 1), "aria-hidden": "true" }), a[1] + " · ", amount(x.amount), " · " + plural(x.n || 0, "customer", "customers")];
        var pre = x.preApril != null ? x.preApril : s.preApril;
        if (a[0] === "b90" && pre) kids.push(el("small", { class: "d-dim" }, [" (of which before April ", amount(pre), ")"]));
        legend.appendChild(jump("list", { extra: { kind: "aging", value: a[0] } }, x.n || 0, { class: "d-lg", dataset: { age: a[0] } }, kids));
      });
      sec.appendChild(legend);
    }
    var top = (s.top5 || []).slice(0, 5);
    if (top.length) {
      sec.appendChild(sub("Top 5 overdue"));
      var ol = el("ol", { class: "d-top5" });
      var all = [];
      top.forEach(function (r) {
        var ids = Array.isArray(r.ids) && r.ids.length ? r.ids : [r.id];
        all = all.concat(ids);
        ol.appendChild(el("li", null, jump("list", { extra: { kind: "ids", value: ids, label: r.name } }, ids.length, { class: "d-row", dataset: { top: r.id } }, [
          el("span", { class: "d-row-name", text: r.name }), el("span", { class: "d-risk" }, [amount(r.overdue), " overdue"])
        ])));
      });
      sec.appendChild(ol);
      sec.appendChild(actionBtn("Show these " + top.length, function () { App.show("list", { extra: { kind: "ids", value: all, label: "Top " + top.length + " overdue" } }); }, { dataset: { go: "list", n: String(all.length) }, id: "top5All" }));
    }
    var meta = mod("CrmMoney") && CrmMoney.meta ? CrmMoney.meta() : null, parts = [];
    if (meta && meta.aging && meta.aging.asOf) parts.push(fmt.date(meta.aging.asOf) + " (AGING)");
    if (meta && meta.live && meta.live.asOf) parts.push(fmt.date(meta.live.asOf) + " (LIVE_POSITION)");
    if (!parts.length && s.asOf) parts.push(fmt.date(s.asOf));
    var foot = el("div", { class: "d-foot" }, [el("span", { class: "d-dim", text: "Data as of " + parts.join(", ") })]);
    if (s.unmatched && s.unmatched.n > 0) {
      foot.appendChild(el("button", { type: "button", class: "d-link", id: "moneyUnmatched", onclick: call("CrmMoney", modFn("CrmMoney", "openUnmatched") ? "openUnmatched" : "openImport") }, ["Includes ", amount(s.unmatched.amount), " for " + plural(s.unmatched.n, "name", "names") + " not in the CRM"]));
    }
    foot.appendChild(importBtn);
    sec.appendChild(foot);
  }

  /* Revenue: A7 builds the card (CrmRevenue.renderCard). The Dashboard owns the slot and, only when the card has no
     switch of its own, the "Include related parties" switch (off by default, persisted in panels.dash.incRelated). */
  function secRevenue(grid) {
    var slot = el("section", { class: "dcard d-s12 d-rev", id: "dashRevenue", "aria-label": "Revenue" });
    var m = modFn("CrmRevenue", "renderCard");
    var built = false;
    if (m) {
      try { m.renderCard(slot); built = true; } catch (e) { warn("Dashboard: CrmRevenue.renderCard failed", e); slot.textContent = ""; }
    }
    if (!built) {
      slot.appendChild(el("h2", { id: "dh-rev", text: "Revenue (Taxable, before GST)" }));
      moduleMissing(slot);
      grid.appendChild(slot);
      return;
    }
    if (!slot.querySelector("#incRelated")) {
      var on = dashView().incRelated === true;
      var bar = el("div", { class: "dcard d-s12 d-relbar", id: "dashRelBar" });
      bar.appendChild(el("button", {
        type: "button", class: "chip", id: "incRelated", "aria-pressed": String(on), text: "Include related parties",
        onclick: function () { setDash("incRelated", !(dashView().incRelated === true)); render(); }
      }));
      var st = modFn("CrmRevenue", "stats"), ex = null;
      if (st) { try { var r = CrmRevenue.stats({ to: "data", includeRelated: on }); ex = r && r.excludedRelated; } catch (e) { warn("Dashboard: CrmRevenue.stats failed", e); } }
      if (!on && ex && ex.n > 0) {
        bar.appendChild(el("button", { type: "button", class: "d-link", id: "relNote", onclick: go("list", { extra: { kind: "related" } }) },
          ["Excludes " + plural(ex.n, "related party", "related parties") + " (", amount(ex.amount), ")"]));
      } else if (on) bar.appendChild(el("span", { class: "d-dim", text: "Related parties are included in revenue." }));
      else bar.appendChild(el("span", { class: "d-dim", text: "Related parties (own group companies) are left out of revenue numbers." }));
      grid.appendChild(bar);
    }
    grid.appendChild(slot);
  }
  function go(tab, filter) { return function () { App.show(tab, filter); }; }

  function phoneNode(p) {
    var raw = String(p || "").replace(/\s+/g, "");
    if (!raw) return null;
    var shown = /^\d{10}$/.test(raw) ? raw.slice(0, 5) + " " + raw.slice(5) : String(p).trim();
    return /^\d{10}$/.test(raw) ? el("a", { href: "tel:+91" + raw, text: shown }) : el("span", { text: shown });
  }
  function secAttention(grid, d) {
    var sec = card("attention", "Attention now", 7);
    var list = d.attention.slice(0, 10), c = d.customers;
    if (!d.attention.length) sec.appendChild(empty("Nothing overdue or due today."));
    else {
      var ol = el("ol", { class: "d-att", id: "attList" });
      list.forEach(function (a) {
        var sub2 = [];
        if (a.contact) sub2.push(el("span", { text: a.contact }));
        var ph = phoneNode(a.phone);
        if (ph) sub2.push(ph);
        sub2.push(el("span", { class: "d-dim", text: a.lastContacted ? "Last contacted " + fmt.date(a.lastContacted) + " · " + ago(a.lastDays) : "No contact logged yet" }));
        if (moneyReady()) {
          var mm = CrmMoney.forCustomer(a.id);
          if (mm && mm.overdue > 0) sub2.push(el("span", { class: "d-risk" }, [amount(mm.overdue), " overdue"]));
        }
        ol.appendChild(el("li", { class: "d-att-item " + (a.kind === "overdue" ? "is-over" : "is-today"), dataset: { id: a.id } }, [
          el("div", { class: "d-att-main" }, [
            el("button", { type: "button", class: "d-link d-name", text: a.name, onclick: call("CrmCustomers", "openNotes", a.id) }),
            el("span", { class: "d-fu " + (a.kind === "overdue" ? "risk" : "warn"), text: a.text })
          ]),
          el("div", { class: "d-att-sub" }, sub2),
          el("div", { class: "d-acts no-print" }, [
            el("button", { type: "button", class: "btn-sm done-btn", text: "✓ Done", "aria-label": "Mark follow-up done for " + a.name, onclick: call("CrmCustomers", "openDone", a.id) }),
            el("button", { type: "button", class: "btn-sm notes-btn", "aria-label": "Notes for " + a.name + ", " + plural(a.notes, "entry", "entries"), onclick: call("CrmCustomers", "openNotes", a.id) },
              ["Notes ", el("span", { class: "d-badge", text: String(a.notes) })])
          ])
        ]));
      });
      sec.appendChild(ol);
      var more = el("div", { class: "d-more no-print" });
      if (c.overdue) more.appendChild(jump("list", { view: "overdue" }, c.overdue, { class: "btn-sm", id: "showOverdue" }, "Show all overdue (" + c.overdue + ")"));
      if (c.today) more.appendChild(jump("list", { view: "today" }, c.today, { class: "btn-sm", id: "showToday" }, "Show all due today (" + c.today + ")"));
      sec.appendChild(more);
    }
    grid.appendChild(sec);
  }

  function secNext7(grid, d, today) {
    var sec = card("next7", "Next 7 days", 5);
    sec.appendChild(sub("Follow-ups"));
    if (!d.upcoming.length) sec.appendChild(empty("No follow-ups in the next 7 days."));
    else {
      var ul = el("ul", { class: "d-days" });
      d.upcoming.forEach(function (g) {
        var names = g.ids.map(function (id) { var x = S.get(id); return x ? x.name : ""; }).filter(Boolean);
        ul.appendChild(el("li", null, [
          jump("list", { extra: { kind: "due", value: g.date } }, g.n, { class: "d-link d-day", dataset: { day: g.date } }, fmt.day(g.date) + " (" + g.n + ")"),
          el("span", { class: "d-names", text: names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "") })
        ]));
      });
      sec.appendChild(ul);
      sec.appendChild(jump("list", { view: "week" }, d.customers.week, { class: "btn-sm", id: "weekAll" }, "All (" + d.customers.week + ")"));
    }
    sec.appendChild(sub("Visits and calls"));
    var v = d.visits;
    if (!v) { sec.appendChild(empty(modFn("CrmSchedule", "visitStats") ? "No visits or calls planned." : "Not available yet.")); }
    else {
      var items = (v.next7 || []).slice(0, 8);
      if (!items.length) sec.appendChild(empty("No visits or calls in the next 7 days."));
      else {
        var vl = el("ul", { class: "d-days" });
        items.forEach(function (it) {
          vl.appendChild(el("li", null, jump("schedule", { sub: "visits", day: it.date }, null, { class: "d-link d-visit", dataset: { visit: it.id } },
            fmt.day(it.date) + (it.time ? " · " + it.time : "") + " · " + it.type + " · " + (it.customerName || ""))));
        });
        sec.appendChild(vl);
      }
      var row = el("div", { class: "d-more" });
      row.appendChild(jump("schedule", { sub: "visits", vflag: "next7" }, null, { class: "btn-sm", id: "visits7" }, plural(v.next7Count != null ? v.next7Count : items.length, "visit and call", "visits and calls")));
      if (v.today) row.appendChild(jump("schedule", { sub: "visits", vflag: "today" }, null, { class: "btn-sm", id: "visitsToday" }, "Today: " + v.today));
      if (v.missed) row.appendChild(jump("schedule", { sub: "visits", vflag: "missed" }, null, { class: "btn-sm d-risk-btn", id: "visitsMissed" }, "Not done: " + v.missed));
      sec.appendChild(row);
    }
    grid.appendChild(sec);
  }

  function secRfq(grid, r) {
    var sec = card("rfq", "RFQ pipeline", 12);
    grid.appendChild(sec);
    if (r.state === "missing") return moduleMissing(sec);
    var s = r.state === "data" ? r.v : null;
    if (!s || !s.total) { sec.appendChild(empty("No RFQs yet. Add them on the RFQs tab or import your RFQ sheet.")); return; }
    var stages = (mod("CrmRfq").STAGES || Object.keys(s.byStage || {})).slice(), max = 0;
    stages.forEach(function (k) { max = Math.max(max, (s.byStage && s.byStage[k]) || 0); });
    var funnel = el("div", { class: "d-funnel" });
    stages.forEach(function (k) {
      var n = (s.byStage && s.byStage[k]) || 0;
      funnel.appendChild(hbar(k, n, max, "rfqs", { stage: k, view: "table" }, { key: k, cls: "stage" }));
    });
    sec.appendChild(funnel);
    var t = [];
    t.push(tile("quote-overdue", "Quote overdue", num(s.quoteOverdue || 0), s.quoteOverdue ? "Quote overdue" : "None overdue", s.quoteOverdue ? "risk" : "", "rfqs", { flag: "quoteOverdue", view: "table" }, s.quoteOverdue || 0));
    if (s.quoteDueToday) t.push(tile("quote-today", "Quote due today", num(s.quoteDueToday), "Due today", "warn", "rfqs", { flag: "quoteToday", view: "table" }, s.quoteDueToday));
    t.push(tile("action-overdue", "Next action overdue", num(s.actionOverdue || 0), s.actionOverdue ? "Action overdue" : "None overdue", s.actionOverdue ? "risk" : "", "rfqs", { flag: "actionOverdue", view: "table" }, s.actionOverdue || 0));
    t.push(tile("value-quoted", "Value quoted, no PO yet", amount(s.valueQuoted || 0, "d-val d-num"), "", "", "rfqs", { flag: "openQuoted", view: "table" }));
    t.push(tile("value-won", "Won (PO and later)", amount(s.valueWon || 0, "d-val d-num"), "", "", "rfqs", { flag: "won", view: "table" }));
    sec.appendChild(tiles(t));
    var h = s.hints || {}, hints = [];
    if (s.total >= 3) {
      if (h.quotedToPoPct != null) {
        var denom = h.quotedEver != null ? h.quotedEver : s.quotedEver != null ? s.quotedEver : stages.slice(1).reduce(function (a, k) { return a + ((s.byStage && s.byStage[k]) || 0); }, 0);
        hints.push(el("li", null, [el("span", { class: "d-static", text: Math.round(h.quotedToPoPct) + "%" }), " of ",
          jump("rfqs", { flag: "quotedEver", view: "table" }, null, { class: "d-link", dataset: { hint: "quotedEver" } }, plural(denom, "quoted RFQ", "quoted RFQs")), " reached PO"]));
      }
      if (h.avgDaysToQuote != null) hints.push(el("li", null, ["Quotes take ", el("span", { class: "d-static", text: String(Math.round(h.avgDaysToQuote)) }), " days on average from receipt"]));
      (h.stuck || []).forEach(function (x) {
        hints.push(el("li", null, [jump("rfqs", { flag: "stuck", stuckStage: x.stage, view: "table" }, null, { class: "d-link", dataset: { hint: "stuck-" + x.stage } }, plural(x.n, "RFQ", "RFQs")),
          " stuck in " + x.stage + " for over 30 days"]));
      });
      if (hints.length) sec.appendChild(el("ul", { class: "d-hints" }, hints));
    } else sec.appendChild(note("Add RFQs to see conversion hints."));
  }

  function secReleased(grid, r) {
    var sec = card("released", "Released parts", 12);
    grid.appendChild(sec);
    if (r.state === "missing") return moduleMissing(sec);
    var s = r.state === "data" ? r.v : null, rel = s && s.released ? s.released : { total: 0, byStage: {}, list: [] };
    sec.appendChild(tiles([tile("released", "Released parts", num(rel.total || 0), "", "", "rfqs", { stage: "released", view: "table" }, rel.total || 0)]));
    var chips = el("div", { class: "d-chips" });
    ["Finalised", "PO", "Sample", "PPAP"].forEach(function (k) {
      var n = (rel.byStage && rel.byStage[k]) || 0;
      chips.appendChild(jump("rfqs", { stage: k, view: "table" }, n, { class: "chip", dataset: { stage: k } }, [k + " ", el("b", { class: "d-num", text: String(n) })]));
    });
    sec.appendChild(chips);
    var list = (rel.list || []).slice(0, 8);
    if (list.length) {
      var ul = el("ul", { class: "d-rel" });
      list.forEach(function (p) {
        ul.appendChild(el("li", null, el("button", { type: "button", class: "d-link", dataset: { rfq: p.id }, onclick: call("CrmRfq", "openEdit", p.id),
          text: (p.part || p.rfqNo || "RFQ") + (p.rfqNo && p.part ? " (" + p.rfqNo + ")" : "") + " · " + (p.customerName || "") + " · " + p.stage })));
      });
      sec.appendChild(ul);
    } else sec.appendChild(empty("No released parts yet."));
    sec.appendChild(note("Released parts = RFQ parts at Finalised, PO, Sample or PPAP. Please confirm this meaning.", "d-dim"));
  }

  function daysOld(iso, today) { return /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? S.daysBetween(iso, today) : null; }
  function secOrders(grid, d, today) {
    var sec = card("orders", "Orders and dispatch", 12);
    grid.appendChild(sec);
    var o = d.orders, dp = d.dispatch, ms = !modFn("CrmSchedule", "orderStats");
    if (ms && !modFn("CrmSchedule", "dispatchStats")) return moduleMissing(sec);
    if (ms) sec.appendChild(empty("Not available yet."));
    else if (!o) sec.appendChild(empty("No upcoming orders added yet."));
    else {
      var t = [];
      t.push(tile("orders-late", "Late orders", num(o.late || 0), o.late ? "Late" : "None late", o.late ? "risk" : "", "schedule", { sub: "orders", oflag: "late" }, o.late || 0));
      t.push(tile("orders-today", "Due today", num(o.dueToday || 0), o.dueToday ? "Due today" : "", o.dueToday ? "warn" : "", "schedule", { sub: "orders", oflag: "today" }, o.dueToday || 0));
      t.push(tile("orders-week", "Due this week", num(o.dueWeek || 0), "", "", "schedule", { sub: "orders", oflag: "week" }, o.dueWeek || 0));
      t.push(o.onTimePct30 != null ? staticTile("orders-ontime", "On time (last 30 days)", Math.round(o.onTimePct30) + "%", "") : staticTile("orders-ontime", "On time (last 30 days)", "—", ""));
      sec.appendChild(tiles(t));
      if (o.asOf) {
        var age = daysOld(o.asOf, today);
        sec.appendChild(note("Data as of " + fmt.date(o.asOf), o.stale ? "d-warn" : "d-dim"));
        if (o.stale && age != null) sec.appendChild(note("Order data is " + plural(age, "day", "days") + " old.", "d-warn"));
      }
    }
    sec.appendChild(sub("Dispatch history"));
    if (!dp) sec.appendChild(empty(modFn("CrmSchedule", "dispatchStats") ? "No dispatch history imported yet." : "Not available yet."));
    else {
      var noIds = (dp.noDispatch90 || []).filter(function (id) { return !!S.get(id); });
      var dt = [];
      dt.push(jump("schedule", { sub: "dispatch" }, null, { class: "d-tile", dataset: { tile: "dispatch30" } }, [
        el("span", { class: "d-tile-label", text: "Dispatched last 30 days" }),
        el("span", { class: "d-val" }, [el("span", { class: "d-num", text: fmt.int(dp.slips30 || 0) }), el("small", { text: " slips · " }), el("span", { class: "d-num", text: fmt.int(dp.qty30 || 0) }), el("small", { text: " pcs" })])
      ]));
      dt.push(tile("dispatch-none90", "No dispatch in 90 days", num(noIds.length), noIds.length === 1 ? "customer" : "customers", "", "list", { extra: { kind: "ids", value: noIds, label: "No dispatch in 90 days" } }, noIds.length));
      sec.appendChild(tiles(dt));
      var dage = daysOld(dp.dataThrough, today);
      if (dp.dataThrough) sec.appendChild(note("Dispatch data through " + fmt.date(dp.dataThrough) + (dage != null && dage > 14 ? ". Dispatch data is " + plural(dage, "day", "days") + " old." : ""), dage != null && dage > 14 ? "d-warn" : "d-dim"));
    }
    sec.appendChild(actionBtn("Open Schedule", go("schedule", { sub: "orders" }), { class: "btn-sm no-print", id: "toSchedule" }));
  }

  function secLeads(grid, l) {
    var sec = card("leads", "Leads", 12);
    grid.appendChild(sec);
    if (l.state === "missing") return moduleMissing(sec);
    var s = l.state === "data" ? l.v : null, bk = s && s.byBucket ? s.byBucket : {};
    var any = s && ((s.open || 0) > 0 || Object.keys(bk).some(function (k) { return bk[k] > 0; }));
    if (!any) {
      sec.appendChild(empty("No leads yet. Import your lead trackers on the Leads tab."));
      sec.appendChild(actionBtn("Open Leads", go("leads", {}), { class: "btn-sm no-print", id: "toLeads" }));
      return;
    }
    var names = (mod("CrmLeads") && CrmLeads.BUCKETS) || {};
    var t = [];
    ["A", "B", "C", "D", "dormant", "jv"].forEach(function (k) {
      var n = bk[k] || 0;
      t.push(tile("lead-" + k, k === "dormant" ? "Bucket: Dormant" : k === "jv" ? "Bucket: JV" : "Bucket " + k, num(n), names[k] || "", "", "leads", { bucket: k }, n));
    });
    if (bk.none) t.push(tile("lead-none", "Bucket not set", num(bk.none), "", "", "leads", { bucket: "none" }, bk.none));
    t.push(tile("lead-dormant6", "Dormant > 6 months", num(s.dormant || 0), "", "", "leads", { flag: "dormant" }, s.dormant || 0));
    t.push(tile("lead-overdue", "Lead follow-ups overdue", num(s.followOverdue || 0), s.followOverdue ? "Overdue" : "None overdue", s.followOverdue ? "risk" : "", "leads", { flag: "overdue" }, s.followOverdue || 0));
    t.push(tile("lead-touched", "Touched in last 7 days", num(s.touched7 || 0), "", "", "leads", { flag: "touched7" }, s.touched7 || 0));
    sec.appendChild(tiles(t));
    var re = (s.reactivate || []).slice(0, 5);
    if (re.length) {
      sec.appendChild(sub("Reactivate next"));
      var ul = el("ul", { class: "d-rel" });
      re.forEach(function (x) {
        ul.appendChild(el("li", null, el("button", { type: "button", class: "d-link", dataset: { lead: x.id }, onclick: call("CrmLeads", "openEdit", x.id),
          text: x.company + (x.lastContact ? " · last contact " + fmt.date(x.lastContact) : "") + (x.category ? " · " + x.category : "") })));
      });
      sec.appendChild(ul);
    }
  }

  function secStatusMix(grid, d) {
    var sec = card("status", "Status mix", 4), c = d.customers;
    var stack = el("div", { class: "d-stack", "aria-hidden": "true" });
    var cls = { "Active": "ok", "Follow up": "warn", "At risk": "risk" };
    STATUSES.forEach(function (s) { if (c.status[s]) stack.appendChild(el("span", { class: "seg tone-" + cls[s], style: { width: (c.status[s] / c.total * 100) + "%" } })); });
    sec.appendChild(stack);
    var lg = el("div", { class: "d-legend col" });
    STATUSES.forEach(function (s) {
      var n = c.status[s], pct = c.total ? Math.round(n / c.total * 100) : 0;
      lg.appendChild(jump("list", { filter: s }, n, { class: "d-lg", dataset: { status: s } }, [
        el("span", { class: "sw tone-" + cls[s], "aria-hidden": "true" }), s + " ", el("span", { class: "d-num", text: String(n) }), " (" + pct + "%)"
      ]));
    });
    sec.appendChild(lg);
    grid.appendChild(sec);
  }

  function secRecency(grid, d, hasDispatch, latest) {
    var sec = card("recency", "Last order", 4), lo = d.lastOrder, v = dashView();
    var tg = el("div", { class: "d-toggle", role: "group", "aria-label": "Count days from" }, [
      el("span", { class: "d-dim", text: "Count days from" }),
      el("button", { type: "button", class: "chip", id: "fromToday", "aria-pressed": String(lo.from === "today"), text: "Today", onclick: function () { setDash("from", "today"); render(); } }),
      el("button", { type: "button", class: "chip", id: "fromData", "aria-pressed": String(lo.from === "data"), disabled: !latest,
        text: "Latest " + (lo.based === "dispatch" ? "dispatch" : "order") + " in the data" + (latest ? " (" + fmt.date(latest) + ")" : ""), onclick: function () { setDash("from", "data"); render(); } })
    ]);
    sec.appendChild(tg);
    if (hasDispatch) {
      sec.appendChild(el("div", { class: "d-toggle", role: "group", "aria-label": "Based on" }, [
        el("span", { class: "d-dim", text: "Based on" }),
        el("button", { type: "button", class: "chip", id: "basedInvoice", "aria-pressed": String(lo.based === "invoice"), text: "Last invoice", onclick: function () { setDash("based", "invoice"); render(); } }),
        el("button", { type: "button", class: "chip", id: "basedDispatch", "aria-pressed": String(lo.based === "dispatch"), text: "Last dispatch", onclick: function () { setDash("based", "dispatch"); render(); } })
      ]));
    }
    var max = 0;
    lo.buckets.forEach(function (b) { max = Math.max(max, b.n); });
    var bars = el("div", { class: "d-bars" });
    lo.buckets.forEach(function (b) {
      var label = b.key === "never" ? (lo.based === "dispatch" ? "No dispatch on record" : BUCKET_LABEL.never) : BUCKET_LABEL[b.key];
      var filter = lo.based === "dispatch"
        ? { extra: { kind: "ids", value: b.ids, label: b.key === "never" ? "No dispatch on record" : "Last dispatch " + BUCKET_LABEL[b.key] + " ago" } }
        : { extra: { kind: "last", value: b.key, ref: lo.ref } };
      bars.appendChild(hbar(label, b.n, max, "list", filter, { key: b.key, cls: "recency" }));
    });
    sec.appendChild(bars);
    sec.appendChild(note(lo.based === "dispatch"
      ? "Dispatch dates come from the dispatch history you imported" + (latest ? ", which runs to " + fmt.date(latest) : "") + "."
      : "Last order dates come from the Collections sheet, which stops at " + (latest ? fmt.date(latest) : "the last invoice loaded") + ". Newer orders may not be loaded, so counting from today can make customers look older than they are.", "d-dim"));
    grid.appendChild(sec);
  }

  function secStates(grid, d) {
    var sec = card("state", "By state", 4), v = dashView();
    var rows = d.byState, known = rows.filter(function (r) { return r.state; }), unk = rows.filter(function (r) { return !r.state; })[0];
    var showAll = v.allStates === true, shown = showAll ? known : known.slice(0, 8), max = 0;
    rows.forEach(function (r) { max = Math.max(max, r.n); });
    var bars = el("div", { class: "d-bars" });
    shown.forEach(function (r) { bars.appendChild(hbar(r.state, r.n, max, "list", { extra: { kind: "state", value: r.state } }, { key: r.state, cls: "state" })); });
    if (unk) bars.appendChild(hbar("Not known", unk.n, max, "list", { extra: { kind: "ids", value: unk.ids, label: "State not known" } }, { key: "unknown", cls: "state unknown" }));
    sec.appendChild(bars);
    if (known.length > 8) sec.appendChild(el("button", { type: "button", class: "btn-sm", id: "statesAll", text: showAll ? "Show fewer" : "Show all (" + known.length + ")", onclick: function () { setDash("allStates", !showAll); render(); } }));
    sec.appendChild(note("State comes from the GST number, or from the first plant when plants are set.", "d-dim"));
    grid.appendChild(sec);
  }

  function secSegments(grid, d) {
    var sec = card("segments", "By segment", 6), v = dashView();
    var hasMoney = moneyReady(), hasRev = revenueReady(), inc = v.incRelated === true;
    var max = 0;
    d.segments.forEach(function (r) { max = Math.max(max, r.n); });
    function extras(ids) {
      var parts = [];
      if (hasMoney) { var o = sumOverdue(ids); if (o > 0) parts.push(["overdue ", o]); }
      if (hasRev) { var rv = sumRevenue(ids, inc); if (rv > 0) parts.push(["revenue ", rv]); }
      if (!parts.length) return null;
      var n = el("small", { class: "hb-sub" });
      parts.forEach(function (p, i) { if (i) n.appendChild(document.createTextNode(" · ")); n.appendChild(document.createTextNode(p[0])); n.appendChild(amount(p[1], "")); });
      return n;
    }
    var bars = el("div", { class: "d-bars" });
    d.segments.forEach(function (r) {
      var b = hbar(r.key === "none" ? "Not set" : r.key, r.n, max, "list", { segment: r.key }, { key: r.key, cls: "segment" });
      var x = extras(r.ids);
      if (x) b.querySelector(".hb-label").appendChild(x);
      bars.appendChild(b);
    });
    sec.appendChild(bars);
    sec.appendChild(sub("By vehicle segment"));
    var chips = el("div", { class: "d-chips" });
    d.vehicleSegments.forEach(function (r) {
      chips.appendChild(jump("list", { vseg: r.key }, r.n, { class: "chip", dataset: { vseg: r.key } }, [(r.key === "none" ? "Not set" : r.key) + " ", el("b", { class: "d-num", text: String(r.n) })]));
    });
    sec.appendChild(chips);
    if (!d.anySegmentOrGroup) sec.appendChild(empty("No segments or groups set yet. Use Edit on a customer to add them."));
    grid.appendChild(sec);

    var g = card("groups", "By group", 6), showAll = v.allGroups === true;
    var groups = showAll ? d.groups : d.groups.slice(0, 8), gmax = 0;
    d.groups.forEach(function (r) { gmax = Math.max(gmax, r.n); });
    var gb = el("div", { class: "d-bars" });
    groups.forEach(function (r) {
      var b = hbar(r.group, r.n, gmax, "list", { group: r.group }, { key: r.group, cls: "group", after: r.n === 1 ? " customer" : " customers" });
      var x = extras(r.ids);
      if (x) b.querySelector(".hb-label").appendChild(x);
      gb.appendChild(b);
    });
    if (d.groups.length) g.appendChild(gb);
    if (d.groups.length > 8) g.appendChild(el("button", { type: "button", class: "btn-sm", id: "groupsAll", text: showAll ? "Show fewer" : "Show all (" + d.groups.length + ")", onclick: function () { setDash("allGroups", !showAll); render(); } }));
    g.appendChild(el("div", { class: "tiles d-one" }, [tile("nogroup", "Customers with no group", num(d.noGroup), "", "", "list", { group: "none" }, d.noGroup)]));
    if (!d.groups.length) g.appendChild(empty("No groups set yet. Use Edit on a customer to add one."));
    grid.appendChild(g);
  }

  function secActivity(grid, d) {
    var sec = card("activity", "Activity", 12), c = d.contact;
    sec.appendChild(tiles([
      tile("contact7", "Contacted in last 7 days", num(c.d7), "", "", "list", { extra: { kind: "contact", value: "7d" } }, c.d7),
      tile("contact30", "Contacted in last 30 days", num(c.d30), "", "", "list", { extra: { kind: "contact", value: "30d" } }, c.d30),
      tile("stale30", "Not contacted in 30+ days", num(c.stale30), c.stale30 ? "Includes never contacted" : "", "", "list", { extra: { kind: "contact", value: "stale30" } }, c.stale30)
    ]));
    sec.appendChild(sub("Recent activity"));
    if (!d.recent.length) {
      sec.appendChild(empty("No calls or notes logged yet. When you finish a follow-up, press ✓ Done on the customer; use Notes to record any call or visit."));
      sec.appendChild(actionBtn("Go to Attention now", function () {
        var h = document.getElementById("dh-attention");
        if (h) { h.scrollIntoView({ block: "start" }); h.focus({ preventScroll: true }); }
      }, { class: "btn-sm no-print", id: "toAttention" }));
    } else {
      var ul = el("ul", { class: "d-recent", id: "recentList" });
      d.recent.forEach(function (e) {
        ul.appendChild(el("li", { dataset: { log: e.id } }, [
          el("time", { datetime: e.at, text: fmt.date(e.at) }), el("span", { class: "d-type", text: e.type }),
          el("button", { type: "button", class: "d-link", text: e.name, onclick: call("CrmCustomers", "openNotes", e.customerId) }),
          e.doneFollowUp ? el("span", { class: "d-donetag", text: "Follow-up done" }) : null,
          e.note ? el("span", { class: "snippet", text: snippet(e.note) }) : null
        ]));
      });
      sec.appendChild(ul);
    }
    grid.appendChild(sec);
  }

  function attentionCsv(list) {
    var rows = [["Customer", "Contact person", "Phone", "Follow-up", "Status", "Last contacted"]];
    list.forEach(function (a) { rows.push([a.name, a.contact, a.phone, a.followUp, a.text, a.lastContacted]); });
    return "﻿" + CrmCsv.toCSV(rows) + "\r\n";
  }
  function secLinks(grid, d) {
    var sec = card("links", "Quick links", 12, "no-print");
    var row = el("div", { class: "d-links" });
    if (modFn("CrmReport", "open")) row.appendChild(el("button", { type: "button", class: "btn", id: "weeklyReportLink", text: "Weekly sales review", onclick: call("CrmReport", "open") }));
    row.appendChild(el("button", { type: "button", class: "btn", id: "attentionCsv", text: "Download Attention list (CSV)", onclick: function () {
      App.download("varsha-crm-attention-" + d.today + ".csv", attentionCsv(d.attention), "text/csv;charset=utf-8");
      App.announce("Attention list downloaded.");
    } }));
    row.appendChild(el("button", { type: "button", class: "btn", id: "toExport", text: "Open the Export tab", onclick: go("export") }));
    sec.appendChild(row);
    grid.appendChild(sec);
  }

  /* ---------- render ---------- */
  function render() {
    if (!root) return;
    var ae = document.activeElement, focusIdx = -1;
    if (ae && root.contains(ae) && ae !== root) focusIdx = Array.prototype.indexOf.call(root.querySelectorAll("button, a[href]"), ae);

    var today = S.todayISO(), v = dashView();
    var money = stat("CrmMoney", "stats"), rfq = stat("CrmRfq", "stats", today), visits = stat("CrmSchedule", "visitStats", today);
    var orders = stat("CrmSchedule", "orderStats", today), dispatch = stat("CrmSchedule", "dispatchStats", today), leads = stat("CrmLeads", "stats", today);
    if (money.state === "data" && modFn("CrmMoney", "has") && !CrmMoney.has()) money = { state: "empty" };
    var ld = lastDispatchFn(), hasDispatch = !!(ld && dispatch.state === "data");
    var based = v.based === "dispatch" && hasDispatch ? "dispatch" : "invoice";
    var latest = based === "dispatch" ? (dispatch.v && dispatch.v.dataThrough) || "" : S.latestOrder();
    var d = compute(S.customers(), S.allLog(), today, {
      from: v.from === "data" ? "data" : "today", latestOrder: latest, based: based, lastDispatch: ld,
      money: money.v, rfq: rfq.v, visits: visits.v, orders: orders.v, leads: leads.v, dispatch: dispatch.v
    });

    var frag = document.createDocumentFragment();
    // head
    var on = App.hideAmounts();
    var head = el("div", { class: "d-head" }, [
      el("p", { class: "d-asof", id: "dashAsOf", text: "As of " + longDate(today) + " (India time)" }),
      el("div", { class: "d-tools no-print" }, [
        el("button", { type: "button", class: "chip", id: "hideAmt", "aria-pressed": String(on), text: "Hide amounts", onclick: function () { App.setHideAmounts(!App.hideAmounts()); } }),
        modFn("CrmReport", "open") ? el("button", { type: "button", class: "btn", id: "weeklyReportBtn", text: "Weekly sales review" }) : null,   // CrmReport owns the click handler
        el("button", { type: "button", class: "btn", id: "printBtn", text: "Print / Save as PDF", onclick: function () { App.show("dash"); window.print(); } })
      ])
    ]);
    frag.appendChild(head);
    frag.appendChild(el("div", { id: "printHead" }, [
      el("img", { src: "assets/varsha-logo.jpg", alt: "Varsha Forgings", width: "48", height: "48" }),
      el("span", { text: "Varsha Forgings · CRM dashboard · " + fmt.date(today) + " (India time)" })
    ]));
    if (S.status().loadError && !d.customers.total) frag.appendChild(el("p", { class: "d-note d-warn", role: "alert", text: S.status().loadError }));

    var grid = el("div", { class: "dgrid" });
    secCustomers(grid, d);
    secMoney(grid, money, today);
    secRevenue(grid);
    secAttention(grid, d);
    secNext7(grid, d, today);
    secRfq(grid, rfq);
    secReleased(grid, rfq);
    secOrders(grid, d, today);
    secLeads(grid, leads);
    secStatusMix(grid, d);
    secRecency(grid, d, hasDispatch, latest);
    secStates(grid, d);
    secSegments(grid, d);
    secActivity(grid, d);
    secLinks(grid, d);
    frag.appendChild(grid);

    root.textContent = "";
    root.appendChild(frag);
    if (focusIdx >= 0) {
      var again = root.querySelectorAll("button, a[href]")[focusIdx];
      if (again) again.focus({ preventScroll: true });
    }
  }

  function mount(el0) { root = el0; root.classList.add("dash"); }

  App.registerPanel("dash", {
    label: "Dashboard", mount: mount, render: render, show: function () {},
    summary: function () { return "Dashboard"; }
  });
})();
