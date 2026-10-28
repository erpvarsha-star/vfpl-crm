/* Automation tab: workflow rules that create tasks.
   Contract: window.CrmRules = { run(), list() }. Rules live in Store.doc("rules"); tasks are written to Store.col("tasks")
   as {id,title,due,done,customerId,leadId,rfqId,source:"rule",ruleId,createdAt,note}. Idempotent: one open task per ruleId + entity.
   Text is built with textContent only. "Today" is India time. */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  var S = window.Store, Ui = window.Ui;

  var TRIGGERS = {
    "followup-overdue": { label: "Follow-up overdue by N days" },
    "rfq-stuck": { label: "RFQ stuck in a stage for N days" },
    "no-contact": { label: "No contact with customer for N days" },
    "rfq-quoted-no-reply": { label: "RFQ quoted, no reply for N days" },
    "lead-untouched": { label: "New lead untouched for N days" }
  };
  var DEFAULTS = [
    { id: "r-fu", name: "Chase overdue follow-ups", enabled: true, trigger: "followup-overdue", days: 3, action: "task" },
    { id: "r-stuck", name: "Unstick stalled RFQs", enabled: true, trigger: "rfq-stuck", days: 14, action: "task" },
    { id: "r-nc", name: "Reconnect with quiet customers", enabled: true, trigger: "no-contact", days: 60, action: "task" },
    { id: "r-q", name: "Chase quotes with no reply", enabled: true, trigger: "rfq-quoted-no-reply", days: 7, action: "task" },
    { id: "r-lead", name: "Touch new leads", enabled: true, trigger: "lead-untouched", days: 3, action: "task" }
  ];
  var DOC = "rules";

  function rulesDoc() { return S.doc(DOC); }
  function load() {
    var d = rulesDoc().get();
    if (!d || !Array.isArray(d.rules)) { d = { v: 1, rules: DEFAULTS.map(function (r) { return Object.assign({}, r); }), lastRun: null }; rulesDoc().set(d); }
    return d;
  }
  function save(d) { return rulesDoc().set(d); }
  function list() { return load().rules.map(function (r) { return Object.assign({}, r); }); }

  function openKey(t) { return t.ruleId + "|" + (t.customerId || "") + "|" + (t.leadId || "") + "|" + (t.rfqId || ""); }

  /* Entities matching one rule: [{customerId,leadId,rfqId,title,note}] */
  function matches(rule, today) {
    var out = [], n = Math.max(0, Number(rule.days) || 0), t = rule.trigger;
    var custs = S.customers(), byId = {};
    custs.forEach(function (c) { byId[c.id] = c; });
    if (t === "followup-overdue") {
      custs.forEach(function (c) {
        if (!c.followUp) return;
        var d = S.daysBetween(c.followUp, today);
        if (d >= n && d > 0) out.push({ customerId: c.id, title: "Follow up with " + c.name, note: "Follow-up overdue by " + d + " days." });
      });
    } else if (t === "no-contact") {
      var lastLog = {};
      S.allLog().forEach(function (l) { if (l.customerId && l.type !== "Note" && (!lastLog[l.customerId] || l.at > lastLog[l.customerId])) lastLog[l.customerId] = l.at; });
      custs.forEach(function (c) {
        var last = lastLog[c.id] || "";
        if (!last) return;
        var d = S.daysBetween(last, today);
        if (d >= n) out.push({ customerId: c.id, title: "Contact " + c.name, note: "No contact logged for " + d + " days." });
      });
    } else if (t === "rfq-stuck" || t === "rfq-quoted-no-reply") {
      S.col("rfqs").all().forEach(function (r) {
        if (r.lost || !r.stage_at) return;
        if (t === "rfq-quoted-no-reply" && r.stage !== "Quoted") return;
        if (t === "rfq-stuck" && ["PO", "Sample", "PPAP"].indexOf(r.stage) !== -1) return;
        var d = S.daysBetween(r.stage_at, today);
        if (d < n) return;
        var label = (r.rfq_no || r.part_name || r.part_no || "RFQ") + (r.customer_id && byId[r.customer_id] ? " (" + byId[r.customer_id].name + ")" : "");
        out.push({ customerId: r.customer_id || "", leadId: r.lead_id || "", rfqId: r.id,
          title: (t === "rfq-stuck" ? "Move RFQ " : "Chase quote ") + label,
          note: (t === "rfq-stuck" ? "Stuck in " + r.stage + " for " : "Quoted ") + d + " days." });
      });
    } else if (t === "lead-untouched") {
      var touched = {};
      S.allLog().forEach(function (l) { if (l.leadId) touched[l.leadId] = 1; });
      S.col("leads").all().forEach(function (l) {
        if (l.status && l.status !== "Open") return;
        if (touched[l.id] || !l.created_at) return;
        var created = String(l.created_at).slice(0, 10);
        try { created = new Date(l.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); } catch (e) { /* keep slice */ }
        var d = S.daysBetween(created, today);
        if (d >= n) out.push({ leadId: l.id, title: "Contact lead " + (l.company || "(unnamed)"), note: "New lead untouched for " + d + " days." });
      });
    }
    return out;
  }

  function run() {
    var d = load(), today = S.todayISO(), tasks = S.col("tasks"), seen = {}, created = [], now = new Date().toISOString();
    tasks.all().forEach(function (t) { if (!t.done && t.source === "rule") seen[openKey(t)] = 1; });
    d.rules.forEach(function (rule) {
      if (!rule.enabled || rule.action !== "task" || !TRIGGERS[rule.trigger]) return;
      matches(rule, today).forEach(function (m) {
        var row = { id: "task-" + rule.id + "-" + (m.rfqId || m.leadId || m.customerId) + "-" + today, title: m.title, due: today, done: false,
          customerId: m.customerId || "", leadId: m.leadId || "", rfqId: m.rfqId || "", source: "rule", ruleId: rule.id, createdAt: now, note: m.note || "" };
        var k = openKey(row);
        if (seen[k]) return;
        if (tasks.get(row.id)) row.id += "-" + Math.random().toString(36).slice(2, 6);
        tasks.insert(row);
        seen[k] = 1; created.push(m.title);
      });
    });
    d.lastRun = { at: now, date: today, created: created.length, titles: created.slice(0, 20) };
    save(d);
    return { created: created.length, titles: created };
  }

  /* ---------- panel ---------- */
  var root, listEl, logEl, formEl, editing = null;
  function el(t, a, k) { return Ui.el(t, a, k); }

  function updateRule(id, patch) {
    var d = load();
    d.rules = d.rules.map(function (r) { return r.id === id ? Object.assign({}, r, patch) : r; });
    save(d); draw();
  }
  function removeRule(id) { var d = load(); d.rules = d.rules.filter(function (r) { return r.id !== id; }); save(d); draw(); }

  function drawLog() {
    Ui.clear(logEl);
    var lr = load().lastRun;
    if (!lr) { logEl.appendChild(el("p", { class: "rl-muted", text: "Not run yet." })); return; }
    logEl.appendChild(el("p", { class: "rl-sum", id: "rlSummary", text: lr.created === 1 ? "Created 1 task" : "Created " + lr.created + " tasks" }));
    logEl.appendChild(el("p", { class: "rl-muted", text: "Last run " + lr.date + " (India time)." }));
    if (lr.titles && lr.titles.length) logEl.appendChild(el("ul", { class: "rl-created" }, lr.titles.map(function (t) { return el("li", { text: t }); })));
  }

  function drawForm() {
    Ui.clear(formEl);
    if (!editing) { formEl.hidden = true; return; }
    formEl.hidden = false;
    var r = editing;
    var name = el("input", { id: "rlName", type: "text", maxlength: "80", value: r.name, "aria-label": "Rule name" });
    var trig = el("select", { id: "rlTrigger", "aria-label": "Trigger" }, Object.keys(TRIGGERS).map(function (k) { return el("option", { value: k, text: TRIGGERS[k].label, selected: k === r.trigger }); }));
    var days = el("input", { id: "rlDays", type: "number", min: "0", max: "365", value: String(r.days), "aria-label": "Number of days" });
    var err = el("p", { class: "rl-err", id: "rlErr", role: "alert" });
    formEl.appendChild(el("h3", { text: r.isNew ? "New rule" : "Edit rule" }));
    formEl.appendChild(el("label", {}, [el("span", { text: "Name" }), name]));
    formEl.appendChild(el("label", {}, [el("span", { text: "When" }), trig]));
    formEl.appendChild(el("label", {}, [el("span", { text: "Days (N)" }), days]));
    formEl.appendChild(el("p", { class: "rl-muted", text: "Then: create a task due today (one open task per rule and customer, lead or RFQ)." }));
    formEl.appendChild(err);
    formEl.appendChild(el("div", { class: "rl-actions" }, [
      el("button", { class: "btn primary", id: "rlSave", type: "button", text: "Save rule", onclick: function () {
        var nm = name.value.trim(), n = parseInt(days.value, 10);
        if (!nm) { err.textContent = "Give the rule a name."; return; }
        if (!(n >= 0 && n <= 365)) { err.textContent = "Days must be 0 to 365."; return; }
        var d = load(), rec = { id: r.id, name: nm, enabled: r.enabled, trigger: trig.value, days: n, action: "task" };
        if (r.isNew) d.rules.push(rec); else d.rules = d.rules.map(function (x) { return x.id === r.id ? rec : x; });
        save(d); editing = null; draw();
      } }),
      el("button", { class: "btn", id: "rlCancel", type: "button", text: "Cancel", onclick: function () { editing = null; drawForm(); } })
    ]));
  }

  function drawList() {
    Ui.clear(listEl);
    var rules = load().rules;
    if (!rules.length) listEl.appendChild(el("li", { class: "rl-muted", text: "No rules yet. Add one." }));
    rules.forEach(function (r) {
      var cb = el("input", { type: "checkbox", class: "rl-toggle", checked: !!r.enabled, "aria-label": "Enabled: " + r.name,
        onchange: function () { updateRule(r.id, { enabled: cb.checked }); } });
      var t = TRIGGERS[r.trigger] || { label: r.trigger };
      listEl.appendChild(el("li", { class: "rl-item", dataset: { id: r.id } }, [
        el("label", { class: "rl-on" }, [cb, el("span", { class: "rl-state", text: r.enabled ? "On" : "Off" })]),
        el("div", { class: "rl-body" }, [
          el("strong", { class: "rl-name", text: r.name }),
          el("span", { class: "rl-desc", text: t.label.replace("N", String(r.days)) + ", then create a task" })
        ]),
        el("div", { class: "rl-btns" }, [
          el("button", { class: "btn-sm rl-edit", type: "button", text: "Edit", onclick: function () { editing = Object.assign({}, r); drawForm(); } }),
          el("button", { class: "btn-sm rl-del", type: "button", text: "Delete", onclick: function () { removeRule(r.id); } })
        ])
      ]));
    });
  }
  function draw() { if (!root) return; drawList(); drawLog(); drawForm(); }

  function mount(el0) {
    root = el0;
    root.appendChild(el("div", { class: "rl-head" }, [
      el("h2", { text: "Automation" }),
      el("div", { class: "rl-btns" }, [
        el("button", { class: "btn primary", id: "rlRun", type: "button", text: "Run now", onclick: function () { run(); draw(); } }),
        el("button", { class: "btn", id: "rlAdd", type: "button", text: "Add rule", onclick: function () {
          editing = { id: "r-" + Date.now().toString(36), name: "", enabled: true, trigger: "followup-overdue", days: 3, action: "task", isNew: true }; drawForm(); } })
      ])
    ]));
    root.appendChild(el("p", { class: "rl-muted", text: "Rules check your data and create tasks. A rule never creates a second open task for the same customer, lead or RFQ." }));
    listEl = el("ul", { class: "rl-list", id: "rlList" }); root.appendChild(listEl);
    formEl = el("div", { class: "rl-form card", id: "rlForm", hidden: true }); root.appendChild(formEl);
    logEl = el("div", { class: "rl-log card", id: "rlLog" }); root.appendChild(logEl);
    try { run(); } catch (e) { /* run again on show */ }
    draw();
  }

  window.CrmRules = { run: run, list: list };
  App.registerPanel("rules", {
    label: "Automation", mount: mount,
    render: function () { if (!editing) draw(); },
    show: function () { try { run(); } catch (e) { /* ignore */ } if (!editing) draw(); }
  });
})();
