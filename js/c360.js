/* Accounts (Customer 360), panel id "c360". Contract: window.Crm360 = { open(customerId), score(customerId) }.
   Reads other modules through their public APIs and degrades if one is missing. The health score is advisory: it never changes the hand-set status.
   The selected customer is remembered in localStorage (a per-viewer convenience). Text is built with textContent only. */
(function () {
  "use strict";
  var KEY = "varsha-crm-c360-sel";
  var root = null, selected = "", query = "";

  function lsGet() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function lsSet(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked: the app banner already warns */ } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function safe(fn, dflt) { try { var v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } }
  function today() { return Store.todayISO(); }
  function days(a, b) { return Store.daysBetween(a, b); }
  function fmtDate(iso) { return safe(function () { return App.fmt.date(iso); }, iso) || iso; }
  function money(n) { return safe(function () { return App.fmt.money(n); }, "Rs " + n); }

  /* ---------- data ---------- */
  function openRfqs(id) {
    var released = (window.CrmRfq && CrmRfq.RELEASED) || [];
    return safe(function () { return Store.col("rfqs").all(); }, []).filter(function (r) {
      return r.customer_id === id && r.stage !== "Lost" && released.indexOf(r.stage) === -1;
    });
  }
  function moneyOf(id) { return safe(function () { return window.CrmMoney && CrmMoney.has() ? CrmMoney.forCustomer(id) : null; }, null); }
  function revOf(id) { return safe(function () { return window.CrmRevenue && CrmRevenue.has() ? CrmRevenue.forCustomer(id) : null; }, null); }

  /* Health score: five factors, points add to 100. Advisory only. */
  function score(id) {
    var c = Store.get(id);
    if (!c) return null;
    var t = today(), f = [];
    function add(key, label, pts, max, why) { f.push({ key: key, label: label, points: pts, max: max, why: why }); }
    var ageLast = c.last ? days(c.last, t) : null;
    add("order", "Recency of last order", ageLast == null ? 0 : ageLast <= 30 ? 30 : ageLast <= 60 ? 22 : ageLast <= 90 ? 14 : ageLast <= 180 ? 6 : 0, 30,
      ageLast == null ? "No order on record" : "Last order " + ageLast + " days ago (30 days or less: 30, up to 60: 22, up to 90: 14, up to 180: 6, older: 0)");
    var m = moneyOf(id), od = m && m.overdue != null ? m.overdue : null;
    add("overdue", "Overdue payments", od == null ? 15 : od > 0 ? 5 : 25, 25,
      od == null ? "No ageing data imported (neutral 15)" : od > 0 ? "Overdue amount " + money(od) + " (5)" : "Nothing overdue (25)");
    var fu = c.followUp, fpts, fwhy;
    if (!fu) { fpts = 10; fwhy = "No follow-up set (10)"; }
    else if (fu >= t) { fpts = 20; fwhy = "Follow-up " + Store.fuText(c, t).toLowerCase() + " (20)"; }
    else { var lateBy = days(fu, t); fpts = lateBy <= 7 ? 8 : 0; fwhy = "Follow-up overdue by " + lateBy + (lateBy === 1 ? " day" : " days") + " (" + fpts + ")"; }
    add("followup", "Follow-up on time", fpts, 20, fwhy);
    var n = openRfqs(id).length;
    add("rfq", "Open RFQs", n === 0 ? 4 : n <= 3 ? 10 : 6, 10, n === 0 ? "No open RFQ (4)" : n <= 3 ? n + " open RFQ, live interest (10)" : n + " open RFQs, a lot waiting (6)");
    var lc = Store.lastContacted(id), lcAge = lc ? days(lc, t) : null;
    add("contact", "Contact recency", lcAge == null ? 0 : lcAge <= 14 ? 15 : lcAge <= 30 ? 10 : lcAge <= 60 ? 5 : 0, 15,
      lcAge == null ? "No call or visit logged (0)" : "Last contact " + lcAge + " days ago (14 or less: 15, up to 30: 10, up to 60: 5, older: 0)");
    var total = f.reduce(function (s, x) { return s + x.points; }, 0);
    var band = total >= 70 ? "Healthy" : total >= 40 ? "Watch" : "Needs attention";
    return { score: total, band: band, factors: f };
  }

  function timeline(id) {
    var out = [];
    Store.listLog(id).forEach(function (l) { out.push({ at: l.at, kind: l.type, text: l.note }); });
    var ids = {};
    safe(function () { return Store.col("rfqs").all(); }, []).forEach(function (r) { if (r.customer_id === id) ids[r.id] = r.rfq_no || r.part_name || "RFQ"; });
    safe(function () { return Store.col("rfq_history").all(); }, []).forEach(function (h) {
      if (!ids[h.rfq_id]) return;
      out.push({ at: h.at, kind: "RFQ", text: ids[h.rfq_id] + ": " + (h.from ? h.from + " to " + h.to : "created at " + h.to) + (h.note ? " (" + h.note + ")" : "") });
    });
    safe(function () { return Store.col("visits").all(); }, []).forEach(function (v) {
      if (v.customer_id === id) out.push({ at: v.date, kind: "Visit", text: (v.type || "Visit") + (v.done ? " (done)" : "") + (v.note ? ": " + v.note : "") });
    });
    safe(function () { return Store.col("orders").all(); }, []).forEach(function (o) {
      if (o.customer_id === id) out.push({ at: o.date || o.order_date || (o.created_at || "").slice(0, 10), kind: "Order", text: [o.order_no, o.part, o.status].filter(Boolean).join(" · ") });
    });
    safe(function () { return window.CrmTasks && CrmTasks.forCustomer ? CrmTasks.forCustomer(id) : []; }, []).forEach(function (k) {
      out.push({ at: k.due || k.date || (k.created_at || "").slice(0, 10), kind: "Task", text: k.title || k.text || "" });
    });
    out.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
    return out;
  }

  /* ---------- view ---------- */
  function fuNode(c) {
    var t = today();
    if (!c.followUp) return el("span", "", "No follow-up set");
    var kind = c.followUp < t ? "c3-fu-overdue" : c.followUp === t ? "c3-fu-today" : "";
    return el("span", kind, "Follow-up " + fmtDate(c.followUp) + " · " + Store.fuText(c, t));
  }
  function kpi(label, value) { var d = el("div", "c3-kpi"); d.appendChild(el("b", "", value)); d.appendChild(el("span", "", label)); return d; }
  function card(title) { var s = el("section", "c3-card"); if (title) s.appendChild(el("h3", "", title)); return s; }

  function viewPicker(wrap) {
    var box = el("div", "c3-pick");
    var inp = el("input"); inp.type = "search"; inp.id = "c3Search"; inp.placeholder = "Search a customer by name"; inp.setAttribute("aria-label", "Search customers");
    inp.value = query;
    var list = el("ul", "c3-list"); list.id = "c3Results"; list.hidden = true;
    function fill() {
      list.textContent = "";
      var q = inp.value.trim().toLowerCase();
      query = inp.value;
      if (!q) { list.hidden = true; return; }
      var hits = Store.customers().filter(function (c) { return c.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
      hits.forEach(function (c) {
        var li = el("li"), b = el("button", "", c.name + (c.city ? " (" + c.city + ")" : ""));
        b.type = "button"; b.dataset.id = c.id;
        b.addEventListener("click", function () { select(c.id); });
        li.appendChild(b); list.appendChild(li);
      });
      if (!hits.length) list.appendChild(el("li", "c3-note", "No customer matches."));
      list.hidden = false;
    }
    inp.addEventListener("input", fill);
    box.appendChild(inp); box.appendChild(list);
    wrap.appendChild(box);
  }

  function viewActions(wrap, c) {
    var s = card("Quick actions"), a = el("div", "c3-actions"); s.appendChild(a);
    var err = el("p", "c3-err"); err.id = "c3Err"; err.setAttribute("role", "alert");
    function run(p) {
      Promise.resolve(p).then(function (res) {
        if (res && res.ok === false) { err.textContent = res.error || "Could not save."; return; }
        err.textContent = "";
        if (window.App && App.flush) App.flush();
        render();
      });
    }
    function noteForm(id, label, type, btn) {
      var f = el("form"); f.id = id;
      var l = el("label", "", label), ta = el("textarea"); ta.rows = 2; ta.maxLength = 500; ta.id = id + "Text"; l.htmlFor = ta.id;
      var b = el("button", "c3-btn", btn); b.type = "submit";
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!ta.value.trim()) { err.textContent = "Write a note first."; return; }
        run(Store.addLog(c.id, { type: type, note: ta.value.trim() }));
      });
      f.appendChild(l); f.appendChild(ta); f.appendChild(b); a.appendChild(f);
    }
    noteForm("c3CallForm", "Log a call", "Call", "Log call");
    noteForm("c3NoteForm", "Add a note", "Note", "Add note");
    var ff = el("form"); ff.id = "c3FuForm";
    var fl = el("label", "", "Follow-up date"), di = el("input"); di.type = "date"; di.id = "c3FuDate"; di.value = c.followUp || ""; fl.htmlFor = di.id;
    var sv = el("button", "c3-btn", "Save follow-up"); sv.type = "submit";
    var cl = el("button", "c3-btn c3-quiet", "Clear follow-up"); cl.type = "button"; cl.id = "c3FuClear";
    ff.addEventListener("submit", function (e) { e.preventDefault(); run(Store.setFollowUp(c.id, di.value)); });
    cl.addEventListener("click", function () { run(Store.setFollowUp(c.id, "")); });
    ff.appendChild(fl); ff.appendChild(di); ff.appendChild(sv); ff.appendChild(cl); a.appendChild(ff);
    a.appendChild(err);
    wrap.appendChild(s);
  }

  function viewAccount(wrap, c) {
    var h = card(); h.classList.add("c3-head");
    h.appendChild(el("h2", "", c.name));
    var m = el("ul", "c3-meta"); m.id = "c3Header";
    var st = el("li"); st.appendChild(el("span", "c3-pill", "Status: " + c.status)); m.appendChild(st);
    var fu = el("li"); fu.id = "c3Fu"; fu.appendChild(fuNode(c)); m.appendChild(fu);
    m.appendChild(el("li", "", "Group: " + (c.group || "none")));
    m.appendChild(el("li", "", "Segment: " + (c.segment || "none")));
    h.appendChild(m); wrap.appendChild(h);

    var k = card("Key figures"), g = el("div", "c3-kpis"); g.id = "c3Kpis";
    var t = today();
    g.appendChild(kpi("Last order", c.last ? fmtDate(c.last) + " (" + days(c.last, t) + " days ago)" : "No order on record"));
    g.appendChild(kpi("Open RFQs", String(openRfqs(c.id).length)));
    var mo = moneyOf(c.id);
    g.appendChild(kpi("Overdue amount", mo && mo.overdue != null ? money(mo.overdue) : "Import to see"));
    var rv = revOf(c.id);
    g.appendChild(kpi("Revenue (this financial year)", rv ? money(rv.fytd) : "Import to see"));
    k.appendChild(g);
    var lo = safe(function () { return Store.latestOrder(); }, "");
    if (lo) k.appendChild(el("p", "c3-note", "Order data through " + fmtDate(lo) + ". Later orders may not be loaded yet."));
    wrap.appendChild(k);

    var sc = score(c.id), hs = card("Health score");
    hs.id = "c3Health";
    var row = el("div", "c3-score"), num = el("span", "c3-num", String(sc.score)); num.id = "c3Score";
    row.appendChild(num);
    row.appendChild(el("span", sc.score >= 70 ? "c3-band-good" : sc.score >= 40 ? "c3-band-watch" : "c3-band-bad", sc.band + " (out of 100)"));
    hs.appendChild(row);
    var ul = el("ul", "c3-factors"); ul.id = "c3Factors";
    sc.factors.forEach(function (x) {
      var li = el("li"); li.dataset.key = x.key;
      li.appendChild(el("span", "", x.label + ": " + x.why));
      li.appendChild(el("b", "", x.points + " / " + x.max));
      ul.appendChild(li);
    });
    hs.appendChild(ul);
    hs.appendChild(el("p", "c3-note", "Advisory only. This score never changes the status you set by hand."));
    wrap.appendChild(hs);

    viewActions(wrap, c);

    var tl = card("Timeline"), items = timeline(c.id), ol = el("ul", "c3-tl"); ol.id = "c3Timeline";
    items.slice(0, 200).forEach(function (x) {
      var li = el("li"); li.dataset.kind = x.kind;
      li.appendChild(el("span", "c3-kind", x.kind));
      li.appendChild(el("span", "c3-when", x.at ? fmtDate(x.at) : ""));
      li.appendChild(el("div", "", x.text || ""));
      ol.appendChild(li);
    });
    if (!items.length) ol.appendChild(el("li", "c3-note", "Nothing logged yet."));
    tl.appendChild(ol); wrap.appendChild(tl);
  }

  function render() {
    if (!root) return;
    var keep = document.activeElement && document.activeElement.id === "c3Search";
    root.textContent = "";
    var wrap = el("div", "c3-wrap");
    viewPicker(wrap);
    var c = selected ? Store.get(selected) : null;
    if (c) viewAccount(wrap, c);
    else wrap.appendChild(el("p", "c3-note", "Pick a customer to see the whole account on one page."));
    root.appendChild(wrap);
    if (keep) { var i = document.getElementById("c3Search"); if (i) i.focus(); }
  }
  function select(id) { selected = id; query = ""; lsSet(id); render(); }

  function open(id) {
    if (!Store.get(id)) return false;
    selected = id; query = ""; lsSet(id);
    if (window.App && App.show) App.show("c360");
    render();
    return true;
  }

  function mount(el0) { root = el0; selected = lsGet(); if (selected && !Store.get(selected)) selected = ""; render(); }
  if (!document.querySelector('link[href^="css/c360.css"]')) {
    var lk = document.createElement("link"); lk.rel = "stylesheet"; lk.href = "css/c360.css?v=2"; document.head.appendChild(lk);
  }
  App.registerPanel("c360", { label: "Accounts", mount: mount, render: render, show: function () { if (!selected) selected = lsGet(); render(); } });
  Store.onChange(function () { if (root && App.tab && App.tab() === "c360") render(); });
  window.Crm360 = { open: open, score: score };
})();
