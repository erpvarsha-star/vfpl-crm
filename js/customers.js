/* Customers tab (A1 ported Phase 1; A2 adds Mark done, Notes and call log, Edit, plants / group / segment, filters,
   and the money / revenue / dispatch lines).
   Contract (design 4.5, 12.5): window.CrmCustomers = { openAdd(prefill?, onSaved?), openDone(id), openNotes(id), openEdit(id), visible, summary }.
   Filter keys for App.show("list", filter): view, filter, q, sort, segment, vseg, group, extra.
   Other modules are consumed only through their contracts and may be absent: CrmMoney, CrmRevenue, CrmSchedule. */
(function () {
  "use strict";

  var el = Ui.el;
  var $ = function (id) { return document.getElementById(id); };
  var ORDER = { "At risk": 0, "Follow up": 1, "Active": 2 };
  var STATUSES = ["Active", "Follow up", "At risk"];
  var VIEWS = ["all", "overdue", "today", "week", "none"];
  var SORTS = ["name", "last", "follow", "status", "overdue", "revenue", "dispatch"];
  var EXTRA_KINDS = ["last", "state", "disputed", "contact", "due", "ids", "money", "aging", "related"];
  var NOTE_MAX = 500;

  var state = { view: "all", filter: "all", q: "", sort: "follow", dir: 1, extra: null, segment: "", vseg: "", group: "" };
  var mountedEl = null;
  var cache = {};       // per-render memo of other modules' answers (cleared at the start of compute)

  function warn(msg, e) { if (typeof console !== "undefined") console.warn(msg, e && e.message ? e.message : e); }

  /* ---------- other modules (all optional) ---------- */
  function mod(name) { return window[name] || null; }
  function safe(fn, fallback) { try { return fn(); } catch (e) { warn("A module call failed", e); return fallback; } }
  function moneyHas() { var m = mod("CrmMoney"); return !!(m && m.has && safe(function () { return m.has(); }, false)); }
  function revHas() { var r = mod("CrmRevenue"); return !!(r && r.has && safe(function () { return r.has(); }, false)); }
  function money(c) {
    if (!moneyHas() || !CrmMoney.forCustomer) return null;
    if (!(c.id in cache)) cache[c.id] = safe(function () { return CrmMoney.forCustomer(c.id) || null; }, null);
    return cache[c.id];
  }
  var revCache = {}, dispCache = {};
  function revenue(c) {
    if (!revHas() || !CrmRevenue.forCustomer) return null;
    if (!(c.id in revCache)) revCache[c.id] = safe(function () { return CrmRevenue.forCustomer(c.id) || null; }, null);
    return revCache[c.id];
  }
  function dispatchOf(c) {
    var s = mod("CrmSchedule");
    if (!s || !s.lastDispatch) return "";
    if (!(c.id in dispCache)) dispCache[c.id] = safe(function () { return s.lastDispatch(c.id) || ""; }, "");
    return dispCache[c.id];
  }
  function resetCaches() { cache = {}; revCache = {}; dispCache = {}; }

  /* ---------- state ---------- */
  function cleanExtra(x) {
    if (!x || typeof x !== "object" || EXTRA_KINDS.indexOf(x.kind) === -1) return null;
    var out = { kind: x.kind };
    if (x.value !== undefined) out.value = x.value;
    if (x.ref) out.ref = x.ref;
    if (x.label) out.label = String(x.label);
    return out;
  }
  function cleanSeg(v) { return v === "none" || Store.SEGMENTS.indexOf(v) !== -1 ? v : ""; }
  function cleanVseg(v) { return v === "none" || Store.VEHICLE_SEGMENTS.indexOf(v) !== -1 ? v : ""; }
  function cleanGroup(v) { return typeof v === "string" ? v.slice(0, 80) : ""; }
  function loadState() {
    var v = App.view("list");
    if (VIEWS.indexOf(v.view) !== -1) state.view = v.view;
    if (v.filter === "all" || ORDER.hasOwnProperty(v.filter)) state.filter = v.filter;
    if (typeof v.q === "string") state.q = v.q;
    if (SORTS.indexOf(v.sort) !== -1) state.sort = v.sort;
    if (v.dir === 1 || v.dir === -1) state.dir = v.dir;
    state.extra = cleanExtra(v.extra);
    state.segment = cleanSeg(v.segment);
    state.vseg = cleanVseg(v.vseg);
    state.group = cleanGroup(v.group);
  }
  function saveState() { App.setView("list", state); }
  /* show(filter) REPLACES the filters (sort is kept unless given). */
  function applyFilter(f) {
    f = f || {};
    state.view = VIEWS.indexOf(f.view) !== -1 ? f.view : "all";
    state.filter = f.filter === "all" || ORDER.hasOwnProperty(f.filter) ? f.filter : "all";
    state.q = typeof f.q === "string" ? f.q : "";
    state.extra = cleanExtra(f.extra);
    state.segment = cleanSeg(f.segment);
    state.vseg = cleanVseg(f.vseg);
    state.group = cleanGroup(f.group);
    if (SORTS.indexOf(f.sort) !== -1) { state.sort = f.sort; state.dir = 1; }
  }
  function syncControls() {
    Array.prototype.forEach.call(document.querySelectorAll(".chip[data-v]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === state.view)); });
    Array.prototype.forEach.call(document.querySelectorAll(".chip[data-f]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.f === state.filter)); });
    $("q").value = state.q;
  }

  /* ---------- extra filter ---------- */
  var BUCKET_LABEL = { "0-30": "0–30 days ago", "31-60": "31–60 days ago", "61-90": "61–90 days ago", "91+": "91+ days ago" };
  var AGING_LABEL = { b1_30: "1–30 days", b31_60: "31–60 days", b61_90: "61–90 days", b90: "over 90 days" };
  function extraLabel(x) {
    switch (x.kind) {
      case "last": return x.value === "never" ? "No order on record" : "Last order " + (BUCKET_LABEL[x.value] || x.value);
      case "state": return "State: " + x.value;
      case "disputed": return "Disputed";
      case "contact": return x.value === "7d" ? "Contacted in the last 7 days" : x.value === "30d" ? "Contacted in the last 30 days" : "Not contacted in 30+ days";
      case "due": return "Follow-up on " + App.fmt.day(x.value);
      case "ids":
        var n = Array.isArray(x.value) ? x.value.length : 0;
        return n === 1 && x.label ? "Customer: " + x.label : x.label || "These " + n + " customers";
      case "money": return x.value === "outstanding" ? "Has outstanding amount" : "Has overdue amount";
      case "aging": return "Overdue " + (AGING_LABEL[x.value] || x.value);
      case "related": return "Related parties";
    }
    return "";
  }
  function extraPass(c, x, today) {
    switch (x.kind) {
      case "last": return Store.lastBucket(c, x.ref || today) === x.value;
      case "state": return c.state === x.value || c.plants.some(function (p) { return p.state === x.value; });
      case "disputed": return c.disputed;
      case "contact":
        var lc = Store.lastContacted(c.id), d = lc ? Store.daysBetween(lc, today) : null;
        if (x.value === "7d") return lc && d <= 7;
        if (x.value === "30d") return lc && d <= 30;
        return !lc || d > 30;
      case "due": return c.followUp === x.value;
      case "ids": return Array.isArray(x.value) && x.value.indexOf(c.id) !== -1;
      case "money":
        var m = money(c);
        return !!m && (x.value === "outstanding" ? (m.outstanding || 0) > 0 : (m.overdue || 0) > 0);
      case "aging":
        var a = money(c);
        return !!a && (a[x.value] || 0) > 0;
      case "related": return c.relatedParty;
    }
    return true;
  }

  /* ---------- list ---------- */
  function revenueOf(c) {
    var r = revenue(c);
    return r && r.fytd ? r.fytd : 0;
  }
  function compute() {
    resetCaches();
    var today = Store.todayISO();
    var q = state.q.trim().toLowerCase();
    var list = Store.customers().filter(function (c) {
      if (state.filter !== "all" && c.status !== state.filter) return false;
      if (state.view !== "all" && Store.fuKind(c, today) !== state.view) return false;
      if (state.segment) { if (state.segment === "none" ? c.segment : c.segment !== state.segment) return false; }
      if (state.vseg) { if (state.vseg === "none" ? c.vehicleSegment : c.vehicleSegment !== state.vseg) return false; }
      if (state.group) { if (state.group === "none" ? c.group : c.group !== state.group) return false; }
      if (state.extra && !extraPass(c, state.extra, today)) return false;
      if (!q) return true;
      var hay = [c.name, c.contact, c.phone, c.city, c.state, c.group].concat(c.plants.map(function (p) { return p.name + " " + p.city + " " + p.state; })).join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    list.sort(function (a, b) {
      var r;
      if (state.sort === "name") r = a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * state.dir;
      else if (state.sort === "last") r = (b.last || "").localeCompare(a.last || "") * state.dir;
      else if (state.sort === "status") r = (ORDER[a.status] - ORDER[b.status]) * state.dir;
      else if (state.sort === "overdue") {
        var ma = money(a), mb = money(b);
        r = (((mb && mb.overdue) || 0) - ((ma && ma.overdue) || 0)) * state.dir;
      } else if (state.sort === "revenue") r = (revenueOf(b) - revenueOf(a)) * state.dir;
      else if (state.sort === "dispatch") r = dispatchOf(b).localeCompare(dispatchOf(a)) * state.dir;
      else if (!a.followUp && !b.followUp) r = 0;           // soonest follow-up first, undated last
      else if (!a.followUp) r = 1;
      else if (!b.followUp) r = -1;
      else r = a.followUp.localeCompare(b.followUp) * state.dir;
      return r || (b.last || "").localeCompare(a.last || "") || a.name.localeCompare(b.name);
    });
    return list;
  }

  function cls(status) { return status === "Active" ? "s-active" : status === "Follow up" ? "s-follow" : "s-risk"; }
  function cell(tr, label, klass) {
    var td = el("td", { dataset: { label: label }, class: klass || null });
    tr.appendChild(td);
    return td;
  }
  function dash(td) { td.textContent = "—"; td.classList.add("muted"); }
  function fmtPhone(p) {
    var d = String(p || "").replace(/\s+/g, "");
    return /^\d{10}$/.test(d) ? d.slice(0, 5) + " " + d.slice(5) : String(p || "").trim();
  }
  function setFollow(c, v) { Store.setFollowUp(c.id, v); App.flush(); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function plantPlace(p) { return [p.city, p.state].filter(Boolean).join(", "); }

  /* "Last contacted 12 Oct 2026 · 7 days ago" / "... · today" / "No contact logged yet" */
  function lastContactText(id, today) {
    var lc = Store.lastContacted(id);
    if (!lc) return "No contact logged yet";
    var d = Store.daysBetween(lc, today);
    return "Last contacted " + App.fmt.date(lc) + " · " + (d <= 0 ? "today" : App.fmt.rel(d) + " ago");
  }

  function tagButton(text, label, key, value) {
    var b = el("button", { type: "button", class: "tag-btn", text: text, "aria-label": label });
    b.addEventListener("click", function () {
      state[key] = value;
      render();
      App.announce("Showing " + plural(compute().length, "customer", "customers") + " for " + text + ".");
    });
    return b;
  }

  function buildMoneyCell(tr, c) {
    var td = cell(tr, "Money", "money");
    var m = money(c), r = revenue(c), any = false;
    if (m) {
      var meta = safe(function () { return CrmMoney.meta(); }, null) || {};
      var asOf = (meta.aging && meta.aging.asOf) || (meta.live && meta.live.asOf) || "";
      if (asOf) td.title = "Data as of " + App.fmt.date(asOf);
      td.appendChild(el("div", { class: "money-line" }, [Ui.amountEl(m.outstanding, "amt")]));
      var over = null;
      if (m.overdue != null && m.overdue > 0) {
        over = el("span", { class: "amt-over" }, [
          (m.shared ? "Group " + m.shared.groupName + ": " : "") + "Overdue ", Ui.amountEl(m.overdue),
          m.shared ? " (shared by " + m.shared.n + ")" : ""
        ]);
      } else if (m.overdue === 0) over = el("span", { class: "amt-none", text: "No overdue" });
      if (over) td.appendChild(el("div", { class: "money-line" }, [over]));
      any = true;
    }
    if (r && r.fytd != null) {
      td.appendChild(el("div", { class: "money-line money-rev" }, [el("span", { class: "amt-rev" }, ["FY revenue ", Ui.amountEl(r.fytd)])]));
      any = true;
    }
    if (!any) dash(td);
  }

  function buildRow(c, today, showMoney) {
    var kind = Store.fuKind(c, today);
    var tr = el("tr", { class: kind === "overdue" ? "overdue" : null, dataset: { id: c.id } });

    var n = cell(tr, "Customer", "name");
    n.appendChild(el("span", { class: "nm", text: c.name }));
    if (c.disputed) n.appendChild(el("span", { class: "tag", text: "Disputed" }));
    if (c.relatedParty) n.appendChild(el("span", { class: "tag-rel", text: "Related party", title: "Own group company" }));
    var tags = [];
    if (c.group) tags.push(tagButton("Group: " + c.group, "Show all customers in group " + c.group, "group", c.group));
    if (c.segment) tags.push(tagButton(c.segment, "Show all customers in segment " + c.segment, "segment", c.segment));
    if (c.vehicleSegment) tags.push(tagButton(c.vehicleSegment, "Show all customers with vehicle segment " + c.vehicleSegment, "vseg", c.vehicleSegment));
    if (tags.length) n.appendChild(el("div", { class: "tags" }, tags));
    n.appendChild(el("div", { class: "lc", text: lastContactText(c.id, today) }));

    var p = cell(tr, "Contact person");
    if (!c.contact) dash(p);
    else {
      p.textContent = c.contact;
      if (c.contactFrom === "email") { p.classList.add("guess"); p.title = "Guessed from the email address"; }
    }

    var ph = cell(tr, "Phone");
    if (!c.phone) dash(ph);
    else if (/^\d{10}$/.test(c.phone.replace(/\s+/g, ""))) {
      ph.appendChild(el("a", { href: "tel:+91" + c.phone.replace(/\s+/g, ""), text: fmtPhone(c.phone) }));
    } else ph.textContent = fmtPhone(c.phone);

    var ci = cell(tr, "City");
    var cv = el("div", { class: "cv" });
    ci.appendChild(cv);
    if (c.plants.length) {
      var p0 = c.plants[0];
      cv.appendChild(document.createTextNode(p0.city || p0.state));
      if (c.plants.length > 1) {
        cv.appendChild(el("span", { class: "badge-lite", text: "+" + (c.plants.length - 1) + (c.plants.length === 2 ? " plant" : " plants"),
          title: c.plants.map(plantPlace).join("; ") }));
      }
    } else if (c.city) cv.textContent = c.city;
    else if (c.state) { cv.textContent = c.state; ci.classList.add("guess"); ci.title = "State from the GST number; city not known"; }
    else dash(cv);
    if (c.plants.length > 1) {
      var pc = cell(tr, "Plants", "plants-cell");
      pc.appendChild(el("ul", { class: "plant-list" }, c.plants.map(function (pl) {
        return el("li", { text: (pl.name ? pl.name + ": " : "") + (plantPlace(pl) || "—") });
      })));
    }

    var l = cell(tr, "Last order");
    var lv = el("div", { class: "cv" });
    l.appendChild(lv);
    if (c.last) lv.textContent = App.fmt.date(c.last); else dash(lv);
    var ld = dispatchOf(c);
    if (ld) lv.appendChild(el("div", { class: "ld", text: "Last dispatch " + App.fmt.date(ld) }));

    var fcell = cell(tr, "Follow-up");
    var fu = el("div", { class: "fu" + (kind === "overdue" ? " over" : kind === "today" ? " today" : "") });
    var row = el("div", { class: "fu-row" });
    var inp = el("input", { type: "date", value: c.followUp, "aria-label": "Follow-up date for " + c.name });
    inp.addEventListener("change", function () { setFollow(c, inp.value); });
    row.appendChild(inp);
    if (c.followUp) {
      var clr = el("button", { type: "button", class: "clr", text: "×", title: "Clear follow-up date", "aria-label": "Clear follow-up date for " + c.name });
      clr.addEventListener("click", function () { setFollow(c, ""); });
      row.appendChild(clr);
    }
    fu.appendChild(row);
    if (c.followUp) fu.appendChild(el("span", { class: "rel", text: Store.fuText(c, today) }));
    fcell.appendChild(fu);

    var s = cell(tr, "Status");
    var sel = el("select", { class: "st " + cls(c.status), "aria-label": "Status for " + c.name });
    STATUSES.forEach(function (o) { sel.appendChild(el("option", { text: o, selected: o === c.status })); });
    sel.addEventListener("change", function () { Store.setStatus(c.id, sel.value); App.flush(); });
    s.appendChild(sel);

    if (showMoney) buildMoneyCell(tr, c);

    var act = cell(tr, "", "act");
    var acts = el("div", { class: "acts" });
    if (c.followUp) {
      var d = el("button", { type: "button", class: "done-btn btn-sm", text: "✓ Done", "aria-label": "Mark follow-up done for " + c.name });
      d.addEventListener("click", function () { openDone(c.id, d); });
      acts.appendChild(d);
    }
    var count = Store.logCount(c.id);
    var nb = el("button", { type: "button", class: "notes-btn btn-sm", "aria-label": "Notes for " + c.name + (count ? ", " + plural(count, "entry", "entries") : "") }, ["Notes"]);
    if (count) nb.appendChild(el("span", { class: "badge", text: String(count) }));
    nb.addEventListener("click", function () { openNotes(c.id, nb); });
    acts.appendChild(nb);
    var eb = el("button", { type: "button", class: "edit-btn btn-sm", text: "Edit", "aria-label": "Edit " + c.name });
    eb.addEventListener("click", function () { openEdit(c.id, eb); });
    acts.appendChild(eb);
    if (c.added) {
      var x = el("button", { class: "rm", type: "button", text: "×", "aria-label": "Remove " + c.name });
      x.addEventListener("click", function () {
        if (!confirm("Remove " + c.name + " from this list?")) return;
        Store.removeCustomer(c.id).then(function (res) { if (!res.ok) App.notice(res.error, "error"); });
        App.flush();
      });
      acts.appendChild(x);
    }
    act.appendChild(acts);
    return tr;
  }

  /* options for a filter <select>; rebuilt only when the list or the counts change (keeps focus and the open picker) */
  function syncSelect(sel, opts, current) {
    var sig = JSON.stringify(opts);
    if (sel.dataset.sig !== sig) {
      sel.textContent = "";
      opts.forEach(function (o) { sel.appendChild(el("option", { value: o[0], text: o[1] })); });
      sel.dataset.sig = sig;
    }
    sel.value = current;
  }
  function buildFilterOptions(all) {
    var seg = {}, vs = {}, gr = {}, segNone = 0, vsNone = 0, grNone = 0;
    all.forEach(function (c) {
      if (c.segment) seg[c.segment] = (seg[c.segment] || 0) + 1; else segNone++;
      if (c.vehicleSegment) vs[c.vehicleSegment] = (vs[c.vehicleSegment] || 0) + 1; else vsNone++;
      if (c.group) gr[c.group] = (gr[c.group] || 0) + 1; else grNone++;
    });
    var so = [["", "All segments"]].concat(Store.SEGMENTS.map(function (s) { return [s, s + " (" + (seg[s] || 0) + ")"]; }), [["none", "Not set (" + segNone + ")"]]);
    var vo = [["", "All vehicle segments"]].concat(Store.VEHICLE_SEGMENTS.map(function (s) { return [s, s + " (" + (vs[s] || 0) + ")"]; }), [["none", "Not set (" + vsNone + ")"]]);
    var names = Store.groups();
    if (state.group && state.group !== "none" && names.indexOf(state.group) === -1) names.push(state.group);
    var go = [["", "All groups"]].concat(names.map(function (g) { return [g, g + " (" + (gr[g] || 0) + ")"]; }), [["none", "Not set (" + grNone + ")"]]);
    syncSelect($("fSegment"), so, state.segment);
    syncSelect($("fVseg"), vo, state.vseg);
    syncSelect($("fGroup"), go, state.group);
  }

  function render() {
    if (!mountedEl) return;
    var today = Store.todayISO();
    var all = Store.customers();
    var list = compute();
    var showMoney = moneyHas() || revHas();

    var body = $("rows");
    body.textContent = "";
    list.forEach(function (c) { body.appendChild(buildRow(c, today, showMoney)); });
    var st = Store.status();
    $("empty").textContent = st.loadError && !all.length ? st.loadError : "No customers match.";
    $("empty").hidden = list.length > 0;

    // column heads that depend on other modules
    var hasMoney = moneyHas(), hasRev = revHas();
    $("thMoney").hidden = !showMoney;
    var bo = $("sortOverdue"), br = $("sortRevenue");
    bo.hidden = !hasMoney;
    br.hidden = !hasRev;
    br.textContent = hasMoney ? "FY revenue" : "Money";
    $("thMoneyImport").hidden = !(hasMoney && mod("CrmMoney") && CrmMoney.openImport);
    $("sortDispatch").hidden = !all.some(function (c) { return dispatchOf(c); });
    var imp = $("moneyImportBtn2");
    imp.hidden = !(mod("CrmMoney") && CrmMoney.openImport && !hasMoney);

    var counts = { all: all.length, "Active": 0, "Follow up": 0, "At risk": 0 };
    var vc = { all: all.length, overdue: 0, today: 0, week: 0, none: 0 };
    all.forEach(function (c) { counts[c.status]++; var k = Store.fuKind(c, today); if (vc.hasOwnProperty(k)) vc[k]++; });
    Object.keys(counts).forEach(function (k) { $("n-" + k).textContent = counts[k]; });
    Object.keys(vc).forEach(function (k) { $("v-" + k).textContent = vc[k]; });
    document.querySelector('.chip[data-v="overdue"]').classList.toggle("has", vc.overdue > 0);

    buildFilterOptions(all);
    var bar = $("extraBar");
    bar.hidden = !state.extra;
    if (state.extra) $("extraLabel").textContent = extraLabel(state.extra);

    $("foot").textContent = summary();
    var edits = Store.unsavedCount();
    $("unsaved").hidden = edits === 0;
    $("unsavedMsg").textContent = edits + " change" + (edits === 1 ? "" : "s") + " saved in this browser only.";
    syncControls();
    saveState();
  }

  function summary() { return "Showing " + compute().length + " of " + Store.customers().length + " customers."; }
  function visible() { return compute(); }

  /* ---------- helpers for dialogs ---------- */
  function field(label, input) { return el("label", null, [label, input]); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function addMonthISO(iso, n) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + "-" + pad(m + 1) + "-" + pad(Math.min(d, dim));
  }
  function showErr(node, text) { node.textContent = text; node.hidden = !text; }
  function refocusRow(id) {
    setTimeout(function () {
      if (document.activeElement && document.activeElement !== document.body) return;
      var b = document.querySelector('#rows tr[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] .notes-btn');
      if (b) b.focus();
    }, 80);
  }

  /* ---------- Add / Edit dialog (#dlg) ---------- */
  var dlg = null, form = null, editId = "", addCb = null, baseState = "";

  function plantRow(p) {
    p = p || {};
    var row = el("div", { class: "plant-row", dataset: { pid: p.id || "" } });
    var no = el("span", { class: "plant-no" });
    var name = el("input", { class: "pl-name", maxlength: "80", placeholder: "e.g. Chakan plant", autocomplete: "off", value: p.name || "" });
    var city = el("input", { class: "pl-city", maxlength: "60", placeholder: "City", autocomplete: "off", value: p.city || "" });
    var st = el("input", { class: "pl-state", maxlength: "60", placeholder: "State", autocomplete: "off", value: p.state || "" });
    var main = el("button", { type: "button", class: "btn-sm pl-main", text: "Make main" });
    var rm = el("button", { type: "button", class: "btn-sm pl-rm", text: "Remove" });
    main.addEventListener("click", function () {
      var list = $("plantList");
      list.insertBefore(row, list.firstChild);
      renumber();
      name.focus();
      App.announce("Plant moved to the top. It is now the main plant.");
    });
    rm.addEventListener("click", function () {
      var next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      renumber();
      if (next) { var f = next.querySelector(".pl-name"); if (f) f.focus(); } else $("addPlant").focus();
    });
    row.appendChild(no);
    row.appendChild(el("div", { class: "plant-fields" }, [name, city, st]));
    row.appendChild(el("div", { class: "plant-btns" }, [main, rm]));
    return row;
  }
  function renumber() {
    var rows = $("plantList").children, n = rows.length;
    var edit = dlg.dataset.mode === "edit";
    Array.prototype.forEach.call(rows, function (row, i) {
      var k = i + 1;
      row.querySelector(".plant-no").textContent = "Plant " + k + (i === 0 ? " (main)" : "");
      row.querySelector(".pl-name").setAttribute("aria-label", "Plant " + k + " name");
      row.querySelector(".pl-city").setAttribute("aria-label", "Plant " + k + " city");
      row.querySelector(".pl-state").setAttribute("aria-label", "Plant " + k + " state");
      var rm = row.querySelector(".pl-rm");
      rm.setAttribute("aria-label", "Remove plant " + k);
      var mn = row.querySelector(".pl-main");
      mn.hidden = !(edit && i > 0);
      mn.setAttribute("aria-label", "Make plant " + k + " the main plant");
    });
    $("cityWrap").hidden = n > 0;
    $("addPlant").disabled = n >= 20;
    $("plantHelp").hidden = n === 0;
  }
  function addPlantRow(p) {
    var list = $("plantList");
    if (list.children.length >= 20) return null;
    var row = plantRow(p);
    list.appendChild(row);
    renumber();
    return row;
  }
  function readPlants() {
    return Array.prototype.map.call($("plantList").children, function (row) {
      var o = { name: row.querySelector(".pl-name").value.trim(), city: row.querySelector(".pl-city").value.trim(), state: row.querySelector(".pl-state").value.trim() };
      if (row.dataset.pid) o.id = row.dataset.pid;
      return o;
    });
  }

  function buildDialog() {
    var err = el("p", { class: "form-err", id: "formErr", role: "alert", hidden: true });
    var segSel = el("select", { name: "segment" }, [el("option", { value: "", text: "Not set" })].concat(Store.SEGMENTS.map(function (s) { return el("option", { value: s, text: s }); })));
    var vegSel = el("select", { name: "vehicleSegment" }, [el("option", { value: "", text: "Not set" })].concat(Store.VEHICLE_SEGMENTS.map(function (s) { return el("option", { value: s, text: s }); })));
    var addPlant = el("button", { type: "button", class: "btn-sm", id: "addPlant", text: "+ Add plant" });
    form = el("form", { id: "form", method: "dialog", novalidate: true }, [
      field("Customer name *", el("input", { name: "name", maxlength: "120", autocomplete: "off", "aria-required": "true", autofocus: true })),
      el("div", { class: "two" }, [
        field("Contact person", el("input", { name: "contact", maxlength: "80", autocomplete: "off" })),
        field("Phone", el("input", { name: "phone", type: "tel", maxlength: "30", autocomplete: "off" }))
      ]),
      el("div", { class: "two" }, [
        el("label", { id: "cityWrap" }, ["City", el("input", { name: "city", maxlength: "60", autocomplete: "off" })]),
        field("Last order date", el("input", { name: "last", type: "date" }))
      ]),
      el("div", { class: "two", id: "addOnly" }, [
        field("Follow-up date", el("input", { name: "followUp", type: "date" })),
        field("Status", el("select", { name: "status" }, STATUSES.map(function (s) { return el("option", { text: s }); })))
      ]),
      el("fieldset", { class: "sect" }, [
        el("legend", { text: "Group and segment" }),
        el("label", null, ["Group (parent company)", el("input", { name: "group", maxlength: "80", autocomplete: "off", list: "groupList" }), el("datalist", { id: "groupList" })]),
        el("div", { class: "two" }, [field("Segment", segSel), field("Vehicle segment", vegSel)]),
        el("label", { class: "check" }, [el("input", { type: "checkbox", name: "relatedParty" }), "Related party (own group company)"]),
        el("p", { class: "note", id: "erpLine" })
      ]),
      el("fieldset", { class: "sect" }, [
        el("legend", { text: "Plants and units" }),
        el("p", { class: "note", id: "plantHelp", text: "The first plant is shown as the customer's city." }),
        el("div", { id: "plantList", class: "plant-list-edit" }),
        addPlant
      ]),
      err,
      el("p", { class: "note", id: "saveNote", text: 'Saved in this browser first. Use "Download customers.json" and commit it to share the change.' }),
      el("div", { class: "actions" }, [
        el("button", { class: "btn", type: "button", id: "cancel", text: "Cancel" }),
        el("button", { class: "btn primary", type: "submit", id: "saveCustomer", text: "Save customer" })
      ])
    ]);
    dlg = el("dialog", { id: "dlg", "aria-labelledby": "dlgTitle", dataset: { mode: "add" } }, [
      el("div", { class: "dlg-head", id: "dlgTitle", text: "Add customer" }), form
    ]);
    document.body.appendChild(dlg);
    $("cancel").addEventListener("click", function () { dlg.close(); });
    addPlant.addEventListener("click", function () {
      var list = $("plantList");
      var row;
      if (!list.children.length) {
        // the old single City is moved into the first plant, with the state we already know (nothing is invented)
        row = addPlantRow({ name: "", city: form.elements.city.value.trim(), state: baseState });
      } else row = addPlantRow({});
      if (row) row.querySelector(".pl-name").focus();
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); submitCustomer(); });
  }

  function fillGroupList() {
    var dl = $("groupList");
    dl.textContent = "";
    Store.groups().forEach(function (g) { dl.appendChild(el("option", { value: g })); });
  }
  function setSelect(sel, value, list) { sel.value = list.indexOf(value) !== -1 ? value : ""; }
  function resetForm(mode, c, pre) {
    form.reset();
    dlg.dataset.mode = mode;
    $("plantList").textContent = "";
    showErr($("formErr"), "");
    fillGroupList();
    var f = form.elements;
    var v = c || pre || {};
    f.name.value = v.name || "";
    f.contact.value = v.contact || "";
    f.phone.value = v.phone || "";
    f.city.value = v.city || "";
    f.last.value = v.last || "";
    f.followUp.value = v.followUp || "";
    f.status.value = STATUSES.indexOf(v.status) !== -1 ? v.status : "Active";
    f.group.value = v.group || "";
    setSelect(f.segment, v.segment, Store.SEGMENTS);
    setSelect(f.vehicleSegment, v.vehicleSegment, Store.VEHICLE_SEGMENTS);
    f.relatedParty.checked = !!v.relatedParty;
    baseState = c ? c.state : "";
    (Array.isArray(v.plants) ? v.plants : []).slice(0, 20).forEach(function (p) { if (p) $("plantList").appendChild(plantRow(p)); });
    renumber();
    $("addOnly").hidden = mode === "edit";
    $("erpLine").hidden = mode !== "edit";
    if (mode === "edit") $("erpLine").textContent = "ERP group (from the Collections sheet): " + (c.erpGroup || "—");
    $("dlgTitle").textContent = mode === "edit" ? "Edit customer" : "Add customer";
    $("saveCustomer").textContent = mode === "edit" ? "Save changes" : "Save customer";
    $("saveNote").hidden = false;
  }

  function isPlainObject(o) { return !!o && typeof o === "object" && Object.getPrototypeOf(o) === Object.prototype; }
  function openAdd(prefill, onSaved) {
    if (!dlg) buildDialog();
    var pre = isPlainObject(prefill) ? prefill : null;
    editId = "";
    addCb = typeof onSaved === "function" ? onSaved : null;
    resetForm("add", null, pre);
    App.openDialog(dlg, document.activeElement);
    form.elements.name.focus();
  }
  function openEdit(id, opener) {
    var c = Store.get(id);
    if (!c) { App.notice("That customer no longer exists.", "error"); return; }
    if (!dlg) buildDialog();
    editId = id;
    addCb = null;
    resetForm("edit", c);
    App.openDialog(dlg, opener || document.activeElement);
    form.elements.name.focus();
  }

  function formValues() {
    var f = form.elements, plants = readPlants();
    var vals = {
      name: f.name.value.trim(), contact: f.contact.value.trim(), phone: f.phone.value.trim(), last: f.last.value || "",
      group: f.group.value.trim(), segment: f.segment.value, vehicleSegment: f.vehicleSegment.value,
      relatedParty: f.relatedParty.checked, plants: plants
    };
    if (!plants.length) vals.city = f.city.value.trim();     // with plants, the city comes from the first plant (Store derives it)
    return vals;
  }
  function samePlants(a, b) {
    var strip = function (l) { return JSON.stringify(l.map(function (p) { return [p.id || "", p.name || "", p.city || "", p.state || ""]; })); };
    return strip(a) === strip(b);
  }
  function submitCustomer() {
    var err = $("formErr"), vals = formValues();
    if (!vals.name) { showErr(err, "Enter a customer name."); form.elements.name.focus(); return; }
    if (editId) {
      var cur = Store.get(editId);
      if (!cur) { showErr(err, "That customer no longer exists."); return; }
      var changed = ["name", "contact", "phone", "last", "group", "segment", "vehicleSegment", "relatedParty"].some(function (k) { return vals[k] !== cur[k]; }) ||
        ("city" in vals && vals.city !== cur.city) || !samePlants(vals.plants, cur.plants);
      if (!changed) { dlg.close(); return; }
      Store.saveCustomer(editId, vals).then(function (res) {
        if (!res.ok) { showErr(err, res.error); return; }
        showErr(err, "");
        dlg.close();
        App.flush();
        App.announce("Saved changes to " + vals.name + ".");
      });
      return;
    }
    vals.followUp = form.elements.followUp.value || "";
    vals.status = form.elements.status.value;
    Store.addCustomer(vals).then(function (res) {
      if (!res.ok) { showErr(err, res.error); return; }
      showErr(err, "");
      var cb = addCb; addCb = null;
      dlg.close();
      App.show("list", {});
      App.announce("Added " + res.customer.name + ".");
      if (cb) { try { cb(res.id, res.customer); } catch (e) { warn("onSaved failed", e); } }
    });
  }

  /* ---------- Mark done (#doneDlg) ---------- */
  var doneDlg = null, doneId = "", doneUpd = null;
  function buildDone() {
    var type = el("select", { id: "doneType" }, Store.LOG_TYPES.map(function (t) { return el("option", { value: t, text: t }); }));
    var note = el("textarea", { id: "doneNote", rows: "3", maxlength: String(NOTE_MAX), autofocus: true, "aria-describedby": "doneCount" });
    var count = el("div", { class: "count", id: "doneCount" });
    var next = el("input", { type: "date", id: "doneNext" });
    var quick = el("div", { class: "quick", role: "group", "aria-label": "Next follow-up shortcuts" }, [
      ["In 1 week", 7], ["In 2 weeks", 14], ["In 1 month", 0]
    ].map(function (q) {
      var b = el("button", { type: "button", class: "btn-sm", text: q[0], dataset: { days: String(q[1]) } });
      b.addEventListener("click", function () {
        var today = Store.todayISO();
        next.value = q[1] ? Store.addDays(today, q[1]) : addMonthISO(today, 1);
        showErr($("doneErr"), "");
      });
      return b;
    }));
    var err = el("p", { class: "form-err", id: "doneErr", role: "alert", hidden: true });
    var f = el("form", { id: "doneForm", method: "dialog", novalidate: true }, [
      el("p", { class: "dlg-sub", id: "doneSub" }),
      field("What happened", type),
      el("label", null, ["Outcome note (optional)", note, count]),
      el("label", null, ["Next follow-up date", next]),
      quick,
      el("p", { class: "note", text: "Leave the date empty to clear the follow-up. Status does not change." }),
      err,
      el("div", { class: "actions" }, [
        el("button", { class: "btn", type: "button", id: "doneCancel", text: "Cancel" }),
        el("button", { class: "btn primary", type: "submit", id: "doneSave", text: "Mark done" })
      ])
    ]);
    doneDlg = el("dialog", { id: "doneDlg", "aria-labelledby": "doneTitle" }, [el("div", { class: "dlg-head", id: "doneTitle", text: "Mark follow-up done" }), f]);
    document.body.appendChild(doneDlg);
    doneUpd = Ui.counter(note, count, NOTE_MAX);
    Ui.ctrlEnter(note, f);
    $("doneCancel").addEventListener("click", function () { doneDlg.close(); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var id = doneId, c = Store.get(id);
      if (!c) { showErr(err, "That customer no longer exists."); return; }
      Store.markDone(id, { type: type.value, note: note.value, next: next.value || "" }).then(function (res) {
        if (!res.ok) { showErr(err, res.error); return; }
        showErr(err, "");
        var nx = res.entry.nextFollowUp;
        doneDlg.close();
        App.flush();
        App.announce("Marked done. " + (nx ? "Next follow-up " + App.fmt.date(nx) + "." : "No follow-up set."));
        refocusRow(id);
      });
    });
  }
  function openDone(id, opener) {
    var c = Store.get(id);
    if (!c) { App.notice("That customer no longer exists.", "error"); return; }
    if (!doneDlg) buildDone();
    doneId = id;
    $("doneForm").reset();
    $("doneType").value = "Call";
    $("doneNote").value = "";
    doneUpd();
    var today = Store.todayISO();
    $("doneNext").min = today;
    $("doneNext").value = "";
    showErr($("doneErr"), "");
    $("doneSub").textContent = c.name + (c.followUp ? " · Follow-up: " + Store.fuText(c, today) : " · No follow-up date set");
    App.openDialog(doneDlg, opener || document.activeElement);
  }

  /* ---------- Notes and call log drawer (#notesDlg) ---------- */
  var notesDlg = null, notesId = "", noteUpd = null;
  function buildNotes() {
    var type = el("select", { id: "noteType" }, Store.LOG_TYPES.map(function (t) { return el("option", { value: t, text: t }); }));
    type.value = "Note";
    var date = el("input", { type: "date", id: "noteDate" });
    var text = el("textarea", { id: "noteText", rows: "3", maxlength: String(NOTE_MAX), autofocus: true, "aria-describedby": "noteCount" });
    var count = el("div", { class: "count", id: "noteCount" });
    var err = el("p", { class: "form-err", id: "noteErr", role: "alert", hidden: true });
    var f = el("form", { id: "noteForm", method: "dialog", novalidate: true }, [
      el("div", { class: "two" }, [field("Type", type), field("Date", date)]),
      el("label", null, ["Note *", text, count]),
      err,
      el("div", { class: "actions" }, [el("button", { class: "btn primary", type: "submit", id: "noteSave", text: "Save note" })])
    ]);
    var close = el("button", { type: "button", class: "drawer-x", id: "notesClose", text: "×", "aria-label": "Close notes", title: "Close" });
    notesDlg = el("dialog", { id: "notesDlg", class: "drawer", "aria-labelledby": "notesTitle" }, [
      el("div", { class: "dlg-head drawer-head" }, [el("span", { id: "notesTitle", text: "Notes and call log" }), close]),
      el("p", { class: "dlg-sub", id: "notesSub" }),
      el("div", { class: "drawer-body" }, [
        f,
        el("p", { class: "note log-note", text: "Entries are never edited or deleted. To correct something, add a new note." }),
        el("ol", { id: "notesList", class: "log-list" }),
        el("p", { class: "empty-note", id: "notesEmpty", text: "No notes yet.", hidden: true })
      ])
    ]);
    document.body.appendChild(notesDlg);
    noteUpd = Ui.counter(text, count, NOTE_MAX);
    Ui.ctrlEnter(text, f);
    close.addEventListener("click", function () { notesDlg.close(); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var id = notesId;
      Store.addLog(id, { at: date.value || "", type: type.value, note: text.value }).then(function (res) {
        if (!res.ok) { showErr(err, res.error); return; }
        showErr(err, "");
        text.value = "";
        noteUpd();
        renderNotes();
        App.flush();
        App.announce("Note saved.");
        text.focus();
      });
    });
    App.onData(function () { if (notesDlg.open) renderNotes(); });
  }
  function renderNotes() {
    var c = Store.get(notesId);
    if (!c) { if (notesDlg.open) notesDlg.close(); return; }
    var today = Store.todayISO(), list = Store.listLog(notesId);
    $("notesSub").textContent = c.name + " · " + lastContactText(notesId, today) + " · " + plural(list.length, "entry", "entries");
    var ol = $("notesList");
    ol.textContent = "";
    list.forEach(function (e) {
      var head = el("div", { class: "log-head" }, [
        el("time", { datetime: e.at, text: App.fmt.date(e.at) }),
        el("span", { class: "log-type", text: e.type })
      ]);
      if (e.doneFollowUp) head.appendChild(el("span", { class: "tag-done", text: "Follow-up done" }));
      var li = el("li", { dataset: { id: e.id } }, [head]);
      if (e.note) li.appendChild(el("div", { class: "log-text", text: e.note }));
      if (e.nextFollowUp) li.appendChild(el("div", { class: "log-next", text: "Next follow-up: " + App.fmt.date(e.nextFollowUp) }));
      ol.appendChild(li);
    });
    $("notesEmpty").hidden = list.length > 0;
  }
  function openNotes(id, opener) {
    var c = Store.get(id);
    if (!c) { App.notice("That customer no longer exists.", "error"); return; }
    if (!notesDlg) buildNotes();
    notesId = id;
    var today = Store.todayISO();
    $("noteType").value = "Note";
    $("noteDate").value = today;
    $("noteDate").max = today;
    $("noteText").value = "";
    noteUpd();
    showErr($("noteErr"), "");
    renderNotes();
    App.openDialog(notesDlg, opener || document.activeElement);
  }

  /* ---------- panel ---------- */
  function mount(root) {
    mountedEl = root;
    loadState();
    var chip = function (attr, val, label, id, extraCls) {
      var d = {}; d[attr] = val;
      return el("button", { class: "chip" + (extraCls ? " " + extraCls : ""), dataset: d, "aria-pressed": "false" }, [label + " ", el("b", { id: id, text: "0" })]);
    };
    var sortBtn = function (label, key, id, hidden) {
      return el("button", { type: "button", dataset: { sort: key }, id: id || null, text: label, hidden: hidden || null });
    };
    var th = function (kids, id, hidden) { return el("th", { id: id || null, hidden: hidden || null }, kids); };
    root.appendChild(el("div", { class: "bar", role: "group", "aria-label": "Filter by follow-up" }, [
      el("span", { class: "bar-label", text: "Follow-ups" }),
      chip("v", "all", "All", "v-all"), chip("v", "overdue", "Overdue", "v-overdue", "danger"), chip("v", "today", "Due today", "v-today"),
      chip("v", "week", "Next 7 days", "v-week"), chip("v", "none", "No follow-up set", "v-none"),
      el("button", { type: "button", class: "btn-sm", id: "moneyImportBtn2", text: "Import money", hidden: true })
    ]));
    root.appendChild(el("div", { class: "bar", role: "group", "aria-label": "Filter by status" }, [
      el("span", { class: "bar-label", text: "Status" }),
      chip("f", "all", "All", "n-all"), chip("f", "Active", "Active", "n-Active"), chip("f", "Follow up", "Follow up", "n-Follow up"), chip("f", "At risk", "At risk", "n-At risk"),
      el("input", { class: "search", id: "q", type: "search", placeholder: "Search name, contact, phone, city, plant, group", "aria-label": "Search customers" })
    ]));
    root.appendChild(el("div", { class: "bar filters", role: "group", "aria-label": "Filter by segment and group" }, [
      el("span", { class: "bar-label", text: "Account" }),
      el("label", { class: "fsel" }, [el("span", { text: "Segment" }), el("select", { id: "fSegment" })]),
      el("label", { class: "fsel" }, [el("span", { text: "Vehicle" }), el("select", { id: "fVseg" })]),
      el("label", { class: "fsel" }, [el("span", { text: "Group" }), el("select", { id: "fGroup" })])
    ]));
    root.appendChild(el("div", { class: "bar", id: "extraBar", hidden: true }, [
      el("span", { class: "bar-label", text: "Also" }),
      el("span", { class: "chip extra-chip" }, [
        el("span", { id: "extraLabel" }),
        el("button", { type: "button", class: "extra-x", id: "extraClear", text: "×", "aria-label": "Remove this filter", title: "Remove this filter" })
      ])
    ]));
    root.appendChild(el("p", { class: "rule", id: "rule", text: "Pick a status and a follow-up date on each row. A follow-up date in the past turns red. Last order is the customer's latest invoice date in the Collections sheet (it runs to 12 Jul 2026). Grey italic contact names are guessed from email addresses, and grey states come from GST numbers." }));
    root.appendChild(el("div", { class: "banner", id: "unsaved", hidden: true }, [
      el("span", { id: "unsavedMsg" }),
      el("button", { class: "btn", type: "button", id: "unsavedExport", text: "Download customers.json" })
    ]));
    root.appendChild(el("div", { class: "card" }, [
      el("table", null, [
        el("thead", null, el("tr", null, [
          th(sortBtn("Customer", "name")), th("Contact person"), th("Phone"), th("City"),
          th([sortBtn("Last order", "last"), sortBtn("by dispatch", "dispatch", "sortDispatch", true)]),
          th(sortBtn("Follow-up", "follow")), th(sortBtn("Status", "status")),
          th([sortBtn("Outstanding / overdue", "overdue", "sortOverdue", true), sortBtn("FY revenue", "revenue", "sortRevenue", true),
              el("button", { type: "button", id: "thMoneyImport", class: "th-link", text: "Import", title: "Import money data again", "aria-label": "Import money data again", hidden: true })], "thMoney", true),
          th("")
        ])),
        el("tbody", { id: "rows" })
      ]),
      el("div", { class: "empty", id: "empty", hidden: true, text: "No customers match." })
    ]));
    root.appendChild(el("p", { class: "foot", id: "foot" }));

    root.querySelectorAll(".chip[data-v]").forEach(function (b) {
      b.addEventListener("click", function () { state.view = b.dataset.v; render(); });
    });
    root.querySelectorAll(".chip[data-f]").forEach(function (b) {
      b.addEventListener("click", function () { state.filter = b.dataset.f; render(); });
    });
    $("q").addEventListener("input", function (e) { state.q = e.target.value; render(); });
    $("fSegment").addEventListener("change", function (e) { state.segment = cleanSeg(e.target.value); render(); });
    $("fVseg").addEventListener("change", function (e) { state.vseg = cleanVseg(e.target.value); render(); });
    $("fGroup").addEventListener("change", function (e) { state.group = cleanGroup(e.target.value); render(); });
    root.querySelectorAll("th button[data-sort]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.sort;
        state.dir = state.sort === k ? -state.dir : 1;
        state.sort = k;
        render();
      });
    });
    var openImport = function () { if (mod("CrmMoney") && CrmMoney.openImport) CrmMoney.openImport(); };
    $("moneyImportBtn2").addEventListener("click", openImport);
    $("thMoneyImport").addEventListener("click", openImport);
    $("extraClear").addEventListener("click", function () { state.extra = null; render(); });
    $("unsavedExport").addEventListener("click", function () {
      App.download("customers.json", JSON.stringify(Store.exportCustomersJson(), null, 2) + "\n", "application/json");
    });
  }

  App.registerPanel("list", {
    label: "Customers", mount: mount, render: render,
    show: function (f) { applyFilter(f); },
    summary: summary
  });

  window.CrmCustomers = {
    openAdd: openAdd, openDone: openDone, openNotes: openNotes, openEdit: openEdit,
    visible: visible, summary: summary
  };
})();
