/* Schedule tab (A5): Visits & calls calendar | Upcoming orders | Dispatch history. Design 5.5 with addendum 12.4.
   Defines window.CrmSchedule = { visitStats, orderStats, dispatchStats, lastDispatch, dispatchMeta, openNewVisit, clearOrders,
   clearDispatches, visibleVisits, visibleOrders, summary }.
   Collections: visits (typed by hand), orders (typed by hand, never imported), dispatches (replaced by each import, NOT in the backup).
   Document: dispatch_meta. Pure functions are also module.exports for Node unit tests.
   Panel filter for App.show("schedule", f): { sub?: "visits"|"orders"|"dispatch", month?, day?, vflag?: "missed"|"next7"|"today",
   oflag?: "late"|"today"|"week"|"open"|"all", customerId?, q? }. A show() call REPLACES the filters. */
(function () {
  "use strict";

  var hasWindow = typeof window !== "undefined";
  var StoreRef = hasWindow ? window.Store : require("./store.js");

  var VISIT_TYPES = ["Visit", "Call", "Meeting"];
  var ORDER_STATUSES = ["Open", "Dispatched", "Cancelled"];
  var MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var STALE_DISPATCH_DAYS = 14;
  var PART_OK = /^[A-Z]{1,4}\d{2,6}(?:[ -]?[A-Z0-9-]+)*$/i;     // soft check: a warning only ("VF1050", "VF849 M")

  /* ============================== pure helpers ============================== */
  function dayNum(iso) { return StoreRef.dayNum(iso); }
  function addDays(iso, n) { return StoreRef.addDays(iso, n); }
  function daysBetween(a, b) { return StoreRef.daysBetween(a, b); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function addMonths(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + "-" + (m + 1 < 10 ? "0" : "") + (m + 1);
  }
  function monthLabel(ym) { return MON_LONG[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4); }
  function monthShort(ym) { return MON[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4); }
  function dateLong(iso) {
    var dt = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
    return DOW_LONG[dt.getUTCDay()] + " " + (+iso.slice(8, 10)) + " " + MON_LONG[+iso.slice(5, 7) - 1] + " " + iso.slice(0, 4);
  }
  function isJobwork(slip) { return /job\s*-?\s*work/i.test(String(slip || "")); }
  function normPart(code) { return String(code == null ? "" : code).trim().replace(/\s+/g, " ").toUpperCase(); }
  function partOk(code) { return PART_OK.test(String(code || "").trim()); }

  /* The 42 days of a month grid, Monday first, starting on the Monday on or before the 1st. */
  function monthGrid(ym) {
    var first = ym + "-01";
    var dow = (new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1)).getUTCDay() + 6) % 7;
    var start = addDays(first, -dow), out = [];
    for (var i = 0; i < 42; i++) out.push(addDays(start, i));
    return out;
  }

  /* ---------- visits ---------- */
  function visitState(v, today) {
    if (v.done) return { kind: "done", text: "Done" };
    var d = daysBetween(v.date, today);
    if (d > 0) return { kind: "missed", text: "Not done · " + plural(d, "day", "days") + " ago" };
    if (d === 0) return { kind: "today", text: "Today" };
    if (d === -1) return { kind: "later", text: "Tomorrow" };
    return { kind: "later", text: "In " + (-d) + " days" };
  }
  /* flag: "missed" (past, not done) | "today" (today, not done) | "next7" (tomorrow to 7 days ahead, not done) */
  function visitFlag(v, flag, today) {
    if (v.done) return false;
    if (flag === "missed") return v.date < today;
    if (flag === "today") return v.date === today;
    if (flag === "next7") return v.date > today && v.date <= addDays(today, 7);
    return true;
  }
  function cmpVisit(a, b) {
    return a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99") || String(a.created_at || "").localeCompare(String(b.created_at || ""));
  }
  function visitStats(visits, customers, today) {
    var names = {};
    (customers || []).forEach(function (c) { names[c.id] = c.name; });
    var next = (visits || []).filter(function (v) { return visitFlag(v, "next7", today); }).sort(cmpVisit);
    return {
      today: (visits || []).filter(function (v) { return visitFlag(v, "today", today); }).length,
      next7: next.map(function (v) { return { id: v.id, date: v.date, time: v.time || "", type: v.type, customerId: v.customer_id, customerName: names[v.customer_id] || "" }; }),
      next7Count: next.length,
      missed: (visits || []).filter(function (v) { return visitFlag(v, "missed", today); }).length
    };
  }

  /* ---------- typed orders ---------- */
  function orderState(o, today) {
    if (o.status === "Cancelled") return { kind: "cancelled", text: "Cancelled" };
    if (o.status === "Dispatched") {
      var late = o.dispatched && o.promised ? daysBetween(o.promised, o.dispatched) : 0;
      return late > 0 ? { kind: "dispatchedLate", text: "Dispatched " + plural(late, "day", "days") + " late" } : { kind: "dispatched", text: "Dispatched" };
    }
    var d = daysBetween(today, o.promised);
    if (d < 0) return { kind: "late", text: "Late by " + plural(-d, "day", "days") };
    if (d === 0) return { kind: "today", text: "Due today" };
    return { kind: d <= 7 ? "soon" : "later", text: "Due in " + plural(d, "day", "days") };
  }
  /* flag: late | today | week (1..7 days ahead) | open | all */
  function orderFlag(o, flag, today) {
    if (flag === "all" || !flag) return true;
    if (o.status !== "Open") return false;
    var d = daysBetween(today, o.promised);
    if (flag === "late") return d < 0;
    if (flag === "today") return d === 0;
    if (flag === "week") return d >= 1 && d <= 7;
    return true;
  }
  function orderStats(orders, today) {
    if (!orders || !orders.length) return null;
    var c = function (f) { return orders.filter(function (o) { return orderFlag(o, f, today); }).length; };
    var recent = orders.filter(function (o) {
      if (o.status !== "Dispatched" || !o.dispatched || !o.promised) return false;
      var d = daysBetween(o.dispatched, today);
      return d >= 0 && d <= 29;
    });
    var onTime = recent.filter(function (o) { return o.dispatched <= o.promised; }).length;
    return {
      asOf: null, stale: false,
      open: c("open"), late: c("late"), dueToday: c("today"), dueWeek: c("week"),
      onTimePct30: recent.length ? Math.round(onTime / recent.length * 100) : null
    };
  }
  /* The hint (never automatic): the same customer and part code on or after the order was created, one slip with qty >= the order qty.
     rows are resolved dispatch rows { date, customerId, part, qty }. Returns { date } or null. */
  function looksDispatched(order, rows, createdDate) {
    if (order.status !== "Open" || !order.customer_id || !order.part_code) return null;
    var code = normPart(order.part_code), best = null;
    (rows || []).forEach(function (r) {
      if (r.customerId !== order.customer_id || r.part !== code) return;
      if (createdDate && r.date < createdDate) return;
      if (r.qty < order.qty) return;
      if (!best || r.date < best) best = r.date;
    });
    return best ? { date: best } : null;
  }

  /* ---------- dispatch history ---------- */
  /* rows: { date, key, name, customerId, matched, part, qty, slip, job }. ref: the date the 30/90-day windows end on. */
  function dispatchAgg(rows, ref) {
    var cm = {}, pm = {}, mm = {}, total = 0, minYm = "", maxYm = "";
    rows.forEach(function (r) {
      var d = daysBetween(r.date, ref), in30 = d >= 0 && d <= 29, in90 = d >= 0 && d <= 89, ym = r.date.slice(0, 7);
      total += r.qty;
      var c = cm[r.key] || (cm[r.key] = { key: r.key, name: r.name, customerId: r.customerId, matched: r.matched, last: "", q30: 0, q90: 0, total: 0, slips: 0, jobSlips: 0, parts: {} });
      var cp = c.parts[r.part] || (c.parts[r.part] = { part: r.part, last: "", q30: 0, q90: 0, total: 0, slips: 0, jobSlips: 0 });
      var p = pm[r.part] || (pm[r.part] = { part: r.part, custs: {}, last: "", q30: 0, q90: 0, total: 0, slips: 0, jobSlips: 0 });
      [c, cp, p].forEach(function (x) {
        if (r.date > x.last) x.last = r.date;
        x.total += r.qty; x.slips++;
        if (r.job) x.jobSlips++;
        if (in30) x.q30 += r.qty;
        if (in90) x.q90 += r.qty;
      });
      p.custs[r.key] = 1;
      var m = mm[ym] || (mm[ym] = { ym: ym, qty: 0, slips: 0, jobQty: 0, jobSlips: 0 });
      m.qty += r.qty; m.slips++;
      if (r.job) { m.jobQty += r.qty; m.jobSlips++; }
      if (!minYm || ym < minYm) minYm = ym;
      if (ym > maxYm) maxYm = ym;
    });
    var customers = Object.keys(cm).map(function (k) {
      var c = cm[k];
      c.partRows = Object.keys(c.parts).map(function (pk) { return c.parts[pk]; }).sort(function (a, b) { return b.total - a.total || a.part.localeCompare(b.part); });
      c.partCount = c.partRows.length;
      delete c.parts;
      return c;
    }).sort(function (a, b) { return b.last.localeCompare(a.last) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    var parts = Object.keys(pm).map(function (k) {
      var p = pm[k];
      p.customers = Object.keys(p.custs).length;
      delete p.custs;
      return p;
    }).sort(function (a, b) { return b.total - a.total || a.part.localeCompare(b.part); });
    var months = [];
    if (maxYm) {
      var start = minYm > addMonths(maxYm, -11) ? minYm : addMonths(maxYm, -11);
      for (var ym = start; ym <= maxYm; ym = addMonths(ym, 1)) months.push(mm[ym] || { ym: ym, qty: 0, slips: 0, jobQty: 0, jobSlips: 0 });
    }
    return { customers: customers, parts: parts, months: months, totalQty: total, slips: rows.length };
  }
  function lastDispatchMap(rows) {
    var m = {};
    rows.forEach(function (r) { if (r.customerId && (!m[r.customerId] || r.date > m[r.customerId])) m[r.customerId] = r.date; });
    return m;
  }
  function dispatchStats(rows, customers, today) {
    if (!rows || !rows.length) return null;
    var through = "", s30 = 0, q30 = 0, c30 = {};
    rows.forEach(function (r) {
      if (r.date > through) through = r.date;
      var d = daysBetween(r.date, today);
      if (d >= 0 && d <= 29) { s30++; q30 += r.qty; if (r.customerId) c30[r.customerId] = 1; }
    });
    var last = lastDispatchMap(rows);
    return {
      dataThrough: through, slips30: s30, qty30: q30, customers30: Object.keys(c30).length,
      noDispatch90: (customers || []).filter(function (c) { return !last[c.id] || daysBetween(last[c.id], today) > 89; }).map(function (c) { return c.id; })
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      monthGrid: monthGrid, addMonths: addMonths, visitState: visitState, visitFlag: visitFlag, visitStats: visitStats,
      orderState: orderState, orderFlag: orderFlag, orderStats: orderStats, looksDispatched: looksDispatched,
      dispatchAgg: dispatchAgg, dispatchStats: dispatchStats, lastDispatchMap: lastDispatchMap, isJobwork: isJobwork, normPart: normPart, partOk: partOk
    };
  }
  if (!hasWindow) return;

  /* ============================== browser part ============================== */
  var Store = window.Store, Ui = window.Ui, App = window.App;
  var el = Ui.el;
  var $ = function (id) { return document.getElementById(id); };

  Store.registerCollection("dispatches", { backup: false });      // re-importable: not in the backup, never in git
  Store.registerDoc("dispatch_meta", { backup: false, imported: true });

  var SUBS = ["visits", "orders", "dispatch"];
  var SUB_LABEL = { visits: "Visits & calls", orders: "Upcoming orders", dispatch: "Dispatch history" };
  var DEFAULTS = {
    sub: "visits", month: "", wstart: "", day: "", vflag: "", vcust: "", vq: "",
    oflag: "open", ocust: "", oq: "",
    dview: "customer", dq: "", dfrom: "", dto: "", dslipOff: [], dmeasure: "today", dmonth: "", dcust: ""
  };
  var S = Object.assign({}, DEFAULTS);
  var rootEl = null, mq = null, E = {};
  var pendingDone = null;            // { id, log } - the inline "Also add to the call log" confirm
  var expanded = {};                 // by-customer rows opened in this session
  var focusDate = "";

  function phone() { return !!(mq && mq.matches); }
  function today() { return Store.todayISO(); }
  function iso(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T00:00:00Z")) ? v : ""; }
  function ym(v) { return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : ""; }

  /* ---------- state ---------- */
  function loadState() {
    var v = App.view("schedule");
    S = Object.assign({}, DEFAULTS);
    if (SUBS.indexOf(v.sub) !== -1) S.sub = v.sub;
    S.month = ym(v.month); S.wstart = iso(v.wstart); S.day = iso(v.day);
    if (["missed", "next7", "today"].indexOf(v.vflag) !== -1) S.vflag = v.vflag;
    if (["late", "today", "week", "open", "all"].indexOf(v.oflag) !== -1) S.oflag = v.oflag;
    ["vcust", "vq", "ocust", "oq", "dq", "dcust"].forEach(function (k) { if (typeof v[k] === "string") S[k] = v[k]; });
    if (["customer", "part", "month"].indexOf(v.dview) !== -1) S.dview = v.dview;
    S.dfrom = iso(v.dfrom); S.dto = iso(v.dto); S.dmonth = ym(v.dmonth);
    if (Array.isArray(v.dslipOff)) S.dslipOff = v.dslipOff.filter(function (x) { return typeof x === "string"; });
    if (v.dmeasure === "data" || v.dmeasure === "today") S.dmeasure = v.dmeasure;
  }
  function saveState() { App.setView("schedule", S); }
  function applyFilter(f) {
    f = f || {};
    var keep = { dview: S.dview, dslipOff: S.dslipOff, dmeasure: S.dmeasure };
    S = Object.assign({}, DEFAULTS, keep);
    var t = today();
    S.sub = SUBS.indexOf(f.sub) !== -1 ? f.sub : (f.oflag ? "orders" : "visits");
    if (["missed", "next7", "today"].indexOf(f.vflag) !== -1) S.vflag = f.vflag;
    if (["late", "today", "week", "open", "all"].indexOf(f.oflag) !== -1) S.oflag = f.oflag;
    if (iso(f.day)) { S.day = f.day; S.month = f.day.slice(0, 7); S.wstart = f.day; }
    else if (ym(f.month)) { S.month = f.month; S.wstart = f.month === t.slice(0, 7) ? t : f.month + "-01"; }
    if (typeof f.customerId === "string") { S.vcust = f.customerId; S.ocust = f.customerId; S.dcust = f.customerId; }
    if (typeof f.q === "string") { if (S.sub === "visits") S.vq = f.q; else if (S.sub === "orders") S.oq = f.q; else S.dq = f.q; }
  }
  function ensureMonth() {
    var t = today();
    if (!S.month) S.month = t.slice(0, 7);
    if (!S.wstart) S.wstart = S.month === t.slice(0, 7) ? t : S.month + "-01";
  }
  function selDay() {
    var t = today();
    if (S.day && S.day.slice(0, 7) === S.month) return S.day;
    return t.slice(0, 7) === S.month ? t : S.month + "-01";
  }

  /* ---------- shared bits ---------- */
  function custName(id) { var c = Store.get(id); return c ? c.name : "(removed customer)"; }
  function findCustomer(text) {
    var t = String(text || "").trim().toLowerCase();
    if (!t) return null;
    var list = Store.customers(), i;
    for (i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === t) return list[i];
    var m = Store.matchCustomer(text);
    return m ? Store.get(m) : null;
  }
  function openCustomerNotes(id) { if (window.CrmCustomers && CrmCustomers.openNotes) CrmCustomers.openNotes(id); }
  function chip(id, label, extra) {
    return el("button", { class: "chip" + (extra ? " " + extra : ""), type: "button", id: id, "aria-pressed": "false" }, [label + " ", el("b", { text: "0" })]);
  }
  function setChip(node, label, n, pressed, danger) {
    node.firstChild.nodeValue = label + " ";
    node.lastChild.textContent = String(n);
    node.setAttribute("aria-pressed", String(!!pressed));
    if (danger != null) node.classList.toggle("has", danger && n > 0);
  }
  function field(label, input, extra) { return el("label", extra ? { class: extra } : null, [label, input]); }
  function showErr(node, msg) { node.textContent = msg || ""; node.hidden = !msg; }
  function istDate(isoStamp) { return new Date(isoStamp).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }

  /* ======================================================================== */
  /*  Visits and calls                                                         */
  /* ======================================================================== */
  function visitRows() {
    var q = S.vq.trim().toLowerCase();
    return Store.col("visits").all().filter(function (v) {
      if (S.vcust && v.customer_id !== S.vcust) return false;
      if (q && (custName(v.customer_id) + " " + (v.note || "") + " " + v.type).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(cmpVisit);
  }
  function visitsOn(list, date) { return list.filter(function (v) { return v.date === date; }); }

  /* The entries the agenda lists right now. */
  function agendaModel(list, t) {
    var out = [], label;
    if (S.vflag) {
      label = S.vflag === "missed" ? "Not done" : S.vflag === "today" ? "Today" : "Next 7 days";
      var f = list.filter(function (v) { return visitFlag(v, S.vflag, t); });
      out.push({ title: label + " (" + f.length + ")", entries: f, red: S.vflag === "missed", flat: true });
      return out;
    }
    if (!phone()) {
      var d = selDay();
      out.push({ title: App.fmt.day(d) + (d === t ? " · today" : ""), entries: visitsOn(list, d), single: true });
      return out;
    }
    var missed = list.filter(function (v) { return visitFlag(v, "missed", t); });
    if (missed.length) out.push({ title: "Not done (" + missed.length + ")", entries: missed, red: true, flat: true });
    var seen = {};
    missed.forEach(function (v) { seen[v.id] = 1; });
    for (var i = 0; i < 30; i++) {
      var date = addDays(S.wstart, i), es = visitsOn(list, date).filter(function (v) { return !seen[v.id]; });
      if (!es.length) continue;
      var pre = date === t ? "Today · " : date === addDays(t, 1) ? "Tomorrow · " : "";
      out.push({ title: pre + App.fmt.day(date), entries: es });
    }
    return out;
  }
  function visibleVisits() {
    var list = visitRows(), t = today(), seen = {}, out = [];
    agendaModel(list, t).forEach(function (g) { g.entries.forEach(function (v) { if (!seen[v.id]) { seen[v.id] = 1; out.push(v); } }); });
    return out;
  }

  function entryItem(v, showDate, t) {
    var st = visitState(v, t), isPending = pendingDone && pendingDone.id === v.id;
    var li = el("li", { class: "sch-item sch-" + st.kind, dataset: { id: v.id } });
    var cb = el("input", { type: "checkbox", class: "vdone", id: "vdone-" + v.id, checked: v.done || isPending });
    cb.addEventListener("change", function () {
      if (cb.checked && !v.done) { pendingDone = { id: v.id, log: !v.log_id, focus: true }; renderVisits(); }
      else if (!cb.checked && v.done) { Store.col("visits").patch(v.id, { done: false, done_at: null }); App.flush(); }
      else { pendingDone = null; renderVisits(); }
    });
    var head = el("div", { class: "sch-head" }, [
      el("span", { class: "sch-time", text: (showDate ? App.fmt.day(v.date) + " · " : "") + (v.time || "Any time") }),
      el("span", { class: "sch-type", text: v.type })
    ]);
    var who = el("button", { type: "button", class: "sch-cust", text: custName(v.customer_id) });
    who.addEventListener("click", function () { openCustomerNotes(v.customer_id); });
    var edit = el("button", { type: "button", class: "btn-sm sch-edit", text: "Edit", "aria-label": "Edit " + v.type + " for " + custName(v.customer_id) });
    edit.addEventListener("click", function () { openVisitDialog(v.id, edit); });
    li.appendChild(head);
    li.appendChild(el("div", { class: "sch-main" }, [who, v.note ? el("p", { class: "sch-note", text: v.note }) : null]));
    li.appendChild(el("span", { class: "sch-state", text: st.text }));
    li.appendChild(el("div", { class: "sch-act" }, [el("label", { class: "sch-check", for: "vdone-" + v.id }, [cb, " Done"]), edit]));
    if (isPending) {
      var also = el("input", { type: "checkbox", id: "doneLog", checked: pendingDone.log, disabled: !!v.log_id });
      also.addEventListener("change", function () { pendingDone.log = also.checked; });
      var save = el("button", { type: "button", class: "btn-sm primary", id: "doneSave", text: "Save" });
      var cancel = el("button", { type: "button", class: "btn-sm", id: "doneCancel", text: "Cancel" });
      save.addEventListener("click", function () { commitDone(v, also.checked); });
      cancel.addEventListener("click", function () { pendingDone = null; renderVisits(); });
      li.appendChild(el("div", { class: "sch-confirm", role: "group", "aria-label": "Mark done" }, [
        v.log_id ? el("span", { class: "note", text: "Already in the call log." }) : el("label", { class: "sch-check" }, [also, " Also add to the call log"]),
        save, cancel
      ]));
    }
    return li;
  }

  function commitDone(v, alsoLog) {
    var t = today(), patch = { done: true, done_at: t };
    pendingDone = null;
    var finish = function () {
      Store.col("visits").patch(v.id, patch).then(function (res) {
        if (!res.ok) App.notice(res.error, "error");
        App.flush();
        App.announce(v.type + " marked done.");
      });
    };
    if (alsoLog && !v.log_id) {
      var type = v.type === "Call" ? "Call" : "Visit";
      Store.addLog(v.customer_id, { at: v.date > t ? t : v.date, type: type, note: v.note || v.type + " done (from Schedule)" }).then(function (res) {
        if (res.ok) patch.log_id = res.entry.id; else App.notice("Marked done, but the call log entry failed: " + res.error, "error");
        finish();
      });
    } else finish();
  }

  function renderAgenda(list, t) {
    var box = E.agenda;
    Ui.clear(box);
    var groups = agendaModel(list, t), any = false;
    groups.forEach(function (g) {
      any = any || g.entries.length > 0;
      var sec = el("section", { class: "sch-group" + (g.red ? " sch-redgroup" : "") });
      sec.appendChild(el("h3", { class: "sch-gtitle", text: g.title }));
      if (g.entries.length) {
        var ul = el("ul", { class: "sch-list" });
        g.entries.forEach(function (v) { ul.appendChild(entryItem(v, !!g.flat, t)); });
        sec.appendChild(ul);
      } else sec.appendChild(el("p", { class: "note", text: g.single ? "Nothing scheduled for this day." : "Nothing here." }));
      box.appendChild(sec);
    });
    if (!groups.length || (phone() && !any && !S.vflag)) {
      box.appendChild(el("p", { class: "sch-empty", text: "No visits or calls in this period. Use “Add visit or call” to schedule one." }));
    }
    if (pendingDone && pendingDone.focus) {
      pendingDone.focus = false;
      var b = $("doneSave");
      if (b) b.focus();
    }
  }

  function renderGrid(list, t) {
    var wrap = E.calwrap;
    Ui.clear(wrap);
    if (phone()) return;
    var sel = selDay(), cells = monthGrid(S.month);
    var table = el("table", { class: "cal", role: "grid", "aria-label": monthLabel(S.month) });
    table.appendChild(el("thead", null, el("tr", null, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(function (d) { return el("th", { scope: "col", text: d }); }))));
    var tb = el("tbody");
    for (var r = 0; r < 6; r++) {
      var tr = el("tr");
      for (var c = 0; c < 7; c++) {
        var date = cells[r * 7 + c], es = visitsOn(list, date);
        var missed = es.some(function (v) { return visitFlag(v, "missed", t); });
        var label = dateLong(date) + ", " + (es.length === 1 ? "1 entry" : es.length + " entries") + (date === t ? ", today" : "") + (missed ? ", has missed entries" : "");
        var b = el("button", {
          type: "button", class: "day" + (date.slice(0, 7) !== S.month ? " out" : "") + (date === t ? " today" : "") + (date === sel ? " sel" : ""),
          dataset: { date: date }, "aria-label": label, "aria-pressed": String(date === sel), tabindex: date === sel ? "0" : "-1"
        });
        b.appendChild(el("span", { class: "dnum", text: String(+date.slice(8, 10)) }));
        if (date === t) b.appendChild(el("span", { class: "sr-only", text: " today" }));
        if (missed) { b.appendChild(el("span", { class: "dot", "aria-hidden": "true" })); b.appendChild(el("span", { class: "sr-only", text: " has missed entries" })); }
        es.slice(0, 3).forEach(function (v) {
          var nm = custName(v.customer_id);
          b.appendChild(el("span", { class: "vchip vchip-" + visitState(v, t).kind, text: (v.time ? v.time + " " : "") + v.type + " · " + (nm.length > 16 ? nm.slice(0, 15) + "…" : nm) }));
        });
        if (es.length > 3) b.appendChild(el("span", { class: "vmore", text: "+" + (es.length - 3) + " more" }));
        tr.appendChild(el("td", { class: date.slice(0, 7) !== S.month ? "out" : null }, b));
      }
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    wrap.appendChild(table);
    if (focusDate) {
      var f = wrap.querySelector('button.day[data-date="' + focusDate + '"]');
      focusDate = "";
      if (f) f.focus();
    }
  }

  function gridKey(e) {
    var b = e.target.closest ? e.target.closest("button.day") : null;
    if (!b) return;
    var step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    if (!step) return;
    e.preventDefault();
    var target = addDays(b.dataset.date, step);
    if (target.slice(0, 7) !== S.month) { S.month = target.slice(0, 7); S.day = target; focusDate = target; renderVisits(); return; }
    var nb = E.calwrap.querySelector('button.day[data-date="' + target + '"]');
    if (!nb) return;
    Array.prototype.forEach.call(E.calwrap.querySelectorAll("button.day"), function (x) { x.tabIndex = -1; });
    nb.tabIndex = 0; nb.focus();
  }
  function selectDay(date) {
    S.day = date; S.month = date.slice(0, 7); S.vflag = "";
    focusDate = date;
    renderVisits();
  }

  function renderVisits() {
    if (!rootEl) return;
    ensureMonth();
    var t = today(), all = Store.col("visits").all();
    var list = visitRows();
    var st = visitStats(list, Store.customers(), t);
    setChip(E.vToday, "Today", st.today, S.vflag === "today");
    setChip(E.vNext, "Next 7 days", st.next7Count, S.vflag === "next7");
    setChip(E.vMissed, "Not done", st.missed, S.vflag === "missed", true);
    E.vMissed.classList.toggle("sch-redtext", st.missed > 0);
    // title
    if (phone()) E.calTitle.textContent = App.fmt.day(S.wstart) + " – " + App.fmt.day(addDays(S.wstart, 29));
    else E.calTitle.textContent = monthLabel(S.month);
    // extra filter chip
    var label = S.vcust ? "Customer: " + custName(S.vcust) : S.vq ? "Search: " + S.vq : "";
    E.vExtra.hidden = !label;
    E.vExtraLabel.textContent = label;
    renderGrid(list, t);
    renderAgenda(list, t);
    E.vEmpty.hidden = all.length > 0 || phone();
  }

  /* ---------- visit dialog ---------- */
  var vdlg = null, vf = {};
  function buildVisitDialog() {
    if (vdlg) return;
    vf.err = el("p", { class: "form-err", id: "visitErr", role: "alert", hidden: true });
    vf.cust = el("input", { name: "customer", id: "vCust", list: "vCustList", required: true, autocomplete: "off", maxlength: "120" });
    vf.list = el("datalist", { id: "vCustList" });
    vf.type = el("select", { name: "type", id: "vType" }, VISIT_TYPES.map(function (x) { return el("option", { value: x, text: x }); }));
    vf.date = el("input", { name: "date", id: "vDate", type: "date", required: true });
    vf.time = el("input", { name: "time", id: "vTime", type: "time" });
    vf.note = el("textarea", { name: "note", id: "vNote", rows: "3", maxlength: "500" });
    vf.count = el("div", { class: "count" });
    vf.done = el("input", { type: "checkbox", id: "vDone" });
    vf.doneWrap = el("label", { class: "sch-check", hidden: true }, [vf.done, " Done"]);
    vf.logAlso = el("input", { type: "checkbox", id: "vLogAlso", checked: true });
    vf.logWrap = el("label", { class: "sch-check", hidden: true }, [vf.logAlso, " Also add to the call log"]);
    vf.del = el("button", { type: "button", class: "btn", id: "visitDelete", text: "Delete", hidden: true });
    vf.cancel = el("button", { type: "button", class: "btn", id: "visitCancel", text: "Cancel" });
    vf.save = el("button", { type: "submit", class: "btn primary", id: "visitSave", text: "Save" });
    vf.form = el("form", { id: "visitForm", method: "dialog" }, [
      field("Customer *", vf.cust), vf.list,
      el("div", { class: "two" }, [field("Type", vf.type), field("Date *", vf.date)]),
      field("Time (optional)", vf.time),
      field("Note", vf.note), vf.count,
      vf.doneWrap, vf.logWrap, vf.err,
      el("div", { class: "actions" }, [vf.del, vf.cancel, vf.save])
    ]);
    vdlg = el("dialog", { id: "visitDlg", "aria-labelledby": "visitTitle" }, [el("div", { class: "dlg-head", id: "visitTitle", text: "Add visit or call" }), vf.form]);
    document.body.appendChild(vdlg);
    Ui.counter(vf.note, vf.count, 500);
    Ui.ctrlEnter(vf.note, vf.form);
    vf.cancel.addEventListener("click", function () { vdlg.close(); });
    vf.done.addEventListener("change", function () { syncLogRow(); });
    vf.del.addEventListener("click", function () {
      var id = vdlg.dataset.id;
      if (!id || !confirm("Delete this visit or call?")) return;
      Store.col("visits").remove(id).then(function (res) { if (!res.ok) { showErr(vf.err, res.error); return; } vdlg.close(); App.flush(); App.announce("Deleted."); });
    });
    vf.form.addEventListener("submit", function (e) { e.preventDefault(); saveVisit(); });
  }
  function syncLogRow() {
    var id = vdlg.dataset.id, v = id ? Store.col("visits").get(id) : null;
    vf.logWrap.hidden = !(vf.done.checked && !(v && v.done) && !(v && v.log_id));
  }
  function fillCustomerList() {
    Ui.clear(vf.list);
    Store.customers().forEach(function (c) { vf.list.appendChild(el("option", { value: c.name })); });
  }
  function openVisitDialog(id, opener, prefill) {
    buildVisitDialog();
    fillCustomerList();
    var v = id ? Store.col("visits").get(id) : null;
    vdlg.dataset.id = v ? v.id : "";
    $("visitTitle").textContent = v ? "Edit visit or call" : "Add visit or call";
    vf.cust.value = v ? custName(v.customer_id) : (prefill && prefill.customerId ? custName(prefill.customerId) : "");
    vf.type.value = v ? v.type : "Visit";
    vf.date.value = v ? v.date : (prefill && prefill.date) || (S.month ? selDay() : today());
    vf.time.value = v ? v.time || "" : "";
    vf.note.value = v ? v.note || "" : "";
    vf.done.checked = !!(v && v.done);
    vf.doneWrap.hidden = !v;
    vf.del.hidden = !v;
    vf.logAlso.checked = true;
    showErr(vf.err, "");
    syncLogRow();
    vf.cust.dispatchEvent(new Event("input"));
    vf.note.dispatchEvent(new Event("input"));
    App.openDialog(vdlg, opener || document.activeElement);
    if (!v) vf.cust.focus();
  }
  function saveVisit() {
    var c = findCustomer(vf.cust.value);
    if (!c) return showErr(vf.err, "Pick a customer from the list.");
    var date = iso(vf.date.value);
    if (!date) return showErr(vf.err, "Pick a date.");
    var time = vf.time.value || "";
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return showErr(vf.err, "Time must be like 10:30.");
    var note = vf.note.value.trim();
    if (note.length > 500) return showErr(vf.err, "A note can have 500 characters at most.");
    var id = vdlg.dataset.id, old = id ? Store.col("visits").get(id) : null, t = today();
    var row = { customer_id: c.id, type: vf.type.value, date: date, time: time, note: note };
    var goDone = !!(old && vf.done.checked && !old.done), alsoLog = goDone && vf.logAlso.checked && !old.log_id;
    var after = function (res) {
      if (!res.ok) return showErr(vf.err, res.error);
      S.day = date; S.month = date.slice(0, 7); if (!S.wstart || date < S.wstart) S.wstart = date;
      S.vflag = "";
      vdlg.close();
      App.flush();
      App.announce((old ? "Saved " : "Added ") + row.type.toLowerCase() + " for " + c.name + " on " + App.fmt.date(date) + ".");
    };
    if (!old) {
      row.done = false; row.done_at = null; row.log_id = null;
      Store.col("visits").insert(row).then(after);
      return;
    }
    if (vf.done.checked !== old.done) { row.done = vf.done.checked; row.done_at = vf.done.checked ? t : null; }
    if (alsoLog) {
      Store.addLog(c.id, { at: date > t ? t : date, type: row.type === "Call" ? "Call" : "Visit", note: note || row.type + " done (from Schedule)" }).then(function (lr) {
        if (lr.ok) row.log_id = lr.entry.id; else App.notice("Saved, but the call log entry failed: " + lr.error, "error");
        Store.col("visits").patch(old.id, row).then(after);
      });
    } else Store.col("visits").patch(old.id, row).then(after);
  }
  function openNewVisit(customerId, date) { openVisitDialog(null, document.activeElement, { customerId: customerId, date: date }); }

  /* ======================================================================== */
  /*  Dispatch rows (resolved against today's customers and aliases)           */
  /* ======================================================================== */
  var dver = 0, dcache = null;
  Store.onChange(function (reason) { if (reason === "dispatches" || reason === "aliases" || reason === "customers" || reason === "load" || reason === "dispatch_meta") { dver++; dcache = null; } });
  function dispatchRows() {
    if (dcache) return dcache;
    var memo = {}, out = [];
    Store.col("dispatches").all().forEach(function (r) {
      var sn = r.source_name || "";
      var res = memo[sn];
      if (!res) {
        var m = Store.matchCustomer(sn), id = null, ignored = false;
        if (m) id = m;
        else if (m === "") ignored = true;
        else if (r.customer_id && Store.get(r.customer_id)) id = r.customer_id;
        res = memo[sn] = { id: id, ignored: ignored, name: id ? custName(id) : sn };
      }
      out.push({
        date: r.date, key: res.id || "n:" + sn, name: res.name, customerId: res.id, matched: !!res.id, ignored: res.ignored, source: sn,
        part: normPart(r.part_code), partRaw: r.part_code, qty: Number(r.qty) || 0, slip: r.slip_type || "", job: isJobwork(r.slip_type)
      });
    });
    dcache = out;
    return out;
  }
  function dispatchMeta() { return Store.doc("dispatch_meta").get(); }
  function throughDate() {
    var m = dispatchMeta(), best = m && m.lastDate ? m.lastDate : "";
    if (!best) dispatchRows().forEach(function (r) { if (r.date > best) best = r.date; });
    return best;
  }
  var lastMap = null, lastVer = -1;
  function lastDispatch(id) {
    if (!lastMap || lastVer !== dver) { lastMap = lastDispatchMap(dispatchRows()); lastVer = dver; }
    return lastMap[id] || "";
  }
  function dispatchStatsNow(t) { return dispatchStats(dispatchRows(), Store.customers(), t || today()); }
  function slipTypes(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) { if (r.slip && !seen[r.slip]) { seen[r.slip] = 1; out.push(r.slip); } });
    return out.sort();
  }
  function dispatchFiltered(rows, withMonth) {
    var q = S.dq.trim().toLowerCase(), off = S.dslipOff;
    return rows.filter(function (r) {
      if (off.indexOf(r.slip) !== -1) return false;
      if (S.dfrom && r.date < S.dfrom) return false;
      if (S.dto && r.date > S.dto) return false;
      if (withMonth && S.dmonth && r.date.slice(0, 7) !== S.dmonth) return false;
      if (S.dcust && r.customerId !== S.dcust) return false;
      if (q && (r.name + " " + r.part + " " + r.partRaw).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function clearDispatches() {
    return Store.col("dispatches").replaceAll([]).then(function (r) { return Store.doc("dispatch_meta").clear().then(function () { return r; }); });
  }

  /* ---------- dispatch import ---------- */
  var DISPATCH_FIELDS = [
    { key: "date", label: "Date", required: true, type: "date" },
    { key: "customer", label: "Customer", required: true, type: "text" },
    { key: "partCode", label: "Part Code", required: true, type: "text" },
    { key: "qty", label: "Quantity", required: true, type: "int" },
    { key: "slipType", label: "Slip Type", required: true, type: "text" }
  ];
  function dispatchSkip(cells, map) {
    var g = function (k) { return String(cells[map[k]] == null ? "" : cells[map[k]]).trim(); };
    if (!g("date")) return "blank date";
    if (!g("partCode")) return "blank part code";
    if (!g("qty")) return "blank quantity";
    return null;
  }
  function dispatchWarnings(items) {
    var odd = items.filter(function (it) { return !partOk(it.partCode); });
    if (!odd.length) return [];
    var ex = [], seen = {};
    odd.forEach(function (it) { if (!seen[it.partCode] && ex.length < 3) { seen[it.partCode] = 1; ex.push(it.partCode); } });
    return [plural(odd.length, "row has", "rows have") + " a part code that looks unusual (for example " + ex.join(", ") + "). They are imported as they are."];
  }
  function onDispatchConfirm(res) {
    var rows = res.rows.map(function (r) {
      return { date: r.date, customer_id: r.customerId || null, source_name: r.sourceName, part_code: String(r.partCode).trim(), qty: r.qty, slip_type: String(r.slipType).trim() };
    });
    var first = "", last = "", types = {};
    rows.forEach(function (r) {
      if (!first || r.date < first) first = r.date;
      if (r.date > last) last = r.date;       // the MAX date, never the last row
      if (r.slip_type) types[r.slip_type] = 1;
    });
    var meta = { fileName: res.meta.fileName, fileDate: res.meta.fileDate, importedAt: res.meta.importedAt, firstDate: first, lastDate: last,
                 rows: rows.length, skipped: res.meta.skipped.length, slipTypes: Object.keys(types).sort() };
    return Store.col("dispatches").replaceAll(rows).then(function (r) {
      if (!r.ok) return r;
      S.dslipOff = S.dslipOff.filter(function (x) { return meta.slipTypes.indexOf(x) !== -1; });
      return Store.doc("dispatch_meta").set(meta);
    });
  }
  function openDispatchImport() {
    CrmImport.open({
      title: "Import dispatch history",
      intro: "Choose the dispatch history CSV with the columns Date (YYYY-MM-DD), Customer, Part Code, Quantity and Slip Type. Importing replaces the dispatch history already in this browser.",
      specs: [{ key: "dispatch", label: "Dispatch history", fields: DISPATCH_FIELDS, skipRow: dispatchSkip, warnings: dispatchWarnings }],
      customerField: "customer", asOf: false, onConfirm: onDispatchConfirm
    });
  }

  /* ---------- dispatch view ---------- */
  function qtyText(n) { return App.fmt.int(n); }
  function td(tr, label, kids, cls) {
    var c = el("td", { dataset: { label: label }, class: cls || null });
    if (kids != null) { if (typeof kids === "string") c.textContent = kids; else c.appendChild(kids); }
    tr.appendChild(c);
    return c;
  }
  function typeText(x) { return x.jobSlips === 0 ? "Dispatch" : x.jobSlips === x.slips ? "Jobwork" : "Dispatch and jobwork"; }
  function lastText(d) { return d ? App.fmt.date(d) : "—"; }

  function renderUnmatched(all) {
    var box = E.dUnm;
    Ui.clear(box);
    var names = {}, order = [];
    all.forEach(function (r) {
      if (r.matched || r.ignored) return;
      if (!names[r.source]) { names[r.source] = { qty: 0, slips: 0 }; order.push(r.source); }
      names[r.source].qty += r.qty; names[r.source].slips++;
    });
    box.hidden = !order.length;
    if (!order.length) return;
    box.appendChild(el("h3", { text: plural(order.length, "customer name is", "customer names are") + " not matched to a customer" }));
    box.appendChild(el("p", { class: "note", text: "Pick the customer for each name, or mark it as not a CRM customer. Your choice is remembered for the next import." }));
    var custs = Store.customers().slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    var ul = el("ul", { class: "sch-unm" });
    order.slice(0, 25).forEach(function (n) {
      var sel = el("select", { "aria-label": "Match " + n }, [
        el("option", { value: "?", text: "Choose customer…" }),
        custs.map(function (c) { return el("option", { value: c.id, text: c.name }); }),
        el("option", { value: "-", text: "Not a CRM customer" })
      ]);
      var btn = el("button", { type: "button", class: "btn-sm", text: "Save match" });
      btn.addEventListener("click", function () {
        if (sel.value === "?") { sel.focus(); return; }
        var map = {}; map[n] = sel.value === "-" ? "" : sel.value;
        Store.setAliases(map).then(function () { App.flush(); App.announce("Saved the match for " + n + "."); });
      });
      ul.appendChild(el("li", null, [el("span", { class: "sch-unmname", text: n }), el("span", { class: "note", text: plural(names[n].slips, "slip", "slips") + " · " + qtyText(names[n].qty) + " pcs" }), sel, btn]));
    });
    box.appendChild(ul);
    if (order.length > 25) box.appendChild(el("p", { class: "note", text: "+" + (order.length - 25) + " more names." }));
  }

  function renderSlipChips(all) {
    var box = E.dSlips;
    Ui.clear(box);
    var types = slipTypes(all);
    box.hidden = types.length < 1;
    if (!types.length) return;
    box.appendChild(el("span", { class: "bar-label", text: "Slip type" }));
    types.forEach(function (ty) {
      var on = S.dslipOff.indexOf(ty) === -1;
      var b = el("button", { type: "button", class: "chip dslip", "aria-pressed": String(on), dataset: { slip: ty }, text: ty });
      b.addEventListener("click", function () {
        var i = S.dslipOff.indexOf(ty);
        if (i === -1) S.dslipOff.push(ty); else S.dslipOff.splice(i, 1);
        renderDispatch();
      });
      box.appendChild(b);
    });
  }

  function renderCustomerView(agg, ref) {
    var wrap = E.dBody;
    if (!agg.customers.length) { wrap.appendChild(el("p", { class: "sch-empty", text: "No dispatch rows match these filters." })); return; }
    var table = el("table", { class: "sch-table", id: "dispatchByCustomer" });
    table.appendChild(el("thead", null, el("tr", null, ["Customer", "Last dispatch", "Qty last 30 days", "Qty last 90 days", "Parts", "Slips"].map(function (h) { return el("th", { text: h }); }))));
    var tb = el("tbody");
    agg.customers.forEach(function (c) {
      var open = !!expanded[c.key];
      var tr = el("tr", { dataset: { id: c.customerId || "", key: c.key } });
      var name = el("td", { dataset: { label: "Customer" }, class: "name" });
      var tog = el("button", { type: "button", class: "sch-tog", "aria-expanded": String(open), "aria-label": (open ? "Hide" : "Show") + " parts for " + c.name });
      tog.appendChild(el("span", { class: "sch-caret", text: open ? "▾" : "▸", "aria-hidden": "true" }));
      tog.appendChild(document.createTextNode(" " + c.name));
      tog.addEventListener("click", function () { expanded[c.key] = !expanded[c.key]; renderDispatch(); });
      name.appendChild(tog);
      if (!c.matched) name.appendChild(el("span", { class: "tag sch-nomatch", text: "Not matched" }));
      tr.appendChild(name);
      td(tr, "Last dispatch", lastText(c.last));
      td(tr, "Qty last 30 days", qtyText(c.q30));
      td(tr, "Qty last 90 days", qtyText(c.q90));
      td(tr, "Parts", String(c.partCount));
      td(tr, "Slips", String(c.slips) + (c.jobSlips ? " (" + c.jobSlips + " jobwork)" : ""));
      tb.appendChild(tr);
      if (open) {
        var ex = el("tr", { class: "sch-exp" });
        var cell = el("td", { colspan: "6" });
        var ul = el("ul", { class: "sch-parts" });
        c.partRows.forEach(function (p) {
          ul.appendChild(el("li", null, [
            el("span", { class: "sch-pcode", text: p.part }),
            el("span", { text: "30 days " + qtyText(p.q30) }), el("span", { text: "90 days " + qtyText(p.q90) }),
            el("span", { text: "Total " + qtyText(p.total) }), el("span", { text: "Last " + lastText(p.last) }),
            el("span", { class: p.jobSlips ? "sch-job" : "sch-dim", text: typeText(p) })
          ]));
        });
        cell.appendChild(ul);
        ex.appendChild(cell);
        tb.appendChild(ex);
      }
    });
    table.appendChild(tb);
    wrap.appendChild(el("div", { class: "card" }, table));
  }

  function renderPartView(agg) {
    var wrap = E.dBody;
    if (!agg.parts.length) { wrap.appendChild(el("p", { class: "sch-empty", text: "No dispatch rows match these filters." })); return; }
    var table = el("table", { class: "sch-table", id: "dispatchByPart" });
    table.appendChild(el("thead", null, el("tr", null, ["Part code", "Customers", "Last dispatch", "Qty last 30 days", "Qty last 90 days", "Total", "Type"].map(function (h) { return el("th", { text: h }); }))));
    var tb = el("tbody"), cap = 300;
    agg.parts.slice(0, cap).forEach(function (p) {
      var tr = el("tr", { dataset: { part: p.part } });
      td(tr, "Part code", p.part, "name");
      td(tr, "Customers", String(p.customers));
      td(tr, "Last dispatch", lastText(p.last));
      td(tr, "Qty last 30 days", qtyText(p.q30));
      td(tr, "Qty last 90 days", qtyText(p.q90));
      td(tr, "Total", qtyText(p.total));
      td(tr, "Type", typeText(p), p.jobSlips ? "sch-job" : "sch-dim");
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(el("div", { class: "card" }, table));
    if (agg.parts.length > cap) wrap.appendChild(el("p", { class: "note", text: "Showing the first " + cap + " of " + agg.parts.length + " parts. Narrow the search to see the rest." }));
  }

  function renderMonthView(agg) {
    var wrap = E.dBody;
    if (!agg.months.length) { wrap.appendChild(el("p", { class: "sch-empty", text: "No dispatch rows match these filters." })); return; }
    var max = Math.max.apply(null, agg.months.map(function (m) { return m.qty; })) || 1;
    var ul = el("ul", { class: "sch-months", id: "dispatchMonths" });
    agg.months.forEach(function (m) {
      var on = S.dmonth === m.ym;
      var txt = qtyText(m.qty) + " pcs · " + plural(m.slips, "slip", "slips") + (m.jobQty ? " · jobwork " + qtyText(m.jobQty) + " pcs" : "");
      var b = el("button", { type: "button", class: "sch-mbtn", "aria-pressed": String(on), dataset: { ym: m.ym }, "aria-label": monthShort(m.ym) + ": " + txt + (on ? " (selected)" : "") }, [
        el("span", { class: "sch-mname", text: monthShort(m.ym) }),
        el("span", { class: "sch-mtrack", "aria-hidden": "true" }, el("span", { class: "sch-mfill", style: { width: (m.qty / max * 100).toFixed(1) + "%" } })),
        el("span", { class: "sch-mtext", text: txt })
      ]);
      b.addEventListener("click", function () { S.dmonth = on ? "" : m.ym; renderDispatch(); });
      ul.appendChild(el("li", null, b));
    });
    wrap.appendChild(el("div", { class: "card sch-monthcard" }, ul));
    wrap.appendChild(el("p", { class: "note", text: "Bars show the last 12 months of data. Click a month to filter the By customer and By part lists to that month." }));
  }

  function renderDispatch() {
    if (!rootEl) return;
    var t = today(), all = dispatchRows(), meta = dispatchMeta();
    var has = all.length > 0;
    E.dEmpty.hidden = has;
    E.dMain.hidden = !has;
    E.dClear.hidden = !has;
    var through = has ? throughDate() : "";
    E.dThrough.hidden = !has;
    E.dThrough.classList.remove("sch-stale");
    if (has) {
      var age = Store.daysBetween(through, t), stale = age > STALE_DISPATCH_DAYS;
      E.dThrough.textContent = "Data through " + App.fmt.date(through) + (stale ? " · " + plural(age, "day", "days") + " old" : "");
      E.dThrough.classList.toggle("sch-stale", stale);
    }
    if (!has) return;
    // controls
    ["customer", "part", "month"].forEach(function (v) { E["dv-" + v].setAttribute("aria-pressed", String(S.dview === v)); });
    if (E.dQ.value !== S.dq) E.dQ.value = S.dq;
    E.dFrom.value = S.dfrom; E.dTo.value = S.dto;
    E.dMeasure.value = S.dmeasure;
    var cname = S.dcust ? custName(S.dcust) : "";
    E.dExtra.hidden = !(S.dmonth || S.dcust);
    E.dExtraLabel.textContent = [S.dmonth ? "Month: " + monthShort(S.dmonth) : "", S.dcust ? "Customer: " + cname : ""].filter(Boolean).join(" · ");
    renderSlipChips(all);
    renderUnmatched(all);
    var ref = S.dmeasure === "data" ? through : t;
    var rows = dispatchFiltered(all, S.dview !== "month");
    var agg = dispatchAgg(rows, ref);
    var sum = plural(agg.slips, "slip", "slips") + " · " + qtyText(agg.totalQty) + " pcs" + (S.dmeasure === "data" ? " · windows end " + App.fmt.date(ref) : "");
    E.dSummary.textContent = sum;
    Ui.clear(E.dBody);
    if (S.dview === "part") renderPartView(agg);
    else if (S.dview === "month") renderMonthView(agg);
    else renderCustomerView(agg, ref);
  }

  /* ======================================================================== */
  /*  Upcoming orders                                                          */
  /* ======================================================================== */
  function orderRows() {
    var q = S.oq.trim().toLowerCase(), t = today();
    return Store.col("orders").all().filter(function (o) {
      if (S.ocust && o.customer_id !== S.ocust) return false;
      if (!orderFlag(o, S.oflag, t)) return false;
      if (q && (custName(o.customer_id) + " " + (o.order_no || "") + " " + (o.part_code || "") + " " + (o.part || "")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      var oa = a.status === "Open" ? 0 : 1, ob = b.status === "Open" ? 0 : 1;
      return oa - ob || (a.promised || "").localeCompare(b.promised || "") || custName(a.customer_id).localeCompare(custName(b.customer_id));
    });
  }
  function visibleOrders() { return orderRows(); }

  function renderOrders() {
    if (!rootEl) return;
    var t = today(), allRows = Store.col("orders").all();
    var scoped = allRows.filter(function (o) { return !S.ocust || o.customer_id === S.ocust; });
    var n = function (f) { return scoped.filter(function (o) { return orderFlag(o, f, t); }).length; };
    setChip(E.oLate, "Late", n("late"), S.oflag === "late", true);
    E.oLate.classList.toggle("sch-redtext", n("late") > 0);
    setChip(E.oToday, "Due today", n("today"), S.oflag === "today");
    setChip(E.oWeek, "Due this week", n("week"), S.oflag === "week");
    setChip(E.oOpen, "Open", n("open"), S.oflag === "open");
    setChip(E.oAll, "All", scoped.length, S.oflag === "all");
    if (E.oQ.value !== S.oq) E.oQ.value = S.oq;
    E.oExtra.hidden = !S.ocust;
    E.oExtraLabel.textContent = S.ocust ? "Customer: " + custName(S.ocust) : "";
    var list = orderRows(), dRows = dispatchRows();
    Ui.clear(E.oRows);
    list.forEach(function (o) {
      var st = orderState(o, t);
      var tr = el("tr", { class: st.kind === "late" ? "sch-rowlate" : null, dataset: { id: o.id } });
      var who = el("button", { type: "button", class: "sch-cust", text: custName(o.customer_id) });
      who.addEventListener("click", function () { openCustomerNotes(o.customer_id); });
      td(tr, "Customer", who, "name");
      td(tr, "Order / PO", o.order_no || "—");
      td(tr, "Part", [o.part_code, o.part].filter(Boolean).join(" · ") || "—");
      td(tr, "Qty", qtyText(o.qty));
      td(tr, "Promised", App.fmt.date(o.promised));
      var stateCell = td(tr, "Status", el("span", { class: "sch-ostate sch-o-" + st.kind, text: st.text }));
      var hint = o.status === "Open" ? looksDispatched(o, dRows, istDate(o.created_at)) : null;
      if (hint) {
        var hb = el("button", { type: "button", class: "btn-sm sch-hint", text: "Looks dispatched on " + App.fmt.date(hint.date).replace(/ \d{4}$/, "") + ": mark dispatched?" });
        hb.addEventListener("click", function () {
          Store.col("orders").patch(o.id, { status: "Dispatched", dispatched: hint.date }).then(function (r) { if (!r.ok) App.notice(r.error, "error"); App.flush(); App.announce("Order marked dispatched."); });
        });
        stateCell.appendChild(hb);
      }
      var edit = el("button", { type: "button", class: "btn-sm", text: "Edit", "aria-label": "Edit order for " + custName(o.customer_id) });
      edit.addEventListener("click", function () { openOrderDialog(o.id, edit); });
      td(tr, "", edit, "act");
      E.oRows.appendChild(tr);
    });
    E.oEmpty.hidden = list.length > 0;
    E.oEmptyText.textContent = allRows.length ? "No orders match this filter." : "No upcoming orders yet. Add the orders customers have been promised dates for. Dispatch history (if imported) can then hint when one looks dispatched.";
    E.oTable.hidden = !list.length;
  }

  /* ---------- order dialog ---------- */
  var odlg = null, of = {};
  function buildOrderDialog() {
    if (odlg) return;
    of.err = el("p", { class: "form-err", id: "orderErr", role: "alert", hidden: true });
    of.cust = el("input", { id: "oCust", list: "oCustList", required: true, autocomplete: "off", maxlength: "120" });
    of.custList = el("datalist", { id: "oCustList" });
    of.no = el("input", { id: "oNo", maxlength: "60", autocomplete: "off" });
    of.code = el("input", { id: "oCode", list: "oCodeList", maxlength: "40", autocomplete: "off" });
    of.codeList = el("datalist", { id: "oCodeList" });
    of.part = el("input", { id: "oPart", maxlength: "120", autocomplete: "off" });
    of.qty = el("input", { id: "oQty", type: "number", min: "1", step: "1", inputmode: "numeric" });
    of.promised = el("input", { id: "oPromised", type: "date" });
    of.status = el("select", { id: "oStatus" }, ORDER_STATUSES.map(function (x) { return el("option", { value: x, text: x }); }));
    of.disp = el("input", { id: "oDispatched", type: "date" });
    of.dispWrap = el("label", { hidden: true }, ["Dispatched on *", of.disp]);
    of.note = el("textarea", { id: "oNote", rows: "2", maxlength: "500" });
    of.count = el("div", { class: "count" });
    of.del = el("button", { type: "button", class: "btn", id: "orderDelete", text: "Delete", hidden: true });
    of.cancel = el("button", { type: "button", class: "btn", id: "orderCancel", text: "Cancel" });
    of.save = el("button", { type: "submit", class: "btn primary", id: "orderSave", text: "Save order" });
    of.form = el("form", { id: "orderForm", method: "dialog" }, [
      field("Customer *", of.cust), of.custList,
      el("div", { class: "two" }, [field("PO / order no", of.no), field("Part code", of.code)]), of.codeList,
      field("Part description", of.part),
      el("div", { class: "two" }, [field("Quantity *", of.qty), field("Promised date *", of.promised)]),
      el("div", { class: "two" }, [field("Status", of.status), of.dispWrap]),
      field("Note", of.note), of.count, of.err,
      el("div", { class: "actions" }, [of.del, of.cancel, of.save])
    ]);
    odlg = el("dialog", { id: "orderDlg", "aria-labelledby": "orderTitle" }, [el("div", { class: "dlg-head", id: "orderTitle", text: "Add order" }), of.form]);
    document.body.appendChild(odlg);
    Ui.counter(of.note, of.count, 500);
    Ui.ctrlEnter(of.note, of.form);
    of.cancel.addEventListener("click", function () { odlg.close(); });
    of.status.addEventListener("change", syncOrderDispatched);
    of.cust.addEventListener("input", fillPartList);
    of.cust.addEventListener("change", fillPartList);
    of.del.addEventListener("click", function () {
      var id = odlg.dataset.id;
      if (!id || !confirm("Delete this order?")) return;
      Store.col("orders").remove(id).then(function (r) { if (!r.ok) { showErr(of.err, r.error); return; } odlg.close(); App.flush(); App.announce("Order deleted."); });
    });
    of.form.addEventListener("submit", function (e) { e.preventDefault(); saveOrder(); });
  }
  function syncOrderDispatched() {
    var d = of.status.value === "Dispatched";
    of.dispWrap.hidden = !d;
    if (d && !of.disp.value) of.disp.value = today();
  }
  function fillPartList() {
    Ui.clear(of.codeList);
    var c = findCustomer(of.cust.value);
    if (!c) return;
    var seen = {};
    dispatchRows().forEach(function (r) {
      if (r.customerId !== c.id || seen[r.part]) return;
      seen[r.part] = 1;
      of.codeList.appendChild(el("option", { value: r.partRaw }));
    });
  }
  function openOrderDialog(id, opener, prefill) {
    buildOrderDialog();
    Ui.clear(of.custList);
    Store.customers().forEach(function (c) { of.custList.appendChild(el("option", { value: c.name })); });
    var o = id ? Store.col("orders").get(id) : null;
    odlg.dataset.id = o ? o.id : "";
    $("orderTitle").textContent = o ? "Edit order" : "Add order";
    of.cust.value = o ? custName(o.customer_id) : (prefill && prefill.customerId ? custName(prefill.customerId) : (S.ocust ? custName(S.ocust) : ""));
    of.no.value = o ? o.order_no || "" : "";
    of.code.value = o ? o.part_code || "" : "";
    of.part.value = o ? o.part || "" : "";
    of.qty.value = o ? String(o.qty) : "";
    of.promised.value = o ? o.promised : "";
    of.status.value = o ? o.status : "Open";
    of.disp.value = o && o.dispatched ? o.dispatched : "";
    of.note.value = o ? o.note || "" : "";
    of.del.hidden = !o;
    showErr(of.err, "");
    syncOrderDispatched();
    fillPartList();
    of.note.dispatchEvent(new Event("input"));
    App.openDialog(odlg, opener || document.activeElement);
    if (!o) of.cust.focus();
  }
  function saveOrder() {
    var c = findCustomer(of.cust.value);
    if (!c) return showErr(of.err, "Pick a customer from the list.");
    var qtyText_ = of.qty.value.trim();
    if (!/^\d+$/.test(qtyText_) || +qtyText_ < 1 || +qtyText_ > 9999999) return showErr(of.err, "Quantity must be a whole number, 1 or more.");
    var promised = iso(of.promised.value);
    if (!promised) return showErr(of.err, "Pick the promised date.");
    var status = of.status.value, disp = iso(of.disp.value);
    if (status === "Dispatched") {
      if (!disp) return showErr(of.err, "Enter the date it was dispatched.");
      if (disp > today()) return showErr(of.err, "The dispatched date can't be in the future.");
    }
    var note = of.note.value.trim();
    if (note.length > 500) return showErr(of.err, "A note can have 500 characters at most.");
    var row = {
      customer_id: c.id, order_no: of.no.value.trim().slice(0, 60), part_code: of.code.value.trim().slice(0, 40), part: of.part.value.trim().slice(0, 120),
      qty: +qtyText_, promised: promised, status: status, dispatched: status === "Dispatched" ? disp : null, note: note
    };
    var id = odlg.dataset.id;
    var p = id ? Store.col("orders").patch(id, row) : Store.col("orders").insert(row);
    p.then(function (res) {
      if (!res.ok) return showErr(of.err, res.error);
      odlg.close();
      App.flush();
      App.announce("Order " + (id ? "saved" : "added") + " for " + c.name + ".");
    });
  }
  function clearOrders() { return Store.col("orders").replaceAll([]); }

  /* ======================================================================== */
  /*  Panel                                                                    */
  /* ======================================================================== */
  function showSub(sub, focus) {
    S.sub = sub;
    render();
    if (focus) { var tb = $("schTab-" + sub); if (tb) tb.focus(); }
  }
  function renderTabs() {
    SUBS.forEach(function (s) {
      var b = $("schTab-" + s), on = S.sub === s;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      $("schPane-" + s).hidden = !on;
    });
  }
  function render() {
    if (!rootEl) return;
    renderTabs();
    if (S.sub === "visits") renderVisits();
    else if (S.sub === "orders") renderOrders();
    else renderDispatch();
    saveState();
  }

  function summary() {
    if (S.sub === "orders") return "Showing " + visibleOrders().length + " of " + Store.col("orders").all().length + " upcoming orders.";
    if (S.sub === "dispatch") {
      var all = dispatchRows(), f = dispatchFiltered(all, true);
      return all.length ? "Showing " + f.length + " of " + all.length + " dispatch slips." : "No dispatch history imported.";
    }
    return "Showing " + visibleVisits().length + " of " + Store.col("visits").all().length + " visits and calls.";
  }

  function mount(root) {
    rootEl = root;
    root.classList.add("sch");
    loadState();
    if (window.matchMedia) {
      mq = window.matchMedia("(max-width: 860px)");
      var onMq = function () { if (rootEl && !rootEl.hidden) render(); };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
    }

    // sub tabs
    var tabs = el("div", { class: "sch-tabs", role: "tablist", "aria-label": "Schedule views" });
    SUBS.forEach(function (s) {
      var b = el("button", { type: "button", role: "tab", id: "schTab-" + s, class: "sch-tab", "aria-controls": "schPane-" + s, "aria-selected": "false", tabindex: "-1", text: SUB_LABEL[s] });
      b.addEventListener("click", function () { showSub(s); });
      tabs.appendChild(b);
    });
    tabs.addEventListener("keydown", function (e) {
      var i = SUBS.indexOf(S.sub), j = -1;
      if (e.key === "ArrowRight") j = (i + 1) % SUBS.length; else if (e.key === "ArrowLeft") j = (i + SUBS.length - 1) % SUBS.length;
      else if (e.key === "Home") j = 0; else if (e.key === "End") j = SUBS.length - 1;
      if (j < 0) return;
      e.preventDefault();
      showSub(SUBS[j], true);
    });
    root.appendChild(tabs);

    var pane = function (s) { return el("div", { class: "sch-pane", role: "tabpanel", id: "schPane-" + s, "aria-labelledby": "schTab-" + s, hidden: true }); };

    // ---- visits ----
    var pv = pane("visits");
    E.calTitle = el("h2", { class: "sch-title", id: "calTitle", "aria-live": "polite" });
    var prev = el("button", { type: "button", class: "btn-sm", id: "calPrev", text: "◀", "aria-label": "Previous" });
    var next = el("button", { type: "button", class: "btn-sm", id: "calNext", text: "▶", "aria-label": "Next" });
    var todayBtn = el("button", { type: "button", class: "btn-sm", id: "calToday", text: "Today" });
    var addBtn = el("button", { type: "button", class: "btn primary sch-add", id: "visitNew", text: "+ Add visit or call" });
    E.vToday = chip("vchip-today", "Today"); E.vNext = chip("vchip-next7", "Next 7 days"); E.vMissed = chip("vchip-missed", "Not done", "danger");
    E.vExtraLabel = el("span");
    var vx = el("button", { type: "button", class: "extra-x", text: "×", "aria-label": "Remove this filter", title: "Remove this filter" });
    E.vExtra = el("span", { class: "chip extra-chip", hidden: true }, [E.vExtraLabel, vx]);
    E.calwrap = el("div", { class: "sch-calwrap" });
    E.agenda = el("div", { class: "sch-agenda", id: "agenda" });
    E.vEmpty = el("p", { class: "note", hidden: true, text: "No visits or calls yet. Add one to see it on the calendar." });
    pv.appendChild(el("div", { class: "bar sch-nav" }, [prev, E.calTitle, next, todayBtn, addBtn]));
    pv.appendChild(el("div", { class: "bar", role: "group", "aria-label": "Filter visits and calls" }, [E.vToday, E.vNext, E.vMissed, E.vExtra]));
    pv.appendChild(el("div", { class: "sch-split" }, [E.calwrap, E.agenda]));
    pv.appendChild(E.vEmpty);
    root.appendChild(pv);
    prev.addEventListener("click", function () {
      if (phone()) S.wstart = addDays(S.wstart, -30); else { S.month = addMonths(S.month, -1); S.day = ""; }
      renderVisits(); saveState();
    });
    next.addEventListener("click", function () {
      if (phone()) S.wstart = addDays(S.wstart, 30); else { S.month = addMonths(S.month, 1); S.day = ""; }
      renderVisits(); saveState();
    });
    todayBtn.addEventListener("click", function () { var t = today(); S.month = t.slice(0, 7); S.wstart = t; S.day = t; S.vflag = ""; renderVisits(); saveState(); });
    addBtn.addEventListener("click", function () { openVisitDialog(null, addBtn); });
    [["today", E.vToday], ["next7", E.vNext], ["missed", E.vMissed]].forEach(function (p) {
      p[1].addEventListener("click", function () { S.vflag = S.vflag === p[0] ? "" : p[0]; renderVisits(); saveState(); });
    });
    vx.addEventListener("click", function () { S.vcust = ""; S.vq = ""; renderVisits(); saveState(); });
    E.calwrap.addEventListener("click", function (e) { var b = e.target.closest ? e.target.closest("button.day") : null; if (b) selectDay(b.dataset.date); });
    E.calwrap.addEventListener("keydown", gridKey);

    // ---- orders ----
    var po = pane("orders");
    E.oNew = el("button", { type: "button", class: "btn primary sch-add", id: "orderNew", text: "+ Add order" });
    E.oLate = chip("ochip-late", "Late", "danger"); E.oToday = chip("ochip-today", "Due today"); E.oWeek = chip("ochip-week", "Due this week");
    E.oOpen = chip("ochip-open", "Open"); E.oAll = chip("ochip-all", "All");
    E.oQ = el("input", { class: "search", id: "oq", type: "search", placeholder: "Search customer, PO, part", "aria-label": "Search orders" });
    E.oExtraLabel = el("span");
    var ox = el("button", { type: "button", class: "extra-x", text: "×", "aria-label": "Remove this filter", title: "Remove this filter" });
    E.oExtra = el("span", { class: "chip extra-chip", hidden: true }, [E.oExtraLabel, ox]);
    E.oRows = el("tbody", { id: "orderRows" });
    E.oTable = el("table", { class: "sch-table", id: "orderTable" }, [
      el("thead", null, el("tr", null, ["Customer", "Order / PO", "Part", "Qty", "Promised", "Status", ""].map(function (h) { return el("th", { text: h }); }))), E.oRows
    ]);
    E.oEmptyText = el("p");
    E.oEmpty = el("div", { class: "sch-empty", id: "orderEmpty", hidden: true }, E.oEmptyText);
    po.appendChild(el("div", { class: "bar sch-nav" }, [el("h2", { class: "sch-title", text: "Upcoming orders" }), E.oNew]));
    po.appendChild(el("div", { class: "bar", role: "group", "aria-label": "Filter orders" }, [E.oLate, E.oToday, E.oWeek, E.oOpen, E.oAll, E.oQ, E.oExtra]));
    po.appendChild(el("div", { class: "card" }, [E.oTable, E.oEmpty]));
    po.appendChild(el("p", { class: "rule", text: "Orders are typed by hand with the date promised to the customer. An open order past its promised date is Late. Marking an order dispatched is always your choice." }));
    root.appendChild(po);
    E.oNew.addEventListener("click", function () { openOrderDialog(null, E.oNew); });
    [["late", E.oLate], ["today", E.oToday], ["week", E.oWeek], ["open", E.oOpen], ["all", E.oAll]].forEach(function (p) {
      p[1].addEventListener("click", function () { S.oflag = p[0]; renderOrders(); saveState(); });
    });
    E.oQ.addEventListener("input", function () { S.oq = E.oQ.value; renderOrders(); saveState(); });
    ox.addEventListener("click", function () { S.ocust = ""; renderOrders(); saveState(); });

    // ---- dispatch ----
    var pd = pane("dispatch");
    E.dImport = el("button", { type: "button", class: "btn primary sch-add", id: "dispatchImport", text: "Import dispatch history" });
    E.dClear = el("button", { type: "button", class: "btn", id: "dispatchClear", text: "Clear dispatch history", hidden: true });
    E.dThrough = el("p", { class: "sch-through", id: "dispatchThrough", hidden: true });
    E.dEmptyText = el("p", { text: "No dispatch history imported yet. Import the tidy dispatch CSV (columns: Date, Customer, Part Code, Quantity, Slip Type) to see last dispatch, quantities by customer and by part, and month totals." });
    E.dEmpty = el("div", { class: "sch-empty", id: "dispatchEmpty" }, E.dEmptyText);
    ["customer", "part", "month"].forEach(function (v) {
      E["dv-" + v] = el("button", { type: "button", class: "chip", id: "dv-" + v, "aria-pressed": "false", text: v === "customer" ? "By customer" : v === "part" ? "By part" : "Month totals" });
      E["dv-" + v].addEventListener("click", function () { S.dview = v; renderDispatch(); saveState(); });
    });
    E.dQ = el("input", { class: "search", id: "dq", type: "search", placeholder: "Search customer or part", "aria-label": "Search dispatch history" });
    E.dFrom = el("input", { type: "date", id: "dfrom", "aria-label": "From date" });
    E.dTo = el("input", { type: "date", id: "dto", "aria-label": "To date" });
    E.dMeasure = el("select", { id: "dmeasure", "aria-label": "Measure from" }, [el("option", { value: "today", text: "Today" }), el("option", { value: "data", text: "Last dispatch in the file" })]);
    E.dExtraLabel = el("span");
    var dx = el("button", { type: "button", class: "extra-x", text: "×", "aria-label": "Remove this filter", title: "Remove this filter" });
    E.dExtra = el("span", { class: "chip extra-chip", hidden: true }, [E.dExtraLabel, dx]);
    E.dSlips = el("div", { class: "bar", role: "group", "aria-label": "Slip types", id: "dslips" });
    E.dUnm = el("div", { class: "sch-unmbox card", id: "dispatchUnmatched", hidden: true });
    E.dSummary = el("p", { class: "note", id: "dispatchSummary" });
    E.dBody = el("div", { id: "dispatchBody" });
    E.dMain = el("div", { hidden: true }, [
      el("div", { class: "bar", role: "group", "aria-label": "Dispatch view" }, [E.dv_customer = E["dv-customer"], E["dv-part"], E["dv-month"]]),
      el("div", { class: "bar sch-filters" }, [E.dQ, el("label", { class: "sch-inline" }, ["From", E.dFrom]), el("label", { class: "sch-inline" }, ["To", E.dTo]), el("label", { class: "sch-inline" }, ["Measure from", E.dMeasure]), E.dExtra]),
      E.dSlips, E.dUnm, E.dSummary, E.dBody
    ]);
    pd.appendChild(el("div", { class: "bar sch-nav" }, [el("h2", { class: "sch-title", text: "Dispatch history" }), E.dImport, E.dClear]));
    pd.appendChild(E.dThrough);
    pd.appendChild(E.dEmpty);
    pd.appendChild(E.dMain);
    root.appendChild(pd);
    E.dImport.addEventListener("click", openDispatchImport);
    E.dClear.addEventListener("click", function () {
      if (!confirm("Remove the imported dispatch history from this browser?")) return;
      clearDispatches().then(function () { App.flush(); App.announce("Dispatch history cleared."); });
    });
    E.dQ.addEventListener("input", function () { S.dq = E.dQ.value; renderDispatch(); saveState(); });
    E.dFrom.addEventListener("change", function () { S.dfrom = iso(E.dFrom.value); renderDispatch(); saveState(); });
    E.dTo.addEventListener("change", function () { S.dto = iso(E.dTo.value); renderDispatch(); saveState(); });
    E.dMeasure.addEventListener("change", function () { S.dmeasure = E.dMeasure.value === "data" ? "data" : "today"; renderDispatch(); saveState(); });
    dx.addEventListener("click", function () { S.dmonth = ""; S.dcust = ""; renderDispatch(); saveState(); });
  }

  App.registerPanel("schedule", {
    label: "Schedule", mount: mount, render: render,
    show: function (f) { applyFilter(f); },
    summary: summary
  });

  window.CrmSchedule = {
    visitStats: function (t) { return visitStats(Store.col("visits").all(), Store.customers(), t || today()); },
    orderStats: function (t) { return orderStats(Store.col("orders").all(), t || today()); },
    dispatchStats: dispatchStatsNow,
    lastDispatch: lastDispatch,
    dispatchMeta: dispatchMeta,
    openNewVisit: openNewVisit,
    clearOrders: clearOrders,
    clearDispatches: clearDispatches,
    visibleVisits: visibleVisits,
    visibleOrders: visibleOrders,
    summary: summary
  };
})();
