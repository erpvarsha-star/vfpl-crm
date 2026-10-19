/* Store: the only data layer (stage A: localStorage "localdb"). Frozen contract: design section 4.1. Owned by A1.
   Open lists: modules add collections and documents by calling Store.col(name) / Store.doc(name) (auto-registered),
   or Store.registerCollection / Store.registerDoc to set options (backup, imported). Nothing here lists modules.
   Also module.exports for Node unit tests (no window needed; storage falls back to memory). */
(function () {
  "use strict";

  var hasWindow = typeof window !== "undefined";
  var DB_KEY = "varsha-crm-localdb-v1";
  var LEGACY_KEY = "varsha-crm-local-v2", LEGACY_DONE = "varsha-crm-legacy-done-v1", LEGACY_BACKUP = "varsha-crm-local-v2-backup";
  var STATUSES = ["Active", "Follow up", "At risk"];
  var SEGMENTS = ["OEM", "Tier-1", "Tier-2", "Trader", "Export"];
  var VEHICLE_SEGMENTS = ["PV", "CV", "Tractor", "2W", "Off-highway", "Other"];
  var LOG_TYPES = ["Call", "Visit", "Email", "Telegram", "Note"];
  var CONTACT_TYPES = ["Call", "Visit", "Email", "Telegram"];
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  var NAME_OK = /^[a-z][a-z0-9_]{0,39}$/;
  var RESERVED = { v: 1, customers: 1, log: 1, deleted: 1, orders_meta: 1 };
  var PHONE_OK = /^[0-9+()\-\s.\/–]*$/;

  /* ---------- registries (open lists) ---------- */
  // collections: name -> { backup: include in the backup under "extra" (built-ins keep their named keys) }
  var collections = {
    rfqs: { backup: true }, rfq_history: { backup: true }, visits: { backup: true }, orders: { backup: true }
  };
  // docs: name -> { key: localStorage key (null = lives inside localdb), backup, imported (dataset the Export tab can clear) }
  var docs = {
    money: { key: "varsha-crm-money-v1", backup: false, imported: true },
    aliases: { key: "varsha-crm-aliases-v1", backup: false, imported: false },
    revenue: { key: "varsha-crm-revenue-v1", backup: false, imported: true },
    targets: { key: "varsha-crm-targets-v1", backup: true, imported: false },
    orders_meta: { key: null, backup: true, imported: true }
  };
  function checkName(name) {
    if (!NAME_OK.test(String(name))) throw new Error("Bad name: " + name);
  }
  function registerCollection(name, opts) {
    checkName(name);
    if (RESERVED[name]) throw new Error("Reserved name: " + name);
    var c = collections[name] || (collections[name] = { backup: false });
    if (opts && opts.backup != null) c.backup = !!opts.backup;
    if (!db[name]) db[name] = [];
    return name;
  }
  function registerDoc(name, opts) {
    checkName(name);
    var d = docs[name] || (docs[name] = { key: "varsha-crm-" + name.replace(/_/g, "-") + "-v1", backup: false, imported: false });
    if (opts) {
      if (opts.key && d.key !== null) d.key = String(opts.key);
      if (opts.backup != null) d.backup = !!opts.backup;
      if (opts.imported != null) d.imported = !!opts.imported;
    }
    return name;
  }

  /* ---------- storage (blocked storage keeps data in memory) ---------- */
  var memory = {};
  var storageOK = true;
  function lsObj() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { if (hasWindow) storageOK = false; return null; }
  }
  function lsGet(k) {
    if (Object.prototype.hasOwnProperty.call(memory, k)) return memory[k];
    var s = lsObj();
    if (!s) return null;
    try { return s.getItem(k); } catch (e) { storageOK = false; return null; }
  }
  function lsSet(k, v) {
    memory[k] = v;
    var s = lsObj();
    if (!s) return;
    try { s.setItem(k, v); } catch (e) { storageOK = false; }
  }
  function lsRemove(k) {
    memory[k] = null;
    var s = lsObj();
    if (!s) return;
    try { s.removeItem(k); } catch (e) { storageOK = false; }
  }

  /* ---------- helpers ---------- */
  function todayISO(now) { return new Date(now == null ? Date.now() : now).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }
  function dayNum(iso) { return Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000); }
  function addDays(iso, n) { return new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function realISO(s) {
    if (!ISO.test(s || "")) return false;
    var t = Date.parse(s + "T00:00:00Z");
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }
  function iso(v) { return realISO(v) ? v : ""; }
  function fuKind(c, today) {
    if (!c.followUp) return "none";
    var d = dayNum(c.followUp) - dayNum(today);
    return d < 0 ? "overdue" : d === 0 ? "today" : d <= 7 ? "week" : "later";
  }
  function fuText(c, today) {
    if (!c.followUp) return "";
    var d = dayNum(c.followUp) - dayNum(today);
    if (d < 0) return "Overdue by " + (-d) + (d === -1 ? " day" : " days");
    if (d === 0) return "Due today";
    if (d === 1) return "Tomorrow";
    return "In " + d + " days";
  }
  function lastBucket(c, refISO) {
    if (!c.last) return "never";
    var d = daysBetween(c.last, refISO || todayISO());
    return d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "91+";
  }
  function slug(name, isTaken) {
    var base = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      .slice(0, 60).replace(/-+$/, "") || "customer";
    var id = base, n = 2;
    while (isTaken && isTaken(id)) id = base + "-" + n++;
    return id;
  }
  function uuid() {
    var c = typeof crypto !== "undefined" ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function nameKey(n) {
    return String(n == null ? "" : n).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/&/g, " and ").replace(/\bprivate\b/g, "pvt").replace(/\blimited\b/g, "ltd").replace(/[^a-z0-9]/g, "");
  }
  function lower(s) { return String(s || "").toLowerCase(); }
  function nowISO() { return new Date().toISOString(); }
  function stamp(row) {
    var n = nowISO();
    if (n === row.created_at || n === row.updated_at) n = new Date(Date.parse(n) + 1).toISOString();
    return n;
  }
  function isPlain(o) { return o !== null && typeof o === "object" && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype; }
  function ok(extra) {
    var r = { ok: true, queued: false };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return Promise.resolve(r);
  }
  function fail(error, field) { return Promise.resolve({ ok: false, error: error, field: field || "" }); }

  /* ---------- state ---------- */
  var db = emptyDb();
  var listeners = [];
  var seedNote = "";
  var seedExport = null;      // id -> exported JSON of the committed row, to count unsaved edits
  var loadError = "";
  var opts = {};
  var inited = false;
  var uiCache = null, uiById = null;

  function emptyDb() {
    var d = { v: 1, customers: [], log: [], deleted: [], orders_meta: null };
    Object.keys(collections).forEach(function (n) { d[n] = []; });
    return d;
  }
  function emit(reason, detail) {
    uiCache = null;
    listeners.slice().forEach(function (cb) {
      try { cb(reason, detail); } catch (e) { if (typeof console !== "undefined") console.warn("Store listener failed", e); }
    });
  }
  function onChange(cb) { if (typeof cb === "function") listeners.push(cb); }
  function persist() { lsSet(DB_KEY, JSON.stringify(db)); }

  function readDb() {
    var raw = lsGet(DB_KEY), parsed = null;
    db = emptyDb();
    if (!raw) return;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      lsSet(DB_KEY + "-corrupt", raw);
      return;
    }
    migrate(parsed);
    Object.keys(parsed).forEach(function (k) {
      if (k === "v") return;
      if (k === "orders_meta") db.orders_meta = isPlain(parsed[k]) ? parsed[k] : null;
      else if (Array.isArray(parsed[k]) && NAME_OK.test(k)) {
        if (!collections[k] && !RESERVED[k]) collections[k] = { backup: false };
        db[k] = parsed[k];
      }
    });
    if (!Array.isArray(db.deleted)) db.deleted = [];
  }
  function migrate(d) { /* fromV upgrades go here; localdb v1 needs none */ return d; }

  /* ---------- customer rows <-> UI objects ---------- */
  function toUI(r) {
    return {
      id: r.id, name: r.name, contact: r.contact || "", contactFrom: r.contact_from || "", city: r.city || "", state: r.state || "",
      phone: r.phone || "", last: r.last_order || "", followUp: r.follow_up || "", status: r.status, disputed: !!r.disputed,
      group: r.grp || "", segment: r.segment || "", vehicleSegment: r.vehicle_segment || "",
      plants: (r.plants || []).map(function (p) { return { id: p.id, name: p.name, city: p.city, state: p.state }; }),
      relatedParty: !!r.related_party, erpGroup: r.erp_group || "",
      added: r.source === "manual", updatedAt: r.updated_at, createdAt: r.created_at
    };
  }
  function ensureUI() {
    if (uiCache) return;
    uiCache = db.customers.map(toUI);
    uiById = {};
    uiCache.forEach(function (c) { uiById[c.id] = c; });
  }
  function rowById(id) {
    for (var i = 0; i < db.customers.length; i++) if (db.customers[i].id === id) return db.customers[i];
    return null;
  }
  function exportRow(c) {
    return {
      id: c.id, name: c.name, contact: c.contact, contactFrom: c.contactFrom, city: c.city, state: c.state, phone: c.phone,
      last: c.last, followUp: c.followUp, status: c.status, disputed: c.disputed, group: c.group, segment: c.segment,
      vehicleSegment: c.vehicleSegment,
      plants: c.plants.map(function (p) { return { id: p.id, name: p.name, city: p.city, state: p.state }; }),
      relatedParty: c.relatedParty, erpGroup: c.erpGroup
    };
  }

  /* ---------- validation ---------- */
  function str(v) { return v == null ? "" : String(v).trim(); }
  function cleanPlants(list, idFor, counts) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (p, i) {
      if (!p || typeof p !== "object") return;
      var q = { id: p.id ? String(p.id) : idFor(i), name: str(p.name).slice(0, 80), city: str(p.city).slice(0, 60), state: str(p.state).slice(0, 60) };
      if (!q.city && !q.state) { if (counts) counts.plants++; return; }
      out.push(q);
    });
    return out.slice(0, 20);
  }
  /* validate(fields, { add: true } | { id }) -> { ok, error, field, patch } with patch in row (snake) keys. Only keys present are checked. */
  function validate(f, o) {
    o = o || {};
    f = f || {};
    var has = function (k) { return Object.prototype.hasOwnProperty.call(f, k); };
    var p = {}, e;
    function bad(msg, field) { return { ok: false, error: msg, field: field }; }
    if (o.add || has("name")) {
      var name = str(f.name);
      if (!name) return bad("Enter a customer name.", "name");
      if (name.length > 120) return bad("Customer name can have 120 characters at most.", "name");
      var dup = db.customers.some(function (r) { return r.id !== o.id && lower(r.name) === lower(name); });
      if (dup) return bad(name + " is already in the list.", "name");
      p.name = name;
    }
    if (has("contact")) { var ct = str(f.contact); if (ct.length > 80) return bad("Contact person can have 80 characters at most.", "contact"); p.contact = ct; }
    if (has("phone")) {
      var ph = str(f.phone);
      if (ph.length > 30) return bad("Phone can have 30 characters at most.", "phone");
      if (!PHONE_OK.test(ph)) return bad("Phone can only have digits and + ( ) - . /", "phone");
      p.phone = ph;
    }
    if (has("city")) { var ci = str(f.city); if (ci.length > 60) return bad("City can have 60 characters at most.", "city"); p.city = ci; }
    if (has("last")) {
      if (f.last && !realISO(f.last)) return bad("Last order date is not a valid date.", "last");
      p.last_order = f.last || "";
    }
    if (has("followUp")) {
      if (f.followUp && !realISO(f.followUp)) return bad("Follow-up date is not a valid date.", "followUp");
      p.follow_up = f.followUp || "";
    }
    if (has("status") || o.add) {
      var st = has("status") && f.status ? f.status : "Active";
      if (STATUSES.indexOf(st) === -1) return bad("Status must be Active, Follow up or At risk.", "status");
      p.status = st;
    }
    if (has("group")) { var g = str(f.group); if (g.length > 80) return bad("Group can have 80 characters at most.", "group"); p.grp = g; }
    if (has("segment")) {
      if (f.segment && SEGMENTS.indexOf(f.segment) === -1) return bad("Segment must be one from the list.", "segment");
      p.segment = f.segment || "";
    }
    if (has("vehicleSegment")) {
      if (f.vehicleSegment && VEHICLE_SEGMENTS.indexOf(f.vehicleSegment) === -1) return bad("Vehicle segment must be one from the list.", "vehicleSegment");
      p.vehicle_segment = f.vehicleSegment || "";
    }
    if (has("relatedParty")) p.related_party = !!f.relatedParty;
    if (has("plants")) {
      if (!Array.isArray(f.plants)) return bad("Plants must be a list.", "plants");
      if (f.plants.length > 20) return bad("A customer can have 20 plants at most.", "plants");
      for (var i = 0; i < f.plants.length; i++) {
        var pl = f.plants[i] || {};
        if (str(pl.name).length > 80) return bad("Plant " + (i + 1) + " name can have 80 characters at most.", "plants");
        if (str(pl.city).length > 60 || str(pl.state).length > 60) return bad("Plant " + (i + 1) + " city and state can have 60 characters at most.", "plants");
        if (!str(pl.city) && !str(pl.state)) return bad("Plant " + (i + 1) + " needs a city or a state.", "plants");
      }
      p.plants = cleanPlants(f.plants, function () { return uuid(); });
    }
    e = null;
    return { ok: true, patch: p };
  }
  function derive(row) {
    if (row.plants && row.plants.length) { row.city = row.plants[0].city; row.state = row.plants[0].state; }
  }

  /* ---------- customers ---------- */
  function customers() { ensureUI(); return uiCache; }
  function get(id) { ensureUI(); return uiById[id]; }
  function latestOrder() {
    var m = "";
    db.customers.forEach(function (r) { if (r.last_order && r.last_order > m) m = r.last_order; });
    return m;
  }
  function groups() {
    var seen = {}, out = [];
    db.customers.forEach(function (r) { if (r.grp && !seen[r.grp]) { seen[r.grp] = 1; out.push(r.grp); } });
    return out.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
  }

  function newRowFromPatch(p, source, id, now) {
    var r = {
      id: id, name: p.name, contact: p.contact || "", contact_from: "", city: p.city || "", state: "", phone: p.phone || "",
      last_order: p.last_order || "", follow_up: p.follow_up || "", status: p.status || "Active", disputed: false,
      grp: p.grp || "", segment: p.segment || "", vehicle_segment: p.vehicle_segment || "", plants: p.plants || [],
      related_party: !!p.related_party, erp_group: "", source: source, created_at: now, updated_at: now, updated_by: ""
    };
    derive(r);
    return r;
  }
  function addCustomerSync(f) {
    var v = validate(f, { add: true });
    if (!v.ok) return v;
    var r = newRowFromPatch(v.patch, "manual", slug(v.patch.name, function (id) { return !!rowById(id); }), nowISO());
    db.customers.push(r);
    return { ok: true, row: r };
  }
  function addCustomer(f) {
    var res = addCustomerSync(f);
    if (!res.ok) return fail(res.error, res.field);
    persist(); emit("customers");
    return ok({ id: res.row.id, customer: get(res.row.id) });
  }
  function patchRow(r, p) {
    var contactChanged = Object.prototype.hasOwnProperty.call(p, "contact") && p.contact !== r.contact;
    Object.keys(p).forEach(function (k) { r[k] = p[k]; });
    if (contactChanged) r.contact_from = "";
    derive(r);
    r.updated_at = stamp(r);
  }
  function saveCustomer(id, fields) {
    var r = rowById(id);
    if (!r) return fail("That customer no longer exists.");
    var v = validate(fields, { id: id });
    if (!v.ok) return fail(v.error, v.field);
    patchRow(r, v.patch);
    persist(); emit("customers");
    return ok({ customer: get(id) });
  }
  function setStatus(id, s) { return saveCustomer(id, { status: s }); }
  function setFollowUp(id, d) { return saveCustomer(id, { followUp: d || "" }); }
  function refs(id) {
    var n = function (name) { return (db[name] || []).filter(function (x) { return x.customer_id === id; }).length; };
    return { rfqs: n("rfqs"), visits: n("visits"), orders: n("orders") };
  }
  function removeCustomer(id) {
    var r = rowById(id);
    if (!r) return fail("That customer no longer exists.");
    if (r.source !== "manual") return fail("Only customers you added can be removed.");
    var rf = refs(id), total = rf.rfqs + rf.visits + rf.orders;
    if (total) return fail("Remove its RFQs and visits first (" + total + ").");
    db.customers = db.customers.filter(function (x) { return x.id !== id; });
    db.log = db.log.filter(function (l) { return l.customer_id !== id; });
    persist(); emit("customers"); emit("log");
    return ok();
  }

  /* ---------- call log ---------- */
  function logUI(l) {
    return { id: l.id, customerId: l.customer_id, at: l.at, type: l.type, note: l.note, doneFollowUp: !!l.done_follow_up,
             nextFollowUp: l.next_follow_up || "", createdAt: l.created_at };
  }
  function cmpLog(a, b) { return (b.at.localeCompare(a.at)) || (b.created_at.localeCompare(a.created_at)); }
  function listLog(id) { return db.log.filter(function (l) { return l.customer_id === id; }).sort(cmpLog).map(logUI); }
  function allLog() { return db.log.slice().sort(cmpLog).map(logUI); }
  function logCount(id) { return db.log.filter(function (l) { return l.customer_id === id; }).length; }
  function lastContacted(id) {
    var m = "";
    db.log.forEach(function (l) { if (l.customer_id === id && CONTACT_TYPES.indexOf(l.type) !== -1 && l.at > m) m = l.at; });
    return m;
  }
  function checkLogFields(f, requireNote) {
    var today = todayISO();
    var at = f.at || today;
    if (!realISO(at)) return { error: "Date is not valid.", field: "at" };
    if (at > today) return { error: "Date can't be in the future.", field: "at" };
    var type = f.type || "Note";
    if (LOG_TYPES.indexOf(type) === -1) return { error: "Pick a type from the list.", field: "type" };
    var note = str(f.note);
    if (requireNote && !note) return { error: "Write a note first.", field: "note" };
    if (note.length > 500) return { error: "A note can have 500 characters at most.", field: "note" };
    return { at: at, type: type, note: note };
  }
  function addLog(id, f) {
    if (!rowById(id)) return fail("That customer no longer exists.");
    var c = checkLogFields(f || {}, true);
    if (c.error) return fail(c.error, c.field);
    var entry = { id: uuid(), customer_id: id, at: c.at, type: c.type, note: c.note, done_follow_up: false, next_follow_up: "", created_at: nowISO(), created_by: "" };
    db.log.push(entry);
    persist(); emit("log");
    return ok({ entry: logUI(entry) });
  }
  function markDone(id, f) {
    var r = rowById(id);
    if (!r) return fail("That customer no longer exists.");
    f = f || {};
    var c = checkLogFields({ type: f.type || "Call", note: f.note }, false);
    if (c.error) return fail(c.error, c.field);
    var today = todayISO(), next = f.next || "";
    if (next) {
      if (!realISO(next)) return fail("Next follow-up is not a valid date.", "next");
      if (next < today) return fail("Pick today or a later date for the next follow-up.", "next");
    }
    var entry = { id: uuid(), customer_id: id, at: today, type: c.type, note: c.note, done_follow_up: !!r.follow_up, next_follow_up: next, created_at: nowISO(), created_by: "" };
    db.log.push(entry);
    patchRow(r, { follow_up: next });
    persist(); emit("customers"); emit("log");
    return ok({ entry: logUI(entry) });
  }

  /* ---------- generic collections ---------- */
  function col(name) {
    checkName(name);
    if (RESERVED[name]) throw new Error("Reserved name: " + name);
    if (!collections[name]) registerCollection(name);
    if (!db[name]) db[name] = [];
    function rows() { return db[name]; }
    function valid(row) {
      if (!isPlain(row)) return "Row must be a plain object.";
      var s;
      try { s = JSON.stringify(row); } catch (e) { return "Row can't be saved."; }
      return s.length > 10240 ? "Row is too big (10 KB at most)." : "";
    }
    return {
      all: function () { return rows().slice(); },
      get: function (id) { return rows().filter(function (r) { return r.id === id; })[0]; },
      where: function (fn) { return rows().filter(fn); },
      insert: function (row) {
        var err = valid(row);
        if (err) return fail(err);
        var r = JSON.parse(JSON.stringify(row)), now = nowISO();
        if (!r.id) r.id = uuid();
        else if (rows().some(function (x) { return x.id === r.id; })) return fail("A row with that id already exists.");
        r.created_at = r.created_at || now; r.updated_at = now;
        rows().push(r);
        persist(); emit(name);
        return ok({ row: r });
      },
      patch: function (id, fields) {
        var r = this.get(id);
        if (!r) return fail("That row no longer exists.");
        var merged = Object.assign({}, r, fields || {});
        var err = valid(merged);
        if (err) return fail(err);
        Object.keys(fields || {}).forEach(function (k) { if (k !== "id") r[k] = JSON.parse(JSON.stringify(fields[k])); });
        r.updated_at = stamp(r);
        persist(); emit(name);
        return ok({ row: r });
      },
      remove: function (id) {
        var n = rows().length;
        db[name] = rows().filter(function (r) { return r.id !== id; });
        if (db[name].length === n) return fail("That row no longer exists.");
        persist(); emit(name);
        return ok();
      },
      replaceAll: function (list) {
        if (!Array.isArray(list)) return fail("Rows must be a list.");
        var now = nowISO(), out = [];
        for (var i = 0; i < list.length; i++) {
          var err = valid(list[i]);
          if (err) return fail("Row " + (i + 1) + ": " + err);
          var r = JSON.parse(JSON.stringify(list[i]));
          if (!r.id) r.id = uuid();
          r.created_at = r.created_at || now; r.updated_at = now;
          out.push(r);
        }
        db[name] = out;
        persist(); emit(name);
        return ok();
      }
    };
  }

  /* ---------- documents ---------- */
  var docParse = {};
  function doc(name) {
    checkName(name);
    if (!docs[name]) registerDoc(name);
    var d = docs[name];
    var reason = name === "orders_meta" ? "orders" : name;
    return {
      get: function () {
        if (d.key === null) return db.orders_meta;
        var raw = lsGet(d.key);
        if (!raw) return null;
        if (docParse[name] && docParse[name].raw === raw) return docParse[name].obj;
        try {
          var obj = JSON.parse(raw);
          docParse[name] = { raw: raw, obj: obj };
          return obj;
        } catch (e) { return null; }
      },
      set: function (obj) {
        if (!isPlain(obj)) return fail("A document must be a plain object.");
        var s;
        try { s = JSON.stringify(obj); } catch (e) { return fail("Document can't be saved."); }
        if (d.key === null) { db.orders_meta = JSON.parse(s); persist(); }
        else { lsSet(d.key, s); delete docParse[name]; }
        emit(reason);
        return ok();
      },
      clear: function () {
        if (d.key === null) { db.orders_meta = null; persist(); }
        else { lsRemove(d.key); delete docParse[name]; }
        emit(reason);
        return ok();
      }
    };
  }
  function importedDocs() { return Object.keys(docs).filter(function (n) { return docs[n].imported; }); }
  function docNames() { return Object.keys(docs); }
  function collectionNames() { return Object.keys(collections); }

  /* ---------- name matching ---------- */
  function aliasMap() {
    var d = doc("aliases").get();
    return d && isPlain(d.map) ? d.map : {};
  }
  function setAliases(map) {
    if (!isPlain(map)) return fail("Aliases must be an object.");
    var cur = Object.assign({}, aliasMap());
    Object.keys(map).forEach(function (k) {
      var key = String(k).trim();
      if (key) cur[key] = map[k] == null ? "" : String(map[k]);
    });
    return doc("aliases").set({ v: 1, map: cur });
  }
  function matchCustomer(sourceName) {
    var n = str(sourceName);
    if (!n) return null;
    var al = aliasMap();
    if (Object.prototype.hasOwnProperty.call(al, n)) {
      if (al[n] === "") return "";
      if (rowById(al[n])) return al[n];
    }
    var i, r;
    for (i = 0; i < db.customers.length; i++) { r = db.customers[i]; if (r.name === n) return r.id; }
    var k = nameKey(n);
    if (!k) return null;
    for (i = 0; i < db.customers.length; i++) { r = db.customers[i]; if (nameKey(r.name) === k) return r.id; }
    return null;
  }
  function matchGroup(sourceName) {
    var n = str(sourceName);
    if (!n) return null;
    var hit = db.customers.filter(function (r) { return r.erp_group && r.erp_group === n; });
    if (!hit.length) { var k = nameKey(n); if (k) hit = db.customers.filter(function (r) { return r.erp_group && nameKey(r.erp_group) === k; }); }
    return hit.length ? hit.map(function (r) { return r.id; }) : null;
  }

  /* ---------- exports ---------- */
  function exportCustomersJson() { return { note: seedNote, customers: customers().map(exportRow) }; }
  function unsavedCount() {
    if (!seedExport) return 0;
    var n = 0;
    customers().forEach(function (c) {
      var s = seedExport[c.id];
      if (!s || s !== JSON.stringify(exportRow(c))) n++;
    });
    return n;
  }
  function exportBackup() {
    var extra = {};
    Object.keys(collections).forEach(function (n) {
      if (collections[n].backup && ["rfqs", "rfq_history", "visits", "orders"].indexOf(n) === -1) extra[n] = (db[n] || []).slice();
    });
    var extraDocs = {};
    Object.keys(docs).forEach(function (n) {
      if (docs[n].backup && ["targets", "orders_meta"].indexOf(n) === -1) { var g = doc(n).get(); if (g) extraDocs[n] = g; }
    });
    return {
      format: "varsha-crm-backup-v2", exportedAt: nowISO(),
      note: "Varsha CRM backup. Has notes, RFQs, visits, orders and targets. No money or invoice amounts. Keep it private.",
      customers: customers().map(exportRow), callLog: allLog(),
      rfqs: db.rfqs.slice(), rfqHistory: db.rfq_history.slice(), visits: db.visits.slice(), orders: db.orders.slice(),
      ordersMeta: db.orders_meta, targets: doc("targets").get(),
      extra: extra, extraDocs: extraDocs
    };
  }

  /* ---------- load: seed, then Phase 1 migration ---------- */
  function normSeedRow(raw, id, counts) {
    var seg = str(raw.segment), vseg = str(raw.vehicleSegment);
    if (seg && SEGMENTS.indexOf(seg) === -1) { counts.segment++; seg = ""; }
    if (vseg && VEHICLE_SEGMENTS.indexOf(vseg) === -1) { counts.vehicle++; vseg = ""; }
    var r = {
      name: str(raw.name).slice(0, 120), contact: str(raw.contact).slice(0, 80), contact_from: str(raw.contactFrom),
      city: str(raw.city).slice(0, 60), state: str(raw.state).slice(0, 60), phone: str(raw.phone).slice(0, 30),
      last_order: iso(raw.last), follow_up: iso(raw.followUp),
      status: STATUSES.indexOf(raw.status) !== -1 ? raw.status : "Active", disputed: !!raw.disputed,
      grp: str(raw.group).slice(0, 80), segment: seg, vehicle_segment: vseg,
      plants: cleanPlants(raw.plants, function (i) { return id + "-p" + (i + 1); }, counts),
      related_party: !!raw.relatedParty, erp_group: str(raw.erpGroup).slice(0, 80)
    };
    derive(r);
    return r;
  }
  var SEED_FIELDS = ["name", "contact", "contact_from", "city", "state", "phone", "last_order", "follow_up", "status", "disputed",
                     "grp", "segment", "vehicle_segment", "related_party", "erp_group"];
  function applySeed(sd, notices) {
    var list = Array.isArray(sd.customers) ? sd.customers : [];
    var taken = {}, items = [], counts = { segment: 0, vehicle: 0, plants: 0 }, bad = { segment: {}, vehicle: {}, plants: {} };
    list.forEach(function (raw) { if (raw && raw.id) taken[String(raw.id)] = 1; });
    list.forEach(function (raw) {
      if (!raw || !str(raw.name)) return;
      var id = raw.id ? String(raw.id) : slug(raw.name, function (x) { return !!taken[x]; });
      taken[id] = 1;
      var before = { segment: counts.segment, vehicle: counts.vehicle, plants: counts.plants };
      var row = normSeedRow(raw, id, counts);
      if (counts.segment > before.segment) bad.segment[id] = 1;
      if (counts.vehicle > before.vehicle) bad.vehicle[id] = 1;
      if (counts.plants > before.plants) bad.plants[id] = 1;
      items.push({ id: id, row: row });
    });
    var now = nowISO(), byName = {}, changed = false;
    db.customers.forEach(function (r) { byName[lower(r.name)] = 1; });
    seedExport = {};
    items.forEach(function (it) {
      var ex = rowById(it.id);
      if (!ex) {
        if (byName[lower(it.row.name)] || db.deleted.indexOf(it.id) !== -1) { seedExport[it.id] = "x"; return; }
        var nr = Object.assign({ id: it.id }, it.row, { source: "seed", created_at: now, updated_at: now, updated_by: "" });
        db.customers.push(nr); byName[lower(nr.name)] = 1; changed = true;
        ex = nr;
      } else if (ex.source === "seed" && ex.updated_at === ex.created_at) {
        var diff = SEED_FIELDS.some(function (k) { return ex[k] !== it.row[k]; }) || JSON.stringify(ex.plants) !== JSON.stringify(it.row.plants);
        if (diff) { SEED_FIELDS.forEach(function (k) { ex[k] = it.row[k]; }); ex.plants = it.row.plants; changed = true; }
      }
      seedExport[it.id] = JSON.stringify(exportRow(toUI(Object.assign({}, it.row, { id: it.id, source: "seed", created_at: "", updated_at: "" }))));
    });
    function plural(n, one, many) { return n + " customer" + (n === 1 ? " " + one : "s " + many); }
    var ns = Object.keys(bad.segment).length, nv = Object.keys(bad.vehicle).length, np = Object.keys(bad.plants).length;
    if (ns) notices.push(plural(ns, "had", "had") + " a segment value that is not in the list; it was left blank.");
    if (nv) notices.push(plural(nv, "had", "had") + " a vehicle segment value that is not in the list; it was left blank.");
    if (np) notices.push(plural(np, "had", "had") + " a plant with no city and no state; it was dropped.");
    seedNote = typeof sd.note === "string" ? sd.note : "";
    return changed;
  }
  function findByName(name) {
    var n = str(name), i, r;
    for (i = 0; i < db.customers.length; i++) if (db.customers[i].name === n) return db.customers[i];
    for (i = 0; i < db.customers.length; i++) if (lower(db.customers[i].name) === lower(n)) return db.customers[i];
    var s = slug(n);
    for (i = 0; i < db.customers.length; i++) { r = db.customers[i]; if (r.id === s) return r; }
    return null;
  }
  function migrateLegacy(notices) {
    var raw = lsGet(LEGACY_KEY);
    if (!raw || lsGet(LEGACY_DONE)) return;
    var legacy = null, applied = 0, skipped = 0;
    try { legacy = JSON.parse(raw); } catch (e) { legacy = null; }
    if (legacy && typeof legacy === "object") {
      var st = isPlain(legacy.status) ? legacy.status : {}, fo = isPlain(legacy.follow) ? legacy.follow : {};
      Object.keys(st).forEach(function (n) {
        var r = findByName(n);
        if (!r || STATUSES.indexOf(st[n]) === -1) { skipped++; return; }
        if (r.status === st[n]) return;
        if (r.updated_at !== r.created_at) { skipped++; return; }
        patchRow(r, { status: st[n] }); applied++;
      });
      Object.keys(fo).forEach(function (n) {
        var r = findByName(n), v = iso(fo[n]);
        if (!r) { skipped++; return; }
        if (r.follow_up === v) return;
        if (r.updated_at !== r.created_at) { skipped++; return; }
        patchRow(r, { follow_up: v }); applied++;
      });
      (Array.isArray(legacy.added) ? legacy.added : []).forEach(function (a) {
        if (!a || !str(a.name)) return;
        if (findByName(a.name)) { skipped++; return; }
        var res = addCustomerSync({ name: a.name, contact: a.contact, phone: a.phone, city: a.city, last: iso(a.last), followUp: iso(a.followUp), status: a.status });
        if (res.ok) applied++; else skipped++;
      });
    }
    lsSet(LEGACY_BACKUP, raw);
    lsRemove(LEGACY_KEY);
    lsSet(LEGACY_DONE, "1");
    persist();
    if (applied || skipped) {
      notices.push("Moved " + applied + " change" + (applied === 1 ? "" : "s") + " saved by the old version of this page." +
        (skipped ? " " + skipped + " skipped because a newer value exists." : ""));
    }
  }
  function fetchSeed() {
    if (typeof fetch !== "function") return Promise.reject(new Error("fetch is not available"));
    return fetch("customers.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function load() {
    if (!inited) readDb();
    var p;
    if (opts.data) p = Promise.resolve(opts.data);
    else if (hasWindow && window.CRM_DATA) p = Promise.resolve(window.CRM_DATA);
    else p = fetchSeed();
    return p.then(function (sd) {
      var notices = [];
      loadError = "";
      applySeed(sd || {}, notices);
      migrateLegacy(notices);
      persist();
      emit("load");
      if (notices.length) emit("notice", { text: notices.join(" "), kind: "info" });
      return { ok: true };
    }).catch(function (err) {
      loadError = "Could not load customers.json (" + (err && err.message ? err.message : err) + "). Open this page from the website or a local web server, not by double-clicking the file.";
      emit("load");
      return { ok: false, error: loadError };
    });
  }
  function init(o) {
    opts = o || {};
    if (!inited) {
      lsSet("varsha-crm-probe", "1");     // detect blocked storage early
      readDb();
      inited = true;
    }
    return Promise.resolve({ mode: "local", user: null });
  }
  function status() { return { mode: "local", pending: 0, storageOK: storageOK, loadError: loadError }; }

  /* Test helper: forget everything (Node unit tests). */
  function reset() {
    memory = {}; db = emptyDb(); listeners = []; seedNote = ""; seedExport = null; loadError = ""; opts = {}; inited = false; uiCache = null; docParse = {};
    storageOK = true;
  }

  var Store = {
    init: init, load: load, status: status, onChange: onChange,
    todayISO: todayISO, addDays: addDays, dayNum: dayNum, daysBetween: daysBetween, fuKind: fuKind, fuText: fuText,
    lastBucket: lastBucket, slug: slug, uuid: uuid, nameKey: nameKey, matchCustomer: matchCustomer, matchGroup: matchGroup,
    setAliases: setAliases, aliases: aliasMap,
    customers: customers, get: get, latestOrder: latestOrder, addCustomer: addCustomer, saveCustomer: saveCustomer,
    setStatus: setStatus, setFollowUp: setFollowUp, groups: groups, SEGMENTS: SEGMENTS, VEHICLE_SEGMENTS: VEHICLE_SEGMENTS,
    STATUSES: STATUSES, LOG_TYPES: LOG_TYPES, CONTACT_TYPES: CONTACT_TYPES,
    removeCustomer: removeCustomer, refs: refs, validate: validate,
    listLog: listLog, allLog: allLog, logCount: logCount, lastContacted: lastContacted, addLog: addLog, markDone: markDone,
    col: col, doc: doc,
    registerCollection: registerCollection, registerDoc: registerDoc, importedDocs: importedDocs, docNames: docNames, collectionNames: collectionNames,
    exportCustomersJson: exportCustomersJson, exportBackup: exportBackup, unsavedCount: unsavedCount,
    storage: { get: lsGet, set: lsSet, remove: lsRemove },
    _reset: reset
  };
  if (hasWindow) window.Store = Store;
  if (typeof module !== "undefined" && module.exports) module.exports = Store;
})();
