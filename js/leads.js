/* Leads tab (A9, design section 12.2): prospects and dormant leads, kept apart from customers.
   Part 1 is pure logic (also module.exports for Node unit tests). Part 2 is the browser UI.
   Contract: window.CrmLeads = { BUCKETS, ACTION_CATEGORIES, leadKey, match, createFromImport, isInternal, stats, openNew, openEdit, visible, summary }.
   Leads, their emails and phones live in this browser only (localStorage). They are never written to customers.json.
   Filter keys for App.show("leads", filter): bucket (A|B|C|D|dormant|jv|none), category, fit (sweet|check|regret|none),
   flag (dormant|overdue|today|touched7), q, showClosed. */
(function () {
  "use strict";

  var hasWindow = typeof window !== "undefined";
  var S = hasWindow ? window.Store : require("./store.js");
  var Csv = hasWindow ? window.CrmCsv : require("./csv.js");

  /* ====================================================================== */
  /* Part 1: constants and pure logic                                        */
  /* ====================================================================== */

  var BUCKETS = {
    A: "No response: awaiting them", B: "Response pending from our side", C: "Negative / shelved / stalled: re-pitch",
    D: "Stalled cold-call list", dormant: "Dormant > 6 months (re-engage)", jv: "JV & strategic partnership"
  };
  var BUCKET_KEYS = ["A", "B", "C", "D", "dormant", "jv"];
  var BUCKET_SHORT = { A: "A · Awaiting them", B: "B · Our turn", C: "C · Shelved", D: "D · Cold list", dormant: "Dormant", jv: "JV" };
  var ACTION_CATEGORIES = ["Action Pending (Urgent)", "No Response (Awaiting Data)", "Dormant >6 Mo (High Value)",
                           "JV & Strategic Partnership", "No Positive / Stalled", "Mismatched / Cold"];
  var CATEGORY_TO_BUCKET = { "Action Pending (Urgent)": "B", "No Response (Awaiting Data)": "A", "Dormant >6 Mo (High Value)": "dormant",
                             "JV & Strategic Partnership": "jv", "No Positive / Stalled": "C", "Mismatched / Cold": "D" };
  var PRIORITIES = ["High", "Medium", "Low"];
  var FITS = { sweet: "Sweet spot: closed-die forgings about 2.5–25 kg (3-ton hammer)", check: "Check fit",
               regret: "Fast regret: parts under 1 kg, sheet metal or investment castings" };
  var FIT_SHORT = { sweet: "Sweet spot", check: "Check fit", regret: "Fast regret" };
  var TOUCH_TYPES = ["Call", "Email", "Visit", "Telegram", "Note"];
  var CONTACT_TYPES = ["Call", "Email", "Visit", "Telegram"];
  var DEFAULT_INTERNAL = ["varsha", "kctr", "prima ft", "scm maxility", "tng korea"];
  var DORMANT_DAYS = 183;
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  var EMAIL_RE = /[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/i;
  var PHONE_RE = /\+?\d[\d\s-]{8,}\d/;
  var PHONE_OK = /^[0-9+()\-\s.\/–,;]*$/;
  var LIMITS = { company: 120, contact_name: 80, email: 160, phone: 40, region_program: 120, scope: 300, segment_domain: 120,
                 context: 2000, value_angle: 1000, strategy: 1000, source: 60, closed_reason: 200 };

  function str(v) { return v == null ? "" : String(v).trim(); }
  function lower(s) { return String(s == null ? "" : s).toLowerCase(); }
  function clip(s, n) { s = str(s); return s.length > n ? s.slice(0, n) : s; }
  function squash(s) { return str(s).replace(/\s+/g, " "); }
  function normText(s) { return lower(squash(s)); }
  function realISO(s) {
    if (!ISO.test(s || "")) return false;
    var t = Date.parse(s + "T00:00:00Z");
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }
  function nowISO() { return new Date().toISOString(); }
  function okR(extra) { var r = { ok: true, queued: false }; if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; }); return Promise.resolve(r); }
  function failR(error, field) { return Promise.resolve({ ok: false, error: error, field: field || "" }); }

  /* leadKey: Store.nameKey, with the company-form words at the end removed ("Pvt Ltd", "Private Limited", "Inc", "India"...).
     Done word by word, so a name like "Tesco" is not cut to "Tes". */
  var TRAIL = { pvtltd: 1, privateltd: 1, pvt: 1, "private": 1, ltd: 1, limited: 1, inc: 1, llc: 1, llp: 1, gmbh: 1, coltd: 1, co: 1, corp: 1, india: 1 };
  function leadKey(name) {
    var words = String(name == null ? "" : name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
    var w = words.slice();
    while (w.length > 1 && TRAIL[w[w.length - 1]]) w.pop();
    if (w.length === 1 && TRAIL[w[0]] && words.length > 1) w = words.slice();
    return (w.length ? w : words).join("") || S.nameKey(name);
  }

  /* ---------- internal / related entities ---------- */
  function internalPatterns() {
    var d = S.doc("internal_entities").get();
    if (d && Array.isArray(d.patterns)) return d.patterns.map(function (p) { return lower(str(p)); }).filter(Boolean);
    return DEFAULT_INTERNAL.slice();
  }
  /* Matches a company name, a person text or an email. For an email only the domain counts, so a person who happens to be
     called "Varsha" at a gmail address is not an internal entity. */
  function isInternal(x, pats) {
    pats = pats || internalPatterns();
    var t = str(x);
    if (!t || !pats.length) return false;
    var low = lower(t), emails = low.match(/[^\s<>()]+@[^\s<>()]+/g) || [], rest = low;
    var doms = emails.map(function (e) { return e.slice(e.lastIndexOf("@") + 1); });
    emails.forEach(function (e) { rest = rest.split(e).join(" "); });
    rest = squash(rest);
    return pats.some(function (p) {
      return rest.indexOf(p) !== -1 || doms.some(function (d) { return d.indexOf(p) !== -1; });
    });
  }

  /* ---------- dates ---------- */
  var MONTH_WORD = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i;
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function mkDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return "";
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }
  /* All dates found in a free-text cell ("Aug 26, 2025; follow-up sent", "2026-01-05 / 2026-03-01", "Nov 2024"). */
  function findDates(text) {
    var t = String(text == null ? "" : text), out = [], m, re, y;
    re = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
    while ((m = re.exec(t))) { var a = mkDate(+m[1], +m[2], +m[3]); if (a) out.push(a); }
    re = /(^|[^\d-])(\d{1,2})[\/.](\d{1,2})[\/.](\d{4}|\d{2})(?!\d)/g;
    while ((m = re.exec(t))) { y = m[4].length === 2 ? 2000 + (+m[4]) : +m[4]; var b = mkDate(y, +m[3], +m[2]); if (b) out.push(b); }
    re = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.]*([A-Za-z]{3,9})[\s\-.,]*(\d{4}|\d{2})\b/g;
    while ((m = re.exec(t))) {
      if (!MONTH_WORD.test(m[2])) continue;
      y = m[3].length === 2 ? 2000 + (+m[3]) : +m[3];
      var c = mkDate(y, MON[m[2].slice(0, 3).toLowerCase()], +m[1]); if (c) out.push(c);
    }
    re = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;
    while ((m = re.exec(t))) {
      if (!MONTH_WORD.test(m[1])) continue;
      var d2 = mkDate(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]); if (d2) out.push(d2);
    }
    if (!out.length) {
      re = /\b([A-Za-z]{3,9})\.?[\s\-–,]+(\d{4})\b/g;
      while ((m = re.exec(t))) {
        if (!MONTH_WORD.test(m[1])) continue;
        var e = mkDate(+m[2], MON[m[1].slice(0, 3).toLowerCase()], 1); if (e) out.push(e);
      }
    }
    return out;
  }
  /* -> { value: ISO or "", issue: "" | "unparsed" | "multiple" | "future" }. Never an error: the original text is kept by the caller. */
  function parseLeadDate(text, today) {
    var t = str(text);
    if (!t) return { value: "", issue: "" };
    var v = "", issue = "";
    var p = Csv.parseDate(t);
    if (p.ok && p.value) v = p.value;
    else {
      var all = findDates(t).sort();
      if (!all.length) return { value: "", issue: "unparsed" };
      v = all[all.length - 1];
      if (all.filter(function (x, i) { return all.indexOf(x) === i; }).length > 1) issue = "multiple";
    }
    if (today && v > today) return { value: "", issue: "future" };
    return { value: v, issue: issue };
  }

  /* ---------- contacts ---------- */
  function cleanEmail(e) { return str(e).replace(/^[,;:"'\[\]]+|[,;:"'\[\]]+$/g, ""); }
  function cleanPhone(p) { return squash(p).replace(/^[,;:]+|[,;:]+$/g, ""); }
  /* "Jane Roe (jane@x.com)" -> { name: "Jane Roe", email: "jane@x.com", phone: "" }. Phone is only read when asked. */
  function splitContact(text, withPhone) {
    var t = String(text == null ? "" : text), email = "", phone = "";
    var m = EMAIL_RE.exec(t);
    if (m) { email = cleanEmail(m[0]); t = t.replace(m[0], " "); }
    if (withPhone) {
      var pm = PHONE_RE.exec(t);
      if (pm) { phone = cleanPhone(pm[0]); t = t.replace(pm[0], " "); }
    }
    t = t.replace(/\(\s*\)|<\s*>|\[\s*\]/g, " ").replace(/\b(e-?mail|phone|mobile|tel|contact)\s*:/gi, " ");
    t = squash(t).replace(/^[\s,;:\/|<>()\-–]+|[\s,;:\/|<>()\-–]+$/g, "");
    return { name: t, email: email, phone: phone };
  }

  /* ---------- bucket and category rules ---------- */
  var RULES = [
    ["A", /awaiting|no response|no reply|follow.?up sent|reminder sent/i],
    ["B", /pending (action )?(from )?(us|our|internal)\b|to send|to prepare|to quote|we owe/i],
    ["C", /regret|declin|negative|shelved|stalled|on hold|not interested/i],
    ["D", /cold call|cold/i],
    ["jv", /\bjv\b|joint venture|partnership|strategic/i]
  ];
  function bucketFromStatus(text) {
    var t = String(text == null ? "" : text);
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(t)) return RULES[i][0];
    return "";
  }
  /* Fuzzy match of a sheet's category text to one of the six categories ("Action Pending" -> "Action Pending (Urgent)"). */
  function matchCategory(text) {
    var n = Csv.normHeader(text);
    if (!n) return "";
    var i;
    for (i = 0; i < ACTION_CATEGORIES.length; i++) if (Csv.normHeader(ACTION_CATEGORIES[i]) === n) return ACTION_CATEGORIES[i];
    for (i = 0; i < ACTION_CATEGORIES.length; i++) {
      var c = Csv.normHeader(ACTION_CATEGORIES[i]);
      if (n.length >= 5 && (c.indexOf(n) === 0 || n.indexOf(c) === 0)) return ACTION_CATEGORIES[i];
    }
    return "";
  }
  function priorityFrom(text) {
    var t = lower(text);
    if (/high|urgent|critical/.test(t)) return "High";
    if (/med|normal/.test(t)) return "Medium";
    if (/low/.test(t)) return "Low";
    return "";
  }
  var NOT_LEAD_RE = /\b(bank|banking|loan|insurance|salary|payroll|personal|income tax|gst|tax|credit card|mutual fund|emi|passport|visa|school|college|hospital|clinic|rent|landlord|electricity|recharge)\b/i;
  function looksNotLead(d) { return NOT_LEAD_RE.test([d.company, d.contact_name, d.scope].join(" ")); }

  /* ---------- the six import formats ---------- */
  var SHEETS = {
    hub_dormant: { label: "Hub: Dormant Leads (>6 Months)", short: "Hub dormant" },
    reengage: { label: "Tracker: Dormant Re-Engagement (>6M)", short: "Re-engagement tracker" },
    pending: { label: "Tracker: Pending & Follow-Up Tracker", short: "Pending tracker" },
    dormant_old: { label: "Tracker: Dormant Leads (>6M)", short: "Dormant tracker" },
    recent: { label: "Tracker: Recent Status & Pending", short: "Recent status" },
    matrix: { label: "Prospect matrix", short: "Prospect matrix" }
  };
  function f(key, label, required, synonyms) { return { key: "f_" + key, label: label, required: !!required, synonyms: synonyms || [], type: "text" }; }
  var SPEC_FIELDS = {
    hub_dormant: [f("ref", "Lead ID"), f("company", "Organization", true, ["Organisation"]), f("segment", "Segment / Domain"), f("contact", "Key Contact & Email"),
                  f("date", "Date of Last Contact", true), f("context", "Historical Context"), f("angle", "Value Proposition / Angle"), f("strategy", "Recommended Outreach Action")],
    reengage: [f("company", "Company", true), f("contact", "Contact"), f("scope", "Requirement"), f("date", "Last Date", true), f("status", "Status"),
               f("angle", "Re-engagement Rationale"), f("strategy", "Action Plan")],
    pending: [f("company", "Company", true), f("contact", "Contact"), f("ref", "Thread ID"), f("date", "Date", true), f("status", "Status"), f("scope", "Scope")],
    dormant_old: [f("company", "Customer / Company", true), f("contact", "Key Contact"), f("emailphone", "Email / Phone"), f("scope", "Component / Scope"),
                  f("date", "Last Interaction Date", true), f("status", "Past Status"), f("strategy", "Outreach / Cold Call Strategy")],
    recent: [f("category", "Category"), f("company", "Counterparty / Entity", true), f("contact", "Contact / Sender"), f("scope", "Subject / Key Requirement"),
             f("date", "Interaction Date", true), f("urgency", "Urgency"), f("strategy", "Action Required / Next Step")],
    matrix: [f("company", "Company Name", true), f("contact", "Key Contact & Details"), f("region", "Region/Program"), f("scope", "Scope/Component Requirement"),
             f("date", "Historical Status/Last Date", true), f("category", "CRM Action Category"), f("strategy", "Recommended Strategy & Next Step")]
  };
  var SPEC_ORDER = ["hub_dormant", "reengage", "pending", "dormant_old", "recent", "matrix"];

  function blankDraft(key, o) {
    return { sheetKey: key, sheet: SHEETS[key].short, ref: "", company: clip(squash(o.f_company), LIMITS.company), contact_name: "", email: "", phone: "",
             region_program: "", scope: "", segment_domain: "", last_contact: "", context: "", value_angle: "", strategy: "", bucket: "", action_category: "",
             priority: "", bucket_guessed: false, dateIssue: "", row: o.row || 0 };
  }
  function addCtx(d, text) { text = str(text); if (text) d.context = d.context ? d.context + " | " + text : text; }
  function setDate(d, text, today, keepText) {
    var p = parseLeadDate(text, today);
    d.last_contact = p.value;
    d.dateIssue = p.issue;
    if (p.issue && str(text) && !keepText) addCtx(d, "Last contact (text): " + squash(text));
  }
  function setContact(d, text, withPhone) {
    var c = splitContact(text, withPhone);
    d.contact_name = clip(c.name, LIMITS.contact_name); if (c.email) d.email = clip(c.email, LIMITS.email); if (c.phone) d.phone = clip(c.phone, LIMITS.phone);
  }
  /* o = a typed row from CrmImport (keys f_*). Returns a staged draft. Guessed values are flagged bucket_guessed. */
  function mapRow(key, o, today) {
    var d = blankDraft(key, o), cat, st;
    d.ref = clip(o.f_ref, 60);
    switch (key) {
      case "hub_dormant":
        d.segment_domain = clip(o.f_segment, LIMITS.segment_domain);
        setContact(d, o.f_contact, false);
        setDate(d, o.f_date, today);
        addCtx(d, o.f_context);
        d.value_angle = clip(o.f_angle, LIMITS.value_angle); d.strategy = clip(o.f_strategy, LIMITS.strategy);
        d.bucket = "dormant"; d.action_category = "Dormant >6 Mo (High Value)"; d.bucket_guessed = true;
        break;
      case "reengage":
        setContact(d, o.f_contact, false);
        d.scope = clip(o.f_scope, LIMITS.scope);
        st = str(o.f_status);
        if (st) addCtx(d, "Status: " + squash(st));
        setDate(d, o.f_date, today);
        d.value_angle = clip(o.f_angle, LIMITS.value_angle); d.strategy = clip(o.f_strategy, LIMITS.strategy);
        d.bucket = bucketFromStatus(st) || "dormant"; d.bucket_guessed = true;
        break;
      case "pending":
        setContact(d, o.f_contact, false);
        d.scope = clip(o.f_scope, LIMITS.scope);
        st = str(o.f_status);
        if (st) addCtx(d, "Status: " + squash(st));
        setDate(d, o.f_date, today);
        d.bucket = bucketFromStatus(st); d.bucket_guessed = !!d.bucket;
        break;
      case "dormant_old":
        setContact(d, o.f_contact, false);
        var ep = splitContact(o.f_emailphone, true);
        if (ep.email) d.email = clip(ep.email, LIMITS.email);
        if (ep.phone) d.phone = clip(ep.phone, LIMITS.phone);
        d.scope = clip(o.f_scope, LIMITS.scope);
        setDate(d, o.f_date, today);
        addCtx(d, o.f_status);
        d.strategy = clip(o.f_strategy, LIMITS.strategy);
        d.bucket = "dormant"; d.bucket_guessed = true;
        break;
      case "recent":
        cat = matchCategory(o.f_category);
        if (cat) d.action_category = cat; else if (str(o.f_category)) addCtx(d, "Category: " + squash(o.f_category));
        setContact(d, o.f_contact, false);
        d.scope = clip(o.f_scope, LIMITS.scope);
        setDate(d, o.f_date, today);
        d.priority = priorityFrom(o.f_urgency);
        d.strategy = clip(o.f_strategy, LIMITS.strategy);
        d.bucket = (cat && CATEGORY_TO_BUCKET[cat]) || bucketFromStatus(o.f_category); d.bucket_guessed = !!d.bucket;
        break;
      case "matrix":
        var lines = String(o.f_contact == null ? "" : o.f_contact).split(/\r?\n/).map(squash).filter(Boolean);
        var cd = splitContact(lines.join("\n"), true);
        var nameLine = lines.filter(function (ln) { return !EMAIL_RE.test(ln) && !PHONE_RE.test(ln) && /[A-Za-z]/.test(ln); })[0] || cd.name;
        d.contact_name = clip(squash(nameLine), LIMITS.contact_name); d.email = clip(cd.email, LIMITS.email); d.phone = clip(cd.phone, LIMITS.phone);
        d.region_program = clip(o.f_region, LIMITS.region_program); d.scope = clip(o.f_scope, LIMITS.scope);
        st = str(o.f_date);
        if (st) addCtx(d, "Status: " + squash(st));
        setDate(d, st, today, true);
        cat = matchCategory(o.f_category);
        if (cat) { d.action_category = cat; d.bucket = CATEGORY_TO_BUCKET[cat]; d.bucket_guessed = true; }
        else if (str(o.f_category)) addCtx(d, "Category: " + squash(o.f_category));
        d.strategy = clip(o.f_strategy, LIMITS.strategy);
        break;
    }
    d.context = clip(d.context, LIMITS.context);
    return d;
  }
  function draftInternal(d, pats) {
    pats = pats || internalPatterns();
    return isInternal(d.company, pats) || isInternal(d.contact_name, pats) || isInternal(d.email, pats);
  }

  /* ---------- lead records ---------- */
  function norm(r) {
    var o = Object.assign({ company: "", contact_name: "", email: "", phone: "", region_program: "", scope: "", segment_domain: "", last_contact: "",
      context: "", value_angle: "", strategy: "", next_follow_up: "", bucket: "", action_category: "", bucket_guessed: false, priority: "", fit: "",
      source: "Manual", sources: [], status: "Open", closed_reason: "", converted_customer_id: "", converted_rfq_ids: [] }, r);
    if (!o.status) o.status = "Open";
    o.company_key = o.company_key || leadKey(o.company);
    return o;
  }
  function leadsCol() { return S.col("leads"); }
  function allLeads() { return leadsCol().all().map(norm); }
  function getLead(id) { var r = leadsCol().get(id); return r ? norm(r) : null; }
  function matchLead(name) {
    var k = leadKey(name);
    if (!k || isInternal(name)) return null;
    var hit = null;
    allLeads().forEach(function (l) { if (l.company_key === k && (!hit || (hit.status !== "Open" && l.status === "Open"))) hit = l; });
    return hit;
  }
  /* A customer that is the same company as `name` (exact/alias/nameKey via Store, or the same leadKey). */
  function customerFor(name) {
    var m = S.matchCustomer(name);
    if (m) return m;
    var k = leadKey(name), hit = "";
    if (!k) return "";
    S.customers().forEach(function (c) { if (!hit && leadKey(c.name) === k) hit = c.id; });
    return hit;
  }
  function dormantInfo(l, today) {
    if ((l.status || "Open") !== "Open") return null;
    var days = l.last_contact ? S.daysBetween(l.last_contact, today) : null;
    var byDate = days === null || days >= DORMANT_DAYS;
    if (!byDate && l.bucket !== "dormant") return null;
    var months = days === null ? null : Math.floor(days / 30.4375);
    var label = days === null ? "Dormant (no contact on record)" : byDate ? "Dormant " + months + " month" + (months === 1 ? "" : "s") : "Dormant";
    return { days: days, months: months, label: label };
  }
  function lastTouchMap() {
    var m = {};
    S.allLog().forEach(function (e) { if (e.leadId && (!m[e.leadId] || e.at > m[e.leadId])) m[e.leadId] = e.at; });
    return m;
  }

  function validateLead(fv, id) {
    var pats = internalPatterns(), today = S.todayISO();
    function bad(msg, field) { return { ok: false, error: msg, field: field }; }
    var company = squash(fv.company);
    if (!company) return bad("Enter the company name.", "company");
    if (company.length > LIMITS.company) return bad("Company name can have " + LIMITS.company + " characters at most.", "company");
    if (isInternal(company, pats) || isInternal(fv.email, pats)) return bad(company + " is an internal or related company and is not tracked as a lead.", "company");
    var key = leadKey(company);
    if (allLeads().some(function (l) { return l.id !== id && l.company_key === key; })) return bad(company + " is already in the leads list.", "company");
    var out = { company: company, company_key: key };
    var txt = ["contact_name", "email", "phone", "region_program", "scope", "segment_domain", "context", "value_angle", "strategy", "source"];
    for (var i = 0; i < txt.length; i++) {
      var k = txt[i], v = k === "context" || k === "value_angle" || k === "strategy" ? str(fv[k]) : squash(fv[k]);
      if (v.length > LIMITS[k]) return bad(k.replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }) + " can have " + LIMITS[k] + " characters at most.", k);
      out[k] = v;
    }
    if (out.email && !/@/.test(out.email)) return bad("That email address does not look right.", "email");
    if (!PHONE_OK.test(out.phone)) return bad("Phone can only have digits and + ( ) - . /", "phone");
    ["last_contact", "next_follow_up"].forEach(function (k) { out[k] = str(fv[k]); });
    if (out.last_contact && !realISO(out.last_contact)) return bad("Last contact is not a valid date.", "last_contact");
    if (out.last_contact && out.last_contact > today) return bad("Last contact can't be in the future.", "last_contact");
    if (out.next_follow_up && !realISO(out.next_follow_up)) return bad("Next follow-up is not a valid date.", "next_follow_up");
    out.bucket = str(fv.bucket);
    if (out.bucket && BUCKET_KEYS.indexOf(out.bucket) === -1) return bad("Pick a bucket from the list.", "bucket");
    out.action_category = str(fv.action_category);
    if (out.action_category && ACTION_CATEGORIES.indexOf(out.action_category) === -1) return bad("Pick an action category from the list.", "action_category");
    out.priority = str(fv.priority);
    if (out.priority && PRIORITIES.indexOf(out.priority) === -1) return bad("Pick a priority from the list.", "priority");
    out.fit = str(fv.fit);
    if (out.fit && !FITS[out.fit]) return bad("Pick a fit from the list.", "fit");
    if (!out.source) out.source = "Manual";
    return { ok: true, row: out };
  }

  /* ---------- merge (several staged rows and an existing lead -> one lead) ---------- */
  var SINGLE = ["company", "contact_name", "email", "phone", "region_program", "scope", "segment_domain", "last_contact", "bucket", "action_category", "priority"];
  var JOINED = { context: LIMITS.context, strategy: LIMITS.strategy, value_angle: LIMITS.value_angle };
  var FIELD_LABEL = { company: "Company", contact_name: "Key contact", email: "Email", phone: "Phone", region_program: "Region / program", scope: "Scope",
                      segment_domain: "Segment / domain", last_contact: "Last contact", bucket: "Bucket", action_category: "Action category", priority: "Priority",
                      context: "Context", strategy: "Strategy", value_angle: "Value / angle" };

  function sortNewest(list) {
    return list.map(function (m, i) { return { m: m, i: i }; }).sort(function (a, b) {
      var x = a.m.last_contact || "", y = b.m.last_contact || "";
      if (x === y) return a.i - b.i;
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? 1 : -1;
    }).map(function (o) { return o.m; });
  }
  function rowFromLead(l) {
    var r = {}; SINGLE.concat(Object.keys(JOINED)).forEach(function (k) { r[k] = l[k] || ""; });
    r.sheet = "Existing lead"; r.bucket_guessed = !!l.bucket_guessed; r.dateIssue = ""; r.isExisting = true;
    return r;
  }
  /* members: staged drafts; existing: a lead or null. Returns the options per field and the default values. */
  function mergeGroup(members, existing) {
    var cand = [];
    if (existing) cand.push(rowFromLead(existing));
    sortNewest(members).forEach(function (r) { cand.push(r); });
    var g = { fields: {}, sheets: [], existing: existing || null, issues: { date: false, guessed: false, conflicts: 0 } };
    cand.forEach(function (r) { if (g.sheets.indexOf(r.sheet) === -1) g.sheets.push(r.sheet); if (r.dateIssue) g.issues.date = true; });
    SINGLE.forEach(function (k) {
      var opts = [], seen = {};
      cand.forEach(function (r) {
        var v = str(r[k]); if (!v) return;
        var key = normText(v), o = seen[key];
        if (o) { if (o.from.indexOf(r.sheet) === -1) o.from.push(r.sheet); if (k === "bucket" && r.bucket_guessed) o.guessed = true; }
        else { o = { value: v, from: [r.sheet], guessed: k === "bucket" ? !!r.bucket_guessed : false }; seen[key] = o; opts.push(o); }
      });
      if (k === "last_contact") opts.sort(function (a, b) { return a.value < b.value ? 1 : -1; });
      g.fields[k] = { options: opts, def: 0 };
      if (opts.length > 1) g.issues.conflicts++;
    });
    Object.keys(JOINED).forEach(function (k) {
      var parts = [];
      cand.forEach(function (r) {
        var v = str(r[k]); if (!v) return;
        var key = normText(v), all = parts.map(function (p) { return p.key; }).join(" | ");
        var dup = null;
        parts.forEach(function (p) { if (p.key === key) dup = p; });
        if (dup) { if (dup.from.indexOf(r.sheet) === -1) dup.from.push(r.sheet); return; }
        if (all.indexOf(key) !== -1) return;
        parts.push({ value: v, key: key, from: [r.sheet] });
      });
      g.fields[k] = { options: parts, joined: parts.map(function (p) { return p.value; }).join(" | ").slice(0, JOINED[k]), def: -1 };
      if (parts.length > 1) g.issues.conflicts++;
    });
    g.issues.guessed = !!(g.fields.bucket.options[0] && g.fields.bucket.options[0].guessed);
    return g;
  }
  /* sel: { field: option index } (-1 = join all, for the joined fields). Missing = the default. */
  function resolve(g, sel) {
    sel = sel || {};
    var v = {};
    SINGLE.forEach(function (k) {
      var fo = g.fields[k], i = sel[k] != null ? sel[k] : fo.def, o = fo.options[i];
      v[k] = o ? o.value : "";
      if (k === "bucket") v.bucket_guessed = !!(o && o.guessed);
    });
    Object.keys(JOINED).forEach(function (k) {
      var fo = g.fields[k], i = sel[k] != null ? sel[k] : -1;
      v[k] = i === -1 ? fo.joined : (fo.options[i] ? fo.options[i].value : "");
    });
    // other contact names (never their addresses) go to the context, as the design says
    var cn = g.fields.contact_name, ci = sel.contact_name != null ? sel.contact_name : cn.def;
    var others = cn.options.filter(function (o, i) { return i !== ci; }).map(function (o) { return o.value; });
    if (others.length) {
      var add = "Other contacts: " + others.join(", ");
      if (normText(v.context).indexOf(normText(add)) === -1) v.context = clip(v.context ? v.context + " | " + add : add, JOINED.context);
    }
    return v;
  }
  function srcList(members, existing) {
    var out = [], seen = {};
    function add(s) {
      var k = s.sheet + "\u0001" + (s.ref || "");
      if (seen[k]) return;
      seen[k] = 1; out.push({ sheet: clip(s.sheet, 40), ref: clip(s.ref, 60), importedAt: s.importedAt || nowISO() });
    }
    if (existing) (existing.sources || []).forEach(add);
    members.forEach(function (m) { add({ sheet: m.sheet, ref: m.ref, importedAt: m.importedAt }); });
    return out.slice(0, 10);
  }
  function distinctNames(members) {
    var seen = {}, out = [];
    members.forEach(function (m) { var k = normText(m.company); if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
  }
  /* Groups staged rows by company key. `split` = { key: true } turns one group into one card per distinct original name.
     Each card: { id, key, members, existing, customerId, notLead, names }. */
  function buildCards(rows, leads, customers, split) {
    split = split || {};
    var groups = {}, order = [];
    rows.forEach(function (r) {
      var k = leadKey(r.company);
      if (!k) return;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(r);
    });
    function existingFor(members, key, nameKey) {
      var hit = null;
      leads.forEach(function (l) {
        if (hit && hit.status === "Open") return;
        var byRef = members.some(function (m) { return m.ref && (l.sources || []).some(function (s) { return s.sheet === m.sheet && s.ref === m.ref; }); });
        var byKey = l.company_key === key && (nameKey == null || normText(l.company) === nameKey);
        if (byRef || byKey) { if (!hit || l.status === "Open") hit = l; }
      });
      return hit;
    }
    var cards = [];
    order.forEach(function (k) {
      var members = groups[k], names = distinctNames(members);
      if (split[k] && names.length > 1) {
        names.forEach(function (n, i) {
          var part = members.filter(function (m) { return normText(m.company) === n; });
          var ex = existingFor(part, k, n);
          cards.push({ id: k + "#" + i, key: k, members: part, existing: ex, names: [n], splitPart: true });
        });
      } else {
        cards.push({ id: k, key: k, members: members, existing: existingFor(members, k, null), names: names, splitPart: false });
      }
    });
    cards.forEach(function (c) {
      c.customerId = customerFor(c.members[0].company) || "";
      c.notLead = c.members.some(looksNotLead);
    });
    cards.sort(function (a, b) { return a.members[0].company.toLowerCase().localeCompare(b.members[0].company.toLowerCase()); });
    return cards;
  }

  /* ---------- store operations ---------- */
  function newRecord(v, extra) {
    var r = {
      company: v.company, company_key: leadKey(v.company), contact_name: v.contact_name || "", email: v.email || "", phone: v.phone || "",
      region_program: v.region_program || "", scope: v.scope || "", segment_domain: v.segment_domain || "", last_contact: v.last_contact || "",
      context: v.context || "", value_angle: v.value_angle || "", strategy: v.strategy || "", next_follow_up: v.next_follow_up || "",
      bucket: v.bucket || "", action_category: v.action_category || "", bucket_guessed: !!v.bucket_guessed && !!v.bucket, priority: v.priority || "",
      fit: v.fit || "", source: v.source || "Manual", sources: [], status: "Open", closed_reason: "", converted_customer_id: "", converted_rfq_ids: []
    };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }
  function fromMerge(v, g, c) {
    var rec = {
      company: clip(v.company, LIMITS.company), contact_name: clip(v.contact_name, LIMITS.contact_name), email: clip(v.email, LIMITS.email),
      phone: clip(v.phone, LIMITS.phone), region_program: clip(v.region_program, LIMITS.region_program), scope: clip(v.scope, LIMITS.scope),
      segment_domain: clip(v.segment_domain, LIMITS.segment_domain), last_contact: v.last_contact || "", context: clip(v.context, LIMITS.context),
      value_angle: clip(v.value_angle, LIMITS.value_angle), strategy: clip(v.strategy, LIMITS.strategy), bucket: v.bucket || "",
      action_category: v.action_category || "", priority: v.priority || "", bucket_guessed: !!v.bucket && !!v.bucket_guessed
    };
    rec.company_key = leadKey(rec.company);
    rec.sources = srcList(c.members, c.existing);
    return rec;
  }
  function createFromImport(fv) {
    fv = fv || {};
    var company = squash(fv.company);
    if (!company) return failR("Enter the company name.", "company");
    if (isInternal(company) || isInternal(fv.email)) return failR(company + " is an internal or related company and is not tracked as a lead.", "company");
    var ex = matchLead(company);
    if (ex) return okR({ id: ex.id, existed: true });
    var lc = str(fv.last_contact);
    var rec = newRecord({
      company: clip(company, LIMITS.company), contact_name: clip(squash(fv.contact_name), LIMITS.contact_name), email: clip(fv.email, LIMITS.email),
      scope: clip(squash(fv.scope), LIMITS.scope), last_contact: realISO(lc) && lc <= S.todayISO() ? lc : "", source: clip(squash(fv.source) || "Imported", LIMITS.source)
    });
    return leadsCol().insert(rec).then(function (r) { return r.ok ? { ok: true, queued: false, id: r.row.id, existed: false } : r; });
  }

  /* ---------- stats and filters (shared by the Dashboard, the report and the tab) ---------- */
  function stats(today) {
    today = today || S.todayISO();
    var touch = lastTouchMap();
    var out = { open: 0, byBucket: { A: 0, B: 0, C: 0, D: 0, dormant: 0, jv: 0, none: 0 }, dormant: 0, followOverdue: 0, followToday: 0, touched7: 0, converted30: 0, reactivate: [] };
    var dorm = [];
    allLeads().forEach(function (l) {
      if (l.status === "Converted") {
        if (l.converted_at && S.daysBetween(l.converted_at, today) >= 0 && S.daysBetween(l.converted_at, today) <= 30) out.converted30++;
        return;
      }
      if (l.status !== "Open") return;
      out.open++;
      out.byBucket[l.bucket && BUCKETS[l.bucket] ? l.bucket : "none"]++;
      if (l.next_follow_up) {
        var d = S.daysBetween(today, l.next_follow_up);
        if (d < 0) out.followOverdue++; else if (d === 0) out.followToday++;
      }
      if (touch[l.id] && S.daysBetween(touch[l.id], today) <= 7) out.touched7++;
      if (dormantInfo(l, today)) { out.dormant++; dorm.push(l); }
    });
    dorm.sort(function (a, b) {
      var ha = a.action_category === "Dormant >6 Mo (High Value)" ? 0 : 1, hb = b.action_category === "Dormant >6 Mo (High Value)" ? 0 : 1;
      if (ha !== hb) return ha - hb;
      var x = a.last_contact || "9999-99-99", y = b.last_contact || "9999-99-99";
      if (x !== y) return x < y ? -1 : 1;
      return a.company.toLowerCase().localeCompare(b.company.toLowerCase());
    });
    out.reactivate = dorm.slice(0, 10).map(function (l) { return { id: l.id, company: l.company, lastContact: l.last_contact, category: l.action_category }; });
    return out;
  }
  var FILTER_FLAGS = ["dormant", "overdue", "today", "touched7"];
  var FILTER_FITS = ["sweet", "check", "regret", "none"];
  function cleanFilter(f) {
    f = f && typeof f === "object" ? f : {};
    var out = { bucket: "", category: "", fit: "", flag: "", q: "", showClosed: false };
    if (f.bucket === "none" || BUCKET_KEYS.indexOf(f.bucket) !== -1) out.bucket = f.bucket;
    if (f.category === "none" || ACTION_CATEGORIES.indexOf(f.category) !== -1) out.category = f.category;
    if (FILTER_FITS.indexOf(f.fit) !== -1) out.fit = f.fit;
    if (FILTER_FLAGS.indexOf(f.flag) !== -1) out.flag = f.flag;
    if (typeof f.q === "string") out.q = f.q;
    out.showClosed = f.showClosed === true;
    return out;
  }
  function passesFilter(l, flt, today, touch) {
    if (flt.bucket) { if (flt.bucket === "none" ? l.bucket : l.bucket !== flt.bucket) return false; }
    if (flt.category) { if (flt.category === "none" ? l.action_category : l.action_category !== flt.category) return false; }
    if (flt.fit) { if (flt.fit === "none" ? l.fit : l.fit !== flt.fit) return false; }
    if (flt.flag) {
      var open = l.status === "Open";
      if (flt.flag === "dormant") { if (!dormantInfo(l, today)) return false; }
      else if (flt.flag === "overdue") { if (!(open && l.next_follow_up && l.next_follow_up < today)) return false; }
      else if (flt.flag === "today") { if (!(open && l.next_follow_up === today)) return false; }
      else if (flt.flag === "touched7") { if (!(touch[l.id] && S.daysBetween(touch[l.id], today) <= 7)) return false; }
    }
    var q = str(flt.q).toLowerCase();
    if (q) {
      var hay = [l.company, l.contact_name, l.scope, l.segment_domain, l.region_program].join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }
  function sortLeads(list, today) {
    list.sort(function (a, b) {
      var oa = a.status === "Open" ? 0 : 1, ob = b.status === "Open" ? 0 : 1;
      if (oa !== ob) return oa - ob;
      var ova = a.status === "Open" && a.next_follow_up && a.next_follow_up < today ? 0 : 1;
      var ovb = b.status === "Open" && b.next_follow_up && b.next_follow_up < today ? 0 : 1;
      if (ova !== ovb) return ova - ovb;
      var x = a.next_follow_up || "9999-99-99", y = b.next_follow_up || "9999-99-99";
      if (x !== y) return x < y ? -1 : 1;
      return a.company.toLowerCase().localeCompare(b.company.toLowerCase());
    });
    return list;
  }
  var current = cleanFilter(null);      // the filter the tab is showing (the tab keeps it up to date)
  function visible() {
    var today = S.todayISO(), touch = lastTouchMap();
    return sortLeads(allLeads().filter(function (l) { return (current.showClosed || l.status === "Open") && passesFilter(l, current, today, touch); }), today);
  }
  function summary() {
    var all = allLeads().filter(function (l) { return current.showClosed || l.status === "Open"; });
    return "Showing " + visible().length + " of " + all.length + " lead" + (all.length === 1 ? "" : "s") + ".";
  }

  var CrmLeads = {
    BUCKETS: BUCKETS, ACTION_CATEGORIES: ACTION_CATEGORIES, leadKey: leadKey,
    match: function (name) { var l = matchLead(name); return l ? l.id : null; },
    createFromImport: createFromImport, isInternal: function (x) { return isInternal(x); },
    stats: stats, visible: visible, summary: summary,
    // internals, exported for the Node unit tests only (not part of the contract)
    _: {
      internalPatterns: internalPatterns, DEFAULT_INTERNAL: DEFAULT_INTERNAL, bucketFromStatus: bucketFromStatus, matchCategory: matchCategory,
      parseLeadDate: parseLeadDate, findDates: findDates, splitContact: splitContact, mapRow: mapRow, draftInternal: draftInternal, dormantInfo: dormantInfo,
      mergeGroup: mergeGroup, resolve: resolve, buildCards: buildCards, validateLead: validateLead, norm: norm, looksNotLead: looksNotLead,
      SPEC_FIELDS: SPEC_FIELDS, SPEC_ORDER: SPEC_ORDER, SHEETS: SHEETS, fromMerge: fromMerge, newRecord: newRecord, cleanFilter: cleanFilter,
      passesFilter: passesFilter, sortLeads: sortLeads, lastTouchMap: lastTouchMap, customerFor: customerFor, setCurrent: function (f) { current = cleanFilter(f); }
    }
  };

  if (!hasWindow) {
    if (typeof module !== "undefined" && module.exports) module.exports = CrmLeads;
    return;
  }

  /* ====================================================================== */
  /* Part 2: the Leads tab (browser only)                                    */
  /* ====================================================================== */

  var el = Ui.el;
  var $ = function (id) { return document.getElementById(id); };
  var state = cleanFilter(null);
  var rootEl = null;
  var dlgs = {};                       // lazily built dialogs

  function loadState() { state = cleanFilter(App.view("leads")); current = state; }
  function saveState() { App.setView("leads", state); }
  function setFilter(f) { state = cleanFilter(f); current = state; }
  function ago(iso, today) {
    var d = S.daysBetween(iso, today);
    if (d < 0) return "in " + (-d) + (d === -1 ? " day" : " days");
    if (d === 0) return "today";
    if (d === 1) return "yesterday";
    if (d < 60) return d + " days ago";
    var m = Math.floor(d / 30.4375);
    if (m < 24) return m + " months ago";
    var y = Math.floor(m / 12);
    return y + " years ago";
  }
  function note(text, kind) { App.notice(text, kind || "info"); }
  function telHref(p) { return "tel:" + String(p).replace(/[^\d+]/g, ""); }
  function firstEmail(e) { var m = EMAIL_RE.exec(String(e || "")); return m ? cleanEmail(m[0]) : ""; }

  /* ---------- the table ---------- */
  function cell(tr, label, klass) { var td = el("td", { dataset: { label: label }, class: klass || null }); tr.appendChild(td); return td; }
  function textOrDash(td, v) { if (v) td.textContent = v; else { td.textContent = "—"; td.classList.add("nil"); } }
  function rfqLinks() {
    var m = {};
    S.col("rfqs").all().forEach(function (r) { if (r.lead_id) (m[r.lead_id] = m[r.lead_id] || []).push(r.id); });
    return m;
  }

  function buildRow(l, today, links) {
    var open = l.status === "Open";
    var kind = open && l.next_follow_up ? S.fuKind({ followUp: l.next_follow_up }, today) : "none";
    var tr = el("tr", { class: (kind === "overdue" ? "lead-over" : "") + (open ? "" : " lead-closed"), dataset: { id: l.id } });

    var c = cell(tr, "Company", "lname");
    c.appendChild(el("span", { class: "lco", text: l.company }));
    var badges = el("div", { class: "lbadges" });
    if (l.fit) badges.appendChild(el("span", { class: "lbadge fit-" + l.fit, title: FITS[l.fit], text: FIT_SHORT[l.fit] }));
    var dm = dormantInfo(l, today);
    if (dm) badges.appendChild(el("span", { class: "lbadge dorm", text: dm.label }));
    if (l.priority === "High") badges.appendChild(el("span", { class: "lbadge prio", text: "High priority" }));
    if (l.status === "Converted") badges.appendChild(el("span", { class: "lbadge done", text: "Converted" }));
    if (l.status === "Closed") badges.appendChild(el("span", { class: "lbadge done", title: l.closed_reason || "", text: "Closed" }));
    var nr = (links[l.id] || []).length;
    if (nr) badges.appendChild(el("span", { class: "lbadge", text: nr + (nr === 1 ? " RFQ" : " RFQs") }));
    if (badges.childNodes.length) c.appendChild(badges);

    var ct = cell(tr, "Key contact", "lcontact");
    if (l.contact_name) ct.appendChild(el("div", { class: "lcname", text: l.contact_name }));
    var em = firstEmail(l.email), acts = el("div", { class: "lmini" });
    if (em) acts.appendChild(el("a", { class: "btn-sm", href: "mailto:" + encodeURI(em), title: em, "aria-label": "Email " + (l.contact_name || l.company), text: "Email" }));
    if (l.phone) acts.appendChild(el("a", { class: "btn-sm", href: telHref(l.phone), title: l.phone, "aria-label": "Call " + (l.contact_name || l.company), text: "Call" }));
    if (acts.childNodes.length) ct.appendChild(acts);
    if (!l.contact_name && !acts.childNodes.length) { ct.textContent = "—"; ct.classList.add("nil"); }

    textOrDash(cell(tr, "Segment / domain"), l.segment_domain);
    textOrDash(cell(tr, "Scope", "lscope"), l.scope);
    textOrDash(cell(tr, "Region / program"), l.region_program);

    var lc = cell(tr, "Last contact");
    if (l.last_contact) {
      lc.appendChild(el("span", { text: App.fmt.date(l.last_contact) }));
      lc.appendChild(el("span", { class: "lrel", text: " · " + ago(l.last_contact, today) }));
    } else { lc.textContent = "—"; lc.classList.add("nil"); }

    var bc = cell(tr, "Bucket");
    var sel = el("select", { class: "lbucket", "aria-label": "Bucket for " + l.company, title: l.bucket ? BUCKETS[l.bucket] : "No bucket set" });
    sel.appendChild(el("option", { value: "", text: "Not set", selected: !l.bucket }));
    BUCKET_KEYS.forEach(function (k) { sel.appendChild(el("option", { value: k, text: BUCKET_SHORT[k], selected: l.bucket === k })); });
    sel.addEventListener("change", function () {
      leadsCol().patch(l.id, { bucket: sel.value, bucket_guessed: false }).then(function (r) { if (!r.ok) note(r.error, "error"); });
      App.flush();
    });
    bc.appendChild(sel);
    if (l.bucket && l.bucket_guessed) bc.appendChild(el("span", { class: "lguess", title: "Suggested from the sheet. Change it if it is wrong.", text: "guessed" }));

    textOrDash(cell(tr, "Action category"), l.action_category);

    var fc = cell(tr, "Next follow-up");
    var fu = el("div", { class: "lfu" + (kind === "overdue" ? " over" : kind === "today" ? " due" : "") });
    if (open) {
      var row = el("div", { class: "lfu-row" });
      var inp = el("input", { type: "date", value: l.next_follow_up, "aria-label": "Next follow-up for " + l.company });
      inp.addEventListener("change", function () {
        leadsCol().patch(l.id, { next_follow_up: inp.value }).then(function (r) { if (!r.ok) note(r.error, "error"); });
        App.flush();
      });
      row.appendChild(inp);
      if (l.next_follow_up) {
        var clr = el("button", { type: "button", class: "lclr", text: "×", title: "Clear follow-up date", "aria-label": "Clear follow-up date for " + l.company });
        clr.addEventListener("click", function () { leadsCol().patch(l.id, { next_follow_up: "" }); App.flush(); });
        row.appendChild(clr);
      }
      fu.appendChild(row);
      if (l.next_follow_up) fu.appendChild(el("span", { class: "lrel2", text: S.fuText({ followUp: l.next_follow_up }, today) }));
    } else {
      fu.appendChild(el("span", { class: "lrel2", text: l.next_follow_up ? App.fmt.date(l.next_follow_up) : "—" }));
    }
    fc.appendChild(fu);

    var ac = cell(tr, "", "act");
    var box = el("div", { class: "lacts" });
    if (open) {
      box.appendChild(el("button", { type: "button", class: "l-touch btn-sm", text: "Log touch", "aria-label": "Log touch for " + l.company, onclick: function (e) { openTouch(l.id, e.currentTarget); } }));
    }
    box.appendChild(el("button", { type: "button", class: "l-edit btn-sm", text: "Edit", "aria-label": "Edit " + l.company, onclick: function (e) { openEditDialog(l.id, e.currentTarget); } }));
    if (open) {
      var det = el("details", { class: "l-conv" }, [
        el("summary", { class: "btn-sm", "aria-label": "Convert " + l.company, text: "Convert ▾" }),
        el("div", { class: "l-menu" }, [
          el("button", { type: "button", class: "l-cust", text: "To customer", onclick: function () { det.open = false; convertToCustomer(l.id); } }),
          el("button", { type: "button", class: "l-rfq", text: "To RFQ", onclick: function () { det.open = false; convertToRfq(l.id); } })
        ])
      ]);
      box.appendChild(det);
      box.appendChild(el("button", { type: "button", class: "l-close btn-sm", text: "Close", "aria-label": "Close lead " + l.company, onclick: function (e) { openClose(l.id, e.currentTarget); } }));
    } else if (l.status === "Converted" && l.converted_customer_id && S.get(l.converted_customer_id)) {
      box.appendChild(el("button", { type: "button", class: "l-cview btn-sm", text: "Customer", "aria-label": "Show customer " + l.company,
        onclick: function () { App.show("list", { extra: { kind: "ids", value: [l.converted_customer_id], label: l.company } }); } }));
    } else if (l.status === "Closed") {
      box.appendChild(el("button", { type: "button", class: "l-reopen btn-sm", text: "Reopen", "aria-label": "Reopen " + l.company,
        onclick: function () { leadsCol().patch(l.id, { status: "Open", closed_reason: "", closed_at: "" }); App.flush(); App.announce("Reopened " + l.company + "."); } }));
    }
    ac.appendChild(box);
    return tr;
  }

  function stagingGet() {
    var d = S.doc("lead_staging").get();
    return { v: 1, files: d && Array.isArray(d.files) ? d.files : [], rows: d && Array.isArray(d.rows) ? d.rows : [] };
  }

  function render() {
    if (!rootEl) return;
    var today = S.todayISO(), touch = lastTouchMap(), links = rfqLinks();
    var base = allLeads().filter(function (l) { return state.showClosed || l.status === "Open"; });
    var list = sortLeads(base.filter(function (l) { return passesFilter(l, state, today, touch); }), today);

    var body = $("leadRows");
    body.textContent = "";
    list.forEach(function (l) { body.appendChild(buildRow(l, today, links)); });
    var any = allLeads().length > 0;
    $("leadEmpty").textContent = any ? "No leads match." : "No leads yet. Import your lead trackers or add a lead.";
    $("leadEmpty").hidden = list.length > 0;

    var bc = { "": base.length, none: 0 };
    BUCKET_KEYS.forEach(function (k) { bc[k] = 0; });
    base.forEach(function (l) { bc[l.bucket && BUCKETS[l.bucket] ? l.bucket : "none"]++; });
    Object.keys(bc).forEach(function (k) { var b = $("lb-" + (k || "all")); if (b) b.textContent = bc[k]; });
    Array.prototype.forEach.call(rootEl.querySelectorAll(".chip[data-b]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.b === state.bucket)); });

    var fc = { overdue: 0, today: 0, touched7: 0, dormant: 0 };
    base.forEach(function (l) {
      if (l.status === "Open" && l.next_follow_up) { if (l.next_follow_up < today) fc.overdue++; else if (l.next_follow_up === today) fc.today++; }
      if (touch[l.id] && S.daysBetween(touch[l.id], today) <= 7) fc.touched7++;
      if (dormantInfo(l, today)) fc.dormant++;
    });
    Object.keys(fc).forEach(function (k) { $("lf-" + k).textContent = fc[k]; });
    Array.prototype.forEach.call(rootEl.querySelectorAll(".chip[data-flag]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.flag === state.flag)); });
    rootEl.querySelector('.chip[data-flag="overdue"]').classList.toggle("has", fc.overdue > 0);
    $("leadClosedToggle").setAttribute("aria-pressed", String(state.showClosed));
    $("leadCategory").value = state.category; $("leadFit").value = state.fit;
    if ($("leadQ").value !== state.q) $("leadQ").value = state.q;

    var st = stagingGet(), sb = $("leadStaging");
    sb.hidden = st.rows.length === 0;
    if (st.rows.length) {
      var internal = st.files.reduce(function (n, x) { return n + (x.internal || 0); }, 0);
      $("leadStageMsg").textContent = st.rows.length + " row" + (st.rows.length === 1 ? "" : "s") + " staged from " + st.files.length + " file" + (st.files.length === 1 ? "" : "s") +
        (internal ? " (" + internal + " internal skipped)" : "") + ". Nothing becomes a lead until you review and merge.";
    }
    $("leadFoot").textContent = summary();
    saveState();
  }

  /* ---------- small dialog toolkit ---------- */
  function field(label, input, hint) { return el("label", null, [label, input, hint ? el("span", { class: "note", text: hint }) : null]); }
  function makeDialog(id, title, wide) {
    var head = el("div", { class: "dlg-head", id: id + "Title", text: title });
    var d = el("dialog", { id: id, class: wide ? "lead-wide" : "lead-dlg", "aria-labelledby": id + "Title" }, [head]);
    document.body.appendChild(d);
    return d;
  }

  /* ---------- lead dialog (new / edit) ---------- */
  var leadForm = null, editingId = "", suggested = "";
  function buildLeadDialog() {
    if (dlgs.lead) return;
    var d = makeDialog("leadDlg", "New lead");
    var err = el("p", { class: "form-err", id: "leadErr", role: "alert", hidden: true });
    var sel = function (name, opts) { return el("select", { name: name }, opts); };
    var opt = function (v, t) { return el("option", { value: v, text: t }); };
    var ta = function (name, max, rows) { return el("textarea", { name: name, maxlength: String(max), rows: String(rows || 3) }); };
    var cnt = function (id) { return el("span", { class: "count", id: id }); };
    var ctxT = ta("context", LIMITS.context, 4), angT = ta("value_angle", LIMITS.value_angle, 3), strT = ta("strategy", LIMITS.strategy, 3);
    var fitSel = sel("fit", [opt("", "Not checked")].concat(Object.keys(FITS).map(function (k) { return opt(k, FITS[k]); })));
    var fitHint = el("p", { class: "note", id: "leadFitHint", text: "Set by hand. It is never worked out by the page." });
    leadForm = el("form", { id: "leadForm", method: "dialog", novalidate: true }, [
      el("div", { class: "dlg-scroll" }, [
        field("Company *", el("input", { name: "company", maxlength: String(LIMITS.company), autocomplete: "off" })),
        el("div", { class: "two" }, [
          field("Key contact", el("input", { name: "contact_name", maxlength: String(LIMITS.contact_name), autocomplete: "off" })),
          field("Region / program", el("input", { name: "region_program", maxlength: String(LIMITS.region_program), autocomplete: "off" }))
        ]),
        el("div", { class: "two" }, [
          field("Email (private)", el("input", { name: "email", type: "email", maxlength: String(LIMITS.email), autocomplete: "off" })),
          field("Phone (private)", el("input", { name: "phone", type: "tel", maxlength: String(LIMITS.phone), autocomplete: "off" }))
        ]),
        el("p", { class: "note", text: "Emails and phones stay in this browser. They are never saved to git or to customers.json." }),
        el("div", { class: "two" }, [
          field("Segment / domain", el("input", { name: "segment_domain", maxlength: String(LIMITS.segment_domain), autocomplete: "off" })),
          field("Scope / component requirement", el("input", { name: "scope", maxlength: String(LIMITS.scope), autocomplete: "off" }))
        ]),
        el("div", { class: "two" }, [
          field("Last contact date", el("input", { name: "last_contact", type: "date" })),
          field("Next follow-up date", el("input", { name: "next_follow_up", type: "date" }))
        ]),
        el("div", { class: "two" }, [
          field("Bucket", sel("bucket", [opt("", "Not set")].concat(BUCKET_KEYS.map(function (k) { return opt(k, k.length === 1 ? k + ": " + BUCKETS[k] : BUCKETS[k]); })))),
          field("Action category", sel("action_category", [opt("", "Not set")].concat(ACTION_CATEGORIES.map(function (c) { return opt(c, c); }))))
        ]),
        el("p", { class: "note", id: "leadBucketHint", hidden: true, text: "Bucket suggested from the category. Change it if it is wrong." }),
        el("div", { class: "two" }, [
          field("Priority", sel("priority", [opt("", "Not set")].concat(PRIORITIES.map(function (p) { return opt(p, p); })))),
          field("Fit with the 3-ton hammer", fitSel)
        ]),
        fitHint,
        field("Source", el("input", { name: "source", maxlength: String(LIMITS.source), autocomplete: "off" })),
        field("Historical status / context", ctxT), cnt("leadCtxCount"),
        field("Value proposition / angle", angT), cnt("leadAngCount"),
        field("Recommended strategy / next step", strT), cnt("leadStrCount"),
        err
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "btn", type: "button", id: "leadCancel", text: "Cancel" }),
        el("button", { class: "btn primary", type: "submit", id: "leadSave", text: "Save lead" })
      ])
    ]);
    d.appendChild(leadForm);
    var fe = leadForm.elements;
    Ui.counter(ctxT, $("leadCtxCount"), LIMITS.context); Ui.counter(angT, $("leadAngCount"), LIMITS.value_angle); Ui.counter(strT, $("leadStrCount"), LIMITS.strategy);
    [ctxT, angT, strT].forEach(function (t) { Ui.ctrlEnter(t, leadForm); });
    fitSel.addEventListener("change", function () { fitHint.textContent = fitSel.value ? FITS[fitSel.value] : "Set by hand. It is never worked out by the page."; });
    fe.action_category.addEventListener("change", function () {
      var m = CATEGORY_TO_BUCKET[fe.action_category.value];
      if (m && !fe.bucket.value) { fe.bucket.value = m; suggested = m; $("leadBucketHint").hidden = false; }
    });
    fe.bucket.addEventListener("change", function () { if (fe.bucket.value !== suggested) $("leadBucketHint").hidden = true; });
    $("leadCancel").addEventListener("click", function () { d.close(); });
    leadForm.addEventListener("submit", function (e) { e.preventDefault(); submitLead(); });
    dlgs.lead = d;
  }
  var FORM_FIELDS = ["company", "contact_name", "region_program", "email", "phone", "segment_domain", "scope", "last_contact", "next_follow_up", "bucket", "action_category", "priority", "fit", "source", "context", "value_angle", "strategy"];
  function fillLeadForm(l) {
    var fe = leadForm.elements;
    FORM_FIELDS.forEach(function (k) { fe[k].value = l && l[k] != null ? l[k] : ""; });
    if (!l) fe.source.value = "Manual";
    fe.last_contact.max = S.todayISO();
    $("leadFitHint").textContent = fe.fit.value ? FITS[fe.fit.value] : "Set by hand. It is never worked out by the page.";
    suggested = l && l.bucket_guessed ? l.bucket : "";
    $("leadBucketHint").hidden = !(l && l.bucket && l.bucket_guessed);
    if (l && l.bucket && l.bucket_guessed) $("leadBucketHint").textContent = "This bucket was guessed when the sheet was imported. Change it if it is wrong.";
    $("leadErr").hidden = true;
    ["leadCtxCount", "leadAngCount", "leadStrCount"].forEach(function () {});
    ["context", "value_angle", "strategy"].forEach(function (k) { fe[k].dispatchEvent(new Event("input")); });
  }
  function openNewDialog(prefill, opener) {
    buildLeadDialog();
    editingId = "";
    $("leadDlgTitle").textContent = "New lead";
    $("leadSave").textContent = "Save lead";
    fillLeadForm(prefill && typeof prefill === "object" ? prefill : null);
    App.openDialog(dlgs.lead, opener || $("leadNew"));
    leadForm.elements.company.focus();
  }
  function openEditDialog(id, opener) {
    var l = getLead(id);
    if (!l) { note("That lead no longer exists.", "error"); return; }
    buildLeadDialog();
    editingId = id;
    $("leadDlgTitle").textContent = "Edit lead";
    $("leadSave").textContent = "Save changes";
    fillLeadForm(l);
    App.openDialog(dlgs.lead, opener || document.activeElement);
  }
  function submitLead() {
    var fe = leadForm.elements, fv = {}, err = $("leadErr");
    FORM_FIELDS.forEach(function (k) { fv[k] = fe[k].value; });
    var v = validateLead(fv, editingId);
    if (!v.ok) { err.textContent = v.error; err.hidden = false; if (fe[v.field]) fe[v.field].focus(); return; }
    var row = v.row;
    if (editingId) {
      var cur = getLead(editingId);
      row.bucket_guessed = row.bucket !== "" && row.bucket === cur.bucket ? !!cur.bucket_guessed : (row.bucket !== "" && row.bucket === suggested);
      leadsCol().patch(editingId, row).then(function (r) {
        if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
        err.hidden = true; dlgs.lead.close(); App.announce("Saved " + row.company + ".");
      });
    } else {
      var rec = newRecord(row, { bucket_guessed: row.bucket !== "" && row.bucket === suggested });
      leadsCol().insert(rec).then(function (r) {
        if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
        err.hidden = true; dlgs.lead.close(); App.announce("Added " + row.company + ".");
      });
    }
    App.flush();
  }

  /* ---------- log a touch ---------- */
  var touchId = "";
  function buildTouchDialog() {
    if (dlgs.touch) return;
    var d = makeDialog("touchDlg", "Log touch");
    var noteT = el("textarea", { name: "note", maxlength: "500", rows: "3" });
    var err = el("p", { class: "form-err", id: "touchErr", role: "alert", hidden: true });
    var form = el("form", { id: "touchForm", method: "dialog", novalidate: true }, [
      el("div", { class: "dlg-scroll" }, [
        el("p", { class: "note", id: "touchSub" }),
        el("div", { class: "two" }, [
          field("Type", el("select", { name: "type" }, TOUCH_TYPES.map(function (t) { return el("option", { value: t, text: t }); }))),
          field("Date", el("input", { name: "at", type: "date" }))
        ]),
        field("What happened *", noteT), el("span", { class: "count", id: "touchCount" }),
        field("Next follow-up (optional)", el("input", { name: "next", type: "date" })),
        el("p", { class: "note", text: "A Note does not change Last contact. A Call, Email, Visit or Telegram does." }),
        err,
        el("div", { class: "actions" }, [
          el("button", { class: "btn", type: "button", id: "touchClose", text: "Close" }),
          el("button", { class: "btn primary", type: "submit", id: "touchSave", text: "Save touch" })
        ]),
        el("h3", { class: "lsub", text: "History" }),
        el("p", { class: "note", id: "touchEmpty", text: "No touches yet." }),
        el("ol", { class: "tlist", id: "touchList" })
      ])
    ]);
    d.appendChild(form);
    Ui.counter(noteT, $("touchCount"), 500); Ui.ctrlEnter(noteT, form);
    $("touchClose").addEventListener("click", function () { d.close(); });
    form.addEventListener("submit", function (e) { e.preventDefault(); submitTouch(form); });
    dlgs.touch = d; dlgs.touchForm = form;
  }
  function renderTouchList() {
    var list = $("touchList"), items = S.leadLog(touchId);
    list.textContent = "";
    items.forEach(function (e) {
      list.appendChild(el("li", null, [
        el("span", { class: "tt", text: App.fmt.date(e.at) }), el("span", { class: "ty", text: " · " + e.type }), el("div", { class: "tn", text: e.note })
      ]));
    });
    $("touchEmpty").hidden = items.length > 0;
  }
  function openTouch(id, opener) {
    var l = getLead(id);
    if (!l) return;
    buildTouchDialog();
    touchId = id;
    var fe = dlgs.touchForm.elements, today = S.todayISO();
    $("touchSub").textContent = l.company + (l.last_contact ? " · Last contact " + App.fmt.date(l.last_contact) : " · No contact on record");
    fe.type.value = "Call"; fe.at.value = today; fe.at.max = today; fe.note.value = ""; fe.next.value = ""; fe.next.min = today;
    fe.note.dispatchEvent(new Event("input"));
    $("touchErr").hidden = true;
    renderTouchList();
    App.openDialog(dlgs.touch, opener || document.activeElement);
  }
  function submitTouch(form) {
    var fe = form.elements, err = $("touchErr"), today = S.todayISO();
    var next = fe.next.value;
    if (next && (!realISO(next) || next < today)) { err.textContent = "Pick today or a later date for the next follow-up."; err.hidden = false; return; }
    S.addLeadLog(touchId, { at: fe.at.value || today, type: fe.type.value, note: fe.note.value }).then(function (r) {
      if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
      err.hidden = true;
      var l = getLead(touchId), patch = {};
      var latest = "";
      S.leadLog(touchId).forEach(function (e) { if (CONTACT_TYPES.indexOf(e.type) !== -1 && e.at > latest) latest = e.at; });
      if (latest && latest > (l.last_contact || "")) patch.last_contact = latest;
      if (next) patch.next_follow_up = next;
      var p = Object.keys(patch).length ? leadsCol().patch(touchId, patch) : Promise.resolve({ ok: true });
      return p.then(function () {
        fe.note.value = ""; fe.next.value = ""; fe.note.dispatchEvent(new Event("input"));
        renderTouchList();
        $("touchSub").textContent = l.company + " · Last contact " + (latest || l.last_contact ? App.fmt.date(patch.last_contact || l.last_contact) : "none on record");
        App.announce("Touch saved for " + l.company + ".");
        App.flush();
      });
    });
  }

  /* ---------- close ---------- */
  var closeId = "";
  function openClose(id, opener) {
    var l = getLead(id);
    if (!l) return;
    if (!dlgs.close) {
      var d = makeDialog("leadCloseDlg", "Close lead");
      var form = el("form", { id: "leadCloseForm", method: "dialog", novalidate: true }, [
        el("p", { class: "note", id: "leadCloseSub" }),
        field("Reason (optional)", el("input", { name: "reason", maxlength: String(LIMITS.closed_reason), autocomplete: "off" })),
        el("p", { class: "note", text: "A closed lead leaves the lists and the Dashboard. Use Show converted / closed to see it again." }),
        el("div", { class: "actions" }, [
          el("button", { class: "btn", type: "button", id: "leadCloseCancel", text: "Cancel" }),
          el("button", { class: "btn primary", type: "submit", id: "leadCloseOk", text: "Close lead" })
        ])
      ]);
      d.appendChild(form);
      $("leadCloseCancel").addEventListener("click", function () { d.close(); });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var cur = getLead(closeId);
        leadsCol().patch(closeId, { status: "Closed", closed_reason: clip(form.elements.reason.value, LIMITS.closed_reason), closed_at: S.todayISO() }).then(function () {
          d.close(); App.announce("Closed " + (cur ? cur.company : "lead") + "."); App.flush();
        });
      });
      dlgs.close = d; dlgs.closeForm = form;
    }
    closeId = id;
    dlgs.closeForm.elements.reason.value = "";
    $("leadCloseSub").textContent = l.company;
    App.openDialog(dlgs.close, opener || document.activeElement);
  }

  /* ---------- internal entities ---------- */
  function openInternal(opener) {
    if (!dlgs.internal) {
      var d = makeDialog("internalDlg", "Internal entities");
      var ta = el("textarea", { id: "internalList", rows: "7", "aria-label": "Internal entity names or email domains" });
      var err = el("p", { class: "form-err", id: "internalErr", role: "alert", hidden: true });
      var form = el("form", { id: "internalForm", method: "dialog", novalidate: true }, [
        el("p", { class: "note", text: "One name or email domain per line, for example a related company or your executive assistant's domain. A lead whose company, contact or email domain contains one of these is treated as internal: it is skipped at import and refused when typed in. Capital letters do not matter." }),
        ta, err,
        el("div", { class: "actions" }, [
          el("button", { class: "btn", type: "button", id: "internalDefaults", text: "Restore the standard list" }),
          el("button", { class: "btn", type: "button", id: "internalCancel", text: "Cancel" }),
          el("button", { class: "btn primary", type: "submit", id: "internalSave", text: "Save list" })
        ])
      ]);
      d.appendChild(form);
      $("internalCancel").addEventListener("click", function () { d.close(); });
      $("internalDefaults").addEventListener("click", function () { ta.value = DEFAULT_INTERNAL.join("\n"); });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var seen = {}, list = [];
        ta.value.split(/\r?\n/).forEach(function (ln) { var p = lower(squash(ln)); if (p && !seen[p]) { seen[p] = 1; list.push(p); } });
        if (list.length > 40) { err.textContent = "40 entries at most."; err.hidden = false; return; }
        if (list.some(function (p) { return p.length > 60; })) { err.textContent = "Each entry can have 60 characters at most."; err.hidden = false; return; }
        S.doc("internal_entities").set({ v: 1, patterns: list }).then(function () {
          err.hidden = true; d.close(); App.announce("Internal entities saved (" + list.length + ")."); App.flush();
        });
      });
      dlgs.internal = d; dlgs.internalTa = ta;
    }
    dlgs.internalTa.value = internalPatterns().join("\n");
    $("internalErr").hidden = true;
    App.openDialog(dlgs.internal, opener || $("leadInternal"));
  }

  /* ---------- convert ---------- */
  function convertToCustomer(id) {
    var l = getLead(id);
    if (!l) return;
    if (!window.CrmCustomers || typeof CrmCustomers.openAdd !== "function") { note("Convert to customer is not available in this build yet.", "info"); return; }
    var prefill = { name: l.company, contact: l.contact_name, phone: l.phone, segment: S.SEGMENTS.indexOf(l.segment_domain) !== -1 ? l.segment_domain : "" };
    CrmCustomers.openAdd(prefill, function (customerId) { onConverted(id, customerId); });
    // An older Customers tab ignores the prefill: say so instead of leaving a blank form that never links back.
    var dlg = $("dlg"), nm = dlg && dlg.querySelector('input[name="name"]');
    if (dlg && dlg.open && nm && nm.value !== prefill.name) {
      dlg.close();
      note("Convert to customer needs the Customers update that accepts a prefilled Add form. It is not in this build yet.", "info");
    }
  }
  function onConverted(leadId, customerId) {
    var l = getLead(leadId);
    if (!l || !customerId) return;
    leadsCol().patch(leadId, { status: "Converted", converted_customer_id: customerId, converted_at: S.todayISO() }).then(function () {
      return S.relinkLog(leadId, customerId);
    }).then(function () {
      var rq = S.col("rfqs"), moves = [];
      rq.all().forEach(function (r) { if (r.lead_id === leadId && r.customer_id !== customerId) moves.push(rq.patch(r.id, { customer_id: customerId })); });
      return Promise.all(moves);
    }).then(function () {
      App.announce(l.company + " is now a customer.");
      note(l.company + " is now a customer. Its touches moved to the customer's notes.", "info");
      App.flush();
    });
  }
  function convertToRfq(id) {
    var l = getLead(id);
    if (!l) return;
    if (!window.CrmRfq || typeof CrmRfq.openNew !== "function") { note("Convert to RFQ is not available in this build yet.", "info"); return; }
    CrmRfq.openNew(null, { leadId: l.id, customerName: l.company, partName: l.scope });
  }
  /* RFQs created from a lead are listed on the lead (converted_rfq_ids). */
  function syncRfqLinks() {
    var m = rfqLinks();
    allLeads().forEach(function (l) {
      var want = (m[l.id] || []).slice().sort(), have = (l.converted_rfq_ids || []).slice().sort();
      if (want.join() !== have.join() && (want.length || have.length)) leadsCol().patch(l.id, { converted_rfq_ids: want });
    });
  }

  /* ---------- import and staging ---------- */
  function importSpecs() {
    return SPEC_ORDER.map(function (k) {
      return { key: k, label: SHEETS[k].label, fields: SPEC_FIELDS[k], skipRow: function (cells, map) { return str(cells[map.f_company]) ? null : "blank name"; } };
    });
  }
  function openImport() {
    if (!window.CrmImport) { note("The import dialog is not available.", "error"); return; }
    CrmImport.open({
      title: "Import leads",
      intro: "Choose one tracker file at a time (CSV): the Hub tab Dormant Leads (>6 Months), an older tracker, or the prospect matrix. Rows are staged first. You review and merge duplicate companies before anything becomes a lead. Emails and phones stay in this browser only and are never saved to git.",
      specs: importSpecs(), customerField: null, asOf: false, onConfirm: onImport
    });
  }
  function onImport(result) {
    var today = S.todayISO(), pats = internalPatterns(), key = result.specKey;
    var rows = [], internal = 0, now = nowISO();
    result.rows.forEach(function (r) {
      var d = mapRow(key, r, today);
      if (!d.company) return;
      if (draftInternal(d, pats)) { internal++; return; }
      d.importedAt = now; d.file = result.meta.fileName;
      rows.push(d);
    });
    var st = stagingGet(), fileName = result.meta.fileName;
    st.rows = st.rows.filter(function (r) { return !(r.sheetKey === key && r.file === fileName); });
    st.files = st.files.filter(function (x) { return !(x.sheetKey === key && x.name === fileName); });
    st.rows = st.rows.concat(rows);
    st.files.push({ sheetKey: key, sheet: SHEETS[key].short, name: fileName, rows: rows.length, internal: internal, at: now });
    return S.doc("lead_staging").set(st).then(function (r) { App.flush(); return r; });
  }

  /* ---------- merge preview ---------- */
  var ms = null;       // merge state: { cs: per card state, attn: bool, splits: {key: true} }
  function cardsNow() {
    var st = stagingGet(), pats = internalPatterns();
    var rows = st.rows.filter(function (r) { return !draftInternal(r, pats); });
    var cards = buildCards(rows, allLeads(), S.customers(), ms.splits);
    cards.forEach(function (c) {
      if (!ms.cs[c.id]) ms.cs[c.id] = { include: !c.notLead && !(c.customerId && !c.existing), mode: c.customerId && !c.existing ? "skip" : "lead", noteCustomer: c.customerId || "", sel: {} };
    });
    return cards;
  }
  function cardInfo(c) {
    var cs = ms.cs[c.id], g = mergeGroup(c.members, c.existing), v = resolve(g, cs.sel);
    return { cs: cs, g: g, v: v };
  }
  function cardNeedsAttention(c) {
    var i = cardInfo(c);
    return !!(i.v.bucket_guessed || i.g.issues.date || i.g.issues.conflicts > 0 || c.notLead);
  }
  function radioGroup(card, fkey, fo, cs) {
    var fs = el("fieldset", { class: "mf" }, [el("legend", { text: FIELD_LABEL[fkey] })]);
    var name = "mr-" + card.id.replace(/[^a-z0-9]/gi, "_") + "-" + fkey;
    var cur = cs.sel[fkey] != null ? cs.sel[fkey] : fo.def;
    var opts = [];
    if (fo.joined != null) opts.push({ idx: -1, text: "Join all: " + fo.joined });
    fo.options.forEach(function (o, i) { opts.push({ idx: i, text: o.value + " (" + o.from.join(", ") + ")" }); });
    opts.forEach(function (o) {
      var r = el("input", { type: "radio", name: name, value: String(o.idx), checked: o.idx === cur });
      r.addEventListener("change", function () { cs.sel[fkey] = o.idx; redrawCard(card.id, name + "|" + o.idx); });
      fs.appendChild(el("label", { class: "mrad" }, [r, el("span", { text: o.text })]));
    });
    return fs;
  }
  function buildCardEl(c) {
    var info = cardInfo(c), cs = info.cs, g = info.g, v = info.v;
    var art = el("article", { class: "mcard" + (cs.include ? "" : " off"), dataset: { key: c.id } });
    var inc = el("input", { type: "checkbox", class: "m-inc", checked: cs.include, "aria-label": "Include " + v.company });
    inc.addEventListener("change", function () { cs.include = inc.checked; if (inc.checked && cs.mode === "skip") cs.mode = "lead"; redrawCard(c.id); refreshSummary(); });
    var head = el("div", { class: "mhead" }, [el("label", { class: "minc" }, [inc, el("strong", { class: "mname", text: v.company })])]);
    var tags = el("div", { class: "lbadges" });
    tags.appendChild(el("span", { class: "lbadge", text: c.existing ? "Update existing lead" : "New lead" }));
    tags.appendChild(el("span", { class: "lbadge", text: g.sheets.join(" · ") + " (" + c.members.length + (c.members.length === 1 ? " row" : " rows") + ")" }));
    if (info.v.bucket_guessed) tags.appendChild(el("span", { class: "lbadge", text: "Bucket guessed" }));
    if (g.issues.date) tags.appendChild(el("span", { class: "lbadge warn", text: "Date needs a look" }));
    if (c.notLead) tags.appendChild(el("span", { class: "lbadge warn", text: "Looks like it is not a lead" }));
    if (c.customerId) tags.appendChild(el("span", { class: "lbadge warn", text: "Already a customer" }));
    head.appendChild(tags);
    art.appendChild(head);

    if (c.customerId && !c.existing) {
      var mname = "mm-" + c.id.replace(/[^a-z0-9]/gi, "_");
      var modes = [["skip", "Skip (already a customer)"], ["note", "Save as a note on the customer"], ["lead", "Import as lead anyway"]];
      var fs = el("fieldset", { class: "mf" }, [el("legend", { text: "This company is already a customer" })]);
      modes.forEach(function (m) {
        var r = el("input", { type: "radio", name: mname, value: m[0], checked: cs.mode === m[0] });
        r.addEventListener("change", function () {
          cs.mode = m[0]; cs.include = m[0] !== "skip"; if (m[0] === "note" && !cs.noteCustomer) cs.noteCustomer = c.customerId;
          redrawCard(c.id, mname + "|" + m[0]); refreshSummary();
        });
        fs.appendChild(el("label", { class: "mrad" }, [r, el("span", { text: m[1] })]));
      });
      art.appendChild(fs);
    }

    var dl = el("dl", { class: "mvals" });
    function row(k, label, val) { if (val) { dl.appendChild(el("dt", { text: label })); dl.appendChild(el("dd", { text: val })); } }
    row("c", "Key contact", v.contact_name);
    row("l", "Last contact", v.last_contact ? App.fmt.date(v.last_contact) : "");
    row("b", "Bucket", v.bucket ? BUCKETS[v.bucket] : "");
    row("a", "Action category", v.action_category);
    row("s", "Scope", v.scope);
    art.appendChild(dl);

    var conf = el("div", { class: "mconf" });
    SINGLE.concat(Object.keys(JOINED)).forEach(function (k) {
      var fo = g.fields[k];
      if (fo.options.length > 1) conf.appendChild(radioGroup(c, k, fo, cs));
    });
    if (conf.childNodes.length) {
      art.appendChild(el("p", { class: "note", text: "These fields have more than one value. Pick the one to keep." }));
      art.appendChild(conf);
    }

    var tools = el("div", { class: "mtools" });
    if (c.splitPart || c.names.length > 1) {
      var sp = el("input", { type: "checkbox", class: "m-split", checked: !!ms.splits[c.key] });
      sp.addEventListener("change", function () {
        if (sp.checked) ms.splits[c.key] = true; else delete ms.splits[c.key];
        Object.keys(ms.cs).forEach(function (id) { if (id === c.key || id.indexOf(c.key + "#") === 0) delete ms.cs[id]; });
        drawCards(); refreshSummary();
      });
      tools.appendChild(el("label", { class: "minc" }, [sp, "These are different companies"]));
    }
    var pick = el("select", { class: "m-match", "aria-label": "Match " + v.company + " to a customer instead" }, [el("option", { value: "", text: "Match to customer instead…" })]
      .concat(S.customers().slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); }).map(function (cu) {
        return el("option", { value: cu.id, text: cu.name, selected: cs.mode === "note" && cs.noteCustomer === cu.id });
      })));
    pick.addEventListener("change", function () {
      if (pick.value) { cs.mode = "note"; cs.noteCustomer = pick.value; cs.include = true; }
      else { cs.mode = c.customerId && !c.existing ? "skip" : "lead"; cs.include = cs.mode !== "skip" && !c.notLead; }
      redrawCard(c.id); refreshSummary();
    });
    tools.appendChild(pick);
    art.appendChild(tools);
    if (cs.mode === "note" && cs.noteCustomer && S.get(cs.noteCustomer)) {
      art.appendChild(el("p", { class: "note", text: "These rows will be saved as notes on " + S.get(cs.noteCustomer).name + ". No lead is created." }));
    }
    art.hidden = ms.attn && !cardNeedsAttention(c);
    return art;
  }
  function redrawCard(id, focusKey) {
    var c = cardsNow().filter(function (x) { return x.id === id; })[0];
    var old = $("mergeCards").querySelector('[data-key="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!c || !old) return;
    var neu = buildCardEl(c);
    old.replaceWith(neu);
    if (focusKey) {
      var p = focusKey.split("|");
      var f = neu.querySelector('input[name="' + p[0] + '"][value="' + p[1] + '"]');
      if (f) f.focus();
    }
  }
  function drawCards() {
    var box = $("mergeCards");
    box.textContent = "";
    cardsNow().forEach(function (c) { box.appendChild(buildCardEl(c)); });
    refreshSummary();
  }
  function tally() {
    var t = { created: 0, updated: 0, notes: 0, skipped: 0, total: 0 };
    cardsNow().forEach(function (c) {
      var cs = ms.cs[c.id]; t.total++;
      if (!cs.include || cs.mode === "skip") { t.skipped++; return; }
      if (cs.mode === "note") { t.notes++; return; }
      if (c.existing) t.updated++; else t.created++;
    });
    return t;
  }
  function refreshSummary() {
    var t = tally(), st = stagingGet();
    $("mergeSummary").textContent = t.total + " compan" + (t.total === 1 ? "y" : "ies") + " from " + st.rows.length + " row" + (st.rows.length === 1 ? "" : "s") +
      " · " + t.created + " new · " + t.updated + " to update" + (t.notes ? " · " + t.notes + " as customer notes" : "") + " · " + t.skipped + " skipped";
    var parts = [];
    if (t.created || !t.updated) parts.push("Create " + t.created + " lead" + (t.created === 1 ? "" : "s"));
    if (t.updated) parts.push((parts.length ? "update " : "Update ") + t.updated);
    if (t.notes) parts.push((parts.length ? "save " : "Save ") + t.notes + " note" + (t.notes === 1 ? "" : "s"));
    $("mergeOk").textContent = parts.join(", ");
    $("mergeOk").disabled = t.created + t.updated + t.notes === 0;
    var attn = cardsNow().filter(cardNeedsAttention).length;
    $("mergeAttnCount").textContent = String(attn);
  }
  function buildMergeDialog() {
    if (dlgs.merge) return;
    var d = makeDialog("leadMergeDlg", "Review and merge leads", true);
    var attn = el("input", { type: "checkbox", id: "mergeAttn" });
    attn.addEventListener("change", function () { ms.attn = attn.checked; drawCards(); });
    var body = el("div", { class: "dlg-scroll" }, [
      el("p", { class: "note", text: "One card per company. Rows from different files and leads you already have are merged: the newest date wins, texts are joined with | and the first contact is kept. Untick Include to leave a company out. Nothing is saved until you press the button at the bottom." }),
      el("p", { id: "mergeSummary", class: "msum", role: "status" }),
      el("label", { class: "minc" }, [attn, "Needs attention only (", el("span", { id: "mergeAttnCount", text: "0" }), ")"]),
      el("div", { id: "mergeCards", class: "mcards" }),
      el("p", { class: "form-err", id: "mergeErr", role: "alert", hidden: true })
    ]);
    var foot = el("div", { class: "actions lfoot" }, [
      el("button", { class: "btn", type: "button", id: "mergeCancel", text: "Cancel" }),
      el("button", { class: "btn primary", type: "button", id: "mergeOk", text: "Create 0 leads" })
    ]);
    d.appendChild(body); d.appendChild(foot);
    $("mergeCancel").addEventListener("click", function () { d.close(); });
    $("mergeOk").addEventListener("click", confirmMerge);
    dlgs.merge = d;
  }
  function openMerge(opener) {
    var st = stagingGet();
    if (!st.rows.length) { note("Nothing is staged yet. Import a tracker file first.", "info"); return; }
    buildMergeDialog();
    ms = { cs: {}, attn: false, splits: {} };
    $("mergeAttn").checked = false; $("mergeErr").hidden = true;
    drawCards();
    App.openDialog(dlgs.merge, opener || $("leadStageReview"));
  }
  function confirmMerge() {
    var cards = cardsNow(), col = leadsCol(), created = 0, updated = 0, notes = 0, errs = [];
    var chain = Promise.resolve();
    cards.forEach(function (c) {
      var cs = ms.cs[c.id];
      if (!cs.include || cs.mode === "skip") return;
      if (cs.mode === "note") {
        c.members.forEach(function (m) {
          var text = "Lead tracker (" + m.sheet + "): " + (m.context || m.strategy || m.scope || "no details");
          chain = chain.then(function () {
            return S.addLog(cs.noteCustomer, { type: "Note", note: clip(text, 500) }).then(function (r) { if (r.ok) notes++; else errs.push(r.error); });
          });
        });
        return;
      }
      var g = mergeGroup(c.members, c.existing), v = resolve(g, cs.sel);
      if (!str(v.company) || isInternal(v.company)) return;
      var rec = fromMerge(v, g, c);
      if (c.existing) {
        var patch = Object.assign({}, rec);
        delete patch.company_key;
        patch.company_key = leadKey(rec.company);
        chain = chain.then(function () { return col.patch(c.existing.id, patch).then(function (r) { if (r.ok) updated++; else errs.push(r.error); }); });
      } else {
        var full = newRecord(rec, { sources: rec.sources, source: clip(g.sheets.join(" · "), LIMITS.source) });
        chain = chain.then(function () { return col.insert(full).then(function (r) { if (r.ok) created++; else errs.push(r.error); }); });
      }
    });
    $("mergeOk").disabled = true;
    return chain.then(function () {
      if (errs.length) { $("mergeErr").textContent = errs.slice(0, 3).join(" "); $("mergeErr").hidden = false; $("mergeOk").disabled = false; return; }
      return S.doc("lead_staging").clear().then(function () {
        dlgs.merge.close();
        var msg = "Created " + created + " lead" + (created === 1 ? "" : "s") + ", updated " + updated + (notes ? ", saved " + notes + " note" + (notes === 1 ? "" : "s") + " on customers" : "") + ".";
        note(msg, "info"); App.announce(msg); App.flush();
      });
    });
  }

  /* ---------- panel ---------- */
  function chip(attr, val, label, id, cls) {
    var dd = {}; dd[attr] = val;
    return el("button", { type: "button", class: "chip" + (cls ? " " + cls : ""), dataset: dd, "aria-pressed": "false" }, [label + " ", el("b", { id: id, text: "0" })]);
  }
  function mount(root) {
    rootEl = root;
    loadState();
    var q = el("input", { class: "search", id: "leadQ", type: "search", placeholder: "Search company, contact, scope, segment, region", "aria-label": "Search leads" });
    root.appendChild(el("div", { class: "bar ltools" }, [
      el("button", { type: "button", class: "btn primary", id: "leadNew", text: "+ New lead" }),
      el("button", { type: "button", class: "btn", id: "leadImport", text: "Import leads" }),
      el("button", { type: "button", class: "btn", id: "leadInternal", text: "Internal entities" }),
      q
    ]));
    var bar = el("div", { class: "bar", role: "group", "aria-label": "Filter by bucket" }, [el("span", { class: "bar-label", text: "Bucket" })]);
    bar.appendChild(chip("b", "", "All", "lb-all"));
    BUCKET_KEYS.forEach(function (k) {
      var c = chip("b", k, k === "dormant" ? "Dormant > 6 mo" : k === "jv" ? "JV" : k, "lb-" + k);
      c.title = BUCKETS[k];
      bar.appendChild(c);
    });
    bar.appendChild(chip("b", "none", "Not set", "lb-none"));
    root.appendChild(bar);
    var catSel = el("select", { id: "leadCategory", "aria-label": "Action category" }, [el("option", { value: "", text: "All action categories" })]
      .concat(ACTION_CATEGORIES.map(function (c) { return el("option", { value: c, text: c }); })).concat([el("option", { value: "none", text: "No category" })]));
    var fitSel = el("select", { id: "leadFit", "aria-label": "Fit" }, [el("option", { value: "", text: "All fits" }), el("option", { value: "sweet", text: "Sweet spot" }),
      el("option", { value: "check", text: "Check fit" }), el("option", { value: "regret", text: "Fast regret" }), el("option", { value: "none", text: "Not checked" })]);
    root.appendChild(el("div", { class: "bar", role: "group", "aria-label": "More filters" }, [
      catSel, fitSel,
      chip("flag", "overdue", "Follow-up overdue", "lf-overdue", "danger"), chip("flag", "today", "Due today", "lf-today"),
      chip("flag", "touched7", "Touched in last 7 days", "lf-touched7"), chip("flag", "dormant", "Dormant over 6 months", "lf-dormant"),
      el("button", { type: "button", class: "chip", id: "leadClosedToggle", "aria-pressed": "false", text: "Show converted / closed" })
    ]));
    root.appendChild(el("p", { class: "rule", id: "leadLegend", text: "A: " + BUCKETS.A + ". B: " + BUCKETS.B + ". C: " + BUCKETS.C + ". D: " + BUCKETS.D + ". A follow-up date in the past turns red and says how many days overdue. Leads are kept in this browser only." }));
    root.appendChild(el("div", { class: "banner info lstage", id: "leadStaging", hidden: true }, [
      el("span", { class: "banner-text", id: "leadStageMsg" }),
      el("button", { type: "button", class: "btn", id: "leadStageAdd", text: "Add another file" }),
      el("button", { type: "button", class: "btn primary", id: "leadStageReview", text: "Review and merge" }),
      el("button", { type: "button", class: "btn", id: "leadStageDiscard", text: "Discard staged rows" })
    ]));
    var th = function (label) { return el("th", null, label); };
    root.appendChild(el("div", { class: "card leads-card" }, [
      el("table", { class: "leads-t" }, [
        el("thead", null, el("tr", null, [th("Company"), th("Key contact"), th("Segment / domain"), th("Scope"), th("Region / program"), th("Last contact"), th("Bucket"), th("Action category"), th("Next follow-up"), th("")])),
        el("tbody", { id: "leadRows" })
      ]),
      el("div", { class: "empty", id: "leadEmpty", hidden: true })
    ]));
    root.appendChild(el("p", { class: "foot", id: "leadFoot" }));

    $("leadNew").addEventListener("click", function (e) { openNewDialog(null, e.currentTarget); });
    $("leadImport").addEventListener("click", openImport);
    $("leadInternal").addEventListener("click", function (e) { openInternal(e.currentTarget); });
    $("leadStageAdd").addEventListener("click", openImport);
    $("leadStageReview").addEventListener("click", function (e) { openMerge(e.currentTarget); });
    $("leadStageDiscard").addEventListener("click", function () {
      var n = stagingGet().rows.length;
      if (!confirm("Discard " + n + " staged row" + (n === 1 ? "" : "s") + "? Nothing has been added to your leads.")) return;
      S.doc("lead_staging").clear(); App.flush(); App.announce("Staged rows discarded.");
    });
    q.addEventListener("input", function () { state.q = q.value; current = state; render(); });
    root.querySelectorAll(".chip[data-b]").forEach(function (b) { b.addEventListener("click", function () { state.bucket = b.dataset.b; render(); }); });
    root.querySelectorAll(".chip[data-flag]").forEach(function (b) { b.addEventListener("click", function () { state.flag = state.flag === b.dataset.flag ? "" : b.dataset.flag; render(); }); });
    catSel.addEventListener("change", function () { state.category = catSel.value; render(); });
    fitSel.addEventListener("change", function () { state.fit = fitSel.value; render(); });
    $("leadClosedToggle").addEventListener("click", function () { state.showClosed = !state.showClosed; render(); });
    document.addEventListener("click", function (e) {
      Array.prototype.forEach.call(document.querySelectorAll("details.l-conv[open]"), function (dt) { if (!dt.contains(e.target)) dt.open = false; });
    });
    S.onChange(function (reason) { if (reason === "rfqs" || reason === "load") syncRfqLinks(); });
  }

  App.registerPanel("leads", {
    label: "Leads", mount: mount, render: render,
    show: function (f) { setFilter(f); },
    summary: summary
  });

  CrmLeads.openNew = function (prefill) { openNewDialog(prefill, document.activeElement); };
  CrmLeads.openEdit = function (id) { openEditDialog(id, document.activeElement); };
  window.CrmLeads = CrmLeads;
})();
