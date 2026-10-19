/* Customers tab: the Phase 1 features ported onto Store (A1). A2 adds Done / Notes / Edit / plants and the money line.
   Contract (design 4.5): window.CrmCustomers = { openAdd, openDone, openNotes, openEdit, visible, summary }.
   Filter keys for App.show("list", filter): view, filter, q, sort, segment, vseg, group, extra. */
(function () {
  "use strict";

  var el = Ui.el;
  var $ = function (id) { return document.getElementById(id); };
  var ORDER = { "At risk": 0, "Follow up": 1, "Active": 2 };
  var STATUSES = ["Active", "Follow up", "At risk"];
  var VIEWS = ["all", "overdue", "today", "week", "none"];
  var SORTS = ["name", "last", "follow", "status", "overdue", "revenue"];
  var EXTRA_KINDS = ["last", "state", "disputed", "contact", "due", "ids", "money", "aging", "related"];

  var state = { view: "all", filter: "all", q: "", sort: "follow", dir: 1, extra: null, segment: "", vseg: "", group: "" };
  var mountedEl = null, dlg = null, form = null;

  /* ---------- state ---------- */
  function cleanExtra(x) {
    if (!x || typeof x !== "object" || EXTRA_KINDS.indexOf(x.kind) === -1) return null;
    var out = { kind: x.kind };
    if (x.value !== undefined) out.value = x.value;
    if (x.ref) out.ref = x.ref;
    if (x.label) out.label = String(x.label);
    return out;
  }
  function loadState() {
    var v = App.view("list");
    if (VIEWS.indexOf(v.view) !== -1) state.view = v.view;
    if (v.filter === "all" || ORDER.hasOwnProperty(v.filter)) state.filter = v.filter;
    if (typeof v.q === "string") state.q = v.q;
    if (SORTS.indexOf(v.sort) !== -1) state.sort = v.sort;
    if (v.dir === 1 || v.dir === -1) state.dir = v.dir;
    state.extra = cleanExtra(v.extra);
    ["segment", "vseg", "group"].forEach(function (k) { if (typeof v[k] === "string") state[k] = v[k]; });
  }
  function saveState() { App.setView("list", state); }
  /* show(filter) REPLACES the filters (sort is kept unless given). */
  function applyFilter(f) {
    f = f || {};
    state.view = VIEWS.indexOf(f.view) !== -1 ? f.view : "all";
    state.filter = f.filter === "all" || ORDER.hasOwnProperty(f.filter) ? f.filter : "all";
    state.q = typeof f.q === "string" ? f.q : "";
    state.extra = cleanExtra(f.extra);
    state.segment = typeof f.segment === "string" ? f.segment : "";
    state.vseg = typeof f.vseg === "string" ? f.vseg : "";
    state.group = typeof f.group === "string" ? f.group : "";
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
  function money(c) { return window.CrmMoney && CrmMoney.forCustomer ? CrmMoney.forCustomer(c.id) : null; }
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
    var r = window.CrmRevenue && CrmRevenue.forCustomer ? CrmRevenue.forCustomer(c.id) : null;
    return r && r.fytd ? r.fytd : 0;
  }
  function compute() {
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

  function buildRow(c, today) {
    var kind = Store.fuKind(c, today);
    var tr = el("tr", { class: kind === "overdue" ? "overdue" : null, dataset: { id: c.id } });

    var n = cell(tr, "Customer", "name");
    n.appendChild(document.createTextNode(c.name));
    if (c.disputed) n.appendChild(el("span", { class: "tag", text: "Disputed" }));

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
    if (c.city) ci.textContent = c.city;
    else if (c.state) { ci.textContent = c.state; ci.classList.add("guess"); ci.title = "State from the GST number; city not known"; }
    else dash(ci);

    var l = cell(tr, "Last order");
    if (c.last) l.textContent = App.fmt.date(c.last); else dash(l);

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

    var act = cell(tr, "", "act");
    if (c.added) {
      var x = el("button", { class: "rm", type: "button", text: "×", "aria-label": "Remove " + c.name });
      x.addEventListener("click", function () {
        if (!confirm("Remove " + c.name + " from this list?")) return;
        Store.removeCustomer(c.id).then(function (res) { if (!res.ok) App.notice(res.error, "error"); });
        App.flush();
      });
      act.appendChild(x);
    }
    return tr;
  }

  function render() {
    if (!mountedEl) return;
    var today = Store.todayISO();
    var all = Store.customers();
    var list = compute();

    var body = $("rows");
    body.textContent = "";
    list.forEach(function (c) { body.appendChild(buildRow(c, today)); });
    var st = Store.status();
    $("empty").textContent = st.loadError && !all.length ? st.loadError : "No customers match.";
    $("empty").hidden = list.length > 0;

    var counts = { all: all.length, "Active": 0, "Follow up": 0, "At risk": 0 };
    var vc = { all: all.length, overdue: 0, today: 0, week: 0, none: 0 };
    all.forEach(function (c) { counts[c.status]++; var k = Store.fuKind(c, today); if (vc.hasOwnProperty(k)) vc[k]++; });
    Object.keys(counts).forEach(function (k) { $("n-" + k).textContent = counts[k]; });
    Object.keys(vc).forEach(function (k) { $("v-" + k).textContent = vc[k]; });
    document.querySelector('.chip[data-v="overdue"]').classList.toggle("has", vc.overdue > 0);

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

  /* ---------- add dialog ---------- */
  function field(label, input) { return el("label", null, [label, input]); }
  function buildDialog() {
    var err = el("p", { class: "form-err", id: "formErr", role: "alert", hidden: true });
    form = el("form", { id: "form", method: "dialog" }, [
      field("Customer name *", el("input", { name: "name", required: true, maxlength: "120", autocomplete: "off" })),
      el("div", { class: "two" }, [
        field("Contact person", el("input", { name: "contact", maxlength: "80", autocomplete: "off" })),
        field("Phone", el("input", { name: "phone", type: "tel", maxlength: "30", autocomplete: "off" }))
      ]),
      el("div", { class: "two" }, [
        field("City", el("input", { name: "city", maxlength: "60", autocomplete: "off" })),
        field("Last order date", el("input", { name: "last", type: "date" }))
      ]),
      el("div", { class: "two", id: "addOnly" }, [
        field("Follow-up date", el("input", { name: "followUp", type: "date" })),
        field("Status", el("select", { name: "status" }, STATUSES.map(function (s) { return el("option", { text: s }); })))
      ]),
      err,
      el("p", { class: "note", text: 'Saved in this browser first. Use "Download customers.json" and commit it to share the change.' }),
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
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(form);
      var vals = { name: String(f.get("name")).trim(), contact: String(f.get("contact")).trim(), phone: String(f.get("phone")).trim(),
                   city: String(f.get("city")).trim(), last: String(f.get("last") || ""), followUp: String(f.get("followUp") || ""),
                   status: String(f.get("status")) };
      if (!vals.name) return;
      Store.addCustomer(vals).then(function (res) {
        if (!res.ok) { err.textContent = res.error; err.hidden = false; return; }
        err.hidden = true;
        dlg.close();
        App.show("list", {});
        App.announce("Added " + res.customer.name + ".");
      });
    });
  }
  function openAdd() {
    if (!dlg) buildDialog();
    form.reset();
    $("formErr").hidden = true;
    App.openDialog(dlg, $("openForm"));
    form.elements.name.focus();
  }
  function later(what) { return function () { App.notice(what + " arrives with the next Customers update.", "info"); }; }

  /* ---------- panel ---------- */
  function mount(root) {
    mountedEl = root;
    loadState();
    var chip = function (attr, val, label, id, extraCls) {
      var d = {}; d[attr] = val;
      return el("button", { class: "chip" + (extraCls ? " " + extraCls : ""), dataset: d, "aria-pressed": "false" }, [label + " ", el("b", { id: id, text: "0" })]);
    };
    var th = function (label, key) { return el("th", null, key ? el("button", { type: "button", dataset: { sort: key }, text: label }) : label); };
    root.appendChild(el("div", { class: "bar", role: "group", "aria-label": "Filter by follow-up" }, [
      el("span", { class: "bar-label", text: "Follow-ups" }),
      chip("v", "all", "All", "v-all"), chip("v", "overdue", "Overdue", "v-overdue", "danger"), chip("v", "today", "Due today", "v-today"),
      chip("v", "week", "Next 7 days", "v-week"), chip("v", "none", "No follow-up set", "v-none")
    ]));
    root.appendChild(el("div", { class: "bar", role: "group", "aria-label": "Filter by status" }, [
      el("span", { class: "bar-label", text: "Status" }),
      chip("f", "all", "All", "n-all"), chip("f", "Active", "Active", "n-Active"), chip("f", "Follow up", "Follow up", "n-Follow up"), chip("f", "At risk", "At risk", "n-At risk"),
      el("input", { class: "search", id: "q", type: "search", placeholder: "Search name, contact, phone, city", "aria-label": "Search customers" })
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
        el("thead", null, el("tr", null, [th("Customer", "name"), th("Contact person"), th("Phone"), th("City"), th("Last order", "last"), th("Follow-up", "follow"), th("Status", "status"), th("")])),
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
    root.querySelectorAll("th button").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.sort;
        state.dir = state.sort === k ? -state.dir : 1;
        state.sort = k;
        render();
      });
    });
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
    openAdd: openAdd, visible: visible, summary: summary,
    openDone: later("Mark done"), openNotes: later("Notes"), openEdit: later("Edit")
  };
})();
