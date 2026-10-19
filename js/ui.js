/* Ui: DOM helpers (text only, never HTML strings), formatters, dialog helpers. Owned by A1.
   App.fmt, App.openDialog and App.closeDialog delegate to this file. */
(function () {
  "use strict";

  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var PROPS = { value: 1, checked: 1, disabled: 1, hidden: 1, selected: 1, readOnly: 1, textContent: 1 };

  function add(parent, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(parent, k); }); return; }
    if (kid.nodeType) { parent.appendChild(kid); return; }
    parent.appendChild(document.createTextNode(String(kid)));
  }

  /* el("button", { class: "btn", text: "Save", dataset: { id: "x" }, onclick: fn, "aria-label": "..." }, [children]) */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "dataset") Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
      else if (k === "style" && typeof v === "object") Object.keys(v).forEach(function (s) { n.style[s] = v[s]; });
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (PROPS[k]) n[k] = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    });
    add(n, kids);
    return n;
  }
  function clear(node) { node.textContent = ""; return node; }
  function $(id) { return document.getElementById(id); }

  /* ---------- formatters ---------- */
  var hideSource = function () { return false; };
  function setHideSource(fn) { hideSource = fn; }

  function isoParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function date(iso) {
    var p = isoParts(iso);
    return p ? p.d + " " + MON[p.m - 1] + " " + p.y : "";
  }
  function day(iso) {
    var p = isoParts(iso);
    if (!p) return "";
    return DOW[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()] + " " + p.d + " " + MON[p.m - 1];
  }
  function int(n) { return n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN"); }
  function rel(days) {
    var d = Math.abs(Math.round(days));
    return d + (d === 1 ? " day" : " days");
  }
  function money(n) {
    if (n == null || isNaN(n)) return "—";
    if (hideSource()) return "₹ •••";
    var body = "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");
    return n < 0 ? "−" + body + " (credit)" : body;
  }
  function moneyShort(n) {
    if (n == null || isNaN(n)) return "—";
    if (hideSource()) return "₹ •••";
    var a = Math.abs(n), sign = n < 0 ? "−" : "", s;
    if (a >= 1e7) s = "₹" + (a / 1e7).toFixed(2) + " Cr";
    else if (a >= 1e5) s = "₹" + (a / 1e5).toFixed(2) + " L";
    else s = "₹" + Math.round(a).toLocaleString("en-IN");
    return sign + s;
  }
  /* A span holding a formatted amount; when amounts are hidden it carries aria-label="amount hidden". */
  function amountEl(n, cls, short) {
    var s = el("span", { class: cls || null, text: short ? moneyShort(n) : money(n) });
    if (n != null && hideSource()) s.setAttribute("aria-label", "amount hidden");
    return s;
  }
  var fmt = { date: date, day: day, money: money, moneyShort: moneyShort, int: int, rel: rel };

  /* ---------- dialogs ---------- */
  function describe(opener) {
    if (!opener || !opener.nodeType) return null;
    var row = opener.closest ? opener.closest("[data-id]") : null;
    return {
      el: opener, id: opener.id || "",
      cls: (opener.classList && opener.classList[0]) || "",
      rowId: row ? row.dataset.id : ""
    };
  }
  function restoreFocus(d) {
    if (!d) return;
    var t = null;
    if (d.el && d.el.isConnected) t = d.el;
    else if (d.id) t = document.getElementById(d.id);
    if (!t && d.rowId && d.cls && window.CSS && CSS.escape) {
      t = document.querySelector('[data-id="' + CSS.escape(d.rowId) + '"] .' + CSS.escape(d.cls));
    }
    if (t && t.focus) t.focus();
  }
  /* showModal, focus the first field, and give focus back to the opener after close (even if the row was re-rendered). */
  function openDialog(dlg, opener) {
    var d = describe(opener || document.activeElement);
    if (!dlg.open) dlg.showModal();
    var first = dlg.querySelector("[autofocus]") || dlg.querySelector("input:not([type=hidden]):not([type=file]), select, textarea");
    if (first) first.focus();
    dlg.addEventListener("close", function () {
      requestAnimationFrame(function () { requestAnimationFrame(function () { restoreFocus(d); }); });
    }, { once: true });
  }
  function closeDialog(dlg) { if (dlg && dlg.open) dlg.close(); }

  /* Character counter that turns --warn at 90% of the limit. */
  function counter(field, out, max) {
    function upd() {
      var n = field.value.length;
      out.textContent = n + " / " + max;
      out.classList.toggle("near", n >= max * 0.9);
    }
    field.addEventListener("input", upd);
    upd();
    return upd;
  }
  /* Ctrl/Cmd+Enter submits the form from a textarea. */
  function ctrlEnter(field, form) {
    field.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
  }

  var Ui = {
    el: el, clear: clear, $: $, fmt: fmt, amountEl: amountEl, setHideSource: setHideSource,
    openDialog: openDialog, closeDialog: closeDialog, counter: counter, ctrlEnter: ctrlEnter
  };
  if (typeof window !== "undefined") window.Ui = Ui;
  if (typeof module !== "undefined" && module.exports) module.exports = Ui;
})();
