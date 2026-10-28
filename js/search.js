/* Global search + command palette (Ctrl/Cmd+K). Index holds names, part/ref numbers and task titles only:
   never money, phone, email or note text. Recent searches (last 5, query text only) live in localStorage.
   Text is set with textContent only. Contract: window.CrmSearch = { open, close, query, results }. */
(function () {
  "use strict";
  var RKEY = "crm.recentSearches", opener = null, dlg, input, list, count, sel = 0, items = [], wired = false;

  function lsGet() { try { var a = JSON.parse(localStorage.getItem(RKEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string"; }).slice(0, 5) : []; } catch (e) { return []; } }
  function lsSet(a) { try { localStorage.setItem(RKEY, JSON.stringify(a)); } catch (e) { /* storage blocked: recents are a convenience */ } }
  function remember(q) {
    q = String(q || "").trim().slice(0, 60); if (q.length < 2) return;
    lsSet([q].concat(lsGet().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); })).slice(0, 5));
  }

  /* score: 0 = no match; higher is better. prefix beats word-start beats substring beats in-order letters. */
  function score(text, q) {
    text = String(text || "").toLowerCase(); q = q.toLowerCase();
    if (!q) return 1;
    var i = text.indexOf(q);
    if (i === 0) return 100;
    if (i > 0) return text.charAt(i - 1) === " " ? 80 : 60;
    var p = 0, k;
    for (k = 0; k < text.length && p < q.length; k++) if (text.charAt(k) === q.charAt(p)) p++;
    return p === q.length && q.length >= 3 ? 20 : 0;
  }
  function col(n) { try { return Store.col(n).all(); } catch (e) { return []; } }
  function go(tab, filter, then) {
    if (!window.App || !App.show) return;
    App.show(tab, filter);
    if (then) { try { then(); } catch (e) { /* module hook missing: the tab switch is enough */ } }
  }
  function tasksTab() { return document.getElementById("tab-tasks") ? "tasks" : "schedule"; }
  function actions() {
    var a = [], tabs = document.querySelectorAll('nav.tabs [role="tab"]');
    Array.prototype.forEach.call(tabs, function (b) {
      var id = b.id.replace(/^tab-/, "");
      a.push({ g: "Actions", t: "Go to " + b.textContent.trim(), run: function () { go(id); } });
    });
    a.push({ g: "Actions", t: "Add customer", run: function () { if (window.CrmCustomers && CrmCustomers.openAdd) CrmCustomers.openAdd(); else go("list"); } });
    a.push({ g: "Actions", t: "Add lead", run: function () { go("leads", {}, function () { CrmLeads.openNew(); }); } });
    a.push({ g: "Actions", t: "Add RFQ", run: function () { go("rfqs", {}, function () { CrmRfq.openNew(); }); } });
    a.push({ g: "Actions", t: "Add task", run: function () { go(tasksTab()); } });
    a.push({ g: "Actions", t: "Log a call", run: function () { go("list", {}); } });
    return a;
  }
  function build(q) {
    q = q.trim();
    var out = [], src = [], names = {};
    var cs = (window.Store && Store.customers) ? Store.customers() : [];
    cs.forEach(function (c) {
      names[c.id] = c.name;
      src.push({ g: "Customers", t: c.name, s: [c.city, c.state].filter(Boolean).join(", "), k: c.name, run: function () { go("list", { q: c.name }); } });
    });
    col("leads").forEach(function (l) {
      if (l.company) src.push({ g: "Leads", t: l.company, s: l.scope || "", k: l.company, run: function () { go("leads", { q: l.company }, function () { if (CrmLeads.openEdit) CrmLeads.openEdit(l.id); }); } });
    });
    col("rfqs").forEach(function (r) {
      var t = [r.rfq_no, r.part_name || r.part_no].filter(Boolean).join(" - "); if (!t) return;
      src.push({ g: "RFQs", t: t, s: names[r.customer_id] || "", k: [r.rfq_no, r.part_name, r.part_no, names[r.customer_id]].join(" "), run: function () { go("rfqs", { q: r.rfq_no || r.part_name || r.part_no }, function () { if (CrmRfq.openEdit) CrmRfq.openEdit(r.id); }); } });
    });
    col("tasks").forEach(function (k) { if (k.title) src.push({ g: "Tasks", t: String(k.title), s: "", k: String(k.title), run: function () { go(tasksTab()); } }); });
    actions().forEach(function (a) { a.k = a.t; src.push(a); });
    if (!q) {
      lsGet().forEach(function (r) { out.push({ g: "Recent searches", t: r, s: "", recent: true }); });
      src.filter(function (x) { return x.g === "Actions"; }).forEach(function (x) { out.push(x); });
      return out;
    }
    var by = {};
    src.forEach(function (x) { var s = score(x.k, q); if (s) { x.sc = s; (by[x.g] = by[x.g] || []).push(x); } });
    ["Customers", "Leads", "RFQs", "Tasks", "Actions"].forEach(function (g) {
      (by[g] || []).sort(function (a, b) { return b.sc - a.sc || a.t.localeCompare(b.t); }).slice(0, 6).forEach(function (x) { out.push(x); });
    });
    return out;
  }

  function render() {
    items = build(input.value);
    if (sel >= items.length) sel = 0;
    list.textContent = "";
    var last = "";
    items.forEach(function (it, i) {
      if (it.g !== last) {
        last = it.g;
        var h = document.createElement("li"); h.setAttribute("role", "presentation"); h.className = "cmdk-grp"; h.textContent = it.g; list.appendChild(h);
      }
      var li = document.createElement("li"); li.className = "cmdk-opt"; li.id = "cmdk-o" + i; li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === sel ? "true" : "false");
      li.appendChild(document.createTextNode(it.t));
      if (it.s) { var s = document.createElement("small"); s.textContent = it.s; li.appendChild(s); }
      li.addEventListener("click", function () { choose(i); });
      list.appendChild(li);
    });
    if (!items.length) { var e = document.createElement("li"); e.className = "cmdk-empty"; e.setAttribute("role", "presentation"); e.textContent = "No results"; list.appendChild(e); }
    input.setAttribute("aria-activedescendant", items.length ? "cmdk-o" + sel : "");
    count.textContent = items.length ? items.length + (items.length === 1 ? " result" : " results") : "No results";
  }
  function move(d) {
    if (!items.length) return;
    sel = (sel + d + items.length) % items.length;
    Array.prototype.forEach.call(list.querySelectorAll(".cmdk-opt"), function (o, i) { o.setAttribute("aria-selected", i === sel ? "true" : "false"); });
    input.setAttribute("aria-activedescendant", "cmdk-o" + sel);
    var o = document.getElementById("cmdk-o" + sel); if (o && o.scrollIntoView) o.scrollIntoView({ block: "nearest" });
  }
  function choose(i) {
    var it = items[i]; if (!it) return;
    if (it.recent) { input.value = it.t; sel = 0; render(); return; }
    remember(input.value);
    close(true);
    if (it.run) it.run();
  }
  function close(skipFocus) {
    if (dlg.open) dlg.close();
    if (!skipFocus && opener && opener.focus) opener.focus();
  }
  function open() {
    if (!dlg) return;
    if (!dlg.open) opener = document.activeElement;
    input.value = ""; sel = 0;
    if (!dlg.open) dlg.showModal();
    render(); input.focus();
  }
  function ensure() {
    if (wired) return;
    wired = true;
    dlg = document.getElementById("cmdk");
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "cmdk"; dlg.setAttribute("aria-label", "Search and commands");
      input = document.createElement("input"); input.className = "cmdk-in"; input.type = "text"; input.setAttribute("role", "combobox");
      input.setAttribute("aria-expanded", "true"); input.setAttribute("aria-controls", "cmdk-list"); input.setAttribute("aria-label", "Search customers, leads, RFQs, tasks or type a command"); input.placeholder = "Search or type a command"; input.autocomplete = "off";
      list = document.createElement("ul"); list.className = "cmdk-list"; list.id = "cmdk-list"; list.setAttribute("role", "listbox");
      var foot = document.createElement("div"); foot.className = "cmdk-foot";
      count = document.createElement("span"); count.id = "cmdk-count"; count.setAttribute("aria-live", "polite");
      var hint = document.createElement("span"); hint.textContent = "Up/Down, Enter, Esc";
      foot.appendChild(count); foot.appendChild(hint);
      dlg.appendChild(input); dlg.appendChild(list); dlg.appendChild(foot);
      document.body.appendChild(dlg);
    } else { input = dlg.querySelector("input"); list = dlg.querySelector("ul"); count = dlg.querySelector("[aria-live]"); }
    input.addEventListener("input", function () { sel = 0; render(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
    });
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
    var btn = document.getElementById("openSearch");
    if (!btn) {
      var row = document.querySelector("header .head-row");
      if (row) {
        btn = document.createElement("button"); btn.id = "openSearch"; btn.type = "button"; btn.className = "btn-add"; btn.textContent = "Search (Ctrl+K)";
        btn.setAttribute("aria-keyshortcuts", "Control+K Meta+K"); row.appendChild(btn);
      }
    }
    if (btn) btn.addEventListener("click", open);
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") { e.preventDefault(); if (dlg.open) close(); else open(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensure); else ensure();
  window.CrmSearch = { open: open, close: close, query: function (q) { input.value = q; sel = 0; render(); }, results: function () { return items.map(function (i) { return i.g + ": " + i.t; }); } };
})();
