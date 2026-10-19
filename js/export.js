/* Export tab: CSV and tab-separated exports, customers.json, the private backup and its restore, the data card (counts and
   Clear buttons), the weekly report button. Design section 5.7 + 12.5. Owned by A6.
   Rules this file keeps:
   - "Include notes", "Include contact details" and "Include amounts" are unticked on every load and are never remembered.
   - Without a tick, no export has note text, no lead/RFQ email, phone or contact reference, and no money or revenue amounts.
     (Customer name, contact person and phone are customer fields: they are in customers.json already, decision D4.)
   - Money, invoices, dispatch history, staged leads and name matches are never in the backup (they are re-imported).
   - Text is built with textContent only. Pure builders are also module.exports for Node unit tests (no window needed). */
(function () {
  "use strict";

  var hasWin = typeof window !== "undefined";
  var Csv = hasWin ? window.CrmCsv : require("./csv.js");
  var BOM = "﻿";
  var BACKUP_FORMAT = "varsha-crm-backup-v2";
  var NOTE_KEYS = ["note", "notes", "context", "value_angle"];
  var CONTACT_KEYS = ["email", "phone", "contact_ref"];

  /* ======================================================================================================
     Pure builders
     ====================================================================================================== */
  function s(v) { return v == null ? "" : String(v); }
  /* Amounts as plain numbers (no rupee sign, no commas) so Sheets can sum them. Positive: 2 decimals as text.
     Negative: a real number, because the formula guard in CrmCsv would put an apostrophe in front of a "-12.00" string. */
  function amt(n) {
    if (n == null || typeof n !== "number" || !isFinite(n)) return "";
    var r = Math.round(n * 100) / 100;
    return r < 0 ? r : r.toFixed(2);
  }
  function plantsText(plants) {
    return (plants || []).map(function (p) {
      var where = [p.city, p.state].filter(Boolean).join(", ");
      return p.name ? p.name + (where ? " (" + where + ")" : "") : where;
    }).filter(Boolean).join("; ");
  }
  function byName(a, b) { return s(a.name).toLowerCase().localeCompare(s(b.name).toLowerCase()); }

  var CUSTOMER_HEAD = ["Customer", "Contact person", "Phone", "City", "Group", "Segment", "Vehicle segment", "Plants", "Last order", "Follow-up", "Status", "Last contacted", "Notes count"];
  var MONEY_HEAD = ["Outstanding", "Overdue", "1-30 days", "31-60 days", "61-90 days", ">90 days"];

  /* ctx: { lastContacted(id), logCount(id), includeNotes, notesFor(id), money(id) | null, revenue(id) | null, fyLabel }.
     Amount columns exist only when ctx.money / ctx.revenue are given (the caller passes them only when "Include amounts" is ticked). */
  function customerTable(list, ctx) {
    ctx = ctx || {};
    var head = CUSTOMER_HEAD.slice();
    if (ctx.includeNotes) head.push("Notes");
    if (ctx.money) head = head.concat(MONEY_HEAD, ["Amount note"]);
    if (ctx.revenue) head.push("Revenue " + (ctx.fyLabel ? "FY " + ctx.fyLabel + " " : "") + "(Taxable)");
    var rows = [head];
    list.forEach(function (c) {
      var r = [c.name, c.contact, c.phone, c.city, c.group, c.segment, c.vehicleSegment, plantsText(c.plants), c.last, c.followUp, c.status,
               ctx.lastContacted ? ctx.lastContacted(c.id) : "", ctx.logCount ? ctx.logCount(c.id) : 0];
      if (ctx.includeNotes) r.push(ctx.notesFor ? ctx.notesFor(c.id) : "");
      if (ctx.money) {
        var m = ctx.money(c.id);
        if (m) {
          r.push(amt(m.outstanding), amt(m.overdue), amt(m.b1_30), amt(m.b31_60), amt(m.b61_90), amt(m.b90),
                 m.shared ? "Group amount (" + m.shared.groupName + ", shared by " + m.shared.n + "): count it once" : "");
        } else r.push("", "", "", "", "", "", "");
      }
      if (ctx.revenue) { var rv = ctx.revenue(c.id); r.push(rv ? amt(rv.fytd) : ""); }
      rows.push(r);
    });
    return rows;
  }

  /* ctx: { customerName(row), includeNotes, includeContacts } */
  function rfqTable(list, ctx) {
    ctx = ctx || {};
    var head = ["RFQ no", "Customer", "Part name", "Part no", "Qty", "Received", "Quote due", "Quoted value", "Stage", "Stage since", "Next action", "Lost"];
    if (ctx.includeNotes) head.push("Notes");
    if (ctx.includeContacts) head.push("Contact reference");
    var rows = [head];
    list.forEach(function (r) {
      var o = [r.rfq_no, ctx.customerName ? ctx.customerName(r) : r.customer_name, r.part_name, r.part_no, r.qty == null ? "" : r.qty, r.received, r.quote_due,
               amt(r.quoted_value), r.stage, r.stage_at, r.next_action, r.lost ? "Yes" : "No"];
      if (ctx.includeNotes) o.push(r.notes);
      if (ctx.includeContacts) o.push(r.contact_ref);
      rows.push(o);
    });
    return rows;
  }

  var FIT_LABEL = { sweet: "Sweet spot", check: "Check fit", regret: "Fast regret" };
  /* ctx: { bucketLabel(key), includeNotes, includeContacts } */
  function leadTable(list, ctx) {
    ctx = ctx || {};
    var head = ["Company", "Key contact"];
    if (ctx.includeContacts) head.push("Email", "Phone");
    head.push("Region / program", "Scope", "Segment / domain", "Last contact", "Bucket", "Action category", "Strategy", "Next follow-up", "Fit", "Source", "Status");
    if (ctx.includeNotes) head.push("Notes");
    var rows = [head];
    list.forEach(function (l) {
      var o = [l.company, l.contact_name];
      if (ctx.includeContacts) o.push(l.email, l.phone);
      o.push(l.region_program, l.scope, l.segment_domain, l.last_contact, l.bucket ? (ctx.bucketLabel ? ctx.bucketLabel(l.bucket) : l.bucket) : "",
             l.action_category, l.strategy, l.next_follow_up, FIT_LABEL[l.fit] || "", l.source, l.status || "Open");
      if (ctx.includeNotes) o.push(l.context);
      rows.push(o);
    });
    return rows;
  }

  /* ctx: { customerName(id), includeNotes } */
  function visitTable(list, ctx) {
    ctx = ctx || {};
    var head = ["Date", "Time", "Type", "Customer"];
    if (ctx.includeNotes) head.push("Note");
    head.push("Done");
    var rows = [head];
    list.slice().sort(function (a, b) { return s(a.date + " " + a.time).localeCompare(s(b.date + " " + b.time)); }).forEach(function (v) {
      var o = [v.date, v.time, v.type, ctx.customerName ? ctx.customerName(v.customer_id) : ""];
      if (ctx.includeNotes) o.push(v.note);
      o.push(v.done ? "Yes" : "No");
      rows.push(o);
    });
    return rows;
  }

  /* UTF-8 with BOM, every field quoted, CRLF rows with a trailing CRLF (design 5.7). */
  function csvText(table) { return BOM + Csv.toCSV(table) + "\r\n"; }
  function tsvText(table) { return Csv.toTSV(table); }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function blank(rows, keys) {
    (rows || []).forEach(function (r) {
      if (r && typeof r === "object") keys.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(r, k)) r[k] = typeof r[k] === "string" ? "" : r[k]; });
    });
  }
  /* The private backup: Store.exportBackup() (no money, no invoices, no dispatch history) plus the leads, with the boxes applied.
     Always returns a copy, so the live data is never touched. */
  function makeBackup(raw, leads, opts) {
    opts = opts || {};
    var b = clone(raw);
    b.leads = clone(leads || []);
    var lists = [b.callLog, b.rfqs, b.rfqHistory, b.visits, b.orders, b.leads];
    Object.keys(b.extra || {}).forEach(function (k) { if (Array.isArray(b.extra[k])) lists.push(b.extra[k]); });
    if (!opts.includeNotes) lists.forEach(function (l) { blank(l, NOTE_KEYS); });
    if (!opts.includeContacts) lists.forEach(function (l) { blank(l, CONTACT_KEYS); });
    b.includes = { notes: !!opts.includeNotes, contactDetails: !!opts.includeContacts };
    b.note = "Varsha CRM backup. Private: never commit it. Has customers, call log, RFQs, visits, typed orders, leads and targets. " +
      "No money, invoices or dispatch history (import those again). " +
      (opts.includeNotes ? "Note text is included. " : "Note text is not included. ") +
      (opts.includeContacts ? "Lead and RFQ emails, phones and contact references are included." : "Without contact details, emails and phones are not in the file.");
    return b;
  }

  /* Check a chosen file before anything is changed. Returns { ok, error } or { ok, backup, summary }. */
  function planRestore(text) {
    var b;
    try { b = JSON.parse(String(text || "").replace(/^﻿/, "")); } catch (e) { return { ok: false, error: "That file is not a backup: it could not be read as JSON." }; }
    if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, error: "That file is not a backup." };
    if (b.format !== BACKUP_FORMAT) {
      return { ok: false, error: Array.isArray(b.customers) && !b.format
        ? "That looks like customers.json, not a backup. Choose a file made by \"Download backup\"."
        : "That file is not a Varsha CRM backup this version can read (expected " + BACKUP_FORMAT + ")." };
    }
    if (!Array.isArray(b.customers)) return { ok: false, error: "The backup has no customer list, so it was not restored." };
    var arr = function (k) { return Array.isArray(b[k]) ? b[k] : []; };
    var inc = b.includes && typeof b.includes === "object" ? b.includes : {};
    return {
      ok: true, backup: b,
      summary: {
        exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : "", customers: b.customers.length, callLog: arr("callLog").length,
        rfqs: arr("rfqs").length, rfqHistory: arr("rfqHistory").length, visits: arr("visits").length, orders: arr("orders").length, leads: arr("leads").length,
        targets: !!(b.targets && typeof b.targets === "object"),
        // a backup made before the boxes existed carried the note text; one made with them says what it holds
        notes: inc.notes !== false && (inc.notes === true || !b.includes), contactDetails: inc.contactDetails === true
      }
    };
  }

  var pure = {
    CUSTOMER_HEAD: CUSTOMER_HEAD, MONEY_HEAD: MONEY_HEAD, BOM: BOM, BACKUP_FORMAT: BACKUP_FORMAT,
    amt: amt, plantsText: plantsText, customerTable: customerTable, rfqTable: rfqTable, leadTable: leadTable, visitTable: visitTable,
    csvText: csvText, tsvText: tsvText, makeBackup: makeBackup, planRestore: planRestore
  };
  if (!hasWin) { if (typeof module !== "undefined" && module.exports) module.exports = pure; return; }

  /* ======================================================================================================
     Browser part
     ====================================================================================================== */
  var Store = window.Store, Ui = window.Ui, App = window.App;
  var el = Ui.el;
  var E = {};                    // elements
  var scope = { cust: "shown", rfq: "shown", lead: "shown" };

  function mod(name) { return window[name] || null; }
  function safe(fn, fallback) { try { var v = fn(); return v == null ? fallback : v; } catch (e) { if (typeof console !== "undefined") console.warn("Export: a module call failed", e && e.message); return fallback; } }
  function plural(n, one, many) { return Ui.fmt.int(n) + " " + (n === 1 ? one : many); }
  function today() { return Store.todayISO(); }

  /* ---------- messages ---------- */
  function say(text) { E.err.hidden = true; E.msg.textContent = text; App.announce(text); }
  function fail(text) { E.msg.textContent = ""; E.err.textContent = text; E.err.hidden = false; }
  function downloadCsv(name, table, what) {
    App.download(name, csvText(table), "text/csv;charset=utf-8");
    say("Downloaded " + name + " (" + what + ").");
  }

  /* ---------- scope (the only remembered choice) ---------- */
  function loadScope() {
    var v = App.view("export");
    ["cust", "rfq", "lead"].forEach(function (k) { if (v[k] === "all" || v[k] === "shown") scope[k] = v[k]; });
  }
  function saveScope() { App.setView("export", { cust: scope.cust, rfq: scope.rfq, lead: scope.lead }); }
  function scopeRadios(key, name, labels) {
    var wrap = el("div", { class: "ex-scope", role: "radiogroup", "aria-label": name }), out = {};
    [["shown", "shown"], ["all", "all"]].forEach(function (p) {
      var inp = el("input", { type: "radio", name: "exScope-" + key, value: p[0], id: "exScope-" + key + "-" + p[0] });
      var txt = el("span", { id: "exScopeText-" + key + "-" + p[0] });
      var lab = el("label", { class: "ex-check", for: inp.id }, [inp, txt]);
      inp.addEventListener("change", function () { if (inp.checked) { scope[key] = p[0]; saveScope(); render(); } });
      wrap.appendChild(lab);
      out[p[0]] = { input: inp, text: txt, label: lab };
    });
    E["scope_" + key] = out;
    return wrap;
  }
  function syncScope(key) {
    var o = E["scope_" + key];
    o.shown.input.checked = scope[key] === "shown";
    o.all.input.checked = scope[key] === "all";
  }

  /* ---------- what the files contain ---------- */
  function opts() { return { notes: E.incNotes.checked, contacts: E.incContacts.checked, amounts: E.incAmounts.checked }; }
  function hasAmountsData() {
    var M = mod("CrmMoney"), R = mod("CrmRevenue");
    return !!((M && safe(function () { return M.has(); }, false)) || (R && safe(function () { return R.has(); }, false)));
  }
  function revenueFy() {
    var R = mod("CrmRevenue");
    if (!R || !safe(function () { return R.has(); }, false)) return "";
    var fys = safe(function () { return R.fys(); }, []);
    var want = App.view("dash").revFy;
    if (want && fys.indexOf(want) !== -1) return want;
    var cur = safe(function () { return R.fyOf(today()); }, "");
    return fys.indexOf(cur) !== -1 ? cur : (fys[0] || "");
  }

  /* ---------- customers ---------- */
  function customersToExport() {
    var C = mod("CrmCustomers");
    if (scope.cust === "shown" && C && typeof C.visible === "function") return { list: safe(function () { return C.visible(); }, Store.customers()), shown: true };
    return { list: Store.customers().slice().sort(byName), shown: false };
  }
  function customerCtx(o) {
    var ctx = {
      lastContacted: Store.lastContacted, logCount: Store.logCount, includeNotes: o.notes,
      notesFor: function (id) { return Store.listLog(id).map(function (e) { return e.at + " " + e.type + (e.note ? ": " + e.note : ""); }).join(" | "); }
    };
    if (o.amounts) {
      var M = mod("CrmMoney"), R = mod("CrmRevenue");
      if (M && safe(function () { return M.has(); }, false)) ctx.money = function (id) { return safe(function () { return M.forCustomer(id); }, null); };
      if (R && safe(function () { return R.has(); }, false)) { var fy = revenueFy(); ctx.fyLabel = fy; ctx.revenue = function (id) { return safe(function () { return R.forCustomer(id, fy || undefined); }, null); }; }
    }
    return ctx;
  }
  function customerTableNow() {
    var pick = customersToExport();
    return { table: customerTable(pick.list, customerCtx(opts())), n: pick.list.length, shown: pick.shown };
  }
  function downloadCustomerCsv() {
    var r = customerTableNow();
    downloadCsv("varsha-crm-customers" + (r.shown ? "-shown" : "") + "-" + today() + ".csv", r.table, plural(r.n, "customer", "customers"));
  }
  function showFallback(text) {
    E.copyBox.value = text;
    E.copyFallback.hidden = false;
    E.copyBox.focus();
    E.copyBox.select();
    var done = false;
    try { done = document.execCommand("copy"); } catch (e) { done = false; }
    return done;
  }
  function copyForSheets() {
    var r = customerTableNow(), text = tsvText(r.table);
    E.copyFallback.hidden = true;
    var finish = function (how) { say(how === "clipboard"
      ? "Copied " + plural(r.n, "customer", "customers") + ". Open Google Sheets, click cell A1 and paste."
      : "Copied " + plural(r.n, "customer", "customers") + " with the fallback. Open Google Sheets, click cell A1 and paste."); };
    var viaBox = function () {
      if (showFallback(text)) finish("fallback");
      else say("The browser blocked the clipboard. The text is selected below: press Ctrl+C (or long-press and Copy), then paste into Google Sheets.");
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      var p;
      try { p = navigator.clipboard.writeText(text); } catch (e) { return viaBox(); }
      Promise.resolve(p).then(function () { finish("clipboard"); }, viaBox);
    } else viaBox();
  }

  /* ---------- RFQs, leads, visits ---------- */
  function customerName(id) { var c = id ? Store.get(id) : null; return c ? c.name : ""; }
  function rfqsToExport() {
    var R = mod("CrmRfq");
    if (scope.rfq === "shown" && R && typeof R.visible === "function") return { list: safe(function () { return R.visible(); }, []), shown: true };
    return { list: Store.col("rfqs").all(), shown: false };
  }
  function downloadRfqCsv() {
    var pick = rfqsToExport(), o = opts();
    var table = rfqTable(pick.list, {
      includeNotes: o.notes, includeContacts: o.contacts,
      customerName: function (r) { return customerName(r.customer_id) || (r.lead_id ? "Lead: " + (r.customer_name || "") : r.customer_name || ""); }
    });
    downloadCsv("varsha-crm-rfqs" + (pick.shown ? "-shown" : "") + "-" + today() + ".csv", table, plural(pick.list.length, "RFQ", "RFQs"));
  }
  function leadsToExport() {
    var L = mod("CrmLeads");
    if (scope.lead === "shown" && L && typeof L.visible === "function") return { list: safe(function () { return L.visible(); }, []), shown: true };
    return { list: Store.col("leads").all(), shown: false };
  }
  function downloadLeadCsv() {
    var pick = leadsToExport(), o = opts(), L = mod("CrmLeads");
    var table = leadTable(pick.list, {
      includeNotes: o.notes, includeContacts: o.contacts,
      bucketLabel: function (b) { return L && L.BUCKETS && L.BUCKETS[b] ? L.BUCKETS[b] : b; }
    });
    downloadCsv("varsha-crm-leads" + (pick.shown ? "-shown" : "") + "-" + today() + ".csv", table, plural(pick.list.length, "lead", "leads"));
  }
  function downloadVisitCsv() {
    var list = Store.col("visits").all();
    downloadCsv("varsha-crm-visits-" + today() + ".csv", visitTable(list, { includeNotes: opts().notes, customerName: customerName }), plural(list.length, "visit or call", "visits and calls"));
  }

  /* ---------- customers.json (git-safe) and the backup ---------- */
  function downloadCustomersJson() {
    App.download("customers.json", JSON.stringify(Store.exportCustomersJson(), null, 2) + "\n", "application/json");
    say("Downloaded customers.json (customer fields only: no notes, no amounts, no emails).");
  }
  function downloadBackup() {
    var o = opts();
    var b = makeBackup(Store.exportBackup(), Store.col("leads").all(), { includeNotes: o.notes, includeContacts: o.contacts });
    var name = "varsha-crm-backup-" + today() + ".json";
    App.download(name, JSON.stringify(b, null, 2) + "\n", "application/json");
    say("Downloaded " + name + ". It is private: keep it out of git." + (o.notes && o.contacts ? "" : " It is missing " +
      (!o.notes && !o.contacts ? "note text and contact details" : !o.notes ? "note text" : "contact details") + " because the box was not ticked."));
  }

  /* ---------- restore ---------- */
  function seq(items, fn) {
    return items.reduce(function (p, it) { return p.then(function () { return fn(it); }); }, Promise.resolve());
  }
  function keepStripped(rows, existing, keys) {
    var byId = {};
    (existing || []).forEach(function (r) { byId[r.id] = r; });
    rows.forEach(function (r) {
      var o = byId[r.id];
      if (!o) return;
      keys.forEach(function (k) { if ((r[k] === "" || r[k] == null) && o[k]) r[k] = o[k]; });
    });
  }
  function remap(rows, map, keys) {
    rows.forEach(function (r) { keys.forEach(function (k) { if (r[k] && map[r[k]]) r[k] = map[r[k]]; }); });
  }
  function fieldsOf(c) {
    return { name: c.name, contact: c.contact || "", phone: c.phone || "", city: c.city || "", last: c.last || "", followUp: c.followUp || "", status: c.status,
             group: c.group || "", segment: c.segment || "", vehicleSegment: c.vehicleSegment || "", relatedParty: !!c.relatedParty, plants: c.plants || [] };
  }
  function differs(cur, f) {
    return Object.keys(f).some(function (k) { return JSON.stringify(k === "plants" ? (cur.plants || []) : cur[k]) !== JSON.stringify(f[k]); });
  }
  function applyRestore(sum, b) {
    var rep = { updated: 0, added: 0, customerFail: 0, logAdded: 0, logSkipped: 0, sets: [] }, idMap = {};
    var haveNotes = sum.notes;
    var cust = b.customers.filter(function (c) { return c && typeof c === "object" && c.name; });
    return seq(cust, function (c) {
      var f = fieldsOf(c), cur = c.id ? Store.get(c.id) : null;
      if (!cur) { var low = String(c.name).toLowerCase(); cur = Store.customers().filter(function (x) { return x.name.toLowerCase() === low; })[0] || null; }
      if (cur) {
        idMap[c.id] = cur.id;
        if (!differs(cur, f)) return null;
        return Store.saveCustomer(cur.id, f).then(function (r) { if (r.ok) rep.updated++; else rep.customerFail++; });
      }
      return Store.addCustomer(f).then(function (r) { if (r.ok) { rep.added++; idMap[c.id] = r.id; } else rep.customerFail++; });
    }).then(function () {
      // collections: replaced by the backup's rows; fields the backup was made without are kept from the rows already here
      var lists = [["rfqs", "rfqs", ["customer_id"], "RFQ", "RFQs"], ["rfq_history", "rfqHistory", [], "RFQ history entry", "RFQ history entries"],
                   ["visits", "visits", ["customer_id"], "visit or call", "visits and calls"], ["orders", "orders", ["customer_id"], "typed order", "typed orders"],
                   ["leads", "leads", ["converted_customer_id"], "lead", "leads"]];
      var stripNotes = !sum.notes, stripContacts = !sum.contactDetails;
      return seq(lists, function (L) {
        if (!Array.isArray(b[L[1]])) return null;
        var rows = clone(b[L[1]].filter(function (r) { return r && typeof r === "object"; }));
        remap(rows, idMap, L[2]);
        var existing = Store.col(L[0]).all();
        if (stripNotes) keepStripped(rows, existing, NOTE_KEYS);
        if (stripContacts) keepStripped(rows, existing, CONTACT_KEYS);
        return Store.col(L[0]).replaceAll(rows).then(function (r) {
          rep.sets.push(r.ok ? plural(rows.length, L[3], L[4]) : L[4] + " not restored (" + r.error + ")");
        });
      });
    }).then(function () {
      return seq(Object.keys(b.extra && typeof b.extra === "object" ? b.extra : {}), function (name) {
        if (!Array.isArray(b.extra[name])) return null;
        try { return Store.col(name).replaceAll(clone(b.extra[name])).then(function (r) { if (r.ok) rep.sets.push(plural(b.extra[name].length, name + " row", name + " rows")); }); } catch (e) { return null; }
      });
    }).then(function () {
      var docs = [];
      if (b.targets && typeof b.targets === "object" && !Array.isArray(b.targets)) docs.push(["targets", b.targets, "targets"]);
      if (b.ordersMeta && typeof b.ordersMeta === "object" && !Array.isArray(b.ordersMeta)) docs.push(["orders_meta", b.ordersMeta, ""]);
      Object.keys(b.extraDocs && typeof b.extraDocs === "object" ? b.extraDocs : {}).forEach(function (n) {
        if (b.extraDocs[n] && typeof b.extraDocs[n] === "object" && !Array.isArray(b.extraDocs[n])) docs.push([n, b.extraDocs[n], ""]);
      });
      return seq(docs, function (d) {
        try { return Store.doc(d[0]).set(clone(d[1])).then(function (r) { if (r.ok && d[2]) rep.sets.push(d[2]); }); } catch (e) { return null; }
      });
    }).then(function () {
      // call log: only entries that are not here yet are added (oldest first, so the order is kept)
      if (!haveNotes) return null;
      var key = function (e) { return [e.customerId || "", e.leadId || "", e.at, e.type, e.note].join("\u0001"); };
      var have = {};
      Store.allLog().forEach(function (e) { have[key(e)] = 1; });
      var entries = (Array.isArray(b.callLog) ? b.callLog : []).filter(function (e) { return e && e.at && e.type; })
        .slice().sort(function (x, y) { return s(x.createdAt).localeCompare(s(y.createdAt)); });
      return seq(entries, function (e) {
        var cid = e.customerId ? (idMap[e.customerId] || e.customerId) : "";
        var e2 = { customerId: cid, leadId: e.leadId || "", at: e.at, type: e.type, note: e.note || "(no note)" };
        if (have[key({ customerId: cid, leadId: e2.leadId, at: e2.at, type: e2.type, note: e2.note })] || have[key(e)]) return null;
        var p = cid ? Store.addLog(cid, { at: e2.at, type: e2.type, note: e2.note }) : (e2.leadId ? Store.addLeadLog(e2.leadId, { at: e2.at, type: e2.type, note: e2.note }) : null);
        if (!p) { rep.logSkipped++; return null; }
        return p.then(function (r) { if (r.ok) rep.logAdded++; else rep.logSkipped++; });
      });
    }).then(function () { return rep; });
  }
  function describeSummary(sm) {
    return [plural(sm.customers, "customer", "customers"), plural(sm.callLog, "call-log entry", "call-log entries"), plural(sm.rfqs, "RFQ", "RFQs"),
            plural(sm.visits, "visit or call", "visits and calls"), plural(sm.orders, "typed order", "typed orders"), plural(sm.leads, "lead", "leads")].join(", ") +
      (sm.targets ? ", targets" : "");
  }
  function restoreFile(file) {
    E.err.hidden = true;
    var rd = new FileReader();
    rd.onerror = function () { fail("The file could not be read."); };
    rd.onload = function () {
      var plan = planRestore(String(rd.result || ""));
      if (!plan.ok) { fail(plan.error); return; }
      var sm = plan.summary;
      var q = "Restore from " + file.name + "?\n\n" +
        "This backup" + (sm.exportedAt ? " was made on " + Ui.fmt.date(sm.exportedAt.slice(0, 10)) + " and" : "") + " has " + describeSummary(sm) + ".\n" +
        (sm.notes ? "It has note text. " : "It was made without note text, so call-log entries are not restored and notes already here are kept. ") +
        (sm.contactDetails ? "It has lead and RFQ contact details.\n\n" : "It has no lead or RFQ emails and phones; the ones already here are kept.\n\n") +
        "Restoring updates customers that differ, replaces RFQs, RFQ history, visits, typed orders, leads and targets with the ones in the file, and adds call-log entries that are missing. " +
        "Imported money, invoices and dispatch history are not changed.\n\nThis cannot be undone. Restore now?";
      if (!window.confirm(q)) { say("Restore cancelled. Nothing was changed."); return; }
      applyRestore(sm, plan.backup).then(function (rep) {
        App.flush();
        var bits = [];
        if (rep.updated) bits.push(plural(rep.updated, "customer updated", "customers updated"));
        if (rep.added) bits.push(plural(rep.added, "customer added", "customers added"));
        if (rep.logAdded) bits.push(plural(rep.logAdded, "call-log entry added", "call-log entries added"));
        bits = bits.concat(rep.sets);
        var problems = (rep.customerFail ? plural(rep.customerFail, "customer could not be restored", "customers could not be restored") + ". " : "") +
          (rep.logSkipped ? plural(rep.logSkipped, "call-log entry was skipped", "call-log entries were skipped") + ". " : "");
        say("Restored from " + file.name + ": " + (bits.length ? bits.join(", ") : "nothing needed to change") + ". " + problems.trim());
      }).catch(function (e) { fail("The restore stopped part-way: " + (e && e.message ? e.message : e) + ". Check the tabs, then try again."); });
    };
    rd.readAsText(file, "utf-8");
  }

  /* ---------- the data card ---------- */
  function datasets() {
    var M = mod("CrmMoney"), R = mod("CrmRevenue"), Sc = mod("CrmSchedule");
    var out = [];
    var all = Store.allLog();
    var custNotes = all.filter(function (e) { return e.customerId; }).length, leadTouches = all.filter(function (e) { return !e.customerId && e.leadId; }).length;
    var cs = Store.customers();
    out.push({ key: "customers", label: "Customers", text: plural(cs.length, "customer", "customers") + (cs.filter(function (c) { return c.added; }).length ? " (" + cs.filter(function (c) { return c.added; }).length + " added by you)" : "") });
    out.push({ key: "notes", label: "Notes and call log", text: plural(custNotes, "entry", "entries") + (leadTouches ? " + " + plural(leadTouches, "lead touch", "lead touches") : "") });
    var rfqs = Store.col("rfqs").all();
    out.push({ key: "rfqs", label: "RFQs", text: plural(rfqs.length, "RFQ", "RFQs") + (rfqs.length ? ", " + plural(rfqs.filter(function (r) { return r.lost; }).length, "lost", "lost") : "") });
    out.push({ key: "leads", label: "Leads", text: plural(Store.col("leads").all().length, "lead", "leads") });
    out.push({ key: "visits", label: "Visits and calls", text: plural(Store.col("visits").all().length, "visit or call", "visits and calls") });
    out.push({ key: "orders", label: "Typed orders", text: plural(Store.col("orders").all().length, "order", "orders") });

    var mm = M && safe(function () { return M.has(); }, false) ? safe(function () { return M.meta(); }, null) : null;
    var parts = [];
    if (mm && mm.aging) parts.push("AGING as of " + Ui.fmt.date(mm.aging.asOf) + " (" + plural(mm.aging.rowsKept || 0, "row", "rows") + ")");
    if (mm && mm.live) parts.push("LIVE_POSITION as of " + Ui.fmt.date(mm.live.asOf) + " (" + plural(mm.live.rowsKept || 0, "row", "rows") + ")");
    out.push({ key: "money", label: "Money files", text: parts.length ? parts.join("; ") : "None imported", clear: parts.length ? { id: "clearMoney", label: "Clear imported money data", ask: "Remove the imported money data (AGING and LIVE_POSITION amounts) from this browser? You can import the files again.", run: function () { return M.clear("all"); } } : null });

    var rv = R && safe(function () { return R.has(); }, false) ? safe(function () { return R.meta(); }, null) : null;
    var rdoc = rv ? Store.doc("revenue").get() : null;
    var nInv = rdoc && Array.isArray(rdoc.rows) ? rdoc.rows.length : 0;
    out.push({ key: "invoices", label: "Invoice file", text: rv ? plural(nInv, "invoice", "invoices") + ", data through " + (rv.lastDate ? Ui.fmt.date(rv.lastDate) : "an unknown date") : "None imported",
               clear: rv ? { id: "clearInvoices", label: "Clear invoice data", ask: "Remove the imported invoice data from this browser? Revenue numbers will go away until you import the file again.", run: function () { return R.clear(); } } : null });

    var dm = Store.doc("dispatch_meta").get();
    var nDisp = Store.col("dispatches").all().length;
    out.push({ key: "dispatch", label: "Dispatch history", text: dm || nDisp ? plural(dm && dm.rows ? dm.rows : nDisp, "slip", "slips") + ", data through " + (dm && dm.lastDate ? Ui.fmt.date(dm.lastDate) : "an unknown date") : "None imported",
               clear: dm || nDisp ? { id: "clearDispatch", label: "Clear dispatch history", ask: "Remove the imported dispatch history from this browser? You can import the file again.", run: function () { return Sc && Sc.clearDispatches ? Sc.clearDispatches() : Store.col("dispatches").replaceAll([]).then(function () { return Store.doc("dispatch_meta").clear(); }); } } : null });

    var st = Store.doc("lead_staging").get();
    var nStaged = st && Array.isArray(st.rows) ? st.rows.length : 0;
    if (nStaged) out.push({ key: "staged", label: "Staged lead rows", text: plural(nStaged, "row", "rows") + " waiting to be merged (they hold emails and phones)",
      clear: { id: "clearStaged", label: "Discard staged lead rows", ask: "Discard the staged lead rows that have not been merged yet?", run: function () { return Store.doc("lead_staging").clear(); } } });

    var tg = Store.doc("targets").get(), tparts = [];
    if (tg && tg.byFy && typeof tg.byFy === "object") Object.keys(tg.byFy).sort().forEach(function (fy) {
      var x = tg.byFy[fy] || {}, nc = Object.keys(x.customers || {}).length, ns = Object.keys(x.segments || {}).length;
      if (nc || ns) tparts.push("FY " + fy + ": " + plural(nc, "customer", "customers") + ", " + plural(ns, "segment", "segments"));
    });
    out.push({ key: "targets", label: "Targets", text: tparts.length ? tparts.join("; ") : "None set" });
    return out;
  }
  function renderData() {
    var list = datasets();
    Ui.clear(E.dataList);
    var clears = [];
    list.forEach(function (d) {
      E.dataList.appendChild(el("li", { dataset: { data: d.key } }, [el("span", { class: "ex-dl", text: d.label }), el("span", { class: "ex-dv", text: d.text })]));
      if (d.clear) clears.push(d.clear);
    });
    Ui.clear(E.clearRow);
    clears.forEach(function (c) {
      var b = el("button", { type: "button", class: "btn-sm ex-danger", id: c.id, text: c.label });
      b.addEventListener("click", function () {
        if (!window.confirm(c.ask)) { say("Nothing was removed."); return; }
        Promise.resolve(c.run()).then(function (r) {
          App.flush();
          if (r && r.ok === false) fail(r.error || "That could not be removed.");
          else { say(c.label + ": done."); E.dataHead.focus(); }
        });
      });
      E.clearRow.appendChild(b);
    });
    E.clearNote.hidden = clears.length === 0;
  }

  /* ---------- panel ---------- */
  function card(id, title, kids, cls) {
    return el("section", { class: "ex-card" + (cls ? " " + cls : ""), id: id, "aria-labelledby": id + "-h" }, [el("h2", { id: id + "-h", text: title })].concat(kids));
  }
  function btn(id, text, onclick, cls) {
    var b = el("button", { type: "button", class: "btn" + (cls ? " " + cls : ""), id: id, text: text });
    if (onclick) b.addEventListener("click", onclick);
    return b;
  }
  function check(id, label, hint) {
    var inp = el("input", { type: "checkbox", id: id });
    return { input: inp, row: el("label", { class: "ex-check ex-incl", for: id }, [inp, el("span", null, [el("b", { text: label }), el("small", { text: hint })])]) };
  }

  function mount(root) {
    loadScope();
    E.msg = el("p", { id: "exportMsg", class: "ex-msg", role: "status" });
    E.err = el("p", { id: "exportErr", class: "ex-err", role: "alert", hidden: true });

    var n = check("incNotes", "Include notes text (private)", "Call-log notes, RFQ and visit notes, lead context. Off by default.");
    var c = check("incContacts", "Include contact details (private)", "Lead emails and phones, RFQ contact references. Off by default.");
    var a = check("incAmounts", "Include amounts (private)", "Adds outstanding, overdue, aging and revenue columns to the customer file. Off by default.");
    E.incNotes = n.input; E.incContacts = c.input; E.incAmounts = a.input; E.amountsRow = a.row;
    var inclCard = card("exInclude", "What goes in the files", [
      el("p", { class: "ex-hint", text: "These boxes are never remembered. Every time you open this page they are off, so a file only has private details when you tick them." }),
      n.row, c.row, a.row
    ], "ex-wide");

    E.custSummary = el("p", { class: "ex-hint", id: "exCustSummary" });
    E.copyBox = el("textarea", { id: "copyBox", readonly: true, rows: "4", "aria-label": "Text to copy" });
    E.copyFallback = el("div", { id: "copyFallback", class: "ex-fallback", hidden: true }, [
      el("p", { text: "Your browser did not let this page use the clipboard. The text below is selected: press Ctrl+C (or long-press and choose Copy), then paste it into Google Sheets." }),
      E.copyBox
    ]);
    var custCard = card("exCustomers", "Customers", [
      scopeRadios("cust", "Customers to export"), E.custSummary,
      el("div", { class: "ex-actions" }, [
        btn("csvBtn", "Download CSV", downloadCustomerCsv, "primary"),
        btn("copyBtn", "Copy for Google Sheets", copyForSheets),
        btn("export", "Download customers.json", downloadCustomersJson)
      ]),
      E.copyFallback,
      el("p", { class: "ex-hint", text: "customers.json is the file the app loads from the website. It holds customer fields only: no notes, no amounts, no emails." })
    ]);

    var rfqCard = card("exRfqs", "RFQs", [
      scopeRadios("rfq", "RFQs to export"),
      el("div", { class: "ex-actions" }, [btn("rfqCsvBtn", "Download RFQs CSV", downloadRfqCsv)]),
      el("p", { class: "ex-private", text: "Contains quoted values (private)." })
    ]);
    var leadCard = card("exLeads", "Leads", [
      scopeRadios("lead", "Leads to export"),
      el("div", { class: "ex-actions" }, [btn("leadCsvBtn", "Download Leads CSV", downloadLeadCsv)]),
      el("p", { class: "ex-hint", text: "Email and phone columns are added only when \"Include contact details\" is ticked." })
    ]);
    var visitCard = card("exVisits", "Visits and calls", [
      el("div", { class: "ex-actions" }, [btn("visitCsvBtn", "Download visits CSV", downloadVisitCsv)]),
      el("p", { class: "ex-hint", text: "Every visit and call, oldest first." })
    ]);

    E.restoreFile = el("input", { type: "file", id: "restoreFile", class: "sr-only", tabindex: "-1", "aria-label": "Backup file", accept: ".json,application/json" });
    E.restoreFile.addEventListener("change", function () {
      var f = E.restoreFile.files && E.restoreFile.files[0];
      if (f) restoreFile(f);
      E.restoreFile.value = "";
    });
    var backupCard = card("exBackup", "Backup", [
      el("p", { class: "ex-private", text: "Private: never commit a backup. Its file name (varsha-crm-backup-<date>.json) is ignored by git." }),
      el("p", { class: "ex-hint", text: "Has customers, call log, RFQs and their history, visits, typed orders, leads and targets. RFQs carry quoted values and targets carry amounts. It never has money, invoices or dispatch history (import those again)." }),
      el("p", { class: "ex-hint", id: "exBackupHint", text: "Without the boxes above, note text and the emails and phones of leads and RFQs are not in the file. Tick both for a complete backup." }),
      el("div", { class: "ex-actions" }, [btn("backup", "Download backup", downloadBackup, "primary"), btn("restoreBtn", "Restore from backup", function () { E.restoreFile.click(); }), E.restoreFile]),
      el("p", { class: "ex-hint", text: "To move everything to another browser, download the backup here and restore it there. You are asked to confirm before anything changes." })
    ], "ex-wide");

    var reportCard = card("exReport", "Weekly sales review", [
      el("p", { class: "ex-hint", text: "One page for the week: follow-ups, visits, RFQs, money and leads. Opens in a window you can print." }),
      el("div", { class: "ex-actions" }, [btn("weeklyReportBtn2", "Weekly sales review", null)])
    ]);

    var autoBtn = el("button", { type: "button", class: "btn", id: "autoBtn", text: "Send to Google Sheet automatically", disabled: true });
    var autoCard = card("exAuto", "Send to Google Sheet automatically", [
      el("p", null, [el("span", { class: "ex-soon", text: "Coming next" })]),
      el("p", { class: "ex-hint", text: "A scheduled copy of your customer list into a separate Google Sheet, without anyone downloading a file. It comes with the shared database, and it will not touch the Collections Engine sheet. Until then, use Download CSV or Copy for Google Sheets." }),
      el("div", { class: "ex-actions" }, [autoBtn])
    ], "ex-soon-card");

    E.dataList = el("ul", { class: "ex-data", id: "dataList" });
    E.clearRow = el("div", { class: "ex-actions", id: "clearRow" });
    E.clearNote = el("p", { class: "ex-hint", id: "clearNote", text: "Clear removes only the imported file from this browser. It asks you to confirm first and does not change customers, notes or RFQs." });
    E.dataHead = null;
    var dataCard = card("dataCard", "Data in this browser", [
      el("p", { class: "ex-hint", text: "This is everything this browser holds. It is not shared with other browsers or devices." }),
      E.dataList, E.clearRow, E.clearNote
    ], "ex-wide");
    E.dataHead = dataCard.querySelector("h2");
    E.dataHead.tabIndex = -1;

    root.appendChild(el("div", { class: "ex-grid" }, [inclCard, custCard, rfqCard, leadCard, visitCard, backupCard, reportCard, autoCard, dataCard]));
    root.appendChild(E.msg);
    root.appendChild(E.err);
    ["cust", "rfq", "lead"].forEach(syncScope);
  }

  function render() {
    if (!E.msg) return;
    var C = mod("CrmCustomers"), R = mod("CrmRfq"), L = mod("CrmLeads");
    var all = Store.customers().length;
    var sh = C && typeof C.visible === "function" ? safe(function () { return C.visible().length; }, all) : null;
    var set = function (key, shownText, allText, shownN) {
      var o = E["scope_" + key];
      o.shown.label.hidden = shownN == null;
      o.shown.text.textContent = shownText;
      o.all.text.textContent = allText;
      if (shownN == null && scope[key] === "shown") { o.all.input.checked = true; } else syncScope(key);
    };
    set("cust", "Customers in the Customers tab now (" + sh + "), with current filters", "All customers (" + all + ")", sh);
    var nr = Store.col("rfqs").all().length, nl = Store.col("leads").all().length;
    var shr = R && typeof R.visible === "function" ? safe(function () { return R.visible().length; }, nr) : null;
    var shl = L && typeof L.visible === "function" ? safe(function () { return L.visible().length; }, nl) : null;
    set("rfq", "RFQs shown in the RFQs tab now (" + shr + ")", "All RFQs (" + nr + ")", shr);
    set("lead", "Leads shown in the Leads tab now (" + shl + ")", "All leads (" + nl + ")", shl);
    E.custSummary.textContent = C && typeof C.summary === "function" && scope.cust === "shown" ? safe(function () { return C.summary(); }, "") : "";
    E.custSummary.hidden = !E.custSummary.textContent;
    E.amountsRow.hidden = !hasAmountsData();
    if (E.amountsRow.hidden) E.incAmounts.checked = false;
    renderData();
  }

  App.registerPanel("export", { label: "Export", mount: mount, render: render, show: function () {} });
  window.CrmExport = pure;
})();
