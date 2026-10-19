/* CrmCsv: pure CSV helpers (parse, header matching, strict number and date parsing, export builders).
   Frozen contract (design section 4.3). Also module.exports for Node unit tests. Owned by A1. */
(function () {
  "use strict";

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* ---------- parse ---------- */
  function detectDelimiter(text) {
    var line = "", inQ = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (ch === '"') inQ = !inQ;
      if (!inQ && (ch === "\n" || ch === "\r")) {
        if (line.trim()) break;
        line = "";
        continue;
      }
      line += ch;
    }
    var best = ",", bestN = -1, cands = [",", ";", "\t"];
    cands.forEach(function (d) {
      var n = 0, q = false;
      for (var k = 0; k < line.length; k++) {
        if (line[k] === '"') q = !q;
        else if (!q && line[k] === d) n++;
      }
      if (n > bestN) { best = d; bestN = n; }
    });
    return best;
  }

  function parse(text) {
    text = String(text == null ? "" : text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var delim = detectDelimiter(text);
    var rows = [], row = [], cell = "", inQ = false, i = 0, n = text.length, ch;
    while (i < n) {
      ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell === "") { inQ = true; i++; continue; }
      if (ch === delim) { row.push(cell); cell = ""; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        row.push(cell); rows.push(row); row = []; cell = "";
        if (ch === "\r" && text[i + 1] === "\n") i++;
        i++; continue;
      }
      cell += ch; i++;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* ---------- headers ---------- */
  function normHeader(h) {
    return String(h == null ? "" : h).toLowerCase().trim().replace(/&/g, "and")
      .replace(/[^\p{L}\p{N}+><]/gu, "");
  }

  function fieldMatches(field, raw) {
    var nh = normHeader(raw);
    if (!nh && !field.pattern) return false;
    if (field.pattern && field.pattern.test(String(raw))) return true;
    if (nh && nh === normHeader(field.label)) return true;
    if (nh && field.key && nh === normHeader(field.key)) return true;
    var syn = field.synonyms || [];
    for (var i = 0; i < syn.length; i++) if (nh && nh === normHeader(syn[i])) return true;
    return false;
  }

  /* spec: an array of fields, or { fields: [...] }. Scans the first 10 rows and picks the first row that has ALL required fields. */
  function findHeader(rows, spec) {
    var fields = Array.isArray(spec) ? spec : (spec && spec.fields) || [];
    var best = null, r;
    for (r = 0; r < Math.min(rows.length, 10); r++) {
      var cells = rows[r], map = {}, used = {}, missing = [], matched = 0;
      fields.forEach(function (f) {
        var idx = -1;
        for (var c = 0; c < cells.length; c++) {
          if (!used[c] && fieldMatches(f, cells[c])) { idx = c; break; }
        }
        if (idx >= 0) { map[f.key] = idx; used[idx] = true; matched++; }
        else if (f.required) missing.push(f.label || f.key);
      });
      var found = cells.map(function (x) { return String(x).trim(); }).filter(Boolean);
      var res = { index: r, map: map, missing: missing, found: found, _score: matched };
      if (!missing.length) { delete res._score; return res; }
      if (!best || res._score > best._score) best = res;
    }
    if (!best) {
      var req = fields.filter(function (f) { return f.required; }).map(function (f) { return f.label || f.key; });
      return { index: -1, map: {}, missing: req, found: [] };
    }
    delete best._score;
    return best;
  }

  /* ---------- strict values ---------- */
  function parseAmount(s) {
    var t = String(s == null ? "" : s).replace(/ /g, " ").trim();
    if (t === "" || /^[-—–]$/.test(t)) return { ok: true, value: null };
    t = t.replace(/₹/g, "").replace(/rs\.?/gi, "").replace(/inr/gi, "").replace(/,/g, "").replace(/\s+/g, "");
    if (t === "") return { ok: true, value: null };
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (t[0] === "-" || t[0] === "−") { neg = true; t = t.slice(1); }
    if (/cr$/i.test(t)) { neg = true; t = t.slice(0, -2); }
    else if (/dr$/i.test(t)) { t = t.slice(0, -2); }
    if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false };
    var v = Math.round(parseFloat(t) * 100) / 100;
    if (neg) v = -v;
    if (v === 0) v = 0;
    return { ok: true, value: v };
  }

  function realDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return String(y) + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }

  /* Always day-first (India). */
  function parseDate(s) {
    var t = String(s == null ? "" : s).replace(/ /g, " ").trim();
    if (t === "") return { ok: true, value: null };
    t = t.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(am|pm|z)?$/i, "").trim();
    var m, y, v;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) v = realDate(+m[1], +m[2], +m[3]);
    else if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(t))) v = realDate(+m[3], +m[2], +m[1]);
    else if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/.exec(t))) v = realDate(2000 + (+m[3]), +m[2], +m[1]);
    else if ((m = /^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,9})[\s\-\/.,]+(\d{4}|\d{2})$/.exec(t))) {
      var mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
      y = m[3].length === 2 ? 2000 + (+m[3]) : +m[3];
      v = mon ? realDate(y, mon, +m[1]) : null;
    }
    return v ? { ok: true, value: v } : { ok: false };
  }

  function pInt(s) {
    var t = String(s == null ? "" : s).replace(/ /g, " ").replace(/,/g, "").replace(/\s+/g, "");
    if (t === "") return { ok: true, value: null };
    if (!/^\d+$/.test(t)) return { ok: false };
    return { ok: true, value: Number(t) };
  }

  /* ---------- export builders ---------- */
  /* Formula guard: a text cell that starts with = + - @ tab or CR is prefixed with an apostrophe. */
  function safeCell(v) {
    if (v == null) return "";
    if (typeof v === "number") return String(v);
    var s = String(v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  /* Every cell is quoted; rows end with CRLF between them (no trailing newline, no BOM: the caller adds a BOM if needed). */
  function toCSV(table) {
    return table.map(function (row) {
      return row.map(function (v) { return '"' + safeCell(v).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
  }

  function toTSV(table) {
    return table.map(function (row) {
      return row.map(function (v) { return safeCell(v).replace(/[\t\r\n]+/g, " "); }).join("\t");
    }).join("\n");
  }

  var CrmCsv = {
    parse: parse, findHeader: findHeader, normHeader: normHeader,
    parseAmount: parseAmount, parseDate: parseDate, parseInt: pInt,
    toCSV: toCSV, toTSV: toTSV, safeCell: safeCell
  };
  if (typeof window !== "undefined") window.CrmCsv = CrmCsv;
  if (typeof module !== "undefined" && module.exports) module.exports = CrmCsv;
})();
