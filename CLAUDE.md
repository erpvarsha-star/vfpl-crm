# Varsha CRM - project rules

Independent project. Work only in this repo (`vfpl-crm`). Never touch `vfpl-dashboard-26-27`.

## Rules (apply to every change)

1. **Data**: customers are seeded from `customers.json`. Edits, notes, call log, RFQs, leads, visits, typed orders and imported amounts live in this browser (stage A) or in the private database (stage B). **Amounts, emails, phone numbers of leads, notes and GST numbers are never committed.** `*.csv` and `varsha-crm-backup-*.json` are gitignored. Imports are CSV files downloaded from the sheet; the page never writes to the Google Sheet.
2. **Persistence**: every action a user can take must survive a refresh (saved in `localStorage`). What is included in an export: customer fields in `customers.json`; notes, RFQs, leads, visits, typed orders and targets in the private backup. Money, invoices and dispatch history are re-imported from the sheet, not exported. The "Include notes", "Include contact details" and "Include amounts" boxes are deliberately not remembered, and without a tick no export has note text, lead/RFQ emails, phones or contact references. If storage is blocked, show the warning banner.
3. **Tests**: `tests/smoke.js` runs `tests/unit/*` and `tests/checks/*` (all files, sorted by name). Every new action gets a check, including a refresh check. Run `node tests/smoke.js --strict` before every push (any failure or skip blocks the push) and report the result. Do not push on a failure.
4. **Overdue**: a follow-up date before today is red AND says "Overdue by N days". Due today is orange. Never rely on colour alone.
5. **Dates**: stored as `YYYY-MM-DD`; "today" is always India time (`Asia/Kolkata`). Imported dates are day-first.
6. **Status**: Active / Follow up / At risk is set by hand. No automatic rule.
7. **Look**: navy and orange. Colours are tokens in `:root`. Green / orange / red only for status and follow-up meaning.
8. **Safety**: build text with `textContent`, never `innerHTML`. The page must work at 375px wide with no sideways scroll; only the tab bar and the desktop RFQ board may scroll sideways inside themselves.
9. **Plan B**: if hosting is unavailable, run any static server on the folder; if storage is blocked, export the JSON.

## Who does what (model roles)

- **Design and architecture are done.** From now on only Sonnet and Haiku agents are used (never Opus): Sonnet builds, tests, reads data and deploys; Haiku is for small read or summary jobs. The lead briefs fully and verifies everything (strict test suite, diff scope, private-data scan) before telling the user it is done, and pushes only after a fully green strict run. Agents do not push to `main` without the lead's check.
- **Links at every step:** after each completed step, push and give the user the git links (commit, files) and the live-view link, so they can check it in a browser.
- **HTML first, backend later:** everything is built and reviewed as a working HTML prototype (localStorage store) first. Supabase build, deploy and login start only after the user reviews the HTML and says GO. When a push is ready to review, notify the user clearly (chat message plus push notification) with the links.
- **Process per phase:** blueprint, the user's GO, build, test, deploy, then a short skill harvest (new gotchas go in the list below).

## Gotchas (learned the hard way)

- CSS `display` on an element overrides the `hidden` attribute. Keep `[hidden] { display: none !important; }`.
- A global `margin: 0` reset breaks `<dialog>` centring. Keep `dialog { margin: auto; }`. Style `dialog[open]`, never `dialog`, for `display`.
- Opening `index.html` by double-click cannot fetch `customers.json`. Previews inject the data as `window.CRM_DATA`.
- `pkill -f <text>` can kill the shell that contains that text. Kill by PID.
- The sheet's `INVOICE_REGISTER` holds 1,040 invoices and its data ends on 12-Jul-2026 (the grid has empty rows below, so it is not a row limit). Invoices after that date may not have been loaded, so "last order" may be out of date. Always show "data through <last invoice date>".
- Panel, collection and document names are open lists registered by modules (`App.registerPanel`, `Store.col(name)`, `Store.doc(name)`). Never hard-code a fixed list of them in the shell or the store.
- Module CSS must be scoped by an id or a prefix (`#panel-export .ex-card`). A bare class like `.rev` collided with another module's `.rev` and restyled it.
- A lead's call-log rows use `customerId` `""`, not `null` (the log shape returned by `Store.allLog()`), and carry `leadId`. Customer views ignore rows that have only a `leadId`.
- Percentages returned by module `stats()` are 0-100 (for example `overduePct: 5` means 5%), never 0-1.
- Wait for `body[data-ready="1"]` in tests, not for `#rows tr`. Serve `.js` as `text/javascript` in the test server.
- A CSV cell that starts with `= + - @` is prefixed with an apostrophe by `CrmCsv.safeCell` (formula guard). Pass negative amounts as numbers, not strings.
