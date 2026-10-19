/* App: shell, router, panels, view state, banners. Frozen contract: design section 4.2. Owned by A1.
   Open lists: tab ids are never listed here. Tabs are read from the DOM (nav.tabs [role=tab], in DOM order);
   a module registers with App.registerPanel(id, ...). A new module needs one tab button, one panel section,
   one css link and one script tag in index.html (a missing button or section is created at the end).
   This file defines window.App and does NOT boot; boot.js calls App.boot(). */
(function () {
  "use strict";

  var VIEW_KEY = "varsha-crm-view-v1";
  var panels = {};            // id -> definition
  var mounted = {};
  var tabEls = {};            // id -> tab button
  var panelEls = {};          // id -> panel section
  var order = [];             // tab ids in DOM order
  var active = "";
  var view = { tab: "dash", hide: false, panels: {} };
  var dataCbs = [];
  var pending = false, rafId = 0, timerId = 0;
  var booted = false;

  var $ = function (id) { return document.getElementById(id); };
  function warn(msg, e) { if (typeof console !== "undefined") console.warn(msg, e && e.message ? e.message : e); }

  /* ---------- view state (one key, one slice per panel) ---------- */
  function loadView() {
    var raw = Store.storage.get(VIEW_KEY), v = null;
    try { v = raw ? JSON.parse(raw) : null; } catch (e) { v = null; }
    if (!v || typeof v !== "object" || Array.isArray(v)) v = {};
    var out = { tab: typeof v.tab === "string" ? v.tab : "dash", hide: v.hide === true,
                panels: v.panels && typeof v.panels === "object" && !Array.isArray(v.panels) ? v.panels : {} };
    // Phase 1 kept { view, filter, q, sort, dir } at the top level: move it into panels.list
    var legacy = {}, any = false;
    ["view", "filter", "q", "sort", "dir"].forEach(function (k) { if (k in v) { legacy[k] = v[k]; any = true; } });
    if (any && !out.panels.list) out.panels.list = legacy;
    view = out;
    if (any) saveView();
  }
  function saveView() { Store.storage.set(VIEW_KEY, JSON.stringify(view)); }
  function getView(id) {
    if (!view.panels[id] || typeof view.panels[id] !== "object") view.panels[id] = {};
    return view.panels[id];
  }
  function setView(id, obj) { view.panels[id] = obj && typeof obj === "object" ? obj : {}; saveView(); }

  /* ---------- formatters and amounts ---------- */
  function hideAmounts() { return view.hide === true; }
  function setHideAmounts(b) {
    view.hide = !!b;
    document.body.classList.toggle("amounts-hidden", view.hide);
    saveView();
    schedule();
  }
  Ui.setHideSource(hideAmounts);

  /* ---------- banners ---------- */
  function banner(id) { return $(id); }
  function showBanner(id, text) {
    var b = banner(id);
    if (!b) return;
    var t = b.querySelector(".banner-text");
    if (t) t.textContent = text;
    b.hidden = false;
  }
  /* Messages: kind "info" (default) shows in #notice and goes away by itself after NOTICE_MS; "warn" shows in #notice and stays
     until dismissed; "error" shows in #syncErr (role=alert) and stays until dismissed. Info and warn messages are also cleared
     when the user moves to another tab (a message posted in the last NOTICE_KEEP_MS before a switch survives it, so a flow that
     says "Imported ..." and then opens another tab still shows it). Every message has a dismiss button. */
  var NOTICE_MS = 12000, NOTICE_KEEP_MS = 1500;
  var noticeTimer = 0, noticeAt = 0, noticeKind = "info";
  function notice(text, kind) {
    kind = kind === "error" ? "error" : kind === "warn" ? "warn" : "info";
    var id = kind === "error" ? "syncErr" : "notice", b = banner(id);
    showBanner(id, String(text));
    if (kind === "error" || !b) return;
    b.classList.toggle("info", kind === "info");
    noticeAt = Date.now(); noticeKind = kind;
    clearTimeout(noticeTimer);
    if (kind === "info") noticeTimer = setTimeout(function () { b.hidden = true; }, NOTICE_MS);
  }
  function hideBanner(b) {
    if (b.id === "notice") clearTimeout(noticeTimer);
    b.hidden = true;
  }
  function clearNoticeOnSwitch() {
    var b = banner("notice");
    if (b && !b.hidden && Date.now() - noticeAt > NOTICE_KEEP_MS) hideBanner(b);
  }
  function announce(text) {
    var l = $("live");
    if (!l) return;
    l.textContent = "";
    setTimeout(function () { l.textContent = String(text); }, 30);
  }
  function updateBanners() { var w = $("storageWarn"); if (w) w.hidden = Store.status().storageOK; }

  /* ---------- data batching ---------- */
  function onData(cb) { if (typeof cb === "function") dataCbs.push(cb); }
  function renderActive() {
    var p = panels[active];
    if (!p || !mounted[active] || typeof p.render !== "function") return;
    try { p.render(); } catch (e) { warn("Panel " + active + " failed to render", e); notice("The " + (p.label || active) + " tab had a problem and may be out of date.", "error"); }
  }
  function run() {
    if (!pending) return;
    pending = false;
    if (rafId) cancelAnimationFrame(rafId);
    clearTimeout(timerId);
    rafId = 0; timerId = 0;
    renderActive();
    dataCbs.slice().forEach(function (cb) { try { cb(); } catch (e) { warn("onData callback failed", e); } });
  }
  function schedule() {
    if (pending) return;
    pending = true;
    rafId = requestAnimationFrame(run);
    timerId = setTimeout(run, 100);
  }
  /* Run any pending batch now (a panel calls this after its own write so the screen is current at once). */
  function flush() { run(); }

  function onStoreChange(reason, detail) {
    if (reason === "notice") { notice(detail && detail.text, detail && detail.kind); return; }
    if (reason === "error") { notice(detail && detail.text ? detail.text : detail, "error"); return; }
    updateBanners();
    schedule();
  }

  /* ---------- panels and tabs ---------- */
  function stubPanel(label) {
    return {
      label: label,
      mount: function (el) { el.appendChild(Ui.el("p", { class: "coming", text: "Coming in this build." })); },
      render: function () {}, show: function () {}
    };
  }
  function registerPanel(id, def) {
    if (!/^[a-z][a-z0-9_-]*$/i.test(String(id))) throw new Error("Bad panel id: " + id);
    panels[id] = def || {};
    if (booted && !mounted[id]) { discoverTabs(); mountPanel(id); }
  }

  function discoverTabs() {
    var nav = document.querySelector("nav.tabs");
    order = [];
    Array.prototype.forEach.call(nav.querySelectorAll('[role="tab"]'), function (b) {
      var id = b.id.replace(/^tab-/, "");
      tabEls[id] = b; order.push(id);
      if (!b.dataset.tab) b.dataset.tab = id;
    });
    // a registered panel without a tab button gets one at the end
    Object.keys(panels).forEach(function (id) {
      if (tabEls[id]) return;
      var b = Ui.el("button", { class: "tab", role: "tab", id: "tab-" + id, "aria-controls": "panel-" + id, "aria-selected": "false", tabindex: "-1", dataset: { tab: id }, text: panels[id].label || id });
      nav.appendChild(b); tabEls[id] = b; order.push(id);
    });
    var main = document.querySelector("main");
    order.forEach(function (id) {
      var p = $("panel-" + id);
      if (!p) {
        p = Ui.el("section", { id: "panel-" + id, class: "tabpanel", role: "tabpanel", "aria-labelledby": "tab-" + id, hidden: true });
        main.appendChild(p);
      }
      panelEls[id] = p;
      if (!tabEls[id].classList.contains("tab")) tabEls[id].classList.add("tab");
      if (!p.classList.contains("tabpanel")) p.classList.add("tabpanel");
    });
  }

  function mountPanel(id) {
    if (mounted[id]) return;
    var def = panels[id];
    if (!def) { def = panels[id] = stubPanel((tabEls[id] && tabEls[id].textContent) || id); }
    try { if (def.mount) def.mount(panelEls[id]); }
    catch (e) { warn("Panel " + id + " failed to mount", e); }
    mounted[id] = true;
  }

  function centreTab(id) {
    var nav = document.querySelector("nav.tabs"), b = tabEls[id];
    if (!nav || !b) return;
    var left = b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2;
    nav.scrollLeft = Math.max(0, left);
  }

  function show(id, filter, opts) {
    if (!tabEls[id]) return false;
    var changed = active !== id, was = active;
    active = id;
    order.forEach(function (t) {
      var on = t === id;
      tabEls[t].setAttribute("aria-selected", String(on));
      tabEls[t].tabIndex = on ? 0 : -1;
      panelEls[t].hidden = !on;
    });
    view.tab = id; saveView();
    var p = panels[id];
    if (p && filter !== undefined && typeof p.show === "function") {
      try { p.show(filter); } catch (e) { warn("Panel " + id + " show failed", e); }
    }
    renderActive();
    centreTab(id);
    if (changed && was) clearNoticeOnSwitch();
    if (changed) {
      if (!opts || !opts.keepScroll) window.scrollTo(0, 0);
      announce((tabEls[id].textContent || id) + " tab");
    }
    if (opts && opts.focus) tabEls[id].focus({ preventScroll: true });
    return true;
  }

  function onTabKey(e) {
    var from = e.target.closest ? e.target.closest('[role="tab"]') : null;
    var i = order.indexOf(from ? from.id.replace(/^tab-/, "") : active), n = order.length, j = -1;
    if (i < 0) i = order.indexOf(active);
    if (e.key === "ArrowRight") j = (i + 1) % n;
    else if (e.key === "ArrowLeft") j = (i - 1 + n) % n;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = n - 1;
    if (j < 0) return;
    e.preventDefault();
    show(order[j], undefined, { focus: true, keepScroll: true });
  }

  function bindShell() {
    var nav = document.querySelector("nav.tabs");
    nav.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest('[role="tab"]') : null;
      if (b) show(b.id.replace(/^tab-/, ""), undefined, { keepScroll: true });
    });
    nav.addEventListener("keydown", onTabKey);
    Array.prototype.forEach.call(document.querySelectorAll(".banner-x"), function (x) {
      x.addEventListener("click", function () { var b = x.closest(".banner"); if (b) hideBanner(b); });
    });
    var add = $("openForm");
    if (add) add.addEventListener("click", function () { if (window.CrmCustomers && CrmCustomers.openAdd) CrmCustomers.openAdd(); });
    var t = $("today");
    if (t) t.textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  }

  /* ---------- boot ---------- */
  function boot() {
    Store.onChange(onStoreChange);
    loadView();
    document.body.classList.toggle("amounts-hidden", view.hide);
    return Store.init().then(function () { return Store.load(); }).then(function (res) {
      if (!res.ok) notice(res.error, "error");
      discoverTabs();
      bindShell();
      order.forEach(mountPanel);
      var first = tabEls[view.tab] ? view.tab : (tabEls.dash ? "dash" : order[0]);
      show(first, undefined, { keepScroll: true });
      updateBanners();
      booted = true;
      document.body.dataset.ready = "1";
      return res;
    });
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  window.App = {
    registerPanel: registerPanel, stubPanel: stubPanel, boot: boot, show: show, tab: function () { return active; },
    view: getView, setView: setView, onData: onData, flush: flush,
    hideAmounts: hideAmounts, setHideAmounts: setHideAmounts,
    notice: notice, announce: announce, download: download,
    openDialog: Ui.openDialog, closeDialog: Ui.closeDialog, fmt: Ui.fmt,
    tabs: function () { return order.slice(); }, NOTICE_MS: NOTICE_MS
  };
})();
