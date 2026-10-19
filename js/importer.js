/* CrmImport: the shared Import dialog (file -> recognise -> check -> match names -> confirm). Frozen contract: design section 4.4.
   Open list: callers pass their own `specs`; CrmImport.register(key, spec) lets a module keep a named dataset kind
   that open() can reference as a string. Nothing here lists datasets. Owned by A1. */
(function () {
  "use strict";

  var registry = {};
  var dlg = null, E = {}, cfg = null, st = null;
  var MAX_BYTES = 8 * 1024 * 1024;

  function el(t, a, k) { return Ui.el(t, a, k); }
  function istDate(ms) { return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }

  function build() {
    if (dlg) return;
    E.title = el("div", { class: "dlg-head", id: "importTitle" });
    E.intro = el("p", { class: "note", id: "importIntro" });
    E.file = el("input", { type: "file", id: "importFile", class: "sr-only", tabindex: "-1", "aria-label": "CSV file", accept: ".csv,text/csv,text/tab-separated-values" });
    E.choose = el("button", { type: "button", class: "btn", id: "importChoose", text: "Choose CSV file" });
    E.fileName = el("span", { class: "muted", id: "importFileName", text: "No file chosen" });
    E.kind = el("select", { id: "importKind", "aria-label": "This file is" });
    E.kindWrap = el("label", null, ["This file is:", E.kind]);
    E.err = el("div", { class: "imp-err", id: "importErr", role: "alert", hidden: true });
    E.warn = el("div", { class: "imp-warn", id: "importWarn", role: "status", hidden: true });
    E.summary = el("ul", { id: "importSummary" });
    E.unHead = el("p", { class: "note", id: "importUnHead", text: "These names are not in the customer list. Pick the right customer, or mark them as not a CRM customer. Your choice is remembered for the next import.", hidden: true });
    E.unmatched = el("ul", { class: "imp-unmatched", id: "importUnmatched" });
    E.asOf = el("input", { type: "date", id: "importAsOf" });
    E.asOfWrap = el("label", null, ["Data as of (the date the sheet was exported)", E.asOf]);
    E.privacy = el("p", { class: "note", text: "The file is read in this browser only. Amounts are not sent anywhere and are not saved to git." });
    E.ok = el("button", { type: "button", class: "btn primary", id: "importOk", text: "Import", disabled: true });
    E.cancel = el("button", { type: "button", class: "btn", id: "importCancel", text: "Cancel" });
    var body = el("div", { class: "dlg-body" }, [
      E.intro, el("div", { class: "imp-row" }, [E.choose, E.fileName, E.file]),
      E.kindWrap, E.err, E.warn, E.summary, E.unHead, E.unmatched, E.asOfWrap, E.privacy
    ]);
    var foot = el("div", { class: "actions imp-foot" }, [E.cancel, E.ok]);
    dlg = el("dialog", { id: "importDlg", "aria-labelledby": "importTitle" }, [E.title, body, foot]);
    document.body.appendChild(dlg);

    E.choose.addEventListener("click", function () { E.file.click(); });
    E.file.addEventListener("change", function () {
      var f = E.file.files && E.file.files[0];
      if (f) readFile(f);
    });
    E.kind.addEventListener("change", function () { st.specIdx = +E.kind.value; st.userPicked = true; analyze(); });
    E.asOf.addEventListener("input", refreshOk);
    E.cancel.addEventListener("click", function () { dlg.close(); });
    E.ok.addEventListener("click", confirm);
  }

  function reset() {
    st = { file: null, rows: null, heads: [], specIdx: 0, items: [], errors: [], skipped: [], rowsRead: 0, kept: 0,
           choices: {}, asOfFromFile: "", mismatch: "", userPicked: false, busy: false };
    E.file.value = "";
    E.fileName.textContent = "No file chosen";
    E.err.hidden = true; E.warn.hidden = true;
    Ui.clear(E.summary); Ui.clear(E.unmatched); E.unHead.hidden = true;
    E.kind.disabled = false;
    E.ok.disabled = true;
    E.ok.textContent = "Import";
  }

  function readFile(file) {
    if (file.size > MAX_BYTES) { showErr("This file is too big (8 MB at most). Export only the tab you need."); return; }
    var fr = new FileReader();
    fr.onload = function () {
      st.file = { name: file.name, fileDate: istDate(file.lastModified || Date.now()) };
      E.fileName.textContent = file.name;
      st.rows = CrmCsv.parse(String(fr.result || ""));
      st.heads = cfg.specs.map(function (sp) { return CrmCsv.findHeader(st.rows, sp.fields); });
      var best = -1, bestMiss = 1e9;
      st.heads.forEach(function (h, i) { if (h.missing.length < bestMiss) { bestMiss = h.missing.length; best = i; } });
      st.specIdx = Math.max(0, best);
      Ui.clear(E.kind);
      cfg.specs.forEach(function (sp, i) { E.kind.appendChild(el("option", { value: String(i), text: sp.label })); });
      E.kind.value = String(st.specIdx);
      analyze();
    };
    fr.onerror = function () { showErr("The file could not be read."); };
    fr.readAsText(file, "utf-8");
  }

  function showErr(msg) { E.err.textContent = msg; E.err.hidden = !msg; }

  function numErr(f, raw, row) {
    var what = f.type === "date" ? "is not a date" : f.type === "int" ? "is not a whole number" : "is not a number";
    return "Row " + row + ': "' + raw + '" in ' + f.label + " " + what;
  }

  function analyze() {
    var spec = cfg.specs[st.specIdx], head = st.heads[st.specIdx];
    st.items = []; st.errors = []; st.skipped = []; st.rowsRead = 0; st.kept = 0; st.choices = {};
    showErr(""); E.warn.hidden = true;
    Ui.clear(E.summary); Ui.clear(E.unmatched); E.unHead.hidden = true;
    if (!st.rows || !st.rows.some(function (r) { return r.some(function (c) { return String(c).trim(); }); })) {
      showErr("This file is empty."); refreshOk(); return;
    }
    if (head.missing.length) {
      showErr("This file does not have the columns we need. Missing: " + head.missing.join(", ") +
        ". Columns found in your file: " + (head.found.join(", ") || "none") + ". Check that you exported the right tab.");
      refreshOk(); return;
    }
    var map = head.map, asOnMax = "", asKey = spec.asOfField || "asOn";
    for (var r = head.index + 1; r < st.rows.length; r++) {
      var cells = st.rows[r], rowNo = r + 1;
      if (!cells.some(function (c) { return String(c).trim(); })) continue;
      st.rowsRead++;
      var reason = spec.skipRow ? spec.skipRow(cells, map) : null;
      var name = cfg.customerField ? String(cells[map[cfg.customerField]] == null ? "" : cells[map[cfg.customerField]]).trim() : "";
      if (!reason && cfg.customerField && !name) reason = "blank name";
      if (reason) { st.skipped.push({ row: rowNo, reason: reason }); continue; }
      var item = { row: rowNo, sourceName: name, customerId: null, groupIds: null };
      var bad = false;
      spec.fields.forEach(function (f) {
        var idx = map[f.key], raw = idx == null || cells[idx] == null ? "" : String(cells[idx]);
        var v;
        if (f.type === "amount") v = CrmCsv.parseAmount(raw);
        else if (f.type === "date") v = CrmCsv.parseDate(raw);
        else if (f.type === "int") v = CrmCsv.parseInt(raw);
        else v = { ok: true, value: raw.trim() };
        if (!v.ok) { st.errors.push(numErr(f, raw.trim(), rowNo)); item[f.key] = null; bad = true; }
        else item[f.key] = v.value;
      });
      if (cfg.customerField) {
        var m = Store.matchCustomer(name);
        if (m) item.customerId = m;
        else if (m === "") item.ignored = true;
        else item.groupIds = Store.matchGroup(name);
      }
      if (item[asKey] && item[asKey] > asOnMax) asOnMax = item[asKey];     // max date: never assume the rows are in order
      if (!bad) { st.items.push(item); st.kept++; }
    }
    st.asOfFromFile = asOnMax;
    summarise(spec);
    refreshOk();
  }

  function unmatchedNames() {
    var seen = {}, out = [];
    st.items.forEach(function (it) {
      if (cfg.customerField && !it.customerId && !it.groupIds && !it.ignored && !seen[it.sourceName]) { seen[it.sourceName] = 1; out.push(it.sourceName); }
    });
    return out;
  }

  function summarise(spec) {
    var li = function (t) { E.summary.appendChild(el("li", { text: t })); };
    var reasons = [];
    st.skipped.forEach(function (s) { if (reasons.indexOf(s.reason) === -1) reasons.push(s.reason); });
    li(st.rowsRead + " rows read · " + st.kept + " kept · " + st.skipped.length + " skipped" + (reasons.length ? " (" + reasons.join(", ") + ")" : ""));
    if (cfg.customerField) {
      var matched = st.items.filter(function (it) { return it.customerId || it.groupIds; }).length;
      var grp = st.items.filter(function (it) { return !it.customerId && it.groupIds; }).length;
      li(matched + " matched to customers" + (grp ? " (" + grp + " by ERP group)" : "") + " · " + (st.kept - matched) + " not matched");
      var counts = {};
      st.items.forEach(function (it) { var k = it.customerId || it.sourceName; counts[k] = (counts[k] || 0) + 1; });
      var dup = Object.keys(counts).filter(function (k) { return counts[k] > 1; }).length;
      if (dup) li(dup + " customer" + (dup === 1 ? " appears" : "s appear") + " on more than one row; their amounts are added together.");
    }
    st.errors.slice(0, 20).forEach(function (m) { E.summary.appendChild(el("li", { class: "imp-err", text: m })); });
    if (st.errors.length > 20) li("+" + (st.errors.length - 20) + " more");
    if (spec.warnings) {
      var w = spec.warnings(st.items) || [];
      Ui.clear(E.warn);
      w.forEach(function (t) { E.warn.appendChild(el("div", { text: t })); });
      E.warn.hidden = !w.length;
    }
    var un = unmatchedNames();
    E.unHead.hidden = !un.length;
    un.forEach(function (n) {
      var sel = el("select", { "aria-label": "Match " + n }, [
        el("option", { value: "?", text: "Choose customer…" }),
        Store.customers().slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); })
          .map(function (c) { return el("option", { value: c.id, text: c.name }); }),
        el("option", { value: "-", text: "Not a CRM customer" })
      ]);
      sel.addEventListener("change", function () { st.choices[n] = sel.value; });
      E.unmatched.appendChild(el("li", null, [el("span", { text: n }), sel]));
    });
    if (cfg.asOf) {
      var today = Store.todayISO();
      var d = st.asOfFromFile && st.asOfFromFile <= today ? st.asOfFromFile : (st.file.fileDate <= today ? st.file.fileDate : today);
      E.asOf.value = d; E.asOf.max = today;
    }
    E.asOfWrap.hidden = !cfg.asOf;
  }

  function refreshOk() {
    var head = st.heads[st.specIdx];
    var good = !!st.file && !!head && st.kept > 0 && !st.errors.length && !head.missing.length;
    if (good && cfg.asOf) good = /^\d{4}-\d{2}-\d{2}$/.test(E.asOf.value) && E.asOf.value <= Store.todayISO();
    E.ok.disabled = !good || st.busy;
    E.ok.textContent = "Import " + st.kept + " rows";
  }

  function confirm() {
    if (E.ok.disabled) return;
    var spec = cfg.specs[st.specIdx], aliases = {};
    Object.keys(st.choices).forEach(function (n) {
      if (st.choices[n] === "-") aliases[n] = "";
      else if (st.choices[n] && st.choices[n] !== "?") aliases[n] = st.choices[n];
    });
    var rows = st.items.map(function (it) {
      var o = Object.assign({}, it);
      if (!o.customerId && aliases[o.sourceName]) o.customerId = aliases[o.sourceName];
      return o;
    });
    var meta = {
      fileName: st.file.name, fileDate: st.file.fileDate, asOf: cfg.asOf ? E.asOf.value : st.file.fileDate,
      importedAt: new Date().toISOString(), rowsRead: st.rowsRead, rowsKept: rows.length, skipped: st.skipped.slice(),
      unmatched: rows.filter(function (r) { return cfg.customerField && !r.customerId && !r.groupIds; }).length
    };
    st.busy = true; E.ok.disabled = true;
    var done = Promise.resolve(cfg.onConfirm({ specKey: spec.key, meta: meta, rows: rows, aliases: aliases }));
    done.then(function (res) {
      st.busy = false;
      if (res && res.ok === false) { showErr(res.error || "The import failed."); refreshOk(); return; }
      var save = Object.keys(aliases).length ? Store.setAliases(aliases) : Promise.resolve();
      return save.then(function () {
        dlg.close();
        var label = String(spec.label || "file").replace(/\s+tab$/i, "");
        App.announce("Imported " + rows.length + " rows from " + label + ".");
        App.notice("Imported " + rows.length + " rows from " + label + "." + (cfg.asOf ? " Data as of " + App.fmt.date(meta.asOf) + "." : ""), "info");
      });
    }).catch(function (e) { st.busy = false; showErr("The import failed: " + (e && e.message ? e.message : e)); refreshOk(); });
  }

  /* specs: spec objects, or keys added with CrmImport.register(key, spec). */
  function resolveSpec(s) {
    if (typeof s === "string") {
      if (!registry[s]) throw new Error("Unknown import dataset: " + s);
      return registry[s];
    }
    return s;
  }
  function open(config) {
    build();
    cfg = Object.assign({ customerField: null, asOf: false }, config);
    cfg.specs = (config.specs || []).map(resolveSpec);
    if (!cfg.specs.length) throw new Error("CrmImport.open needs at least one spec");
    reset();
    E.title.textContent = cfg.title || "Import";
    E.intro.textContent = cfg.intro || "";
    E.asOfWrap.hidden = !cfg.asOf;
    Ui.clear(E.kind);
    cfg.specs.forEach(function (sp, i) { E.kind.appendChild(el("option", { value: String(i), text: sp.label })); });
    App.openDialog(dlg, document.activeElement);
  }
  function register(key, spec) {
    if (!key || !spec || !Array.isArray(spec.fields)) throw new Error("register(key, spec) needs a spec with fields");
    spec.key = spec.key || key;
    registry[key] = spec;
  }

  window.CrmImport = { open: open, register: register, spec: function (k) { return registry[k]; }, kinds: function () { return Object.keys(registry); } };
})();
