/* RFQs tab (A4): 7-stage pipeline + a Lost marker, board and table views, RFQ dialog with stage history,
   released parts view, the generic RFQ CSV import and the Hub RFQ import with a review screen (design 5.4 and 12.3).
   Contract (design 4.5): window.CrmRfq = { STAGES, RELEASED, stats(today), openNew(customerId?, opts?), openEdit(id), visible(), summary() }.
   Pure functions (stats, filters, Hub classification) are in the first half and also module.exports for Node unit tests.
   Text is always set with textContent (Ui.el); no HTML strings. */
(function () {
  "use strict";

  var inBrowser = typeof window !== "undefined" && typeof document !== "undefined";
  var S = inBrowser ? window.Store : require("./store.js");
  var Csv = inBrowser ? window.CrmCsv : require("./csv.js");

  var STAGES = ["Received", "Quoted", "Negotiated", "Finalised", "PO", "Sample", "PPAP"];
  var RELEASED = ["Finalised", "PO", "Sample", "PPAP"];
  var FLAGS = ["quoteOverdue", "quoteToday", "actionOverdue", "stuck", "openQuoted", "won", "quotedEver"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var STAGE_ALIASES = { "po received": "PO", "purchase order": "PO", "po recd": "PO", "finalized": "Finalised", "finalised": "Finalised", "sampling": "Sample" };
  var INTERNAL_DEFAULT = ["varsha", "kctr", "prima ft", "scm maxility", "tng korea"];

  function str(v) { return v == null ? "" : String(v).trim(); }
  function cap(s, n) { s = str(s); return s.length > n ? s.slice(0, n) : s; }
  function days(n) { return n + (n === 1 ? " day" : " days"); }
  function stageIdx(s) { return STAGES.indexOf(s); }
  function shortDate(iso, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    var y = today ? today.slice(0, 4) : "";
    return (+m[3]) + " " + MON[+m[2] - 1] + (y && m[1] !== y ? " " + m[1] : "");
  }
  function normStage(s) {
    var t = str(s).toLowerCase().replace(/\s+/g, " ");
    if (!t) return "";
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].toLowerCase() === t) return STAGES[i];
    return STAGE_ALIASES[t] || null;
  }

  /* ---------- labels ---------- */
  function labelOf(r, byId) {
    if (r.customer_id && byId && byId[r.customer_id]) return byId[r.customer_id].name;
    return r.customer_name || "";
  }
  function indexById(list) { var m = {}; (list || []).forEach(function (c) { m[c.id] = c; }); return m; }
  function histByRfq(history) {
    var m = {};
    (history || []).forEach(function (h) { (m[h.rfq_id] = m[h.rfq_id] || []).push(h); });
    return m;
  }
  function reachedIdx(r, hist) {
    var m = stageIdx(r.stage);
    (hist || []).forEach(function (h) { var i = stageIdx(h.to); if (i > m) m = i; });
    return m;
  }

  /* ---------- status words (design 2.5): red or orange, always with text ---------- */
  function statusWords(r, today) {
    var out = [];
    if (r.lost) return out;
    if (r.stage === "Received" && r.quote_due) {
      var q = S.daysBetween(r.quote_due, today);
      if (q > 0) out.push({ kind: "risk", text: "Quote overdue by " + days(q), key: "quote" });
      else if (q === 0) out.push({ kind: "warn", text: "Quote due today", key: "quote" });
      else out.push({ kind: "muted", text: "Quote due " + shortDate(r.quote_due, today), key: "quote" });
    }
    if (r.next_action && r.stage !== "PPAP") {
      var a = S.daysBetween(r.next_action, today);
      if (a > 0) out.push({ kind: "risk", text: "Action overdue by " + days(a), key: "action" });
      else if (a === 0) out.push({ kind: "warn", text: "Action due today", key: "action" });
    }
    return out;
  }

  /* ---------- flags and filters ---------- */
  function matchesFlag(r, flag, today, reach, stuckStage) {
    if (flag === "quotedEver") return reach >= 1;
    if (r.lost) return false;
    var i = stageIdx(r.stage);
    switch (flag) {
      case "quoteOverdue": return r.stage === "Received" && !!r.quote_due && r.quote_due < today;
      case "quoteToday": return r.stage === "Received" && r.quote_due === today;
      case "actionOverdue": return r.stage !== "PPAP" && !!r.next_action && r.next_action < today;
      case "stuck":
        if (r.stage === "PPAP" || !r.stage_at || S.daysBetween(r.stage_at, today) <= 30) return false;
        return !stuckStage || r.stage === stuckStage;
      case "openQuoted": return i >= 1 && i <= 3;
      case "won": return i >= 4;
    }
    return true;
  }

  function cmpVal(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function sortRfqs(list, sort, dir, byId) {
    var d = dir === 1 ? 1 : dir === -1 ? -1 : (sort === "received" || !sort ? -1 : 1);
    function key(r) {
      switch (sort) {
        case "quoteDue": return r.quote_due || "";
        case "value": return r.quoted_value == null ? "" : r.quoted_value;
        case "next": return r.next_action || "";
        case "rfq": return str(r.rfq_no).toLowerCase();
        case "customer": return labelOf(r, byId).toLowerCase();
        default: return r.received || "";
      }
    }
    return list.slice().sort(function (a, b) {
      var ka = key(a), kb = key(b), ea = ka === "", eb = kb === "";
      if (ea !== eb) return ea ? 1 : -1;                       // blanks last, whichever direction
      var r = ea ? 0 : cmpVal(ka, kb) * d;
      return r || cmpVal(b.received || "", a.received || "") || cmpVal(str(a.rfq_no), str(b.rfq_no));
    });
  }

  /* f: { stage, flag, stuckStage, customerId, waiting, q, showLost, sort, dir } */
  function filterRfqs(rfqs, history, customers, f, today) {
    f = f || {};
    var byId = indexById(customers), hist = histByRfq(history), q = str(f.q).toLowerCase();
    var out = (rfqs || []).filter(function (r) {
      if (r.lost && !f.showLost && f.flag !== "quotedEver") return false;
      if (f.stage === "released") { if (RELEASED.indexOf(r.stage) === -1) return false; }
      else if (f.stage && r.stage !== f.stage) return false;
      if (f.customerId && r.customer_id !== f.customerId) return false;
      if (f.waiting && r.waiting_on !== f.waiting) return false;
      if (f.flag && !matchesFlag(r, f.flag, today, f.flag === "quotedEver" ? reachedIdx(r, hist[r.id]) : 0, f.stuckStage)) return false;
      if (q) {
        var hay = [r.rfq_no, r.part_name, r.part_no, labelOf(r, byId)].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    return sortRfqs(out, f.sort || "next", f.dir === 1 || f.dir === -1 ? f.dir : (f.sort === "received" ? -1 : 1), byId);
  }

  /* ---------- stats() contract for the Dashboard (design 4.5) ---------- */
  function rfqStats(rfqs, history, customers, today) {
    rfqs = rfqs || []; today = today || S.todayISO();
    var byId = indexById(customers), hist = histByRfq(history);
    var out = {
      total: rfqs.length, open: 0, lost: 0, byStage: {}, valueQuoted: 0, valueWon: 0,
      quoteOverdue: 0, quoteDueToday: 0, actionOverdue: 0,
      released: { total: 0, byStage: {}, list: [] },
      hints: { quotedToPoPct: null, avgDaysToQuote: null, stuck: [] }
    };
    STAGES.forEach(function (s) { out.byStage[s] = 0; });
    RELEASED.forEach(function (s) { out.released.byStage[s] = 0; });
    var stuck = {}, quotedEver = 0, poEver = 0, toQuote = [];
    rfqs.forEach(function (r) {
      var h = hist[r.id] || [], reach = reachedIdx(r, h);
      if (reach >= 1) { quotedEver++; if (reach >= 4) poEver++; }
      var firstQ = null;
      h.forEach(function (x) { if (x.to === "Quoted" && x.from && (!firstQ || x.at < firstQ)) firstQ = x.at; });
      if (firstQ && r.received) { var d = S.daysBetween(r.received, firstQ); if (d >= 0) toQuote.push(d); }
      if (r.lost) { out.lost++; return; }
      out.open++;
      if (out.byStage.hasOwnProperty(r.stage)) out.byStage[r.stage]++;
      var i = stageIdx(r.stage), v = Number(r.quoted_value) || 0;
      if (i >= 1 && i <= 3) out.valueQuoted += v;
      if (i >= 4) out.valueWon += v;
      if (matchesFlag(r, "quoteOverdue", today, 0)) out.quoteOverdue++;
      if (matchesFlag(r, "quoteToday", today, 0)) out.quoteDueToday++;
      if (matchesFlag(r, "actionOverdue", today, 0)) out.actionOverdue++;
      if (matchesFlag(r, "stuck", today, 0)) stuck[r.stage] = (stuck[r.stage] || 0) + 1;
      if (RELEASED.indexOf(r.stage) !== -1) {
        out.released.total++; out.released.byStage[r.stage]++;
        out.released.list.push({ id: r.id, rfqNo: r.rfq_no || "", part: r.part_name || r.part_no || "", customerName: labelOf(r, byId), stage: r.stage });
      }
    });
    if (quotedEver) out.hints.quotedToPoPct = Math.round(poEver * 100 / quotedEver);
    if (toQuote.length) out.hints.avgDaysToQuote = Math.round(toQuote.reduce(function (a, b) { return a + b; }, 0) / toQuote.length);
    STAGES.forEach(function (s) { if (stuck[s]) out.hints.stuck.push({ stage: s, n: stuck[s] }); });
    return out;
  }

  /* ---------- RFQ form validation (design 5.4); pure so it can be unit tested ---------- */
  /* vals: strings from the dialog. ctx: { today, rows, editing (row|null), opts ({leadId, customerName}|null) } */
  function validateRfq(vals, ctx) {
    var today = ctx.today, ed = ctx.editing || null, opts = ctx.opts || {}, out = {};
    var cn = str(vals.customer);
    if (cn) {
      var m = S.matchCustomer(cn);
      if (m) { out.customer_id = m; out.customer_name = cn; out.lead_id = ""; }
      else if (ed && !ed.customer_id && cn === str(ed.customer_name)) { out.customer_id = null; out.customer_name = cn; out.lead_id = ed.lead_id || ""; }
      else if (opts.leadId && cn === str(opts.customerName)) { out.customer_id = null; out.customer_name = cn; out.lead_id = opts.leadId; }
      else return { error: "Pick a customer from the list, or add the customer first.", field: "customer" };
    } else if (ed && !ed.customer_id && !str(ed.customer_name) && !ed.lead_id) {
      out.customer_id = null; out.customer_name = ""; out.lead_id = "";
    } else return { error: "Pick a customer from the list, or add the customer first.", field: "customer" };

    out.rfq_no = cap(vals.rfq_no, 40);
    out.part_name = cap(vals.part_name, 120);
    out.part_no = cap(vals.part_no, 60);
    if (!out.rfq_no && !out.part_name) return { error: "Enter the RFQ number or the part name.", field: "rfq_no" };
    if (out.rfq_no) {
      var key = out.rfq_no.toLowerCase();
      var dup = (ctx.rows || []).some(function (r) { return (!ed || r.id !== ed.id) && str(r.rfq_no).toLowerCase() === key; });
      if (dup) return { error: "RFQ " + out.rfq_no + " already exists.", field: "rfq_no" };
    }
    var q = Csv.parseInt(vals.qty);
    if (!q.ok) return { error: "Quantity must be a whole number.", field: "qty" };
    out.qty = q.value;
    var recv = str(vals.received) || today;
    if (!Csv.parseDate(recv).ok || !/^\d{4}-\d{2}-\d{2}$/.test(recv) || Csv.parseDate(recv).value !== recv) return { error: "Received date is not a valid date.", field: "received" };
    if (recv > today) return { error: "Received date can't be in the future.", field: "received" };
    out.received = recv;
    var dates = [["quote_due", "Quote due"], ["next_action", "Next action"]];
    for (var i = 0; i < dates.length; i++) {
      var raw = str(vals[dates[i][0]]);
      if (raw && (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Csv.parseDate(raw).value !== raw)) return { error: dates[i][1] + " date is not a valid date.", field: dates[i][0] };
      out[dates[i][0]] = raw;
    }
    var amt = Csv.parseAmount(vals.quoted_value);
    if (!amt.ok || (amt.value != null && amt.value < 0)) return { error: "Quoted value is not a number.", field: "quoted_value" };
    out.quoted_value = amt.value;
    var st = normStage(vals.stage);
    if (st === null || (st === "" && vals.stage)) return { error: "Pick a stage from the list.", field: "stage" };
    out.stage = st || (ed ? ed.stage : "Received");
    var notes = str(vals.notes);
    if (notes.length > 1000) return { error: "Notes can have 1000 characters at most.", field: "notes" };
    out.notes = notes;
    return { fields: out };
  }

  /* ========================================================================================================
     Hub import: classification, stage rules, field mapping, duplicates (design 12.3). Pure functions.
     ======================================================================================================== */
  var HUB_RFQ_RE = /\brfq\b|enquir|inquir|quot(e|ation)|drawing|feasibilit|sample|ppap|\bpo\b|purchase order|costing|price|negotiat|develop|new part|offer (sent|submitted|uploaded|review)|final offer/;
  var HUB_OTHER_RE = /invoice|payment|debit|credit note|tooling (invoice|payment)|gst|statutory|audit|salary|visa|minutes|governance|jv\b/;
  var STAGE_RULES = [
    ["PPAP", /ppap|psw/],
    ["Sample", /sample|trial|first article|\bfai\b/],
    ["PO", /\bpo\b|purchase order|order (received|placed)|\bloi\b/],
    ["Finalised", /finali[sz]|price (agreed|approved)|approved|accepted|nominat/],
    ["Negotiated", /negotiat|counter.?offer|revised (quote|price)|re-?quote|price discussion/],
    ["Quoted", /quoted|quotation (sent|submitted|shared)|offer (sent|submitted)|awaiting (po|feedback|approval)/],
    ["Received", /new rfq|rfq received|enquir|inquir|drawing received|feasibilit/]
  ];
  var LOST_RE = /\blost\b|regret|declined|not (interested|feasible)|dropped/;
  /* "awaiting a PO" means a quote is out, not that a PO has arrived */
  var WAITING_PO_RE = /(awaiting|awaits?|pending|waiting for|expecting|chasing|chase)( for)?( the| a| their)? (po|purchase order)\b/g;

  function deriveStage(text) {
    var t = String(text || "").toLowerCase(), noWait = t.replace(WAITING_PO_RE, " ");
    for (var i = 0; i < STAGE_RULES.length; i++) {
      var src = STAGE_RULES[i][0] === "PO" ? noWait : t;
      if (STAGE_RULES[i][1].test(src)) return { stage: STAGE_RULES[i][0], source: "rule" };
    }
    return { stage: "Received", source: "guess" };
  }
  function deriveLost(text) {
    var m = LOST_RE.exec(String(text || "").toLowerCase());
    return m ? { lost: true, reason: m[0] } : { lost: false, reason: "" };
  }
  function derivePriority(col, text) {
    var c = str(col).toLowerCase();
    if (c) {
      if (/high|urgent|critical/.test(c)) return "High";
      if (/med/.test(c)) return "Medium";
      if (/low/.test(c)) return "Low";
    }
    return /high.?priority|urgent/.test(String(text || "").toLowerCase()) ? "High" : "";
  }
  var EMAIL_RE = /[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/gi;
  var PHONE_RE = /\+\d[\d\s-]{8,}\d|\b\d{5}[\s-]?\d{5}\b|\b\d{10}\b/g;
  /* Emails and phone numbers are private: they leave the text and go to contact_ref (localStorage only). */
  function redact(text) {
    var found = [], t = String(text == null ? "" : text);
    t = t.replace(EMAIL_RE, function (m) { found.push(m.replace(/[.,;]+$/, "")); return "(email kept private)"; });
    t = t.replace(PHONE_RE, function (m) { found.push(m.trim()); return "(phone kept private)"; });
    return { text: t, found: found };
  }

  function isInternalText(text, ctx) {
    var t = String(text || "").toLowerCase();
    if (ctx && typeof ctx.isInternal === "function") return !!ctx.isInternal(text);
    return INTERNAL_DEFAULT.some(function (p) { return t.indexOf(p) !== -1; });
  }
  function coreKey(name) {
    var k = S.nameKey(name), prev, re = /(pvtltd|privateltd|ltd|limited|inc|llc|llp|gmbh|coltd|co|corp|india)$/;
    do { prev = k; k = k.replace(re, ""); } while (k !== prev && k);
    return k;
  }
  /* The longest customer or lead name found inside the subject. */
  function guessCustomer(subject, customers, leads) {
    var sk = S.nameKey(subject), best = null;
    function tryOne(type, id, name) {
      var core = coreKey(name);
      if (core.length >= 5 && sk.indexOf(core) !== -1 && (!best || core.length > best.len)) best = { type: type, id: id, name: name, len: core.length };
    }
    (customers || []).forEach(function (c) { tryOne("customer", c.id, c.name); });
    (leads || []).forEach(function (l) { if (l.company) tryOne("lead", l.id, l.company); });
    return best;
  }

  function lenientDate(s) {
    var v = Csv.parseDate(s);
    return v.ok ? { value: v.value || "", bad: false } : { value: "", bad: true };
  }
  function cutText(s, n) {
    s = str(s);
    return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+$/, "") + "…";
  }

  /* Field keys used by the two Hub specs (see HUB_*_FIELDS below). */
  function hubFields(sheet, r) {
    if (sheet === "hub_awaiting") {
      return { id: str(r.tracking_id), category: str(r.category), counterparty: str(r.account), subject: str(r.deliverable), action: "",
               status: str(r.status), received: r.outreach, due: "", lastTouch: r.last_follow, count: r.follow_count, contact: str(r.contact), delegated: "", priorityCol: "" };
    }
    return { id: str(r.item_id), category: str(r.category), counterparty: str(r.counterparty), subject: str(r.subject), action: str(r.action),
             status: str(r.status), received: r.date_received, due: r.due, lastTouch: "", count: "", contact: "", delegated: str(r.delegated), priorityCol: r.priority };
  }

  /* ctx: { today, isInternal(text), matchCustomer(name), matchLead(name), customers: [{id,name,relatedParty}], leads: [{id,company}], canCreateLead } */
  function buildHubItem(sheet, row, ctx) {
    var f = hubFields(sheet, row), today = ctx.today || S.todayISO();
    var text = [f.category, f.subject, f.action, f.status].join(" ").toLowerCase();
    var st = deriveStage(text), lost = deriveLost(text);
    var dRecv = lenientDate(f.received), dDue = lenientDate(f.due), dTouch = lenientDate(f.lastTouch);
    var badDates = [];
    if (dRecv.bad) badDates.push(f.received); if (dDue.bad) badDates.push(f.due); if (dTouch.bad) badDates.push(f.lastTouch);
    var cnt = str(f.count), count = /^\d+$/.test(cnt) ? Number(cnt) : null;

    // counterparty -> customer, lead, or guessed from the subject
    var customerId = null, leadId = null, guessed = false, matchedRelated = false, customerName = f.counterparty;
    if (f.counterparty) {
      var m = ctx.matchCustomer ? ctx.matchCustomer(f.counterparty) : null;
      if (m) customerId = m;
      else if (m !== "" && ctx.matchLead) leadId = ctx.matchLead(f.counterparty) || null;
    } else {
      var g = guessCustomer(f.subject, ctx.customers, ctx.leads);
      if (g) { guessed = true; customerName = g.name; if (g.type === "customer") customerId = g.id; else leadId = g.id; }
    }
    if (customerId) (ctx.customers || []).forEach(function (c) { if (c.id === customerId && c.relatedParty) matchedRelated = true; });

    // kind
    var who = f.counterparty || f.subject, kind, why;
    if (matchedRelated || isInternalText(who, ctx)) { kind = "internal"; why = "internal / related entity"; }
    else if (/\brfq\b/.test(text)) { kind = "rfq"; why = "mentions RFQ"; }
    else if (HUB_OTHER_RE.test(text)) { kind = "other"; why = "not an RFQ"; }
    else if (HUB_RFQ_RE.test(text)) { kind = "rfq"; why = "RFQ words"; }
    else { kind = "other"; why = "no RFQ words"; }

    // fields
    var partFull = f.subject, partName = cutText(partFull, 120), truncated = partName !== partFull;
    var notesParts = [];
    if (sheet === "hub_awaiting") {
      if (f.status) notesParts.push("Status: " + f.status);
      if (f.category && f.category !== f.status) notesParts.push("Category: " + f.category);
      if (truncated) notesParts.push("Expected: " + partFull);
    } else {
      if (f.action) notesParts.push(f.action);
      if (f.delegated) notesParts.push("Delegated to: " + f.delegated);
      if (f.status) notesParts.push("Status: " + f.status);
      if (f.category && f.category !== f.status) notesParts.push("Category: " + f.category);
      if (truncated) notesParts.push("Subject: " + partFull);
    }
    var red = redact(notesParts.join(" · "));
    var contacts = [];
    if (f.contact) contacts.push(f.contact);
    red.found.forEach(function (x) { if (contacts.indexOf(x) === -1) contacts.push(x); });
    var recv = dRecv.value || today;
    var noteText = redact(f.subject + (f.action ? " — " + f.action : "")).text;
    var choice = customerId ? "c:" + customerId : leadId ? "l:" + leadId : (f.counterparty && ctx.canCreateLead ? "new" : "text");
    return {
      sheet: sheet, id: f.id, kind: kind, kindWhy: why, include: kind === "rfq",
      counterparty: f.counterparty, customerName: customerName, customerId: customerId, leadId: leadId, customerGuessed: guessed, choice: choice,
      partName: partName, partFull: partFull, received: recv > today ? today : recv, due: dDue.value, lastTouch: dTouch.value, followupCount: count,
      contactRef: cap(contacts.join(" · "), 200), priority: derivePriority(f.priorityCol, text), waitingOn: sheet === "hub_awaiting" ? "customer" : "us",
      delegatedTo: f.delegated, notes: cap(red.text, 1000), noteText: cap(noteText, 480),
      stage: st.stage, stageSource: st.source, lost: lost.lost, lostReason: lost.reason, badDates: badDates, row: row.row || 0
    };
  }

  function fallbackKey(counterparty, received, part) { return "fb:" + S.nameKey(counterparty) + "|" + (received || "") + "|" + S.nameKey(part); }
  function itemKey(it) { return it.id ? "id:" + it.sheet + ":" + it.id.toLowerCase() : fallbackKey(it.counterparty, it.received, it.partName); }
  function rowKey(r) {
    var sr = r.source_ref;
    if (!sr || !sr.sheet) return "";
    return sr.id ? "id:" + sr.sheet + ":" + String(sr.id).toLowerCase() : fallbackKey(r.customer_name, r.received, r.part_name);
  }
  function eq(a, b) { return (a == null ? "" : a) === (b == null ? "" : b); }
  function effectiveDue(it, stage) { return stage === "Received" ? it.due : ""; }

  /* What a re-import would change on an existing row. It never touches a user-set stage, the customer, or a user-set lost flag. */
  function updatePlan(ex, it) {
    var p = {}, plan = { patch: p, advance: false, newLost: false };
    function set(k, v) { if (!eq(ex[k], v)) p[k] = v; }
    set("part_name", it.partName); set("notes", it.notes); set("received", it.received); set("next_action", it.due);
    set("last_touch", it.lastTouch); set("followup_count", it.followupCount); set("contact_ref", it.contactRef);
    if (it.priority) set("priority", it.priority);
    var userSet = ex.stage_source === "user";
    var stageAfter = ex.stage;
    if (!userSet && !ex.lost && it.stageSource === "rule" && stageIdx(it.stage) > stageIdx(ex.stage)) { plan.advance = true; stageAfter = it.stage; }
    if (stageAfter === "Received") set("quote_due", it.due);
    if (plan.advance) { p.stage = it.stage; p.stage_at = it.lastTouch || it.received; p.stage_source = "rule"; }
    if (!userSet && !ex.lost && it.lost) { plan.newLost = true; p.lost = true; p.lost_reason = it.lostReason; }
    plan.changed = Object.keys(p).length > 0;
    return plan;
  }

  /* Marks each item new / update / unchanged against the existing RFQs. Items repeated inside the file are flagged. */
  function planImport(items, existing) {
    var map = {}, seen = {};
    (existing || []).forEach(function (r) { var k = rowKey(r); if (k && !map[k]) map[k] = r; });
    var counts = { "new": 0, update: 0, unchanged: 0 };
    items.forEach(function (it) {
      var k = itemKey(it);
      it.dupInFile = !!seen[k];
      seen[k] = true;
      var ex = map[k];
      if (ex) {
        it.existingId = ex.id; it.plan = updatePlan(ex, it);
        it.status = it.plan.changed ? "update" : "unchanged";
      } else { it.existingId = ""; it.plan = null; it.status = "new"; }
      if (it.dupInFile) it.include = false;
    });
    items.forEach(function (it) { if (it.kind === "rfq" && it.include) counts[it.status]++; });
    return counts;
  }

  /* A new RFQ row from a reviewed Hub item. */
  function rowFromItem(it, today, id) {
    var stageAt = it.stage === "Received" ? it.received : (it.lastTouch || it.received);
    if (stageAt > today) stageAt = today;
    return {
      id: id, customer_id: it.customerId || null, customer_name: it.customerName || it.counterparty || "",
      rfq_no: it.id, part_name: it.partName, part_no: "", qty: null, received: it.received, quote_due: effectiveDue(it, it.stage),
      quoted_value: null, stage: it.stage, stage_at: stageAt, next_action: it.due, notes: it.notes, lost: !!it.lost, lost_reason: it.lost ? it.lostReason : "",
      source_ref: { sheet: it.sheet, id: it.id }, priority: it.priority, waiting_on: it.waitingOn, contact_ref: it.contactRef,
      followup_count: it.followupCount, last_touch: it.lastTouch, delegated_to: it.delegatedTo,
      stage_source: it.stageSource, customer_guessed: !!it.customerGuessed && !!it.customerId, lead_id: it.leadId || ""
    };
  }

  /* ---------- import specs (headers are the exact Hub headers; synonyms for the generic RFQ list are placeholders, decision D5) ---------- */
  var t = function (key, label, req, syn) { return { key: key, label: label, required: !!req, synonyms: syn || [], type: "text" }; };
  var HUB_ACTION_FIELDS = [
    t("item_id", "Item ID", true), t("priority", "Priority"), t("category", "Category", true), t("subject", "Subject / Matter", true),
    t("counterparty", "Counterparty / Organization", true), t("delegated", "Delegated To"), t("action", "Action Required", true),
    t("date_received", "Date Received", true), t("due", "Target Due Date"), t("status", "Status", true)
  ];
  var HUB_AWAITING_FIELDS = [
    t("tracking_id", "Tracking ID", true), t("category", "Category", true), t("account", "Account / Counterparty", true),
    t("contact", "Contact Email / Reference"), t("outreach", "Outreach Date", true), t("last_follow", "Last Follow-up Date"),
    t("follow_count", "Follow-up Count"), t("deliverable", "Expected Deliverable", true), t("status", "Status", true)
  ];
  var RFQ_FIELDS = [
    t("customer", "Customer", true, ["Customer Name", "Party"]),
    t("rfq_no", "RFQ No", false, ["RFQ Number", "RFQ #", "Enquiry No"]),
    t("part_name", "Part Name", false, ["Part", "Description"]),
    t("part_no", "Part No", false, ["Part Number", "Drawing No"]),
    { key: "qty", label: "Qty", required: false, synonyms: ["Quantity", "Annual Qty"], type: "int" },
    { key: "received", label: "Date Received", required: false, synonyms: ["RFQ Date", "Received"], type: "date" },
    { key: "quote_due", label: "Quote Due", required: false, synonyms: ["Due Date", "Quote Due Date"], type: "date" },
    { key: "quoted_value", label: "Quoted Value", required: false, synonyms: ["Quote Value", "Value"], type: "amount" },
    t("stage", "Stage", false, ["Status"]),
    { key: "next_action", label: "Next Action Date", required: false, synonyms: ["Next Action"], type: "date" },
    t("notes", "Notes", false, ["Remarks"])
  ];
  function rfqSkip(cells, map) {
    var v = function (k) { return map[k] == null || cells[map[k]] == null ? "" : String(cells[map[k]]).trim(); };
    if (!v("customer")) return "blank customer";
    if (!v("rfq_no") && !v("part_name")) return "no RFQ number or part name";
    return null;
  }
  function hubWarnings(rows) {
    var out = [];
    rows.forEach(function (it) {
      ["date_received", "due", "outreach", "last_follow"].forEach(function (k) {
        var raw = str(it[k]);
        if (raw && !Csv.parseDate(raw).ok && out.length < 5) out.push('Row ' + it.row + ': "' + raw + '" is not a date. It will be left blank.');
      });
    });
    return out;
  }
  var SPECS = {
    rfqs: { key: "rfqs", label: "RFQ list (CSV)", fields: RFQ_FIELDS, skipRow: rfqSkip },
    hub_action: { key: "hub_action", label: "Action Pending (Internal)", fields: HUB_ACTION_FIELDS, warnings: hubWarnings },
    hub_awaiting: { key: "hub_awaiting", label: "Awaiting Customer Response", fields: HUB_AWAITING_FIELDS, warnings: hubWarnings }
  };

  var pure = {
    STAGES: STAGES, RELEASED: RELEASED, FLAGS: FLAGS, normStage: normStage, statusWords: statusWords, matchesFlag: matchesFlag,
    filterRfqs: filterRfqs, sortRfqs: sortRfqs, rfqStats: rfqStats, validateRfq: validateRfq, reachedIdx: reachedIdx,
    deriveStage: deriveStage, deriveLost: deriveLost, derivePriority: derivePriority, redact: redact, guessCustomer: guessCustomer,
    buildHubItem: buildHubItem, planImport: planImport, updatePlan: updatePlan, rowFromItem: rowFromItem, itemKey: itemKey, rowKey: rowKey,
    SPECS: SPECS, shortDate: shortDate
  };
  if (typeof module !== "undefined" && module.exports) module.exports = pure;
  if (!inBrowser) return;

  /* ========================================================================================================
     Browser part
     ======================================================================================================== */
  var el = Ui.el;
  var $ = function (id) { return document.getElementById(id); };
  var rfqCol = S.col("rfqs"), histCol = S.col("rfq_history");
  var VIEWS = ["board", "table"];
  var SORTS = ["received", "quoteDue", "value", "next", "rfq", "customer"];
  var state = { view: "board", stage: "", flag: "", stuckStage: "", customerId: "", waiting: "", q: "", showLost: false, sort: "received", dir: -1, closed: [] };
  var root = null, lastList = [];
  var dlg = null, F = {}, editing = null, newOpts = null, histNote = null;
  var narrow = function () { return window.matchMedia && window.matchMedia("(max-width: 860px)").matches; };

  function loadState() {
    var v = App.view("rfqs");
    if (VIEWS.indexOf(v.view) !== -1) state.view = v.view;
    if (v.stage === "released" || STAGES.indexOf(v.stage) !== -1) state.stage = v.stage;
    if (FLAGS.indexOf(v.flag) !== -1) state.flag = v.flag;
    if (typeof v.stuckStage === "string" && STAGES.indexOf(v.stuckStage) !== -1) state.stuckStage = v.stuckStage;
    if (typeof v.customerId === "string") state.customerId = v.customerId;
    if (v.waiting === "us" || v.waiting === "customer") state.waiting = v.waiting;
    if (typeof v.q === "string") state.q = v.q;
    state.showLost = v.showLost === true;
    if (SORTS.indexOf(v.sort) !== -1) state.sort = v.sort;
    if (v.dir === 1 || v.dir === -1) state.dir = v.dir;
    if (Array.isArray(v.closed)) state.closed = v.closed.filter(function (s) { return STAGES.indexOf(s) !== -1; });
  }
  function saveState() { App.setView("rfqs", state); }
  /* show(filter) REPLACES the filters; the board/table choice and the sort are kept unless given. */
  function applyFilter(f) {
    f = f || {};
    if (VIEWS.indexOf(f.view) !== -1) state.view = f.view;
    state.stage = f.stage === "released" || STAGES.indexOf(f.stage) !== -1 ? f.stage : "";
    state.flag = FLAGS.indexOf(f.flag) !== -1 ? f.flag : "";
    state.stuckStage = state.flag === "stuck" && STAGES.indexOf(f.stuckStage) !== -1 ? f.stuckStage : "";
    state.customerId = typeof f.customerId === "string" ? f.customerId : "";
    state.waiting = f.waiting === "us" || f.waiting === "customer" ? f.waiting : "";
    state.q = typeof f.q === "string" ? f.q : "";
    state.showLost = f.showLost === true;
    if (SORTS.indexOf(f.sort) !== -1) { state.sort = f.sort; state.dir = f.sort === "received" ? -1 : 1; }
  }

  function custIndex() { return indexById(S.customers()); }
  function customerLine(r, byId) {
    var span = el("span", { class: "rc-cust" });
    if (r.customer_id && byId[r.customer_id]) span.textContent = byId[r.customer_id].name;
    else if (r.lead_id) { span.textContent = "Lead: " + (r.customer_name || "unnamed"); span.classList.add("lead"); }
    else if (r.customer_name) { span.textContent = r.customer_name; span.classList.add("guess"); span.title = "Not in the customer list"; span.appendChild(el("span", { class: "nic", text: " (not in CRM)" })); }
    else { span.textContent = "No customer"; span.classList.add("guess"); }
    return span;
  }
  function rfqLabel(r) { return r.rfq_no || r.part_name || "RFQ"; }
  function badges(r) {
    var out = [];
    if (r.stage_source === "guess") out.push(el("span", { class: "badge guess", text: "stage guessed", title: "No stage words were found; Received is a guess. Move the card to confirm." }));
    if (r.customer_guessed) out.push(el("span", { class: "badge guess", text: "customer guessed" }));
    if (r.priority === "High") out.push(el("span", { class: "badge prio", text: "High priority" }));
    if (r.waiting_on === "us") out.push(el("span", { class: "badge", text: "Waiting on us" }));
    if (r.waiting_on === "customer") out.push(el("span", { class: "badge", text: "Waiting on customer" }));
    if (r.lead_id && !r.customer_id) out.push(el("span", { class: "badge", text: "Lead" }));
    return out;
  }
  function wordsEls(r, today) {
    return statusWords(r, today).map(function (w) { return el("span", { class: "rc-flag " + w.kind, text: w.text }); });
  }

  /* ---------- stage moves (each one is logged with today's IST date) ---------- */
  function moveTo(r, to, note) {
    if (r.lost || to === r.stage || STAGES.indexOf(to) === -1) return Promise.resolve({ ok: true });
    var today = S.todayISO(), from = r.stage;        // r is the live row: read the old stage before patching
    var p2 = histCol.insert({ rfq_id: r.id, from: from, to: to, at: today, note: cap(note, 200) });
    var p1 = rfqCol.patch(r.id, { stage: to, stage_at: today, stage_source: "user" });
    return Promise.all([p1, p2]);
  }
  function focusCard(id, prefer) {
    var c = root && root.querySelector('[data-id="' + CSS.escape(id) + '"]');
    if (!c) return;
    var b = (prefer && c.querySelector("." + prefer + ":not([disabled])")) || c.querySelector(".next:not([disabled])") || c.querySelector(".prev:not([disabled])") || c.querySelector(".edit");
    if (b) b.focus();
  }
  function stepCard(r, dir) {
    var to = STAGES[stageIdx(r.stage) + dir];
    if (!to) return;
    var name = rfqLabel(r);
    state.closed = state.closed.filter(function (s) { return s !== to; });
    moveTo(r, to, "");
    App.flush();
    App.announce("RFQ " + name + " moved to " + to + ".");
    focusCard(r.id, dir > 0 ? "next" : "prev");
  }

  /* ---------- board ---------- */
  function buildCard(r, today, byId) {
    var lost = r.lost, i = stageIdx(r.stage);
    var card = el("article", { class: "rfq-card" + (lost ? " is-lost" : ""), tabindex: "-1", dataset: { id: r.id }, "aria-label": "RFQ " + rfqLabel(r) });
    card.appendChild(el("div", { class: "rc-head" }, [el("b", { class: "rc-no", text: r.rfq_no || "No RFQ no" }), customerLine(r, byId)]));
    var part = [[r.part_name, r.part_no].filter(Boolean).join(" / "), r.qty != null ? "Qty " + App.fmt.int(r.qty) : ""].filter(Boolean).join(" · ");
    if (part) card.appendChild(el("div", { class: "rc-part", text: part }));
    if (r.quoted_value != null) card.appendChild(el("div", { class: "rc-val" }, [Ui.amountEl(r.quoted_value, "", true)]));
    var b = badges(r);
    if (b.length) card.appendChild(el("div", { class: "rc-badges" }, b));
    var w = wordsEls(r, today);
    if (w.length) card.appendChild(el("div", { class: "rc-flags" }, w));
    if (r.next_action && !lost) card.appendChild(el("div", { class: "rc-next", text: "Next: " + shortDate(r.next_action, today) }));
    if (lost) card.appendChild(el("div", { class: "rc-lost", text: "Lost" + (r.lost_reason ? ": " + r.lost_reason : "") }));
    var ctl = el("div", { class: "rc-ctl" });
    if (!lost) {
      var prevTo = STAGES[i - 1], nextTo = STAGES[i + 1];
      ctl.appendChild(el("button", { type: "button", class: "prev btn-sm", text: "◀", disabled: !prevTo, "aria-label": prevTo ? "Move RFQ " + rfqLabel(r) + " back to " + prevTo : "Already at the first stage" }));
      ctl.appendChild(el("button", { type: "button", class: "next btn-sm", text: "▶", disabled: !nextTo, "aria-label": nextTo ? "Move RFQ " + rfqLabel(r) + " to " + nextTo : "Already at the last stage" }));
    }
    ctl.appendChild(el("button", { type: "button", class: "edit btn-sm", text: "Edit", "aria-label": "Edit RFQ " + rfqLabel(r) }));
    card.appendChild(ctl);
    return card;
  }
  function renderBoard(list, today) {
    var board = $("rfqBoard"), byId = custIndex();
    board.textContent = "";
    var mobile = narrow();
    STAGES.forEach(function (stage) {
      var cards = list.filter(function (r) { return r.stage === stage; });
      var sum = 0, any = false;
      cards.forEach(function (r) { if (!r.lost && r.quoted_value != null) { sum += Number(r.quoted_value) || 0; any = true; } });
      var hid = "rfqh-" + stage;
      var open = mobile ? state.closed.indexOf(stage) === -1 : true;
      var det = el("details", { class: "rfq-col", role: "group", "aria-labelledby": hid, open: open, dataset: { stage: stage } });
      var head = el("summary", null, [el("h3", { id: hid, text: stage + " (" + cards.length + ")" }), any ? Ui.amountEl(sum, "col-val", true) : null]);
      head.addEventListener("click", function (e) { if (!narrow()) e.preventDefault(); });
      det.appendChild(head);
      det.addEventListener("toggle", function () {
        if (!narrow()) return;
        var i = state.closed.indexOf(stage);
        if (det.open && i !== -1) state.closed.splice(i, 1);
        else if (!det.open && i === -1) state.closed.push(stage);
        saveState();
      });
      var body = el("div", { class: "col-cards" });
      cards.forEach(function (r) { body.appendChild(buildCard(r, today, byId)); });
      if (!cards.length) body.appendChild(el("p", { class: "col-empty", text: "None" }));
      det.appendChild(body);
      board.appendChild(det);
    });
  }

  /* ---------- table ---------- */
  function buildRow(r, today, byId) {
    var tr = el("tr", { class: r.lost ? "is-lost" : null, dataset: { id: r.id } });
    var cell = function (label, cls) { var td = el("td", { dataset: { label: label }, class: cls || null }); tr.appendChild(td); return td; };
    var dash = function (td) { td.textContent = "—"; td.classList.add("muted"); };
    var td = cell("RFQ no", "name");
    td.appendChild(document.createTextNode(r.rfq_no || "—"));
    badges(r).forEach(function (b) { td.appendChild(b); });
    td = cell("Customer"); td.appendChild(customerLine(r, byId));
    td = cell("Part"); var part = [r.part_name, r.part_no].filter(Boolean).join(" / "); if (part) td.textContent = part; else dash(td);
    td = cell("Qty"); if (r.qty != null) td.textContent = App.fmt.int(r.qty); else dash(td);
    td = cell("Received"); if (r.received) td.textContent = App.fmt.date(r.received); else dash(td);
    td = cell("Quote due");
    if (r.quote_due) td.appendChild(el("span", { text: App.fmt.date(r.quote_due) })); else dash(td);
    wordsEls(r, today).filter(function (x) { return /Quote/.test(x.textContent); }).forEach(function (x) { td.appendChild(x); });
    td = cell("Value"); if (r.quoted_value != null) td.appendChild(Ui.amountEl(r.quoted_value)); else dash(td);
    td = cell("Stage");
    if (r.lost) td.appendChild(el("span", { class: "rc-lost", text: "Lost" + (r.lost_reason ? ": " + r.lost_reason : "") }));
    else {
      var sel = el("select", { class: "stage-sel", "aria-label": "Stage for RFQ " + rfqLabel(r) }, STAGES.map(function (s) { return el("option", { text: s, selected: s === r.stage }); }));
      td.appendChild(sel);
    }
    td = cell("Next action");
    if (r.next_action) td.appendChild(el("span", { text: App.fmt.date(r.next_action) })); else dash(td);
    wordsEls(r, today).filter(function (x) { return /Action/.test(x.textContent); }).forEach(function (x) { td.appendChild(x); });
    td = cell("Age"); if (r.received) td.textContent = days(Math.max(0, S.daysBetween(r.received, today))); else dash(td);
    td = cell("", "act");
    td.appendChild(el("button", { type: "button", class: "edit btn-sm", text: "Edit", "aria-label": "Edit RFQ " + rfqLabel(r) }));
    return tr;
  }
  function renderTable(list, today) {
    var body = $("rfqRows"), byId = custIndex();
    body.textContent = "";
    list.forEach(function (r) { body.appendChild(buildRow(r, today, byId)); });
  }

  /* ---------- render ---------- */
  function currentFilter() {
    return { stage: state.stage, flag: state.flag, stuckStage: state.stuckStage, customerId: state.customerId, waiting: state.waiting, q: state.q, showLost: state.showLost, sort: state.view === "board" ? "next" : state.sort, dir: state.view === "board" ? 1 : state.dir };
  }
  function compute() {
    return filterRfqs(rfqCol.all(), histCol.all(), S.customers(), currentFilter(), S.todayISO());
  }
  function flagLabel() {
    var m = { quoteOverdue: "Quote overdue", quoteToday: "Quote due today", actionOverdue: "Action overdue", stuck: "Stuck over 30 days", openQuoted: "Quoted, negotiating or finalised", won: "PO, sample or PPAP", quotedEver: "Ever quoted" };
    var s = m[state.flag] || "";
    if (state.flag === "stuck" && state.stuckStage) s += " at " + state.stuckStage;
    return s;
  }
  function render() {
    if (!root) return;
    var today = S.todayISO();
    var all = rfqCol.all(), custs = S.customers();
    var st = rfqStats(all, histCol.all(), custs, today);
    var list = compute();
    lastList = list;

    var press = function (id, on) { var b = $(id); if (b) b.setAttribute("aria-pressed", String(!!on)); };
    press("rfqViewBoard", state.view === "board"); press("rfqViewTable", state.view === "table");
    press("rfqChipQuote", state.flag === "quoteOverdue"); press("rfqChipAction", state.flag === "actionOverdue");
    press("rfqChipReleased", state.stage === "released"); press("rfqChipLost", state.showLost);
    press("rfqChipUs", state.waiting === "us"); press("rfqChipCust", state.waiting === "customer");
    $("rfqNQuote").textContent = st.quoteOverdue; $("rfqNAction").textContent = st.actionOverdue; $("rfqNReleased").textContent = st.released.total;
    $("rfqNUs").textContent = all.filter(function (r) { return !r.lost && r.waiting_on === "us"; }).length;
    $("rfqNCust").textContent = all.filter(function (r) { return !r.lost && r.waiting_on === "customer"; }).length;
    $("rfqNLost").textContent = st.lost;
    $("rfqChipQuote").classList.toggle("has", st.quoteOverdue > 0);
    $("rfqChipAction").classList.toggle("has", st.actionOverdue > 0);
    if ($("rfqQ").value !== state.q) $("rfqQ").value = state.q;

    var stageBar = $("rfqStageBar");
    stageBar.hidden = state.view !== "table";
    var cnt = { "": 0 };
    STAGES.forEach(function (s) { cnt[s] = 0; });
    all.forEach(function (r) { if (r.lost && !state.showLost) return; cnt[""]++; if (cnt.hasOwnProperty(r.stage)) cnt[r.stage]++; });
    Array.prototype.forEach.call(stageBar.querySelectorAll(".chip[data-stage]"), function (b) {
      var s = b.dataset.stage;
      b.setAttribute("aria-pressed", String(state.stage !== "released" && s === state.stage));
      b.querySelector("b").textContent = cnt[s] == null ? 0 : cnt[s];
    });
    $("rfqReleasedNote").hidden = state.stage !== "released";

    var fb = $("rfqFlagBar");
    fb.hidden = !(state.flag && !/^(quoteOverdue|actionOverdue)$/.test(state.flag)) && !state.customerId;
    if (!fb.hidden) {
      var lab = [flagLabel()];
      if (state.customerId) { var c = S.get(state.customerId); lab.push("Customer: " + (c ? c.name : state.customerId)); }
      $("rfqFlagLabel").textContent = lab.filter(Boolean).join(" · ");
    }

    $("rfqBoardWrap").hidden = state.view !== "board";
    $("rfqTableWrap").hidden = state.view !== "table";
    if (state.view === "board") renderBoard(list, today); else renderTable(list, today);
    var th = root.querySelectorAll("#rfqTable th button");
    Array.prototype.forEach.call(th, function (b) {
      var on = b.dataset.sort === state.sort;
      b.parentNode.setAttribute("aria-sort", on ? (state.dir === 1 ? "ascending" : "descending") : "none");
    });

    var empty = $("rfqEmpty");
    empty.hidden = list.length > 0;
    empty.textContent = all.length ? "No RFQs match." : "No RFQs yet. Use + New RFQ, or Import RFQs to bring in the Hub sheet.";
    $("rfqFoot").textContent = summary();
    saveState();
  }
  function summary() { return "Showing " + compute().length + " of " + rfqCol.all().length + " RFQs."; }
  function visible() { return compute(); }

  /* ---------- RFQ dialog ---------- */
  function field(label, input, extra) { return el("label", extra ? { class: extra } : null, [label, input]); }
  function buildDialog() {
    F.err = el("p", { class: "form-err", id: "rfqErr", role: "alert", hidden: true });
    F.datalist = el("datalist", { id: "rfqCustomers" });
    F.customer = el("input", { id: "rfqCustomer", name: "customer", list: "rfqCustomers", autocomplete: "off", maxlength: "120", placeholder: "Start typing a customer name" });
    F.rfq_no = el("input", { id: "rfqNo", name: "rfq_no", maxlength: "40", autocomplete: "off" });
    F.part_name = el("input", { id: "rfqPartName", name: "part_name", maxlength: "120", autocomplete: "off" });
    F.part_no = el("input", { id: "rfqPartNo", name: "part_no", maxlength: "60", autocomplete: "off" });
    F.qty = el("input", { id: "rfqQty", name: "qty", inputmode: "numeric", autocomplete: "off", maxlength: "12" });
    F.received = el("input", { id: "rfqReceived", name: "received", type: "date" });
    F.quote_due = el("input", { id: "rfqQuoteDue", name: "quote_due", type: "date" });
    F.quoted_value = el("input", { id: "rfqValue", name: "quoted_value", inputmode: "decimal", autocomplete: "off", maxlength: "20", placeholder: "e.g. 1250000" });
    F.stage = el("select", { id: "rfqStage", name: "stage" }, STAGES.map(function (s) { return el("option", { text: s, value: s }); }));
    F.next_action = el("input", { id: "rfqNext", name: "next_action", type: "date" });
    F.stageNote = el("input", { id: "rfqStageNote", name: "stage_note", maxlength: "200", autocomplete: "off" });
    F.stageNoteWrap = field("Stage note (optional)", F.stageNote);
    F.stageNoteWrap.hidden = true;
    F.notes = el("textarea", { id: "rfqNotes", name: "notes", rows: "3", maxlength: "1000" });
    F.notesCount = el("div", { class: "count", id: "rfqNotesCount" });
    Ui.counter(F.notes, F.notesCount, 1000);
    F.lost = el("input", { id: "rfqLost", name: "lost", type: "checkbox" });
    F.lostReason = el("input", { id: "rfqLostReason", name: "lost_reason", maxlength: "200", autocomplete: "off", placeholder: "Reason (optional)", disabled: true, "aria-label": "Reason for losing" });
    F.lostRow = el("div", { class: "lost-row" }, [el("label", { class: "chk" }, [F.lost, " Mark as lost"]), F.lostReason]);
    F.hist = el("ol", { class: "hist", id: "rfqHist" });
    F.histWrap = el("div", { class: "hist-wrap" }, [el("div", { class: "hist-title", text: "Stage history" }), F.hist]);
    F.title = el("div", { class: "dlg-head", id: "rfqDlgTitle", text: "New RFQ" });
    F.save = el("button", { class: "btn primary", type: "submit", id: "rfqSave", text: "Save RFQ" });
    F.cancel = el("button", { class: "btn", type: "button", id: "rfqCancel", text: "Cancel" });
    F.form = el("form", { id: "rfqForm", method: "dialog" }, [
      field("Customer *", F.customer), F.datalist,
      el("div", { class: "two" }, [field("RFQ no", F.rfq_no), field("Stage", F.stage)]),
      el("div", { class: "two" }, [field("Part name", F.part_name), field("Part no", F.part_no)]),
      el("div", { class: "two" }, [field("Quantity", F.qty), field("Quoted value (₹)", F.quoted_value)]),
      el("div", { class: "two" }, [field("Date received", F.received), field("Quote due", F.quote_due)]),
      el("div", { class: "two" }, [field("Next action date", F.next_action), F.stageNoteWrap]),
      field("Notes", F.notes), F.notesCount,
      F.lostRow, F.histWrap, F.err,
      el("p", { class: "note", text: "Saved in this browser. Quoted values are private and are not in customers.json." }),
      el("div", { class: "actions" }, [F.cancel, F.save])
    ]);
    dlg = el("dialog", { id: "rfqDlg", "aria-labelledby": "rfqDlgTitle" }, [F.title, F.form]);
    document.body.appendChild(dlg);

    F.cancel.addEventListener("click", function () { dlg.close(); });
    F.lost.addEventListener("change", function () { F.lostReason.disabled = !F.lost.checked; if (F.lost.checked) F.lostReason.focus(); });
    F.stage.addEventListener("change", function () { F.stageNoteWrap.hidden = !editing || F.stage.value === editing.stage; });
    Ui.ctrlEnter(F.notes, F.form);
    F.form.addEventListener("submit", function (e) { e.preventDefault(); saveDialog(); });
  }
  function showErr(msg, fieldKey) {
    F.err.textContent = msg; F.err.hidden = false;
    var f = F[fieldKey]; if (f && f.focus) f.focus();
  }
  function histLine(h, today) {
    var when = App.fmt.date(h.at);
    if (h.to === "Lost") return when + " · Marked lost" + (h.note ? " · " + h.note : "");
    var step = h.from ? h.from + " → " + h.to : "Created at " + h.to;
    return when + " · " + step + (h.note ? " · " + h.note : "");
  }
  function fillHistory(r) {
    F.hist.textContent = "";
    var rows = histCol.where(function (h) { return h.rfq_id === r.id; }).sort(function (a, b) { return cmpVal(a.at, b.at) || cmpVal(a.created_at || "", b.created_at || ""); });
    rows.forEach(function (h) { F.hist.appendChild(el("li", { text: histLine(h) })); });
    if (!rows.length) F.hist.appendChild(el("li", { class: "muted", text: "No history yet." }));
  }
  function openDialog(r, opts, opener) {
    if (!dlg) buildDialog();
    editing = r || null; newOpts = opts || null;
    var today = S.todayISO();
    F.datalist.textContent = "";
    S.customers().slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); })
      .forEach(function (c) { F.datalist.appendChild(el("option", { value: c.name })); });
    F.err.hidden = true;
    F.form.reset();
    F.received.max = today;
    F.title.textContent = r ? "Edit RFQ" : "New RFQ";
    F.save.textContent = r ? "Save changes" : "Save RFQ";
    F.histWrap.hidden = !r; F.lostRow.hidden = !r;
    F.stageNoteWrap.hidden = true;
    if (r) {
      var byId = custIndex();
      F.customer.value = r.customer_id && byId[r.customer_id] ? byId[r.customer_id].name : (r.customer_name || "");
      F.rfq_no.value = r.rfq_no || ""; F.part_name.value = r.part_name || ""; F.part_no.value = r.part_no || "";
      F.qty.value = r.qty == null ? "" : r.qty; F.received.value = r.received || today; F.quote_due.value = r.quote_due || "";
      F.quoted_value.value = r.quoted_value == null ? "" : r.quoted_value; F.stage.value = r.stage; F.next_action.value = r.next_action || "";
      F.notes.value = r.notes || "";
      F.lost.checked = !!r.lost; F.lostReason.disabled = !r.lost; F.lostReason.value = r.lost_reason || "";
      F.stage.disabled = !!r.lost;
      fillHistory(r);
    } else {
      var cid = opts && opts.customerId, c = cid ? S.get(cid) : null;
      F.customer.value = c ? c.name : (opts && opts.customerName) || "";
      F.part_name.value = (opts && opts.partName) || "";
      F.received.value = today; F.stage.value = "Received"; F.stage.disabled = false;
      F.lostReason.disabled = true;
    }
    F.notes.dispatchEvent(new Event("input"));
    App.openDialog(dlg, opener || document.activeElement);
    F.customer.focus();
  }
  function saveDialog() {
    var today = S.todayISO();
    var vals = {};
    ["customer", "rfq_no", "part_name", "part_no", "qty", "received", "quote_due", "quoted_value", "stage", "next_action", "notes"].forEach(function (k) { vals[k] = F[k].value; });
    var res = validateRfq(vals, { today: today, rows: rfqCol.all(), editing: editing, opts: newOpts });
    if (res.error) { showErr(res.error, res.field); return; }
    var fl = res.fields, lostOn = F.lost.checked, reason = cap(F.lostReason.value, 200);
    F.err.hidden = true;
    if (!editing) {
      var id = S.uuid();
      var row = Object.assign({ id: id, stage_at: today, lost: false, lost_reason: "", stage_source: "user" }, fl);
      if (newOpts && newOpts.leadId) row.lead_id = newOpts.leadId;
      if (!row.lead_id) delete row.lead_id;
      rfqCol.insert(row);
      histCol.insert({ rfq_id: id, from: null, to: fl.stage, at: today, note: "" });
      dlg.close();
      applyFilter({ view: state.view });
      if (App.tab() !== "rfqs") App.show("rfqs", { view: state.view }); else App.flush();
      App.announce("RFQ " + (fl.rfq_no || fl.part_name) + " added at " + fl.stage + ".");
      requestAnimationFrame(function () { focusCard(id, "next"); });
      return;
    }
    var patch = {};
    ["customer_id", "customer_name", "lead_id", "rfq_no", "part_name", "part_no", "qty", "received", "quote_due", "quoted_value", "next_action", "notes"].forEach(function (k) {
      if (fl[k] !== undefined) patch[k] = fl[k];
    });
    var from = editing.stage;
    if (!editing.lost && fl.stage !== from) {
      patch.stage = fl.stage; patch.stage_at = today; patch.stage_source = "user";
      histCol.insert({ rfq_id: editing.id, from: from, to: fl.stage, at: today, note: cap(F.stageNote.value, 200) });
    }
    if (lostOn && !editing.lost) {
      patch.lost = true; patch.lost_reason = reason;
      histCol.insert({ rfq_id: editing.id, from: patch.stage || from, to: "Lost", at: today, note: reason });
    } else if (!lostOn && editing.lost) {
      patch.lost = false; patch.lost_reason = "";
      histCol.insert({ rfq_id: editing.id, from: "Lost", to: patch.stage || from, at: today, note: "Reopened" });
    } else if (lostOn) patch.lost_reason = reason;
    rfqCol.patch(editing.id, patch);
    var eid = editing.id;
    dlg.close();
    App.flush();
    App.announce("RFQ " + (fl.rfq_no || fl.part_name) + " saved.");
    requestAnimationFrame(function () { focusCard(eid, "edit"); });
  }
  function openNew(customerId, opts) {
    var o = Object.assign({}, opts || {});
    if (customerId) o.customerId = customerId;
    openDialog(null, o, $("rfqNew"));
  }
  function openEdit(id) {
    var r = rfqCol.get(id);
    if (!r) { App.notice("That RFQ no longer exists.", "error"); return; }
    openDialog(r, null, null);
  }

  /* ---------- imports ---------- */
  function openImport() {
    if (!window.CrmImport) { App.notice("The import dialog is not available.", "error"); return; }
    CrmImport.open({
      title: "Import RFQs",
      intro: "Choose a CSV exported from the Hub sheet (Action Pending (Internal) or Awaiting Customer Response tab), or an RFQ list with a Customer column. Hub rows open a review screen first; nothing is saved until you accept.",
      specs: [SPECS.hub_action, SPECS.hub_awaiting, SPECS.rfqs], customerField: null, asOf: false,
      onConfirm: function (res) {
        if (res.specKey === "rfqs") return importRfqList(res);
        setTimeout(function () { startReview(res); }, 0);
        return { ok: true };
      }
    });
  }

  /* generic RFQ list: upsert by RFQ no (design 5.4) */
  function importRfqList(res) {
    var today = S.todayISO(), errs = [];
    res.rows.forEach(function (r) {
      if (str(r.stage) && normStage(r.stage) === null) errs.push("Row " + r.row + ': Stage "' + r.stage + '" is not one of ' + STAGES.join(", ") + ".");
      if (r.received && r.received > today) errs.push("Row " + r.row + ": Date received is in the future.");
    });
    if (errs.length) return { ok: false, error: errs.slice(0, 5).join(" ") + (errs.length > 5 ? " (+" + (errs.length - 5) + " more)" : "") };
    var added = 0, updated = 0;
    res.rows.forEach(function (r) {
      var m = S.matchCustomer(r.customer), stage = normStage(r.stage) || "";
      var key = str(r.rfq_no).toLowerCase();
      var ex = key ? rfqCol.all().filter(function (x) { return str(x.rfq_no).toLowerCase() === key; })[0] : null;
      var cust = { customer_id: m || null, customer_name: cap(r.customer, 120) };
      if (ex) {
        var p = Object.assign({}, cust);
        [["part_name", 120], ["part_no", 60]].forEach(function (k) { if (str(r[k[0]])) p[k[0]] = cap(r[k[0]], k[1]); });
        ["qty", "received", "quote_due", "quoted_value", "next_action"].forEach(function (k) { if (r[k] != null && r[k] !== "") p[k] = r[k]; });
        if (str(r.notes)) p.notes = cap(r.notes, 1000);
        if (!ex.lead_id) p.lead_id = "";
        if (stage && stage !== ex.stage && !ex.lost) {
          p.stage = stage; p.stage_at = today; p.stage_source = "user";
          histCol.insert({ rfq_id: ex.id, from: ex.stage, to: stage, at: today, note: "Imported" });
        }
        rfqCol.patch(ex.id, p); updated++;
      } else {
        var id = S.uuid(), st = stage || "Received";
        rfqCol.insert(Object.assign({ id: id, rfq_no: cap(r.rfq_no, 40), part_name: cap(r.part_name, 120), part_no: cap(r.part_no, 60), qty: r.qty == null ? null : r.qty,
          received: r.received || today, quote_due: r.quote_due || "", quoted_value: r.quoted_value == null ? null : r.quoted_value, stage: st, stage_at: today,
          next_action: r.next_action || "", notes: cap(r.notes, 1000), lost: false, lost_reason: "", stage_source: "user" }, cust));
        histCol.insert({ rfq_id: id, from: null, to: st, at: today, note: "Imported" });
        added++;
      }
    });
    App.flush();
    setTimeout(function () { App.notice("RFQ list imported: " + added + " new, " + updated + " updated.", "info"); }, 0);
    return { ok: true };
  }

  /* ---------- Hub review screen (design 12.3) ---------- */
  var RV = { dlg: null, items: [], attention: false, E: {}, notesDone: {}, canLead: false };
  function leadRows() {
    return S.collectionNames().indexOf("leads") !== -1 ? S.col("leads").all().filter(function (l) { return l.company; }) : [];
  }
  function hubCtx() {
    var CL = window.CrmLeads;
    return {
      today: S.todayISO(), customers: S.customers(), leads: leadRows(),
      canCreateLead: !!(CL && typeof CL.createFromImport === "function"),
      isInternal: CL && typeof CL.isInternal === "function" ? function (x) { return CL.isInternal(x); } : null,
      matchCustomer: function (n) { return S.matchCustomer(n); },
      matchLead: CL && typeof CL.match === "function" ? function (n) { return CL.match(n); } : null
    };
  }
  function startReview(res) {
    var ctx = hubCtx();
    var items = res.rows.map(function (r) { return buildHubItem(res.specKey, r, ctx); });
    var counts = planImport(items, rfqCol.all());
    var d = S.doc("hub_import").get();
    RV.notesDone = d && d.notes && typeof d.notes === "object" ? d.notes : {};
    RV.items = items; RV.counts = counts; RV.attention = false; RV.canLead = ctx.canCreateLead;
    App.notice("Review the " + items.length + " rows from the Hub sheet. Nothing is saved until you press Import.", "info");
    openReview(res);
  }
  function itemMatched(it) { return /^[cl]:/.test(it.choice); }
  function needsAttention(it) {
    if (it.kind === "other") return true;
    return it.kind === "rfq" && (it.stageSource === "guess" || !itemMatched(it) || it.customerGuessed);
  }
  function reviewTotals() {
    var tot = { rfq: 0, guessed: 0, unmatched: 0, other: 0, internal: 0, add: 0, upd: 0, same: 0, notes: 0 };
    RV.items.forEach(function (it) {
      if (it.kind === "rfq") {
        tot.rfq++; if (it.stageSource === "guess") tot.guessed++; if (!itemMatched(it)) tot.unmatched++;
        if (it.include) { if (it.status === "new") tot.add++; else if (it.status === "update") tot.upd++; else tot.same++; }
      } else {
        if (it.kind === "internal") tot.internal++; else tot.other++;
        if (it.saveNote && it.customerId) tot.notes++;
      }
    });
    return tot;
  }
  function refreshReview() {
    var E = RV.E, t0 = reviewTotals();
    E.summary.textContent = RV.items.length + " rows: " + t0.rfq + " RFQs (" + t0.guessed + " stage guessed, " + t0.unmatched + " customer not matched) · " +
      t0.other + " other items (skipped) · " + t0.internal + " internal (skipped)";
    E.counts.textContent = "New " + t0.add + " · Updated " + t0.upd + " · Unchanged " + t0.same;
    var n = t0.add + t0.upd, bits = [];
    if (n) bits.push("Import " + n + " RFQ" + (n === 1 ? "" : "s"));
    if (t0.notes) bits.push((n ? "save " : "Save ") + t0.notes + " note" + (t0.notes === 1 ? "" : "s"));
    E.accept.textContent = bits.length ? bits.join(" and ") : "Nothing to import";
    E.accept.disabled = !bits.length;
    var att = RV.items.filter(needsAttention).length;
    E.attnN.textContent = att;
    E.attn.setAttribute("aria-pressed", String(RV.attention));
    RV.items.forEach(function (it) { if (it.sync) it.sync(); });
  }
  function selectEl(label, id, opts, value, onChange) {
    var s = el("select", { id: id, "aria-label": label }, opts.map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
    s.value = value;
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function buildReviewRow(it, idx, custs, leads) {
    var pre = "hub" + idx;
    var inc = el("input", { type: "checkbox", id: pre + "Inc", checked: it.include, "aria-label": "Include " + (it.id || "row " + (idx + 1)) });
    inc.addEventListener("change", function () { it.include = inc.checked; refreshReview(); });
    var kind = selectEl("Kind", pre + "Kind", [["rfq", "RFQ"], ["other", "Other"], ["internal", "Internal"]], it.kind, function (v) {
      it.kind = v; it.include = v === "rfq"; inc.checked = it.include; refreshReview();
    });
    var cpOpts = [["text", "Keep as text"]];
    if (RV.canLead) cpOpts.push(["new", "Create lead"]);
    var match = el("select", { id: pre + "Match", "aria-label": "Customer for " + (it.id || "row " + (idx + 1)) }, [
      cpOpts.map(function (o) { return el("option", { value: o[0], text: o[1] }); }),
      el("optgroup", { label: "Customers" }, custs.map(function (c) { return el("option", { value: "c:" + c.id, text: c.name }); })),
      leads.length ? el("optgroup", { label: "Leads" }, leads.map(function (l) { return el("option", { value: "l:" + l.id, text: l.company }); })) : null
    ]);
    match.value = it.choice;
    if (match.value !== it.choice) { it.choice = "text"; match.value = "text"; }
    match.addEventListener("change", function () {
      it.choice = match.value; it.customerGuessed = false;
      var p = it.choice.split(":");
      it.customerId = p[0] === "c" ? p[1] : null; it.leadId = p[0] === "l" ? p[1] : null;
      var cc = it.customerId ? S.get(it.customerId) : null, ll = it.leadId ? leadRows().filter(function (x) { return x.id === it.leadId; })[0] : null;
      it.customerName = cc ? cc.name : ll ? ll.company : it.counterparty;
      refreshReview();
    });
    var stage = selectEl("Stage", pre + "Stage", STAGES.map(function (s) { return [s, s]; }), it.stage, function (v) {
      it.stage = v; it.stageSource = "user"; refreshReview();
    });
    var prio = selectEl("Priority", pre + "Prio", [["", "No priority"], ["High", "High"], ["Medium", "Medium"], ["Low", "Low"]], it.priority, function (v) { it.priority = v; refreshReview(); });
    var lost = el("input", { type: "checkbox", id: pre + "Lost", checked: it.lost });
    var lostWhy = el("input", { id: pre + "LostWhy", value: it.lostReason, maxlength: "200", placeholder: "Reason", "aria-label": "Reason lost", autocomplete: "off" });
    lost.addEventListener("change", function () { it.lost = lost.checked; refreshReview(); });
    lostWhy.addEventListener("input", function () { it.lostReason = lostWhy.value; });
    var note = el("input", { type: "checkbox", id: pre + "Note" });
    it.saveNote = false;
    note.addEventListener("change", function () { it.saveNote = note.checked; refreshReview(); });
    var noteLabel = el("label", { class: "chk hub-note" }, [note, " Save as a note on the customer"]);
    var noteDone = RV.notesDone[itemKey(it)];
    if (noteDone) { note.disabled = true; noteLabel.appendChild(document.createTextNode(" (already saved)")); }

    var tagStatus = el("span", { class: "tag-s st-" + it.status, text: it.status === "new" ? "New" : it.status === "update" ? "Update" : "Unchanged" });
    var gStage = el("span", { class: "badge guess", text: "stage guessed" });
    var gCust = el("span", { class: "badge guess", text: "customer guessed" });
    var bLead = el("span", { class: "badge", text: "Lead" });
    var bDup = el("span", { class: "badge", text: "Repeated in this file" });
    var bDate = el("span", { class: "badge guess", text: "date not read" });
    var cpText = el("div", { class: "hub-cp" });
    var row = el("li", { class: "hub-item", dataset: { key: itemKey(it) } }, [
      el("div", { class: "hub-top" }, [el("label", { class: "chk hub-inc" }, [inc, " Include"]), el("b", { class: "hub-id", text: it.id || "(no ID)" }), tagStatus, gStage, gCust, bLead, bDup, bDate]),
      el("div", { class: "hub-subject", text: it.partFull || "(no subject)" }),
      cpText,
      el("div", { class: "hub-grid" }, [
        el("label", null, ["Kind", kind]),
        el("label", null, ["Customer", match]),
        el("label", null, ["Stage", stage]),
        el("label", null, ["Priority", prio]),
        el("div", { class: "hub-lostbox" }, [el("label", { class: "chk" }, [lost, " Lost"]), lostWhy]),
        noteLabel
      ])
    ]);
    it.sync = function () {
      var isR = it.kind === "rfq";
      inc.disabled = !isR; inc.checked = isR && it.include;
      row.classList.toggle("skipped", !isR || !it.include);
      stage.disabled = !isR || it.status !== "new"; prio.disabled = !isR; lost.disabled = !isR; lostWhy.disabled = !isR || !it.lost; lostWhy.hidden = !it.lost;
      lost.checked = it.lost; stage.value = it.stage;
      match.disabled = isR && it.status !== "new";
      gStage.hidden = !(isR && it.stageSource === "guess");
      gCust.hidden = !(it.customerGuessed && itemMatched(it));
      bLead.hidden = !/^l:/.test(it.choice) && it.choice !== "new";
      bLead.textContent = it.choice === "new" ? "New lead" : "Lead";
      bDup.hidden = !it.dupInFile;
      bDate.hidden = !(it.badDates && it.badDates.length);
      noteLabel.hidden = isR;
      note.disabled = !!noteDone || !it.customerId;
      note.title = it.customerId ? "" : "Pick a customer first";
      if (!it.customerId && note.checked) { note.checked = false; it.saveNote = false; }
      cpText.textContent = it.counterparty ? "Counterparty: " + it.counterparty : "Counterparty: (blank)" + (it.customerGuessed ? " · guessed from the subject: " + it.customerName : "");
      row.hidden = RV.attention && !needsAttention(it);
    };
    return row;
  }
  function openReview() {
    if (!RV.dlg) {
      var E = RV.E;
      E.summary = el("p", { id: "hubSummary", class: "hub-summary", role: "status" });
      E.counts = el("p", { id: "hubCounts", class: "note" });
      E.attnN = el("b", { text: "0" });
      E.attn = el("button", { type: "button", class: "chip", id: "hubAttn", "aria-pressed": "false" }, ["Needs attention ", E.attnN]);
      E.list = el("ul", { class: "hub-list", id: "hubRows" });
      E.warn = el("div", { class: "imp-warn", id: "hubWarn", hidden: true });
      E.err = el("p", { class: "form-err", id: "hubErr", role: "alert", hidden: true });
      E.accept = el("button", { type: "button", class: "btn primary", id: "hubAccept", text: "Import" });
      E.cancel = el("button", { type: "button", class: "btn", id: "hubCancel", text: "Cancel" });
      var body = el("div", { class: "dlg-body" }, [
        el("p", { class: "note", text: "Nothing is saved until you press the button at the bottom. Emails and phone numbers are kept out of the notes and stored only in this browser." }),
        E.summary, E.counts, el("div", { class: "bar" }, [E.attn]), E.warn, E.err, E.list
      ]);
      RV.dlg = el("dialog", { id: "hubReviewDlg", "aria-labelledby": "hubTitle" }, [
        el("div", { class: "dlg-head", id: "hubTitle", text: "Review Hub rows" }), body, el("div", { class: "actions imp-foot" }, [E.cancel, E.accept])
      ]);
      document.body.appendChild(RV.dlg);
      E.cancel.addEventListener("click", function () { RV.dlg.close(); });
      E.attn.addEventListener("click", function () { RV.attention = !RV.attention; refreshReview(); });
      E.accept.addEventListener("click", acceptReview);
    }
    var E2 = RV.E;
    E2.list.textContent = ""; E2.err.hidden = true;
    var custs = S.customers().slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    var leads = leadRows();
    var bad = [];
    RV.items.forEach(function (it, i) { E2.list.appendChild(buildReviewRow(it, i, custs, leads)); if (it.badDates && it.badDates.length) bad.push(it.id || "row " + (i + 1)); });
    E2.warn.hidden = !bad.length;
    E2.warn.textContent = bad.length ? "A date could not be read in " + bad.length + " row" + (bad.length === 1 ? "" : "s") + " (" + bad.slice(0, 5).join(", ") + "). It is left blank." : "";
    refreshReview();
    App.openDialog(RV.dlg, $("rfqImport"));
    RV.E.accept.focus();
  }
  function ensureLead(it, made) {
    var CL = window.CrmLeads, k = S.nameKey(it.counterparty);
    if (made[k]) return Promise.resolve(made[k]);
    return Promise.resolve(CL.createFromImport({ company: it.counterparty, scope: it.partName, last_contact: it.lastTouch || it.received, source: "Hub RFQ import" })).then(function (r) {
      if (r && r.ok && r.id) { made[k] = r.id; return r.id; }
      return null;
    }).catch(function () { return null; });
  }
  function must(p) {
    return Promise.resolve(p).then(function (r) { if (r && r.ok === false) throw new Error(r.error || "A change could not be saved."); return r; });
  }
  async function acceptReview() {
    var E = RV.E, today = S.todayISO(), made = {}, add = 0, upd = 0, same = 0, notes = 0, leadsMade = 0, leadFails = 0;
    E.accept.disabled = true; E.err.hidden = true;
    try {
      var existingNos = {};
      rfqCol.all().forEach(function (r) { if (r.rfq_no) existingNos[r.rfq_no.toLowerCase()] = true; });
      for (var i = 0; i < RV.items.length; i++) {
        var it = RV.items[i];
        if (it.kind !== "rfq") continue;
        if (!it.include) continue;
        if (it.status === "new") {
          if (it.choice === "new" && RV.canLead) {
            var lid = await ensureLead(it, made);
            if (lid) { it.leadId = lid; it.customerId = null; if (made[S.nameKey(it.counterparty)] === lid) leadsMade++; } else leadFails++;
          }
          var id = S.uuid(), row = rowFromItem(it, today, id);
          if (row.rfq_no && existingNos[row.rfq_no.toLowerCase()]) row.rfq_no = row.rfq_no + "-hub";
          if (row.rfq_no) existingNos[row.rfq_no.toLowerCase()] = true;
          if (it.leadId) row.customer_name = it.counterparty;
          await must(rfqCol.insert(row));
          await must(histCol.insert({ rfq_id: id, from: null, to: it.stage, at: today, note: "Hub import" }));
          if (it.lost) await must(histCol.insert({ rfq_id: id, from: it.stage, to: "Lost", at: today, note: cap(it.lostReason, 200) }));
          add++;
        } else if (it.status === "update") {
          var ex = rfqCol.get(it.existingId);
          if (!ex) continue;
          var plan = updatePlan(ex, it);
          if (plan.advance) await must(histCol.insert({ rfq_id: ex.id, from: ex.stage, to: it.stage, at: today, note: "Hub import" }));
          if (plan.newLost) await must(histCol.insert({ rfq_id: ex.id, from: plan.advance ? it.stage : ex.stage, to: "Lost", at: today, note: cap(it.lostReason, 200) }));
          if (plan.changed) await must(rfqCol.patch(ex.id, plan.patch));
          upd++;
        } else same++;
      }
      var done = S.doc("hub_import"), cur = done.get() || { v: 1, notes: {} };
      if (!cur.notes || typeof cur.notes !== "object") cur.notes = {};
      for (var j = 0; j < RV.items.length; j++) {
        var n = RV.items[j];
        if (n.kind === "rfq" || !n.saveNote || !n.customerId || cur.notes[itemKey(n)]) continue;
        var at = n.received && n.received <= today ? n.received : today;
        var r = await S.addLog(n.customerId, { type: "Note", note: n.noteText, at: at });
        if (r.ok) { cur.notes[itemKey(n)] = r.entry.id; notes++; }
      }
      if (notes) await done.set(cur);
      RV.dlg.close();
      applyFilter({ view: state.view });
      App.flush();
      var msg = "Hub import: " + add + " new, " + upd + " updated, " + same + " unchanged" + (notes ? "; " + notes + " note" + (notes === 1 ? "" : "s") + " saved" : "") +
        (leadsMade ? "; " + leadsMade + " lead" + (leadsMade === 1 ? "" : "s") + " created" : "") + (leadFails ? "; " + leadFails + " lead(s) could not be created and were kept as text" : "") + ".";
      App.notice(msg, "info"); App.announce(msg);
    } catch (e) {
      E.err.textContent = "The import stopped: " + (e && e.message ? e.message : e); E.err.hidden = false; E.accept.disabled = false;
    }
  }

  /* ---------- panel ---------- */
  function chip(id, label, nId, extra, attrs) {
    return el("button", Object.assign({ type: "button", class: "chip" + (extra ? " " + extra : ""), id: id, "aria-pressed": "false" }, attrs || {}), [label + " ", el("b", { id: nId, text: "0" })]);
  }
  function mount(panel) {
    root = panel;
    loadState();
    var viewBtn = function (id, v, label) { return el("button", { type: "button", class: "chip", id: id, text: label, "aria-pressed": "false", dataset: { v: v } }); };
    panel.appendChild(el("div", { class: "bar rfq-tools" }, [
      el("div", { class: "seg", role: "group", "aria-label": "View" }, [viewBtn("rfqViewBoard", "board", "Board"), viewBtn("rfqViewTable", "table", "Table")]),
      el("button", { type: "button", class: "btn primary", id: "rfqNew", text: "+ New RFQ" }),
      el("button", { type: "button", class: "btn", id: "rfqImport", text: "Import RFQs" }),
      el("input", { class: "search", id: "rfqQ", type: "search", placeholder: "Search RFQ no, part, customer", "aria-label": "Search RFQs" })
    ]));
    panel.appendChild(el("div", { class: "bar", role: "group", "aria-label": "Filter RFQs" }, [
      chip("rfqChipQuote", "Quote overdue", "rfqNQuote", "danger"), chip("rfqChipAction", "Action overdue", "rfqNAction", "danger"),
      chip("rfqChipReleased", "Released parts", "rfqNReleased"),
      chip("rfqChipUs", "Waiting on us", "rfqNUs"), chip("rfqChipCust", "Waiting on customer", "rfqNCust"),
      chip("rfqChipLost", "Show lost", "rfqNLost")
    ]));
    var stageBar = el("div", { class: "bar", id: "rfqStageBar", role: "group", "aria-label": "Filter by stage", hidden: true });
    stageBar.appendChild(el("button", { type: "button", class: "chip", dataset: { stage: "" }, "aria-pressed": "false" }, ["All ", el("b", { text: "0" })]));
    STAGES.forEach(function (s) { stageBar.appendChild(el("button", { type: "button", class: "chip", dataset: { stage: s }, "aria-pressed": "false" }, [s + " ", el("b", { text: "0" })])); });
    panel.appendChild(stageBar);
    panel.appendChild(el("div", { class: "bar", id: "rfqFlagBar", hidden: true }, [
      el("span", { class: "bar-label", text: "Also" }),
      el("span", { class: "chip extra-chip" }, [el("span", { id: "rfqFlagLabel" }), el("button", { type: "button", class: "extra-x", id: "rfqFlagClear", text: "×", "aria-label": "Remove this filter", title: "Remove this filter" })])
    ]));
    panel.appendChild(el("p", { class: "rule", id: "rfqReleasedNote", hidden: true, text: "Released parts are RFQs at Finalised, PO, Sample or PPAP. Please confirm this is the right definition; it can be changed in one place." }));
    panel.appendChild(el("div", { id: "rfqBoardWrap" }, [el("div", { class: "rfq-board", id: "rfqBoard" })]));
    panel.appendChild(el("div", { class: "card", id: "rfqTableWrap", hidden: true }, [
      el("table", { id: "rfqTable" }, [
        el("thead", null, el("tr", null, [
          sortTh("RFQ no", "rfq"), sortTh("Customer", "customer"), sortTh("Part"), sortTh("Qty"), sortTh("Received", "received"), sortTh("Quote due", "quoteDue"),
          sortTh("Value", "value"), sortTh("Stage"), sortTh("Next action", "next"), sortTh("Age"), sortTh("")
        ])),
        el("tbody", { id: "rfqRows" })
      ])
    ]));
    panel.appendChild(el("div", { class: "empty", id: "rfqEmpty", hidden: true }));
    panel.appendChild(el("p", { class: "foot", id: "rfqFoot" }));

    $("rfqViewBoard").addEventListener("click", function () { state.view = "board"; render(); });
    $("rfqViewTable").addEventListener("click", function () { state.view = "table"; render(); });
    $("rfqNew").addEventListener("click", function () { openNew(); });
    $("rfqImport").addEventListener("click", openImport);
    $("rfqQ").addEventListener("input", function (e) { state.q = e.target.value; render(); });
    $("rfqChipQuote").addEventListener("click", function () { toggleFlag("quoteOverdue"); });
    $("rfqChipAction").addEventListener("click", function () { toggleFlag("actionOverdue"); });
    $("rfqChipReleased").addEventListener("click", function () { state.stage = state.stage === "released" ? "" : "released"; render(); });
    $("rfqChipLost").addEventListener("click", function () { state.showLost = !state.showLost; render(); });
    $("rfqChipUs").addEventListener("click", function () { state.waiting = state.waiting === "us" ? "" : "us"; render(); });
    $("rfqChipCust").addEventListener("click", function () { state.waiting = state.waiting === "customer" ? "" : "customer"; render(); });
    $("rfqFlagClear").addEventListener("click", function () { state.flag = ""; state.stuckStage = ""; state.customerId = ""; render(); });
    stageBar.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".chip[data-stage]") : null;
      if (!b) return;
      state.stage = b.dataset.stage; render();
    });
    panel.addEventListener("click", function (e) {
      var tgt = e.target.closest ? e.target.closest("button") : null;
      if (!tgt) return;
      var host = tgt.closest("[data-id]");
      if (host && tgt.classList.contains("edit")) { openDialog(rfqCol.get(host.dataset.id), null, tgt); return; }
      if (host && (tgt.classList.contains("prev") || tgt.classList.contains("next"))) {
        var r = rfqCol.get(host.dataset.id);
        if (r) stepCard(r, tgt.classList.contains("next") ? 1 : -1);
        return;
      }
      if (tgt.dataset.sort) {
        var k = tgt.dataset.sort;
        state.dir = state.sort === k ? -state.dir : (k === "received" ? -1 : 1);
        state.sort = k; render();
      }
    });
    panel.addEventListener("change", function (e) {
      var sel = e.target;
      if (!sel.classList || !sel.classList.contains("stage-sel")) return;
      var host = sel.closest("[data-id]"), r = host && rfqCol.get(host.dataset.id);
      if (!r) return;
      var to = sel.value, id = r.id;
      moveTo(r, to, "");
      App.flush();
      App.announce("RFQ " + rfqLabel(r) + " moved to " + to + ".");
      var again = root.querySelector('[data-id="' + CSS.escape(id) + '"] .stage-sel');
      if (again) again.focus();
    });
  }
  function sortTh(label, key) {
    return el("th", { scope: "col" }, key ? el("button", { type: "button", dataset: { sort: key }, text: label }) : label);
  }
  function toggleFlag(f) { state.flag = state.flag === f ? "" : f; state.stuckStage = ""; render(); }

  App.registerPanel("rfqs", { label: "RFQs", mount: mount, render: render, show: function (f) { applyFilter(f); }, summary: summary });
  if (window.CrmImport) Object.keys(SPECS).forEach(function (k) { try { CrmImport.register(k, SPECS[k]); } catch (e) { /* already registered */ } });

  window.CrmRfq = {
    STAGES: STAGES, RELEASED: RELEASED, rfqStats: rfqStats,
    stats: function (today) { return rfqStats(rfqCol.all(), histCol.all(), S.customers(), today || S.todayISO()); },
    openNew: openNew, openEdit: openEdit, openImport: openImport, visible: visible, summary: summary
  };
})();
