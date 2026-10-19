/* Weekly sales review (P2-M, task A8): one printable A4 page. Owned by A8.
   Contract (design 4.5): window.CrmReport = { open(opts?), compute(range, deps) }.
   - compute() is pure (also module.exports for Node unit tests): it takes plain data plus the other modules' stats() results.
   - open() gathers live data from Store and from CrmMoney / CrmRfq / CrmSchedule / CrmRevenue / CrmLeads (each optional:
     a missing module or a null stats() gives a "no data" line, never an error), then draws #reportDlg.
   - Buttons #weeklyReportBtn (Dashboard) and #weeklyReportBtn2 (Export) work through one delegated click handler here,
     so those tabs only need to render the button.
   - Never remembered: "Include note text" and "Include contact details" (unticked on every open).
   - The chosen date range is remembered in App.view("report") (deviation from design 5.7b, asked for by the lead).
   - Text is built with textContent only. Emails and phones are never read into the model unless "Include contact details". */
(function () {
  "use strict";

  var hasDom = typeof window !== "undefined" && typeof document !== "undefined";

  /* ================= pure part ================= */
  var STAGES_DEFAULT = ["Received", "Quoted", "Negotiated", "Finalised", "PO", "Sample", "PPAP"];
  var CONTACT_TYPES = ["Call", "Visit", "Email", "Telegram"];
  var DEFAULT_CAPS = { moves: 8, overdue: 8, dueNext: 8, atRisk: 10, actions: 5, lateOrders: 5, moneyTop: 5, reactivate: 5,
                       names: 30, notes: 8, leadNames: 10 };
  var MIN_CAP = 3;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function dayNum(iso) { return Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000); }
  function addDays(iso, n) { return new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function todayIST(now) { return new Date(now == null ? Date.now() : now).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }
  function isISO(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
    var t = Date.parse(s + "T00:00:00Z");
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }
  function num(n) { return typeof n === "number" && isFinite(n) ? n : null; }
  function str(v) { return v == null ? "" : String(v); }
  function lower(s) { return str(s).toLowerCase(); }
  function byText(a, b) { return lower(a).localeCompare(lower(b)); }

  /* Hide emails and phone-like numbers in free text (used for note text when contact details are not ticked). */
  function scrub(text) {
    return str(text)
      .replace(/[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/gi, "[email hidden]")
      .replace(/\+?\d[\d\s().-]{6,}\d/g, function (m) { return m.replace(/\D/g, "").length >= 9 ? "[phone hidden]" : m; });
  }
  function clip(text, n) { text = str(text).replace(/\s+/g, " ").trim(); return text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text; }

  function capList(list, cap) {
    return { total: list.length, items: list.slice(0, cap), more: Math.max(0, list.length - cap) };
  }

  function mergeCaps(over) {
    var caps = {};
    Object.keys(DEFAULT_CAPS).forEach(function (k) { caps[k] = DEFAULT_CAPS[k]; });
    if (over) Object.keys(over).forEach(function (k) { if (typeof over[k] === "number" && over[k] >= 0) caps[k] = Math.floor(over[k]); });
    return caps;
  }
  /* One step towards fitting a page: shorten the list that currently shows the most items (ties go to the least important list),
     never below MIN_CAP, never the top-5 actions. Returns a new caps object, or null when nothing more can be shortened. */
  var TRIM_ORDER = ["notes", "names", "leadNames", "reactivate", "moneyTop", "lateOrders", "atRisk", "moves", "dueNext", "overdue"];
  function nextCaps(model, caps) {
    var totals = {
      moves: model.moves.total, overdue: model.overdue.total, dueNext: model.dueNext.total, atRisk: model.atRisk.total,
      names: model.contact.namesTotal, notes: model.contact.notes ? model.contact.notes.total : 0,
      lateOrders: model.lateOrders ? model.lateOrders.items.length + model.lateOrders.more : 0,
      moneyTop: model.money ? model.money.top.total : 0, reactivate: model.leads.reactivate.total, leadNames: model.leads.touched.total
    };
    var best = null, bestShown = MIN_CAP;
    TRIM_ORDER.forEach(function (k) {
      var shown = Math.min(totals[k] || 0, caps[k]);
      if (shown > bestShown) { best = k; bestShown = shown; }
    });
    if (!best) return null;
    var out = {};
    Object.keys(caps).forEach(function (k) { out[k] = caps[k]; });
    out[best] = bestShown - 1;
    return out;
  }

  function contactName(c, includeContacts) {
    var o = { contact: str(c.contact).trim() };
    if (includeContacts) o.phone = str(c.phone).trim();
    return o;
  }

  /* ReportModel (design 5.7b). range = { from, to } (YYYY-MM-DD, India time).
     deps = { today, customers, log, visits, rfqs, rfqHistory, leads, orders, stats: { money, rfq, orders, revenue, leads },
              stages, includeNotes, includeContacts, includeRelated, caps }
     Every list is { total, items, more } with items already capped. */
  function compute(range, deps) {
    deps = deps || {};
    var today = isISO(deps.today) ? deps.today : todayIST();
    var from = range && isISO(range.from) ? range.from : addDays(today, -6);
    var to = range && isISO(range.to) ? range.to : today;
    if (from > to) { var sw = from; from = to; to = sw; }
    var caps = mergeCaps(deps.caps);
    var includeNotes = deps.includeNotes === true, includeContacts = deps.includeContacts === true;
    var customers = Array.isArray(deps.customers) ? deps.customers : [];
    var log = Array.isArray(deps.log) ? deps.log : [];
    var visits = Array.isArray(deps.visits) ? deps.visits : [];
    var rfqs = Array.isArray(deps.rfqs) ? deps.rfqs : [];
    var history = Array.isArray(deps.rfqHistory) ? deps.rfqHistory : [];
    var leads = Array.isArray(deps.leads) ? deps.leads : [];
    var orderRows = Array.isArray(deps.orders) ? deps.orders : [];
    var st = deps.stats || {};
    var stages = Array.isArray(deps.stages) && deps.stages.length ? deps.stages : STAGES_DEFAULT;

    var byId = {};
    customers.forEach(function (c) { byId[c.id] = c; });
    var leadById = {};
    leads.forEach(function (l) { leadById[l.id] = l; });
    var rfqById = {};
    rfqs.forEach(function (r) { rfqById[r.id] = r; });
    function inRange(d) { return !!d && d >= from && d <= to; }
    function custName(id, fallback) { return byId[id] ? byId[id].name : (fallback || ""); }

    /* ---- follow-ups ---- */
    var overdueAll = customers.filter(function (c) { return c.followUp && c.followUp < today; })
      .sort(function (a, b) { return a.followUp < b.followUp ? -1 : a.followUp > b.followUp ? 1 : byText(a.name, b.name); });
    var dueAll = customers.filter(function (c) { return c.followUp && c.followUp >= today && c.followUp <= addDays(today, 7); })
      .sort(function (a, b) { return a.followUp < b.followUp ? -1 : a.followUp > b.followUp ? 1 : byText(a.name, b.name); });
    function fuItem(c) {
      var o = contactName(c, includeContacts);
      o.id = c.id; o.name = c.name; o.followUp = c.followUp;
      o.days = daysBetween(c.followUp, today);          // > 0 overdue by that many days; 0 due today; < 0 due in -days
      return o;
    }
    var overdue = capList(overdueAll.map(fuItem), caps.overdue);
    var dueNext = capList(dueAll.map(fuItem), caps.dueNext);

    /* ---- contact this week ---- */
    var byType = { Call: 0, Visit: 0, Email: 0, Telegram: 0 };
    var nameSet = {}, noteLines = [];
    var leadTouched = {};
    log.forEach(function (e) {
      if (!inRange(e.at)) return;
      var isLead = !!(e.leadId || e.lead_id) && !e.customerId;
      if (isLead) {
        if (CONTACT_TYPES.indexOf(e.type) !== -1) leadTouched[e.leadId || e.lead_id] = true;
        return;
      }
      if (!e.customerId) return;
      var contactType = CONTACT_TYPES.indexOf(e.type) !== -1;
      if (contactType) {
        byType[e.type]++;
        if (byId[e.customerId]) nameSet[byId[e.customerId].name] = true;
      }
      if (includeNotes && str(e.note).trim() && byId[e.customerId]) {
        noteLines.push({ at: e.at, order: str(e.createdAt), name: byId[e.customerId].name, type: e.type,
                         text: clip(includeContacts ? e.note : scrub(e.note), 140) });
      }
    });
    visits.forEach(function (v) {
      var doneOn = str(v.done_at).slice(0, 10);
      if (!v.done || v.log_id || !inRange(doneOn)) return;          // visits that also made a log entry are already counted above
      var type = v.type === "Call" ? "Call" : "Visit";
      byType[type]++;
      if (byId[v.customer_id]) nameSet[byId[v.customer_id].name] = true;
      if (includeNotes && str(v.note).trim() && byId[v.customer_id]) {
        noteLines.push({ at: doneOn, order: str(v.updated_at), name: byId[v.customer_id].name, type: type,
                         text: clip(includeContacts ? v.note : scrub(v.note), 140) });
      }
    });
    var contactTotal = byType.Call + byType.Visit + byType.Email + byType.Telegram;
    var names = capList(Object.keys(nameSet).sort(byText), caps.names);
    noteLines.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : a.order < b.order ? 1 : a.order > b.order ? -1 : 0; });
    var contact = {
      byType: byType, total: contactTotal, callsVisits: byType.Call + byType.Visit,
      names: names.items, namesTotal: names.total, namesMore: names.more,
      notes: includeNotes ? capList(noteLines, caps.notes) : null
    };

    /* ---- at risk (status set by hand; sorted by last contacted, oldest or never first) ---- */
    var lastContact = {};
    log.forEach(function (e) {
      if (e.customerId && CONTACT_TYPES.indexOf(e.type) !== -1 && e.at > (lastContact[e.customerId] || "")) lastContact[e.customerId] = e.at;
    });
    var riskAll = customers.filter(function (c) { return c.status === "At risk"; }).map(function (c) {
      return { id: c.id, name: c.name, last: c.last || "", lastContacted: lastContact[c.id] || "" };
    }).sort(function (a, b) {
      if (a.lastContacted !== b.lastContacted) return a.lastContacted < b.lastContacted ? -1 : 1;     // "" (never) sorts first
      return byText(a.name, b.name);
    });
    var atRisk = capList(riskAll, caps.atRisk);

    /* ---- RFQ pipeline ---- */
    var rfqStats = st.rfq && typeof st.rfq === "object" ? st.rfq : null;
    var funnel = null, quoteOverdue = null, rfqTotal = null;
    if (rfqStats) {
      var bs = rfqStats.byStage && typeof rfqStats.byStage === "object" ? rfqStats.byStage : {};
      funnel = stages.map(function (s) { return { stage: s, n: num(bs[s]) || 0 }; });
      quoteOverdue = num(rfqStats.quoteOverdue) || 0;
      rfqTotal = num(rfqStats.total);
    }
    function rfqLabel(r) {
      if (!r) return "RFQ";
      return "RFQ " + (str(r.rfq_no).trim() || str(r.part_name).trim() || "—");
    }
    function rfqCustomer(r) {
      if (!r) return "";
      if (r.customer_id && byId[r.customer_id]) return byId[r.customer_id].name;
      if (r.lead_id && leadById[r.lead_id]) return leadById[r.lead_id].company;
      return str(r.customer_name);
    }
    var moveRows = history.filter(function (h) { return inRange(h.at) && (h.from || h.to === "Lost"); })
      .sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : str(a.created_at) < str(b.created_at) ? 1 : -1; })
      .map(function (h) {
        var r = rfqById[h.rfq_id];
        return { at: h.at, rfq: rfqLabel(r), customer: rfqCustomer(r), from: h.from || "", to: h.to };
      });
    var moves = capList(moveRows, caps.moves);
    var newRfqs = rfqs.filter(function (r) { return inRange(r.received); }).length;

    /* ---- money (only when imported) ---- */
    var ms = st.money && typeof st.money === "object" ? st.money : null, money = null;
    if (ms) {
      var b = ms.buckets || {};
      money = {
        asOf: str(ms.asOf), stale: ms.stale === true, overdue: num(ms.overdue), outstanding: num(ms.outstanding), overduePct: num(ms.overduePct),
        buckets: [["b1_30", "1–30 days"], ["b31_60", "31–60"], ["b61_90", "61–90"], ["b90", ">90"]].map(function (p) {
          var x = b[p[0]]; return { key: p[0], label: p[1], amount: x ? num(x.amount) : null, n: x ? num(x.n) : null };
        }),
        top: capList((Array.isArray(ms.top5) ? ms.top5 : []).map(function (t) { return { id: t.id, name: str(t.name), overdue: num(t.overdue), b90: num(t.b90) }; }), caps.moneyTop)
      };
    }

    /* ---- late orders (only when the Schedule module has order data) ---- */
    var os = st.orders && typeof st.orders === "object" ? st.orders : null, lateOrders = null;
    if (os) {
      var lateRows = orderRows.filter(function (o) {
        var open = o.status ? o.status === "Open" : !o.done;
        return open && o.promised && o.promised < today;
      }).sort(function (a, b) { return a.promised < b.promised ? -1 : a.promised > b.promised ? 1 : 0; }).map(function (o) {
        return { orderNo: str(o.order_no), customer: custName(o.customer_id, o.customer_name), part: str(o.part_code || o.part),
                 promised: o.promised, days: daysBetween(o.promised, today) };
      });
      var late = capList(lateRows, caps.lateOrders);
      lateOrders = { count: num(os.late) != null ? os.late : lateRows.length, items: late.items, more: Math.max(0, lateRows.length - late.items.length),
                     dueToday: num(os.dueToday), dueWeek: num(os.dueWeek), open: num(os.open), asOf: str(os.asOf), stale: os.stale === true };
    }

    /* ---- revenue vs target (only when imported) ---- */
    var rs = st.revenue && typeof st.revenue === "object" ? st.revenue : null, revenue = null;
    if (rs) {
      var tg = rs.targets && typeof rs.targets === "object" ? rs.targets : null;
      var ex = rs.excludedRelated && num(rs.excludedRelated.n) > 0 && deps.includeRelated !== true ? { n: rs.excludedRelated.n } : null;
      revenue = {
        fy: str(rs.fy), to: str(rs.to), dataThrough: str(rs.dataThrough), fytd: num(rs.fytd), mtd: num(rs.mtd), mtdLabel: str(rs.mtdLabel),
        changePct: rs.prior ? num(rs.prior.changePct) : null,
        target: tg ? { pct: num(tg.pct), pacePct: num(tg.pacePct), behind: tg.behind === true, total: num(tg.total), actual: num(tg.actual) } : null,
        excludedRelated: ex
      };
    }

    /* ---- leads ---- */
    var ls = st.leads && typeof st.leads === "object" ? st.leads : null;
    var touchedLeads = Object.keys(leadTouched).map(function (id) { return leadById[id] ? leadById[id].company : ""; }).filter(Boolean).sort(byText);
    var leadOverdueAll = leads.filter(function (l) { return (!l.status || l.status === "Open") && l.next_follow_up && l.next_follow_up < today; })
      .sort(function (a, b) { return a.next_follow_up < b.next_follow_up ? -1 : a.next_follow_up > b.next_follow_up ? 1 : byText(a.company, b.company); })
      .map(function (l) { return { id: l.id, company: str(l.company), nextFollowUp: l.next_follow_up, days: daysBetween(l.next_follow_up, today) }; });
    var react = ls && Array.isArray(ls.reactivate) ? ls.reactivate.map(function (r) {
      return { id: r.id, company: str(r.company), lastContact: str(r.lastContact), category: str(r.category) };
    }) : [];
    var reactCapped = capList(react, caps.reactivate);
    var touchedCap = capList(touchedLeads, caps.leadNames);
    var leadsOut = {
      available: !!ls || leads.length > 0 || touchedLeads.length > 0,
      touched: { total: touchedLeads.length, names: touchedCap.items, more: touchedCap.more },
      followOverdue: ls && num(ls.followOverdue) != null ? ls.followOverdue : leadOverdueAll.length,
      overdueList: leadOverdueAll,
      reactivate: reactCapped
    };

    /* ---- top 5 actions: customer overdue (oldest first), customer due soonest, then overdue lead follow-ups ---- */
    var actions = [];
    overdueAll.forEach(function (c) { actions.push(Object.assign(fuItem(c), { kind: "overdue" })); });
    dueAll.forEach(function (c) { actions.push(Object.assign(fuItem(c), { kind: "due" })); });
    leadOverdueAll.forEach(function (l) { actions.push({ kind: "lead", id: l.id, name: l.company, followUp: l.nextFollowUp, days: l.days }); });
    var actionsOut = capList(actions, caps.actions);

    /* ---- headline ---- */
    var headline = {
      overdue: overdueAll.length, dueNext: dueAll.length, contacts: contact.callsVisits,
      rfqMoved: rfqStats ? moveRows.length : null,
      lateOrders: lateOrders ? lateOrders.count : null,
      revenue: revenue ? { fytd: revenue.fytd, pct: revenue.target ? revenue.target.pct : null, behind: revenue.target ? revenue.target.behind : false } : null
    };

    var missing = [];
    if (!money) missing.push("Money overdue (no AGING or LIVE_POSITION data imported)");
    if (!lateOrders) missing.push("Late orders (no order data)");
    if (!revenue) missing.push("Revenue vs target (no invoice data imported)");

    return {
      range: { from: from, to: to }, today: today, includeNotes: includeNotes, includeContacts: includeContacts,
      headline: headline,
      rfq: rfqStats ? { total: rfqTotal } : null, funnel: funnel, moves: moves, newRfqs: newRfqs, quoteOverdue: quoteOverdue,
      overdue: overdue, dueNext: dueNext, contact: contact, atRisk: atRisk,
      money: money, lateOrders: lateOrders, revenue: revenue, leads: leadsOut, actions: actionsOut,
      asOf: { money: money ? money.asOf : "", orders: lateOrders ? lateOrders.asOf : "", revenue: revenue ? revenue.dataThrough : "" },
      missing: missing
    };
  }

  var pure = { compute: compute, scrub: scrub, DEFAULT_CAPS: DEFAULT_CAPS, nextCaps: nextCaps, STAGES: STAGES_DEFAULT,
               defaultRange: function (today) { today = isISO(today) ? today : todayIST(); return { from: addDays(today, -6), to: today }; } };

  if (typeof module !== "undefined" && module.exports) module.exports = pure;
  if (!hasDom) return;

  /* ================= browser part ================= */
  var VIEW_ID = "report";
  var dlg = null, parts = {}, current = null;     // current = { from, to, depsOverride, opener }
  var printTitle = null;

  function warn(msg, e) { if (typeof console !== "undefined") console.warn(msg, e && e.message ? e.message : e); }
  function el(tag, attrs, kids) { return Ui.el(tag, attrs, kids); }
  function safe(fn) { try { return fn(); } catch (e) { warn("Weekly sales review: a module's stats failed", e); return null; } }
  function has(name, method) { return !!(window[name] && typeof window[name][method] === "function"); }

  function dm(iso) { return Ui.fmt.date(iso).replace(/ \d{4}$/, ""); }
  function rangeText(r) {
    if (r.from === r.to) return Ui.fmt.date(r.to);
    var sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
    return (sameYear ? dm(r.from) : Ui.fmt.date(r.from)) + " – " + Ui.fmt.date(r.to);
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

  /* ---------- live data ---------- */
  function readCol(name) { return safe(function () { return Store.col(name).all(); }) || []; }
  function gather(o) {
    var today = Store.todayISO();
    var dash = (window.App && App.view) ? (App.view("dash") || {}) : {};
    var includeRelated = dash.incRelated === true;
    var stats = {
      money: has("CrmMoney", "stats") ? safe(function () { return CrmMoney.stats(); }) : null,
      rfq: has("CrmRfq", "stats") ? safe(function () { return CrmRfq.stats(today); }) : null,
      orders: has("CrmSchedule", "orderStats") ? safe(function () { return CrmSchedule.orderStats(today); }) : null,
      revenue: has("CrmRevenue", "stats") ? safe(function () {
        var q = { to: dash.revTo === "today" ? "today" : "data", includeRelated: includeRelated };
        if (dash.revFy) q.fy = dash.revFy;
        return CrmRevenue.stats(q);
      }) : null,
      leads: has("CrmLeads", "stats") ? safe(function () { return CrmLeads.stats(today); }) : null
    };
    var deps = {
      today: today, customers: Store.customers(), log: safe(function () { return Store.allLog(); }) || [],
      visits: readCol("visits"), rfqs: readCol("rfqs"), rfqHistory: readCol("rfq_history"), leads: readCol("leads"), orders: readCol("orders"),
      stats: stats, stages: window.CrmRfq && Array.isArray(CrmRfq.STAGES) ? CrmRfq.STAGES : null, includeRelated: includeRelated
    };
    var over = o && o.depsOverride;
    if (over) {
      Object.keys(over).forEach(function (k) {
        if (k === "stats" && over.stats) Object.keys(over.stats).forEach(function (s) { deps.stats[s] = over.stats[s]; });
        else deps[k] = over[k];
      });
    }
    return deps;
  }

  /* ---------- small DOM builders ---------- */
  function sec(id, title, kids) {
    var h = el("h2", { id: id + "H", text: title });
    return el("section", { class: "rp-sec", id: id, "aria-labelledby": id + "H" }, [h, kids]);
  }
  function li(kids, cls) { return el("li", { class: cls || null }, kids); }
  function red(text) { return el("span", { class: "rp-red", text: text }); }
  function orange(text) { return el("span", { class: "rp-orange", text: text }); }
  function sep() { return " · "; }
  function nm(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }   // long names are shortened to keep lists on one line
  function none(text) { return el("p", { class: "rp-none", text: text }); }
  function more(n) { return n > 0 ? el("li", { class: "rp-more", text: "+" + n + " more" }) : null; }
  function sub(text) { return el("h3", { text: text }); }
  function overdueWords(days) { return "Overdue by " + plural(days, "day"); }
  function contactBit(it, withPhone) {
    var bits = [];
    if (it.contact) bits.push(it.contact);
    if (withPhone && it.phone) bits.push(it.phone);
    return bits.length ? " (" + bits.join(", ") + ")" : "";
  }

  /* ---------- sections ---------- */
  function boxes(m) {
    var h = m.headline, list = [];
    list.push({ n: String(h.overdue), l: "Overdue follow-ups", cls: h.overdue > 0 ? "rp-red" : "" });
    list.push({ n: String(h.dueNext), l: "Due in next 7 days" });
    list.push({ n: String(h.contacts), l: "Calls / visits logged" });
    if (h.rfqMoved != null) list.push({ n: String(h.rfqMoved), l: "RFQs moved" });
    if (h.lateOrders != null) list.push({ n: String(h.lateOrders), l: "Late orders", cls: h.lateOrders > 0 ? "rp-red" : "" });
    if (h.revenue) {
      var r = h.revenue;
      list.push({ n: Ui.fmt.moneyShort(r.fytd), l: r.pct != null ? "Revenue FYTD · " + Math.round(r.pct) + "% of target" : "Revenue FYTD · no target", cls: r.behind ? "rp-red" : "", amount: r.fytd != null });
    }
    return el("div", { class: "rp-boxes" }, list.map(function (b) {
      var n = el("div", { class: "rp-n" + (b.cls ? " " + b.cls : ""), text: b.n });
      if (b.amount && App.hideAmounts()) n.setAttribute("aria-label", "amount hidden");
      return el("div", { class: "rp-box" }, [n, el("div", { class: "rp-l", text: b.l })]);
    }));
  }

  function secRfq(m) {
    if (!m.funnel) return sec("repRfq", "RFQ pipeline", none("No data: the RFQ module is not available yet."));
    var kids = [];
    kids.push(el("p", { class: "rp-funnel", text: m.funnel.map(function (f) { return f.stage + " " + f.n; }).join(" → ") }));
    kids.push(sub("Stage movements in this range (" + m.moves.total + ")"));
    if (!m.moves.total) kids.push(none("No stage movements in this range."));
    else kids.push(el("ul", { class: "rp-list rp-cols" }, m.moves.items.map(function (x) {
      return li(dm(x.at) + sep() + x.rfq + (x.customer ? sep() + nm(x.customer, 24) : "") + sep() + (x.from ? x.from + " → " : "→ ") + x.to);
    }).concat([more(m.moves.more)])));
    var foot = ["New RFQs in range: " + m.newRfqs + sep()];
    if (m.quoteOverdue > 0) foot.push(red("Quote overdue: " + m.quoteOverdue)); else foot.push("Quote overdue: 0");
    kids.push(el("p", { class: "rp-line" }, foot));
    return sec("repRfq", "RFQ pipeline", kids);
  }

  function secFollow(m) {
    var kids = [];
    kids.push(sub("Overdue follow-ups (" + m.overdue.total + ")"));
    if (!m.overdue.total) kids.push(none("No overdue follow-ups."));
    else kids.push(el("ul", { class: "rp-list" }, m.overdue.items.map(function (x) {
      return li([nm(x.name, 30), " — ", red(overdueWords(x.days)), contactBit(x, m.includeContacts)]);
    }).concat([more(m.overdue.more)])));
    kids.push(sub("Due in the next 7 days (" + m.dueNext.total + ")"));
    if (!m.dueNext.total) kids.push(none("Nothing due in the next 7 days."));
    else kids.push(el("ul", { class: "rp-list" }, m.dueNext.items.map(function (x) {
      return li([nm(x.name, 30), " — ", x.days === 0 ? orange("Due today") : "Due " + Ui.fmt.day(x.followUp), contactBit(x, m.includeContacts)]);
    }).concat([more(m.dueNext.more)])));
    return sec("repFollow", "Follow-ups", kids);
  }

  function secContact(m) {
    var c = m.contact, bt = c.byType, kids = [];
    kids.push(el("p", { class: "rp-line" }, "Calls " + bt.Call + sep() + "Visits " + bt.Visit + sep() + "Emails " + bt.Email + sep() + "Telegram " + bt.Telegram + sep() + c.total + " logged"));
    if (!c.total) kids.push(none("No calls or visits logged in this range."));
    else kids.push(el("p", { class: "rp-names" }, c.names.map(function (n) { return nm(n, 26); }).join(", ") + (c.namesMore ? " +" + c.namesMore + " more" : "")));
    if (c.notes) {
      kids.push(sub("Notes (private)"));
      if (!c.notes.total) kids.push(none("No note text in this range."));
      else kids.push(el("ul", { class: "rp-list" }, c.notes.items.map(function (n) {
        return li(dm(n.at) + sep() + nm(n.name, 26) + ": " + n.text);
      }).concat([more(c.notes.more)])));
    }
    return sec("repContact", "Calls and visits this week", kids);
  }

  function secRisk(m) {
    var r = m.atRisk;
    var kids = [];
    if (!r.total) kids.push(none("No customers are marked At risk."));
    else kids.push(el("ul", { class: "rp-list" }, r.items.map(function (x) {
      return li(nm(x.name, 28) + sep() + "last order " + (x.last ? dm(x.last) : "none") + sep() + "contacted " + (x.lastContacted ? dm(x.lastContacted) : "never"));
    }).concat([more(r.more)])));
    return sec("repRisk", "At-risk customers (" + r.total + ")", kids);
  }

  function secMoney(m) {
    var x = m.money, kids = [];
    var head = [x.overdue == null ? "Overdue amount: not in the imported file" : [red("Overdue"), " ", Ui.amountEl(x.overdue, "rp-amt", true)]];
    if (x.overduePct != null) head.push(" (" + Math.round(x.overduePct) + "% of outstanding)");
    if (x.stale) head.push(sep(), orange("data may be out of date"));
    kids.push(el("p", { class: "rp-line" }, head));
    var parts_ = [];
    x.buckets.forEach(function (b, i) { if (b.amount != null) { if (parts_.length) parts_.push(sep()); parts_.push(b.label + " ", Ui.amountEl(b.amount, "rp-amt", true)); } });
    if (parts_.length) kids.push(el("p", { class: "rp-line" }, parts_));
    if (x.top.total) kids.push(el("ul", { class: "rp-list" }, x.top.items.map(function (t) {
      return li([nm(t.name, 34) + " — ", Ui.amountEl(t.overdue, "rp-amt", true)]);
    }).concat([more(x.top.more)])));
    return sec("repMoney", "Money overdue", kids);
  }

  function secOrders(m) {
    var x = m.lateOrders, kids = [];
    var head = x.count > 0 ? [red("Late orders: " + x.count)] : ["No late orders"];
    if (x.dueToday) head.push(sep(), orange("Due today: " + x.dueToday));
    if (x.dueWeek) head.push(sep() + "Due this week: " + x.dueWeek);
    kids.push(el("p", { class: "rp-line" }, head));
    if (x.items.length) kids.push(el("ul", { class: "rp-list" }, x.items.map(function (o) {
      return li([(o.orderNo ? o.orderNo + sep() : "") + nm(o.customer, 22) + (o.part ? sep() + o.part : "") + sep() + "promised " + dm(o.promised) + " — ", red("Late by " + plural(o.days, "day"))]);
    }).concat([more(x.more)])));
    return sec("repOrders", "Late orders", kids);
  }

  function secRevenue(m) {
    var x = m.revenue, kids = [];
    var line1 = ["FY " + (x.fy || "") + " to date ", Ui.amountEl(x.fytd, "rp-amt", true)];
    if (x.mtd != null) line1.push(sep() + (x.mtdLabel || "This month") + " ", Ui.amountEl(x.mtd, "rp-amt", true));
    if (x.changePct != null) line1.push(sep() + (x.changePct >= 0 ? "+" : "") + Math.round(x.changePct) + "% vs last FY");
    kids.push(el("p", { class: "rp-line" }, line1));
    if (x.target) {
      var t = x.target, line2;
      if (t.pct == null) line2 = ["Target set; progress not available"];
      else line2 = [Math.round(t.pct) + "% of target" + sep(), t.behind ? red("Behind pace: " + Math.round(t.pct) + "% of target, " + Math.round(t.pacePct || 0) + "% expected") : "On pace"];
      kids.push(el("p", { class: "rp-line" }, line2));
    } else kids.push(none("No target set for this year."));
    if (x.dataThrough) kids.push(el("p", { class: "rp-small", text: "Data through " + Ui.fmt.date(x.dataThrough) }));
    if (x.excludedRelated) kids.push(el("p", { class: "rp-small", text: "Excludes " + plural(x.excludedRelated.n, "related party", "related parties") }));
    return sec("repRevenue", "Revenue vs target", kids);
  }

  function secLeads(m) {
    var L = m.leads;
    if (!L.available) return sec("repLeads", "Leads", none("No data: the Leads module is not available yet."));
    var kids = [];
    kids.push(sub("Leads touched this week (" + L.touched.total + ")"));
    if (!L.touched.total) kids.push(none("No leads were contacted in this range."));
    else kids.push(el("p", { class: "rp-names", text: L.touched.names.map(function (n) { return nm(n, 26); }).join(", ") + (L.touched.more ? " +" + L.touched.more + " more" : "") }));
    kids.push(el("p", { class: "rp-line" }, L.followOverdue > 0 ? [red("Lead follow-ups overdue: " + L.followOverdue)] : ["Lead follow-ups overdue: 0"]));
    kids.push(sub("Dormant leads to reactivate"));
    if (!L.reactivate.total) kids.push(none("No dormant leads to show."));
    else kids.push(el("ul", { class: "rp-list" }, L.reactivate.items.map(function (r) {
      return li(nm(r.company, 28) + (r.lastContact ? sep() + "last contact " + dm(r.lastContact) + " " + r.lastContact.slice(0, 4) : sep() + "no contact logged"));
    }).concat([more(L.reactivate.more)])));
    return sec("repLeads", "Leads", kids);
  }

  function secActions(m) {
    var kids = [];
    if (!m.actions.total) kids.push(none("No follow-ups are overdue or due in the next 7 days."));
    else kids.push(el("ol", { class: "rp-actions" }, m.actions.items.map(function (a) {
      if (a.kind === "lead") return li(["Follow up lead ", nm(a.name, 40) + ": ", red("follow-up overdue by " + plural(a.days, "day"))]);
      var who = nm(a.name, 40) + contactBit(a, m.includeContacts);
      if (a.kind === "overdue") return li(["Call " + who + ": ", red("follow-up overdue by " + plural(a.days, "day"))]);
      return li(["Call " + who + ": ", a.days === 0 ? orange("follow-up due today") : "follow-up due " + Ui.fmt.day(a.followUp)]);
    })));
    kids.push(el("p", { class: "rp-small", text: "Actions = overdue follow-ups, oldest first, then the next ones due, then overdue lead follow-ups." }));
    return sec("repActions", "Top 5 actions for next week", kids);
  }

  function footer(m) {
    var kids = [];
    var asof = [];
    if (m.asOf.money) asof.push("Money as of " + Ui.fmt.date(m.asOf.money));
    if (m.asOf.orders) asof.push("Orders as of " + Ui.fmt.date(m.asOf.orders));
    if (m.asOf.revenue) asof.push("Revenue data through " + Ui.fmt.date(m.asOf.revenue));
    if (asof.length) kids.push(el("p", { class: "rp-small", text: "Data as of: " + asof.join(sep()) }));
    if (m.missing.length) kids.push(el("p", { class: "rp-small rp-nodata", text: "No data for: " + m.missing.join("; ") + "." }));
    kids.push(el("p", { class: "rp-small", text: "Contact details: " + (m.includeContacts ? "included (private)" : "not included") + sep() + "Note text: " + (m.includeNotes ? "included (private)" : "not included") }));
    return el("footer", { class: "rp-foot" }, kids);
  }

  function buildPage(m) {
    var head = el("div", { class: "rp-head" }, [
      el("span", { class: "rp-badge" }, el("img", { src: "assets/varsha-logo.jpg", alt: "Varsha Forgings", width: 40, height: 40 })),
      el("div", { class: "rp-title" }, [
        el("div", { class: "rp-h1", text: "Varsha Forgings · Weekly sales review" }),
        el("div", { class: "rp-range", id: "repRangeText", text: rangeText(m.range) + " (India time)" })
      ]),
      el("div", { class: "rp-prep", text: "Prepared " + Ui.fmt.date(m.today) })
    ]);
    var left = el("div", { class: "rp-col" }, [secFollow(m), m.money ? secMoney(m) : null, m.lateOrders ? secOrders(m) : null, m.revenue ? secRevenue(m) : null]);
    var right = el("div", { class: "rp-col" }, [secContact(m), secRisk(m), secLeads(m)]);
    return el("div", { class: "rp-body" }, [head, boxes(m), secRfq(m), el("div", { class: "rp-grid" }, [left, right]), secActions(m), footer(m)]);
  }

  /* ---------- render and fit to one A4 page ---------- */
  var A4_PX = 297 * 96 / 25.4;
  function contentHeight(pageEl) {
    // measure in print geometry (A4 width, two columns) whatever the screen width is
    pageEl.classList.add("rp-measure");
    var h = pageEl.firstChild ? pageEl.firstChild.offsetHeight : 0;
    var cs = getComputedStyle(pageEl);
    var pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    pageEl.classList.remove("rp-measure");
    return h + pad;
  }
  function render() {
    if (!dlg || !dlg.open || !current) return;
    var deps = gather(current);
    deps.includeNotes = parts.notes.checked;
    deps.includeContacts = parts.contacts.checked;
    var page = parts.page, model = null, steps = 0, fits = false, heights = [], caps = mergeCaps(null);
    for (steps = 0; steps < 80; steps++) {
      deps.caps = caps;
      model = compute({ from: current.from, to: current.to }, deps);
      Ui.clear(page).appendChild(buildPage(model));
      var h = contentHeight(page);
      heights.push(Math.round(h));
      if (h <= A4_PX - 1) { fits = true; break; }
      var next = nextCaps(model, caps);
      if (!next) break;
      caps = next;
    }
    parts.page.dataset.trimSteps = String(steps);
    parts.page.dataset.fitHeights = heights.join(",");
    var level = steps;
    parts.warn.hidden = fits && level === 0;
    parts.warn.textContent = fits
      ? "This week has more items than fit on one page; the lists are shortened, so open the tabs for the full lists."
      : "This week has more items than fit on one page; the lists are cut, so open the tabs for the full lists.";
    parts.last7.hidden = current.from === pure.defaultRange(deps.today).from && current.to === deps.today;
    parts.saved.hidden = parts.last7.hidden ? true : false;
    current.model = model;
  }

  /* ---------- range ---------- */
  function savedRange(today) {
    var v = App.view(VIEW_ID) || {};
    if (isISO(v.from) && isISO(v.to) && v.from <= v.to && v.to <= today) return { from: v.from, to: v.to };
    return pure.defaultRange(today);
  }
  function saveRange(r, isDefault) { App.setView(VIEW_ID, isDefault ? {} : { from: r.from, to: r.to }); }
  function applyRange() {
    var today = Store.todayISO(), f = parts.from.value, t = parts.to.value;
    parts.err.textContent = "";
    if (!isISO(f) || !isISO(t)) { parts.err.textContent = "Pick both dates."; return; }
    if (t > today) { parts.err.textContent = "To can't be in the future."; return; }
    if (f > t) { parts.err.textContent = "From must be on or before To."; return; }
    current.from = f; current.to = t;
    var def = pure.defaultRange(today);
    saveRange(current, f === def.from && t === def.to);
    render();
  }
  function resetRange() {
    var def = pure.defaultRange(Store.todayISO());
    current.from = def.from; current.to = def.to;
    parts.from.value = def.from; parts.to.value = def.to;
    parts.err.textContent = "";
    saveRange(def, true);
    render();
  }

  /* ---------- print ---------- */
  /* @page cannot be scoped by a class, so the A4 / no-margin rule is added only while the report prints. */
  function endPrint() {
    document.body.classList.remove("print-report");
    var st = document.getElementById("repPageStyle");
    if (st) st.remove();
    if (printTitle != null) { document.title = printTitle; printTitle = null; }
  }
  function doPrint() {
    if (!current || !current.model) return;
    printTitle = document.title;
    document.title = "Varsha weekly sales review " + rangeText(current.model.range);
    document.body.classList.add("print-report");
    if (!document.getElementById("repPageStyle")) {
      var st = el("style", { id: "repPageStyle" });
      st.textContent = "@page { size: A4; margin: 0; }";
      document.head.appendChild(st);
    }
    window.addEventListener("afterprint", endPrint, { once: true });
    try { window.print(); } catch (e) { warn("print failed", e); endPrint(); }
  }

  /* ---------- dialog ---------- */
  function build() {
    parts.from = el("input", { type: "date", id: "repFrom", "aria-label": "From date" });
    parts.to = el("input", { type: "date", id: "repTo", "aria-label": "To date" });
    parts.last7 = el("button", { class: "btn-sm", type: "button", id: "repLast7", text: "Last 7 days" });
    parts.notes = el("input", { type: "checkbox", id: "repNotes" });
    parts.contacts = el("input", { type: "checkbox", id: "repContacts" });
    parts.print = el("button", { class: "btn primary", type: "button", id: "repPrint", text: "Print / Save as PDF" });
    parts.close = el("button", { class: "btn", type: "button", id: "repClose", text: "Close" });
    parts.err = el("p", { class: "form-err", id: "repErr", role: "alert" });
    parts.saved = el("span", { class: "rp-saved", id: "repSaved", text: "Showing your saved date range." });
    parts.warn = el("p", { class: "rp-warn no-print overflow-warn", id: "repWarn", role: "status" });
    parts.page = el("div", { id: "reportPage" });

    var bar = el("div", { class: "rp-bar no-print" }, [
      el("div", { class: "rp-bar-row" }, [
        el("label", { class: "rp-field" }, ["From", parts.from]),
        el("label", { class: "rp-field" }, ["To", parts.to]),
        parts.last7, parts.saved
      ]),
      el("div", { class: "rp-bar-row" }, [
        el("label", { class: "rp-check" }, [parts.notes, el("span", { text: "Include note text (private)" })]),
        el("label", { class: "rp-check" }, [parts.contacts, el("span", { text: "Include contact details (private)" })])
      ]),
      el("div", { class: "rp-bar-row rp-bar-actions" }, [parts.print, parts.close]),
      parts.err, parts.warn
    ]);
    dlg = el("dialog", { id: "reportDlg", class: "report", "aria-label": "Weekly sales review" }, [bar, el("div", { class: "rp-scroll" }, parts.page)]);
    document.body.appendChild(dlg);

    parts.from.addEventListener("change", applyRange);
    parts.to.addEventListener("change", applyRange);
    parts.last7.addEventListener("click", resetRange);
    parts.notes.addEventListener("change", render);
    parts.contacts.addEventListener("change", render);
    parts.print.addEventListener("click", doPrint);
    parts.close.addEventListener("click", function () { Ui.closeDialog(dlg); });
    dlg.addEventListener("close", function () { endPrint(); current = null; });
    if (window.App && App.onData) App.onData(function () { if (dlg.open) render(); });
  }

  /* open({ from, to }) - an explicit range wins and is saved; otherwise the saved range, else the last 7 days (India time). */
  function open(opts) {
    opts = opts || {};
    if (!dlg) build();
    var today = Store.todayISO();
    if (dlg.open) { if (opts.depsOverride || opts.deps) current.depsOverride = opts.deps || opts.depsOverride; render(); return; }
    var range;
    if (isISO(opts.from) && isISO(opts.to) && opts.from <= opts.to && opts.to <= today) { range = { from: opts.from, to: opts.to }; var d0 = pure.defaultRange(today); saveRange(range, range.from === d0.from && range.to === d0.to); }
    else range = savedRange(today);
    current = { from: range.from, to: range.to, depsOverride: opts.deps || null };
    parts.from.value = range.from; parts.to.value = range.to;
    parts.from.max = today; parts.to.max = today;
    parts.notes.checked = false; parts.contacts.checked = false;     // never remembered
    parts.err.textContent = "";
    var opener = opts.opener || (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
    Ui.openDialog(dlg, opener);
    render();
  }

  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("#weeklyReportBtn, #weeklyReportBtn2") : null;
    if (b && !b.disabled) open({ opener: b });
  });

  window.CrmReport = { open: open, compute: compute, close: function () { if (dlg) Ui.closeDialog(dlg); }, DEFAULT_CAPS: DEFAULT_CAPS };
})();
