# Varsha CRM - Phase 2 design

Date: 19 Oct 2026, 04:46 IST (revised the same day for scope updates 1, 2 and 3). Author: Opus design agent. Status: ready for the lead's review.
First HTML review scope = the user's **"Owner's Path"**: everything in this doc marked stage A, about 48 hours of parallel Sonnet build. Items for after the first review are in §11 "Later".

**Two stages**
- **Stage A, build now: a working HTML prototype.** Browser storage only, hosted on GitHub Pages, for the user to review. **No Supabase calls, no login, no keys, no real amounts in git.**
  - Tabs: **Dashboard · Customers · RFQs · Schedule · Export**. The tab persists across refresh.
  - Features: Mark done (P2-A), Notes and call log (P2-B), Edit customer (P2-C), Export (P2-E), Dashboard (P2-F), Money import (P2-G), RFQ pipeline (P2-H), Schedule: orders and visits (P2-I), Released parts (P2-J), and the logo.
  - Also: **Plants, group and segment** on each customer (P2-K), **Revenue analytics** from an INVOICE_REGISTER import with targets (P2-L), and a printable **Weekly sales review** (P2-M).
- **Stage B, only after the user's GO on stage A:** Supabase (Postgres, Auth, RLS, allowlist) behind the same `Store` API. The Telegram 11:00 IST reminder is designed as a hook only.

Terms
- **IST today** = `new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })`. Every "overdue", "late" and "today" uses it.
- **localdb** = localStorage `varsha-crm-localdb-v1`, the stage A "database".
- **Store** = `js/store.js`, the only data layer. Panels never touch localStorage directly, except for their own view slice through `App.view()`.
- **Amounts** = money from the Collections sheet (outstanding, overdue, aging) and RFQ quoted values. They are private: never in git and never in `customers.json`.

---

## 0. Key decisions

1. **The page is split into plain files** under `css/` and `js/` with ordinary `<script defer>` tags and no build step. Each Sonnet agent owns whole files, so several agents build in parallel. A1 does the split.
2. **One `Store` with collections.** Customers and the call log have rich methods. RFQs, RFQ history, visits and orders use one generic collection API. Money and aliases use a document API. Stage B swaps the backend without touching the UI.
3. **Stable ids.** Customers have a slug id from their name, never changed on rename. Everything links by `customer_id`. Phase 1 edits keyed by NAME are migrated once.
4. **Imports are parsed in the browser and stored in this browser only.** One shared import dialog (`js/importer.js`) is used by Money (AGING, LIVE_POSITION), RFQs and Orders:
   - header-name matching with synonyms, and a clear mismatch error;
   - strict number and date parsing;
   - customer matching by name, plus an unmatched list with remembered manual matches.
5. **Amounts never reach git.** They are kept in localStorage, excluded from `customers.json` and from the backup, shown with a "Data as of" label, and can be hidden on screen and in print with one toggle. `*.csv` is gitignored. Tests only use made-up amounts built inside the test.
6. **The Dashboard is read-only and every number is a button** that opens the matching tab with the matching filter; the row count equals the number. Charts are CSS bars only. The dashboard reads each module's `stats()` contract, so it is built in parallel with the modules.
7. **RFQ pipeline**, 7 stages in this order: Received, Quoted, Negotiated, Finalised, PO, Sample, PPAP. Every stage change is logged with a date. "Released parts" = RFQs at Finalised or later (assumption, to confirm at review).
8. **Red rule everywhere:** overdue follow-ups, overdue amounts, late orders, overdue quotes, missed visits, overdue next actions, "Behind pace" targets and concentration risk are red **and** say so in words. Due today is orange and says so.
9. **Customers gain optional `group`, `segment`, `vehicleSegment` and `plants[]`.** All are blank by default and never invented. `customers.json` stays backwards compatible. City and state shown in the table come from the first plant when plants exist, otherwise from the old fields.
10. **Revenue = the Taxable column** (before GST and TCS), never Invoice Amount. It is imported from INVOICE_REGISTER CSV in the browser and kept in localStorage only, with "Data through <last invoice date>". GSTIN and the tax columns are dropped at import and never stored. Targets are typed by the user, kept in localStorage, and included in the private backup.
11. **The Weekly sales review is one A4 page** built from the same module `stats()` contracts. It opens from the Dashboard and the Export tab. Note text appears only when "Include notes" is ticked, and that box is never remembered.

---

## 1. Architecture and file layout

### 1.1 Stage A

```
 Browser (GitHub Pages, static, no build step)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ index.html          shell: header+logo, tablist, 5 empty panels, banners,    │
 │                     #live region, CSP meta, <link>/<script> tags             │
 │ css/base.css        tokens, reset, header, tabs, buttons, chips, banners,    │
 │                     dialogs, table->card layout, print basics                │
 │ js/store.js         Store: customers + call log + collections + docs,        │
 │                     LocalBackend, migration, customer matching, helpers      │
 │ js/csv.js           CSV parse/build, amount/date/int parsing, header match   │
 │ js/ui.js            el()/text helpers, formatters (dates, ₹), dialog helper  │
 │ js/importer.js      shared Import dialog (file -> headers -> match -> confirm)│
 │ js/app.js           tabs/router, panel registry, view state, banners, boot   │
 │ js/customers.js     Customers tab + Done / Notes / Edit / Add dialogs        │
 │ js/money.js         Money import (AGING, LIVE_POSITION), per-customer amounts│
 │ js/rfqs.js          RFQs tab: board + table, RFQ dialog, RFQ import          │
 │ js/schedule.js      Schedule tab: Visits & calls calendar, Orders & dispatch │
 │ js/revenue.js       INVOICE_REGISTER import, revenue stats, targets dialog   │
 │ js/report.js        Weekly sales review (one A4 page, print)                 │
 │ js/dashboard.js     Dashboard tab (reads every module's stats())             │
 │ js/export.js        Export tab                                               │
 │ css/<module>.css    one stylesheet per module above                          │
 │ assets/             varsha-logo.jpg (committed), favicon-64.png              │
 │ customers.json      seed: 42 customers, no notes, no amounts                 │
 └──────────────────────────────────────────────────────────────────────────────┘
 localStorage: varsha-crm-localdb-v1 (customers, call log, rfqs, rfq_history, visits, orders)
               varsha-crm-money-v1 (amounts)   varsha-crm-aliases-v1 (name -> customer id)
               varsha-crm-revenue-v1 (invoices: no GSTIN, no tax columns)   varsha-crm-targets-v1 (targets + settings)
               varsha-crm-view-v1 (tab + each panel's filters/sort/sub-view)
```

### 1.2 Load order (index.html, at the end of `<body>`)

```html
<link rel="icon" type="image/png" sizes="64x64" href="assets/favicon-64.png">
<link rel="stylesheet" href="css/base.css?v=2">      <!-- then customers, money, rfqs, schedule, revenue, report, dashboard, export .css -->
...
<script src="js/store.js?v=2" defer></script>
<script src="js/csv.js?v=2" defer></script>
<script src="js/ui.js?v=2" defer></script>
<script src="js/importer.js?v=2" defer></script>
<script src="js/app.js?v=2" defer></script>        <!-- defines window.App, does NOT boot yet -->
<script src="js/customers.js?v=2" defer></script>  <!-- each module calls App.registerPanel(...) -->
<script src="js/money.js?v=2" defer></script>
<script src="js/rfqs.js?v=2" defer></script>
<script src="js/schedule.js?v=2" defer></script>
<script src="js/revenue.js?v=2" defer></script>
<script src="js/report.js?v=2" defer></script>
<script src="js/dashboard.js?v=2" defer></script>
<script src="js/export.js?v=2" defer></script>
<script src="js/boot.js?v=2" defer></script>       <!-- last: App.boot() -->
```
- `?v=` defeats GitHub Pages caching; bump it every release.
- Stage B adds `config.js` before `store.js`.
- A1 creates **every** file in the table, with stubs for the modules others own (a one-line comment, plus `App.registerPanel` placeholders for the tabs). This avoids 404s and console errors before those modules land.

### 1.3 Stage B (summary; details in §8)
Same files, plus `config.js` (public URL + publishable key). `store.js` gains a `SupabaseBackend`, a write queue, a cache and auth. Supabase holds every collection as a table with RLS + allowlist. Money can later come straight from the sheet by a read-only server job.

---

## 2. Data model

### 2.1 Customers and call log (rows are the same in localdb and Postgres)

Customer row: `{ id, name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed, grp, segment, vehicle_segment, plants, related_party, erp_group, source /* seed|manual */, created_at, updated_at, updated_by }`

**P2-K fields.** All are optional, blank by default, and **never invented or guessed**:

| Row | UI / customers.json | Values | Default |
|---|---|---|---|
| `grp` | `group` | free text ≤ 80 (parent group, e.g. "Sangkaj Industries"); the UI suggests existing groups | `""` |
| `segment` | `segment` | `SEGMENTS = ["OEM", "Tier-1", "Tier-2", "Trader", "Export"]` or `""` | `""` |
| `vehicle_segment` | `vehicleSegment` | `VEHICLE_SEGMENTS = ["PV", "CV", "Tractor", "2W", "Off-highway", "Other"]` or `""` | `""` |
| `plants` | `plants` | array (≤ 20) of `{ id /* uuid */, name /* ≤ 80, may be "" */, city /* ≤ 60 */, state /* ≤ 60 */ }` | `[]` |
| `related_party` | `relatedParty` | boolean. The user's own group or related companies. **A1 sets it to `true` in `customers.json` for exactly two customers: "VARSHA FORGINGS LTD MARKAL" (`varsha-forgings-ltd-markal`) and "KCTR VARSHA AUTOMOTIVE PVT. LTD." (`kctr-varsha-automotive-pvt-ltd`).** Editable in the Edit dialog (checkbox "Related party (own group company)"). | `false` |
| `erp_group` | `erpGroup` | text ≤ 80, the CUSTOMER_MASTER "ERP Group" value, used **only for matching** imports (§2.7). It is read-only in the UI (shown in Edit as "ERP group (from the Collections sheet)"). A1 fills it in `customers.json` from the CUSTOMER_MASTER ERP Group column that the lead supplies (names only, no amounts). Blank if it is not supplied; never guessed. | `""` |

- **Derived city/state:**
  - If `plants.length > 0`, then on every save `city = plants[0].city` and `state = plants[0].state`, so the table, search, exports and stage B always have a main location.
  - If `plants` is empty, the old `city`/`state` stay as they are. They are shown as today, and a state alone is shown in grey italic as "from the GST number".
  - The plant ids let a future parts master and visit reports link to a plant (§11).
- **Extended `customers.json` shape**, backwards compatible. The current file, without these keys, loads unchanged. Export writes them always:
  ```json
  { "id": "sangkaj-industries-pvt-ltd", "name": "SANGKAJ INDUSTRIES PVT. LTD.", "contact": "", "contactFrom": "",
    "city": "", "state": "Maharashtra", "phone": "…", "last": "2026-07-01", "followUp": "", "status": "Active",
    "disputed": false, "group": "", "segment": "", "vehicleSegment": "", "plants": [],
    "relatedParty": false, "erpGroup": "" }
  ```
  Exact export keys: `id,name,contact,contactFrom,city,state,phone,last,followUp,status,disputed,group,segment,vehicleSegment,plants,relatedParty,erpGroup`.
- **Seed validation:** unknown `segment` or `vehicleSegment` values become `""`, and plants with no city and no state are dropped. If anything was dropped, a `notice` says "2 customers had a segment value that is not in the list; it was left blank."

Log row: `{ id /* uuid */, customer_id, at, type /* Call|Visit|Email|Telegram|Note */, note /* ≤500 */, done_follow_up, next_follow_up, created_at, created_by }`

UI objects use the Phase 1 camelCase names: `id, name, contact, contactFrom, city, state, phone, last ('' = none), followUp ('' = none), status, disputed, group, segment, vehicleSegment, plants, added (source==="manual"), updatedAt, createdAt`. LogEntry: `{ id, customerId, at, type, note, doneFollowUp, nextFollowUp, createdAt }`.

**Slug rule** (`Store.slug`, also used by the stage B seed script):
```js
function slug(name, isTaken) {
  var base = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/, "") || "customer";
  var id = base, n = 2;
  while (isTaken && isTaken(id)) id = base + "-" + n++;
  return id;
}
```
I checked all 42 current names: every slug is unique. Example: `ZF STEERING GEAR (INDIA) LTD` -> `zf-steering-gear-india-ltd`. An input row that already has `id` keeps it.

### 2.2 localdb `varsha-crm-localdb-v1`

```
{ v: 1,
  customers: Row[], log: Row[], deleted: string[],          // as above
  rfqs: RfqRow[], rfq_history: RfqHistRow[],                 // §2.5
  visits: VisitRow[],                                        // §2.6
  orders: OrderRow[], orders_meta: ImportMeta | null }       // §2.6 (replaced by each import)
```
Seeding on every load, from `window.CRM_DATA` or `fetch("customers.json",{cache:"no-store"})`:
- Insert seed customers that are missing and not `deleted`.
- Refresh seed rows that were never edited (`updated_at === created_at`) from the file.
- Rules:
  - Unique `lower(name)`.
  - Only `manual` customers can be removed, and only when **no RFQ, visit or order references them**. Otherwise: "Remove its RFQs and visits first (3)." Removing one deletes its log rows.
  - Patches set `updated_at`.

### 2.3 Phase 1 migration (keyed by NAME), once per browser

```
legacy = JSON.parse(localStorage["varsha-crm-local-v2"])   // {added:[], status:{name:v}, follow:{name:v}}
if (!legacy || localStorage["varsha-crm-legacy-done-v1"]) return
find(name) = exact name, else lower(name), else id === slug(name)
status/follow: apply when found, different, and the row was never edited (updatedAt === createdAt); else skipped++
added: addCustomer(a) when not found; else skipped++
keep raw in "varsha-crm-local-v2-backup"; remove "varsha-crm-local-v2"; set "varsha-crm-legacy-done-v1" = "1"
notice: "Moved 3 changes saved by the old version of this page." (+ " 1 skipped because a newer value exists.")
```

### 2.4 Money `varsha-crm-money-v1` (a document, never exported, never in the backup)

```
{ v: 1,
  aging: { meta: ImportMeta, rows: [{ sourceName, customerId /* or null */, groupIds /* [ids] when matched by ERP Group, else null */,
           termsDays, erpTotal, erpNotDue, overdue /* = ERP Overdue */, modelNotDue, modelOverdue,
           b1_30, b31_60, b61_90, b90, preApril, creditBalance, asOn }] } | null,
  live:  { meta: ImportMeta, rows: [{ sourceName, customerId, groupIds, erpBase /* "ERP <date>" column */, erpBaseDate,
           invoicesSince, receiptsSince, outstanding /* = Estimated Live */, asOn }] } | null }
ImportMeta = { fileName, fileDate /* ISO from File.lastModified */, asOf /* YYYY-MM-DD, user-editable, default = file date in IST */,
               importedAt /* ISO */, rowsRead, rowsKept, skipped: [{row, reason}], unmatched: n }
```
- **Decided source rule:** **outstanding = LIVE_POSITION "Estimated Live"**; **overdue = AGING "ERP Overdue"**; the **aging buckets = AGING "1-30", "31-60", "61-90", ">90"**. With only one file imported, show what that file has and an "Import <other tab> to see <x>" hint.
- **">90" bar and Pre April** (Open Question 2): the ">90 days" segment shows `b90 + preApril`, and the legend says "of which before April ₹X".
- The importer shows a **soft check** (a warning, not a block): "Buckets add up to ₹X but ERP Overdue says ₹Y" when `b1_30+b31_60+b61_90+b90+preApril` differs from `ERP Overdue` by more than ₹1 for any row (listing the first 5 rows), and the same against `Model Overdue`. This lets the user see which overdue figure the buckets follow.
- `ImportMeta.asOf` defaults to the latest **"As On"** value in the file (e.g. `15-Oct-26`). If that column is empty, it falls back to the file date. The user can edit it.
- **Totals use every row** (matched or not). **Per-customer amounts use matched rows only.** Rows for the same customer are added together, and the preview reports how many.
- **Group rows** (matched by ERP Group, §2.7):
  - The amount belongs to the group. `CrmMoney.forCustomer(id)` returns it with `shared: { groupName, n }`, and the Customers tab shows "Group Sangkaj: Overdue ₹X (shared by 2)".
  - Totals count it once. Top 5 overdue lists it as one entry "Sangkaj (group of 2)" → `{kind:"ids", value: groupIds}`.
- **Related parties are included in money totals.** Money owed is still owed; the related-party switch only affects the revenue-type numbers (§5.3b).

### 2.4b Revenue `varsha-crm-revenue-v1` and targets `varsha-crm-targets-v1` (P2-L)

```
revenue = { v: 1,
  meta: ImportMeta & { firstDate, lastDate /* = "data through" */, duplicates: n },
  rows: [{ invoiceNo, date /* YYYY-MM-DD */, customerId /* or null */, sourceName /* "Customer" column */,
           onInvoice /* "Customer On Invoice" */, erpGroup /* "ERP Group" */, taxable /* number, may be negative */ }] }
targets = { v: 1,
  byFy: { "2026-27": { customers: { "<customer id>": 2500000 }, segments: { "OEM": 40000000 } } },
  settings: { concentrationPct: 25 } }
```
- **Never stored:** `GSTIN` (CLAUDE.md rule 1), `CGST`, `SGST`, `IGST`, `TCS`, `Invoice Amount`, `PO No`, `Terms Days`, `Due Date`, `Source File`, `Match Method`, `Parser`, `Source File Id`. The importer keeps only the fields in the spec. A test checks that the fixture GSTIN is not anywhere in localStorage.
- **Duplicates:** the same `Invoice No` + `Invoice Date` appearing twice keeps the first row and reports the count. Negative Taxable values (credit notes) are kept and summed.
- **Order is not assumed.** The real file has out-of-order dates (e.g. a 30-May-26 invoice inside the 23-Jun block). "Data through" = the **max** invoice date in the file, `firstDate` = the **min**, and "last invoice" per customer (and "Update Last order") = the **max date per customer**. Never use the first or last row. The real file has 1,040 invoices from 01-Apr-26 to 12-Jul-26.
- **India financial year:** `fyOf(iso)` gives `"2026-27"` for 1 Apr 2026 to 31 Mar 2027. Months run April to March.
- **Revenue is in neither the backup nor `customers.json`** (it is re-imported from the sheet). **Targets are in the backup** (typed by the user, so they cannot be re-imported), with a "contains targets" line on the backup card.
- Optional user action after an import: **"Update Last order from this file"**. For matched customers where the file's newest invoice date is later than `last`, it sets `last` through `Store.saveCustomer`. It is never automatic.

### 2.5 RFQs (assumed fields; to confirm when the RFQ sheet arrives)

```
RfqRow = { id /* uuid */, customer_id /* or null */, customer_name /* raw text, kept when no match */,
           rfq_no, part_name, part_no, qty /* int or null */, received, quote_due, quoted_value /* ₹ number or null */,
           stage, stage_at /* date the current stage started */, next_action /* date or null */, notes /* ≤1000 */,
           lost: false, lost_reason: "",      /* a flag, not a stage (decided, D2) */
           created_at, updated_at }
RfqHistRow = { id, rfq_id, from /* stage or null */, to, at /* IST date */, note /* ≤200 */, created_at }
STAGES = ["Received", "Quoted", "Negotiated", "Finalised", "PO", "Sample", "PPAP"]
RELEASED = ["Finalised", "PO", "Sample", "PPAP"]      // "released parts" (assumption, confirm at review)
```
- Creating an RFQ writes history `{from:null, to:stage}`.
- Every stage change writes `{from, to, at: today}`, plus an optional note. Marking lost or reopening writes `{to: "Lost"}` / `{to: <stage>, note: "Reopened"}`.
- `rfq_no` is unique (case-insensitive) when not empty.
- Status words shown on the cards, red or orange with text:
  - `quote_due < today && stage === "Received"`: **"Quote overdue by N days"** (red).
  - `quote_due === today && stage === "Received"`: "Quote due today" (orange).
  - `next_action < today && stage !== "PPAP" && !lost`: **"Action overdue by N days"** (red).

### 2.6 Schedule

```
VisitRow = { id, customer_id, type /* Visit|Call|Meeting */, date, time /* "" or "HH:MM" 24h */, note /* ≤500 */,
             done: false, done_at /* or null */, log_id /* or null */, created_at, updated_at }
OrderRow = { id, customer_id /* or null */, customer_name, order_no, part, qty /* int or null */, promised /* date or null */,
             status_raw /* text from the file */, done /* boolean, from status_raw */, dispatched /* date or null, optional column */ }
DONE_WORDS = ["dispatched", "delivered", "complete", "completed", "closed", "done", "shipped", "invoiced"]   // lowercase, "contains" match
```
- An orders import **replaces** all orders (snapshot, like money) and sets `orders_meta`.
- Order state words:
  - open and `promised < today`: **"Late by N days"** (red);
  - open and promised = today: "Due today" (orange);
  - open and within 7 days: "Due in N days";
  - done with `dispatched > promised`: "Dispatched N days late" (grey text; history, not an action);
  - done otherwise: "Done".
- Visit state words: `!done && date < today`: **"Not done · N days ago"** (red); today: "Today" (orange).
- Ticking a visit or call done offers **"Also add to the call log"** (ticked by default; decided, D3). It creates a log entry `{at: date, type: Call→Call, Visit→Visit, Meeting→Visit, note}` and stores its `log_id`, so Last contacted updates.

### 2.7 Customer name matching (shared by all imports), `varsha-crm-aliases-v1`

```js
nameKey(n) = n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/\bprivate\b/g, "pvt").replace(/\blimited\b/g, "ltd")
  .replace(/[^a-z0-9]/g, "")
Store.matchCustomer(sourceName) ->
  1. aliases[sourceName.trim()]  (a customer id, or "" meaning "not a CRM customer")
  2. a customer with name === sourceName.trim()
  3. a customer with nameKey(name) === nameKey(sourceName)
  else null (unmatched)
Store.matchGroup(sourceName) -> [customer ids] | null      // used ONLY when matchCustomer returns null
  customers whose erpGroup (exact, then nameKey) equals sourceName; null if none
  (AGING and LIVE_POSITION carry the ERP GROUP name for Sangkaj instead of a customer name)
```
The import dialog lists unmatched names, each with a `<select>`: "Choose customer…" / every customer by name / "Not a CRM customer". Choices are saved into the aliases document on Confirm, so the next import matches them automatically. The customer names in `customers.json` are the CUSTOMER_MASTER names.

---

## 3. Security and privacy

### 3.1 Stage A
- No backend, no keys, no login. Data stays in the browser it was typed or imported in.
- **Git rules:**
  - `customers.json` export has exactly `id,name,contact,contactFrom,city,state,phone,last,followUp,status,disputed,group,segment,vehicleSegment,plants,relatedParty,erpGroup` (no notes, no amounts, no revenue, no targets);
  - the backup has no money;
  - `.gitignore` (A1) gets `*.csv`, `varsha-crm-backup-*.json`, `supabase/.generated/`, `.env*`, `node_modules/`;
  - test fixtures are built in code with made-up amounts, never files of real data.
- `textContent` / `.value` only; a test greps for `innerHTML` in every js file.
- CSP meta:
  ```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'">
  ```
  Bar widths use `el.style.width` (CSSOM, allowed). File import uses `FileReader` (no network).
- **Hide amounts:** a toggle in the Dashboard head ("Hide amounts", persisted in the view key). When on, every amount on every tab renders as `₹ •••` with `aria-label="amount hidden"`. Print follows the toggle.
- Imported CSVs are never uploaded anywhere. The dialog text says: "The file is read in this browser only. Amounts are not sent anywhere and are not saved to git."
- Known existing exposure: the public `customers.json` holds company names, 10 contact names and 42 phones (kept for the review: decided, D4).
- CLAUDE.md rule 1: the page never writes to the Google Sheet. Imports are CSV files the user downloads from it.

### 3.2 Stage B
See §8: RLS + allowlist, sign-ups off, anon revoked, column grants, the emergency revoke, the key rules.

---

## 4. Shared contracts (frozen by A1; other agents only consume them)

### 4.1 `Store` (`js/store.js`)

Every write:
1. validates, and resolves `{ok:false, error, field}` with no change if invalid;
2. applies the change and fires `onChange(reason)` synchronously;
3. persists;
4. resolves `{ok:true, queued:false}`.
Stage B keeps the signatures.

```js
window.Store = {
  init(): Promise<{mode:"local"|"supabase", user:null|{email}}>,
  load(): Promise<{ok:boolean, error?:string}>,          // seed + migrate, then onChange("load")
  status(): { mode, pending:number, storageOK:boolean, loadError:string },
  onChange(cb: (reason: string /* "load"|"local"|"customers"|"log"|"rfqs"|"rfq_history"|"visits"|"orders"|"money"|"aliases"|"notice"|"error" */, detail?) => void),

  // helpers (also module.exports for Node unit tests)
  todayISO(), addDays(iso, n), dayNum(iso), daysBetween(aISO, bISO) /* b - a */,
  fuKind(c, today) /* "overdue"|"today"|"week"|"later"|"none" */, fuText(c, today),
  lastBucket(c, refISO) /* "0-30"|"31-60"|"61-90"|"91+"|"never" */, slug(name, isTaken?), uuid(),
  nameKey(n), matchCustomer(sourceName) /* id | "" | null */, setAliases(map /* {sourceName: id|""} */): Promise<Result>,

  // customers + call log (rich API)
  customers(), get(id), latestOrder() /* max last */,
  addCustomer(f), saveCustomer(id, {name, contact, phone, city, last, group, segment, vehicleSegment, plants}) /* any subset */,
  setStatus(id, s), setFollowUp(id, iso),
  groups(): string[] /* distinct non-empty groups, sorted */, SEGMENTS, VEHICLE_SEGMENTS,
  removeCustomer(id) /* refuses if referenced (§2.2) */, refs(id) /* {rfqs, visits, orders} counts */,
  listLog(id) /* newest first */, allLog(), logCount(id), lastContacted(id) /* among CONTACT_TYPES */,
  addLog(id, {at?, type, note}), markDone(id, {type, note?, next?}),

  // generic collections: "rfqs" | "rfq_history" | "visits" | "orders"
  col(name): {
    all(): Row[],  get(id): Row|undefined,  where(fn): Row[],
    insert(row): Promise<Result & {row}>,      // id = uuid() if missing; created_at/updated_at set
    patch(id, fields): Promise<Result & {row}>,
    remove(id): Promise<Result>,
    replaceAll(rows): Promise<Result>          // imports (orders)
  },
  // documents: "money" | "aliases" | "orders_meta" | "revenue" | "targets"   (each in its own localStorage key, §1.1)
  doc(name): { get(): object|null, set(obj): Promise<Result>, clear(): Promise<Result> },

  // exports
  exportCustomersJson(): {note, customers},                    // exact keys §3.1; no notes, no amounts
  exportBackup(): { format: "varsha-crm-backup-v2", exportedAt, note, customers, callLog, rfqs, rfqHistory, visits, orders, ordersMeta, targets }  // NO money, NO invoices
};
// CONTACT_TYPES = ["Call","Visit","Email","Telegram"]   // DECIDED: plain "Note" entries do not count as Last contacted
```
- Validation for customers and log is the same as earlier versions. Name 1–120, unique case-insensitive: "<name> is already in the list." Phone ≤ 30 and `/^[0-9+()\-\s.\/–]*$/`. Note ≤ 500. `at` ≤ today. `next` ≥ today. Editing `contact` clears `contactFrom`.
- Generic collections only check that the value is a plain JSON-able object under 10 KB. **The owning module validates its domain rules** before calling (e.g. `rfqs.js` checks stage names).
- Storage blocked: keep data in memory and show `#storageWarn`.
- Never `console.error` (the smoke test fails on console errors); use `console.warn`.

### 4.2 `App` (`js/app.js`): shell, router, panels

```js
window.App = {
  registerPanel(id /* "dash"|"list"|"rfqs"|"schedule"|"export" */, {
    label, mount(panelEl), render(), show(filter /* panel-specific, see each module */), summary?() }),
  boot(),                                 // Store.init/load, mount panels, open saved tab, body.dataset.ready = "1"
  show(id, filter?),                      // switch tab; if filter given, call panel.show(filter) (it REPLACES that panel's filters)
  tab(): string,
  view(panelId): object, setView(panelId, obj),   // per-panel persisted slice of varsha-crm-view-v1
  onData(cb),                             // Store.onChange batched per animation frame, then cb()
  hideAmounts(): boolean, setHideAmounts(bool),
  notice(text, kind /* "info"|"error" */), // #notice / #syncErr banners with dismiss ×
  announce(text),                         // #live polite region
  download(filename, text, mime),
  openDialog(dialogEl, openerEl), closeDialog(dialogEl),   // showModal + focus return (by data-id + class after re-render)
  fmt: { date(iso) /* "12 Oct 2026" */, day(iso) /* "Tue 20 Oct" */, money(n) /* "₹4,56,789" */,
         moneyShort(n) /* "₹4.57 L", "₹1.23 Cr" */, int(n), rel(days) /* "3 days" */ }
};
```
- `fmt.money`: `"₹" + Math.round(Math.abs(n)).toLocaleString("en-IN")`. Negative values show as `"−₹1,200 (credit)"`. `null` shows "—". All of it respects `hideAmounts()`.
- `moneyShort`: ≥ 1e7 -> Cr with 2 decimals; ≥ 1e5 -> L with 2 decimals; else full.
- View key: `{ tab: "dash", hide: false, panels: { list: {view, filter, q, sort, dir, extra}, rfqs: {...}, schedule: {...}, export: {...}, dash: {from} } }`. A1 migrates the Phase 1 top-level `{view, filter, q, sort, dir}` into `panels.list`.

### 4.3 `CrmCsv` (`js/csv.js`), pure (also module.exports)

```js
window.CrmCsv = {
  parse(text): string[][],           // strips BOM; detects , ; or \t from the first non-empty line; RFC 4180 quotes; CRLF/LF
  findHeader(rows, spec): { index, map /* fieldKey -> column index */, missing: [labels], found: [headers] },
                                     // scans the first 10 rows; picks the first row matching ALL required fields
  normHeader(h): string,             // lowercase, trim, "&"->"and", remove spaces _ - . ( ) : / ; keep letters digits + > <
  parseAmount(s): { ok:true, value:number|null } | { ok:false },
  parseDate(s): { ok:true, value:"YYYY-MM-DD"|null } | { ok:false },
  parseInt(s): { ok:true, value:number|null } | { ok:false },
  toCSV(table), toTSV(table), safeCell(v)      // export builders (§5.7)
};
```
- **`parseAmount`:**
  - trim, and remove NBSP, spaces, `₹`, `Rs`, `Rs.` and `INR` (case-insensitive) and commas (Indian `1,23,456.78` and Western both work);
  - empty, `-`, `—` or `–` become `{ok:true, value:null}`, treated as 0 in sums and shown as "—";
  - `(1,234)` means −1234; a leading `-` or `−` (U+2212) means negative;
  - suffix `Cr` means negative (credit balance), `Dr` means positive;
  - then it must match `/^\d+(\.\d+)?$/`, else `{ok:false}`;
  - round to 2 decimals.
- **`parseDate`:** accepts `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`, `DD/MM/YY` (20YY), `D-Mon-YYYY` / `DD Mon YYYY` / **`DD-Mon-YY`** (e.g. `01-Apr-26` -> 2026-04-01, the INVOICE_REGISTER format) (Jan–Dec, any case). **Always day-first** (India). It validates real dates (no 31/02). Empty becomes `null`.
- **`parseInt`:** after removing commas it must be `/^\d+$/`. Empty becomes `null`.

### 4.4 `CrmImport` (`js/importer.js`): the shared Import dialog

```js
CrmImport.open({
  title: "Import money data",
  intro: "Export the AGING or LIVE_POSITION tab of the Collections sheet (File > Download > Comma-separated values) and choose the file.",
  specs: [ { key: "aging", label: "AGING tab", fields: [ { key, label, required, synonyms: [..], pattern? /* RegExp on the raw header */, type: "text"|"amount"|"date"|"int" } ],
             skipRow?(cells) -> reason|null } ],             // e.g. "Total" rows
  customerField: "customer",                                // field whose value is matched to customers (or null)
  asOf: true,                                               // show the "Data as of" date
  onConfirm(result): Promise<{ok, error?}>
  // result = { specKey, meta: ImportMeta, rows: [{ ...typed fields, sourceName, customerId /* or null */, row /* file row no */ }], aliases }
});
```

Dialog `#importDlg` (built by importer.js once, reused):
1. **Choose file:** `<input type="file" id="importFile" accept=".csv,text/csv,text/tab-separated-values">` and a "Choose CSV file" button. Read with `FileReader.readAsText(file, "utf-8")`.
2. **Recognise:**
   - Every spec runs `findHeader`. The best match (all required found) is preselected in `<select id="importKind">` ("This file is: AGING tab / LIVE_POSITION tab"); the user can override.
   - **Mismatch:** `#importErr` (`role="alert"`, red, with text) says: "This file does not have the columns we need. Missing: Customer, 1-30 days. Columns found in your file: Party, Amount, Days. Check that you exported the right tab." Confirm stays disabled.
3. **Check:** a summary list:
   - "52 rows read · 47 kept · 3 skipped (total rows, blank names)";
   - "44 matched to customers · 3 not matched";
   - number and date errors as "Row 12: "12,34a" in Overdue is not a number" (the first 20, then "+N more"). **Any error blocks the import** (strict, so money totals are never wrong).
   - Same-name rows: "2 customers appear on more than one row; their amounts are added together."
3b. **Unmatched names** (if any): `<ul id="importUnmatched">`, each with the source name (`textContent`) and a `<select>` of customers + "Not a CRM customer". Unmatched rows are still imported; they count in totals but not per customer.
4. **Data as of:** `<input type="date" id="importAsOf">`, default = file date in IST, max = today. Label: "Data as of (the date the sheet was exported)".
5. **Confirm** `#importOk` "Import 47 rows" / Cancel. On success: close, `App.announce("Imported 47 rows from AGING.")`, `App.notice` with the as-of date.
- 375px: full width (`min(640px, 100vw - 16px)`), the summary scrolls vertically, selects are full width.
- Keyboard: standard dialog rules (§5.8).

### 4.5 Module contracts (each module exposes these; the Dashboard and Export depend only on them)

```js
CrmCustomers = { openDone(id), openNotes(id), openEdit(id), visible(): Customer[], summary(): string };
// list filter: { view?, filter?, q?, sort?, segment? /* SEGMENTS | "none" */, vseg? /* VEHICLE_SEGMENTS | "none" */,
//                group? /* a group name | "none" */, extra? }   (segment, vseg and group combine with everything else)
// sort keys: name | last | follow | status | overdue | revenue
// extra kinds:
//  {kind:"last", value:"0-30"|"31-60"|"61-90"|"91+"|"never", ref} {kind:"state", value} {kind:"disputed"}
//  {kind:"contact", value:"7d"|"30d"|"stale30"} {kind:"due", value:date} {kind:"ids", value:[id], label}
//  {kind:"money", value:"overdue"|"outstanding"} {kind:"aging", value:"b1_30"|"b31_60"|"b61_90"|"b90"} {kind:"related"}

CrmMoney = {
  has(): boolean, meta(): {aging: ImportMeta|null, live: ImportMeta|null},
  forCustomer(id): { outstanding: number|null, overdue: number|null, b1_30, b31_60, b61_90, b90, preApril,
                    shared: null | { groupName, n } /* amount belongs to an ERP group row */ } | null,
  stats(): null | { asOf, stale /* asOf > 7 days ago */, outstanding /* or null */, overdue /* or null */,
                    overduePct /* or null */, buckets: { b1_30: {amount, n}, b31_60, b61_90, b90 },
                    top5: [{ id, name, overdue, b90 }], unmatched: { n, amount } },
  openImport(), clear(which /* "aging"|"live"|"all" */): Promise<Result>
};

CrmRfq = {
  STAGES, RELEASED,
  stats(today): { total, open, lost, byStage: {Received: n, ...}, valueQuoted /* Quoted+Negotiated+Finalised, not lost */,
                  valueWon /* PO+Sample+PPAP */, quoteOverdue, quoteDueToday, actionOverdue,
                  released: { total, byStage: {Finalised, PO, Sample, PPAP}, list: [{id, rfqNo, part, customerName, stage}] },
                  hints: { quotedToPoPct /* or null */, avgDaysToQuote /* or null */, stuck: [{stage, n}] /* open, stage_at > 30 days ago */ } },
  openNew(customerId?), openEdit(id), visible(): RfqRow[], summary(): string
};
// rfqs filter: { view?: "board"|"table", stage?: Stage|"released",
//               flag?: "quoteOverdue"|"quoteToday"|"actionOverdue"|"stuck"|"openQuoted"|"won"|"quotedEver",
//               stuckStage?, customerId?, q?, showLost?: boolean }

CrmSchedule = {
  visitStats(today): { today: n, next7: [{id, date, time, type, customerId, customerName}], next7Count, missed: n },
  orderStats(today): null | { asOf, stale, open, late, dueToday, dueWeek, onTimePct30 /* or null */ },
  openNewVisit(customerId?, date?), clearOrders(): Promise<Result>, visibleVisits(), visibleOrders(), summary()
};
// schedule filter: { sub?: "visits"|"orders", month?: "YYYY-MM", day?: date, vflag?: "missed"|"next7"|"today",
//                   oflag?: "late"|"today"|"week"|"open"|"all", customerId?, q? }

CrmRevenue = {
  has(), meta(): ImportMeta & {firstDate, lastDate} | null, openImport(), clear(): Promise<Result>,
  fyOf(iso): "2026-27", fyRange(fy): {start, end}, fys(): string[] /* FYs present in the data, newest first */,
  forCustomer(id, fy?): { fytd, mtd, lastInvoice } | null,
  stats(opts: { fy?, to: "today"|"data", includeRelated: boolean /* default false */ }): null | {
    excludedRelated: { n, amount } /* shown as "Excludes 2 related parties" when n > 0 and !includeRelated */,
    fy, to /* the date measured to */, dataThrough /* lastDate */, fytd, mtd, mtdLabel /* "July 2026" */,
    prior: { fytd, changePct } | null,                              // only if the file has prior-FY rows
    months: [{ ym: "2026-04", label: "Apr", amount, prior /* number or null */, ids: [customer ids] }],  // 12 items, Apr..Mar
    top10: [{ id, name, amount, share }], top1Share, top5Share,
    concentration: { thresholdPct, risk: boolean, id, name, share },
    bySegment: [{ segment /* "" = not set */, amount, share, ids }],   // CRM segment of matched customers
    byGroup:   [{ group /* ERP Group, "" = none */, amount, share, ids }],
    unmatched: { n, amount },
    targets: null | { basis: "customers"|"segments", total, actual, pct, pacePct, behind: boolean,
                      customers: [{ id, name, target, actual, pct, behind }], segments: [{ segment, target, actual, pct, behind }] } },
  openTargets(), setConcentration(pct): Promise<Result>,
  renderCard(slotEl)          // builds the whole Dashboard revenue card (A7 owns its DOM; A3 provides the slot)
};

CrmReport = {
  open(opts?: { from?, to? }),                      // default: IST today-6 .. today
  compute(range, deps): ReportModel                 // pure; deps = { customers, log, visits, rfqs, rfqHistory, stats: {money, rfq, orders, revenue} }
};
```
- Pure stats functions also go into `module.exports` for unit tests: `rfqStats(rfqs, history, customers, today)`, `moneyStats(doc, customers, today)`, `visitStats(...)`, `orderStats(...)`, `revenueStats(doc, customers, targets, today, opts)`, `reportCompute(...)`.
- If a module is missing (stub), `window.CrmX` is undefined. The Dashboard shows that card's "Not available yet" state and does not error.

---

## 5. UI specs

### 5.1 Header, logo, tabs, banners

- `assets/varsha-logo.jpg` (200×200, already in the repo).
- **Header:** a white rounded badge left of the existing title block (the dark-grey wordmark is unreadable on navy):
  ```html
  <div class="brand"><span class="logo-badge"><img src="assets/varsha-logo.jpg" alt="Varsha Forgings" width="64" height="64"></span>
    <div> company / h1 "Varsha CRM" / date </div></div>
  ```
  ```css
  .brand { display: flex; align-items: center; gap: 16px; }
  .logo-badge { flex: none; background: #fff; border-radius: 16px; padding: 6px; box-shadow: 0 6px 18px rgba(0,0,0,.25); line-height: 0; }
  .logo-badge img { width: 64px; height: 64px; object-fit: contain; display: block; }
  @media (max-width: 860px) { .logo-badge { border-radius: 12px; padding: 4px; } .logo-badge img { width: 44px; height: 44px; } }
  ```
- **Favicon:** **A1 makes** `assets/favicon-64.png`, the circle only, with a transparent background (Pillow 12 is installed):
  ```
  python3 -I - <<'EOF'
  from PIL import Image, ImageDraw
  src = Image.open("assets/varsha-logo.jpg").convert("RGB"); w, h = src.size
  pts = [(x, y) for y in range(int(h * .75)) for x in range(w) if min(src.getpixel((x, y))) < 200]
  x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts); y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
  s = max(x1 - x0, y1 - y0) + 2; cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
  c = src.crop((cx - s//2, cy - s//2, cx - s//2 + s, cy - s//2 + s)).resize((256, 256), Image.LANCZOS).convert("RGBA")
  m = Image.new("L", (256, 256), 0); ImageDraw.Draw(m).ellipse((2, 2, 253, 253), fill=255)
  c.putalpha(m); c.resize((64, 64), Image.LANCZOS).save("assets/favicon-64.png")
  EOF
  ```
  The circle's bounding box is about (43, 23)–(165, 145); the wordmark starts at y 156. A1 checks the result visually.
- **Login card (stage B):** logo at 72px. **Dashboard print header:** logo at 48px (§5.6).
- **Tabs** (`nav.tabs[role=tablist]`, A1). Buttons `#tab-dash`, `#tab-list`, `#tab-rfqs`, `#tab-schedule`, `#tab-export`, labelled Dashboard · Customers · RFQs · Schedule · Export. Panels `#panel-<id>[role=tabpanel]`.
  - Default is `dash` on the first visit, then the last used tab.
  - Left/Right/Home/End keys with a roving tabindex.
  - Selected tab: 3px orange underline, navy text, min height 44px.
  - **At ≤ 860px the tab bar scrolls sideways inside itself** (`overflow-x: auto; scrollbar-width: none`; the page itself never scrolls sideways). The selected tab is scrolled into view.
- **Banners** above the panels (A1): `#storageWarn` (alert), `#notice` (status, dismissible), `#syncErr` (alert, dismissible). Also `#live` (`aria-live="polite"`, visually hidden).
- "+ Add customer" stays in the header on every tab. It opens the Add dialog owned by `customers.js`, so the header button calls `CrmCustomers.openAdd()`; A1 stubs it.

### 5.2 Customers tab (`customers.js`; A1 ports the Phase 1 features, A2 adds P2-A/B/C and the money column)

- Phase 1 behaviour stays: follow-up and status chips with counts, search, sort, red overdue row with "Overdue by N days", orange Due today, tel links, grey italic guesses, Disputed tag, add, remove (hand-added only), 375px cards.
- **Extra filter chip row** `#extraBar`: "Also: <label> ×". It covers every `extra` kind in §4.5 (labels: "Last order 61–90 days ago", "State: Maharashtra", "Disputed", "Contacted in the last 7 days", "Not contacted in 30+ days", "Follow-up on Tue 20 Oct", "Customer: ZF STEERING…" / "These 5 customers", "Has overdue amount", "Overdue 61–90 days"). It persists.
- **Row additions** (`tr[data-id]`):
  - `.lc` under the name: "Last contacted 12 Oct 2026 · 7 days ago" / "today" / "No contact logged yet" (`--ink-dim`).
  - Actions `.acts`:
    - `.done-btn` "✓ Done" (only with a follow-up; `aria-label="Mark follow-up done for <name>"`);
    - `.notes-btn` "Notes" + `.badge` count (`aria-label="Notes for <name>, 3 entries"`);
    - `.edit-btn` "Edit";
    - `.rm` × (hand-added only; refused with a message if referenced).
  - **Money column** `td.money` (header "Outstanding / overdue"; card label "Money"). Shown only when `CrmMoney.has()`.
    - Line 1: outstanding `fmt.money`, or "—".
    - Line 2: `<span class="amt-over">Overdue ₹4,56,000</span>` in red text, with the word "Overdue". Shows "No overdue" (dim) when 0, and nothing when the customer is not in the file.
    - Title on the cell: "Data as of 18 Oct 2026".
    - New sort key `overdue` (sort button on the column header).
- **Done dialog** `#doneDlg` (P2-A):
  - Type select (Call default / Visit / Email / Telegram / Note), outcome note (textarea, 500 max, counter `#doneCount`), next follow-up date (min today) with quick buttons "In 1 week / 2 weeks / 1 month".
  - Note: "Leave the date empty to clear the follow-up. Status does not change." Error `#doneErr`.
  - Save calls `Store.markDone`.
  - Announces "Marked done. Next follow-up 26 Oct 2026." / "Marked done. No follow-up set."
- **Notes drawer** `#notesDlg.drawer` (P2-B):
  - Header with close ×.
  - Sub-line: "<name> · Last contacted … · N entries".
  - Add form: type (Note default), date (default and max today), note (required, 500, `#noteCount`), `#noteErr`, "Save note".
  - History `ol#notesList` newest first. Each `li`: `time` · `.log-type` · optional `.tag-done` "Follow-up done", then `.log-text` (`white-space: pre-wrap; overflow-wrap: anywhere`), then optional "Next follow-up: …".
  - Empty: `#notesEmpty` "No notes yet."
  - CSS: `dialog.drawer { margin: 0 0 0 auto; width: min(440px, 100vw); height: 100dvh; max-height: 100dvh; border-radius: 0 }` and **`dialog.drawer[open] { display: flex; flex-direction: column }`** (never set `display` on a closed dialog). Full width at ≤ 860px.
- **Edit dialog** (P2-C): reuses `#dlg[data-mode=edit]`.
  - Title "Edit customer"; the follow-up/status row `#addOnly` is hidden; "Save changes".
  - Errors go in `#formErr` (`role="alert"`). That replaces Phase 1's `alert()` in add mode too.
  - The id never changes. Use `form.elements.name`.
- Card CSS:
  ```css
  .acts { display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end }
  .btn-sm { font:inherit; font-size:.85rem; font-weight:700; padding:6px 10px; min-height:36px; border-radius:8px;
            border:1.5px solid var(--line); background:#fff; color:var(--navy); cursor:pointer; white-space:nowrap }
  .badge { display:inline-block; min-width:20px; margin-left:6px; padding:1px 6px; border-radius:999px;
           background:var(--navy); color:#fff; font-size:.75rem; text-align:center }
  ```
  At ≤ 860px, actions align left and `.btn-sm` gets `min-height: 40px`.

### 5.2b Plants, group and segment on the Customers tab (P2-K; `customers.js`, A2)

- **Related party** (decided): customers with `relatedParty` show a `Related party` tag (grey outline, text) next to the name. They stay in every list, filter and follow-up. Extra filter kind `{kind:"related"}` with the chip label "Related parties".
- **Table and card:**
  - Under the name, before `.lc`, a `.tags` line of small outline badges, each shown only when set: `Group: Sangkaj Industries` (navy outline), `OEM` (segment), `CV` (vehicle).
  - Badges are `<button class="tag-btn">`, and clicking one applies that filter (`segment`, `vseg` or `group`). `aria-label="Show all customers in group Sangkaj Industries"`.
  - Badges are neutral navy, never status colours.
- **City column:**
  - With plants: `plants[0].city` (or `plants[0].state` if there is no city), then `<span class="badge-lite">+2 plants</span>` when there are more. Its `title` lists all plants ("Chakan, Maharashtra; Hosur, Tamil Nadu"). In the 375px card the full plant list shows as a small list under the label "Plants".
  - Without plants: Phase 1 behaviour.
- **Filter row** (a third `.bar`, before the extra chip):
  - `<label>Segment <select id="fSegment">` All / OEM / Tier-1 / Tier-2 / Trader / Export / Not set;
  - `<select id="fVseg">` All / PV / CV / Tractor / 2W / Off-highway / Other / Not set;
  - `<select id="fGroup">` All / each group from `Store.groups()` with its count / Not set.
  The options carry counts ("OEM (6)"). The filters combine with the chips, search and extra filter, and persist in `panels.list`. At 375px the three selects stack full width.
- **Search** also matches group, plant names and plant cities.
- **Add/Edit dialog**, new sections after the contact fields, in this order:
  1. "Group and segment": `group` (`<input list="groupList">` with a datalist from `Store.groups()`, ≤ 80); `segment` and `vehicleSegment` (`<select>` with a blank "Not set" first; nothing is preselected); the checkbox "Related party (own group company)"; and the read-only "ERP group (from the Collections sheet): <erpGroup or —>".
  2. "Plants and units": a list of rows, each with name (placeholder "e.g. Chakan plant"), city and state inputs, and a "Remove" button (`aria-label="Remove plant 2"`). Then "+ Add plant" (maximum 20). Help text: "The first plant is shown as the customer's city." Edit mode only: a "Make main" button on rows 2 and later moves that plant to the top.
  - The old single **City** input stays in the dialog only while the plant list is empty. When the user adds the first plant, it is prefilled with the current city and state (moved, not invented) and the City input hides.
  - Validation: each plant needs a city or a state ("Plant 2 needs a city or a state."); lengths as in §2.1.
  - The dialog body scrolls (`max-height: calc(100dvh - 120px); overflow-y: auto`), so it fits at 375px.

### 5.3 Money (P2-G; `money.js` + importer)

- **Entry points:** the Dashboard money card "Import money data" (`#moneyImportBtn`), the Customers tab toolbar button "Import money" (only before any money is imported; afterwards the column title links to it), and the Export tab "Data in this browser" card.
- **Header spec** (`HEADER_SPEC` at the top of `money.js`), using the **exact headers** from the sheet (columns A–N and A–F). Matching uses the normalised name, so column order does not matter.

  | spec | col | header | field | required | type |
  |---|---|---|---|---|---|
  | aging | A | `Customer` | customer | yes | text |
  | aging | B | `Printed Terms Days` | termsDays | no | int |
  | aging | C | `ERP Total` | erpTotal | yes | amount |
  | aging | D | `ERP Not Due` | erpNotDue | no | amount |
  | aging | E | `ERP Overdue` | overdue | yes | amount |
  | aging | F | `Model Not Due` | modelNotDue | no | amount |
  | aging | G | `1-30` | b1_30 | yes | amount |
  | aging | H | `31-60` | b31_60 | yes | amount |
  | aging | I | `61-90` | b61_90 | yes | amount |
  | aging | J | `>90` | b90 | yes | amount |
  | aging | K | `Pre April` | preApril | no | amount |
  | aging | L | `Credit Balance` | creditBalance | no | amount |
  | aging | M | `Model Overdue` | modelOverdue | no | amount |
  | aging | N | `As On` | asOn | no | date (`15-Oct-26`) |
  | live | A | `Customer` | customer | yes | text |
  | live | B | **pattern** `^ERP \d{1,2}-[A-Za-z]{3}(-\d{2,4})?$` (e.g. `ERP 15-Oct`; the date in the header changes) | erpBase (+ `erpBaseDate` parsed from the header) | yes | amount |
  | live | C | `Invoices Since` | invoicesSince | no | amount |
  | live | D | `Receipts Since` | receiptsSince | no | amount |
  | live | E | `Estimated Live` | outstanding | yes | amount |
  | live | F | `As On` | asOn | no | date |

  - The importer's field spec gains **`pattern?: RegExp`**, tested on the trimmed original header (A1 adds it to `CrmImport` / `findHeader`).
  - Amount format: text with 3-digit commas (`1,234,567`), negatives with a leading minus, zeros as `"0"`. `parseAmount` covers all of these.
  - Recognition: a file with `ERP Overdue` + `1-30` is AGING; a file with `Estimated Live` is LIVE_POSITION.
  - The real files each have 28 customers and an "As On" of 15-Oct-26. AGING "Printed Terms Days" is sometimes blank: blank is `null` and never an error.
  - Do not assume row order; `asOf` uses the max "As On" date.

  `skipRow`: an empty customer cell, or one matching `/^(grand\s*)?total\b/i`, is skipped with the reason "total row" or "blank name".
- `onConfirm` writes `Store.doc("money")` `{aging | live: {meta, rows}}` (the other file's part is kept) and `Store.setAliases(result.aliases)`.
- **Clear:** "Clear imported money data" asks `confirm("Remove all imported amounts from this browser?")`, then `CrmMoney.clear("all")`. A per-file clear lives in the Export card.
- **Empty state** (Dashboard money card, no money data): "No money data yet. Export the AGING and LIVE_POSITION tabs of the VFPL Collections Engine sheet as CSV and import them here. Amounts stay in this browser only and are never saved to git." plus the Import button.
- **Stale:** `asOf` older than 7 days shows orange text "Money data is 12 days old. Import a fresh file." Totals stay visible.
- Money never appears in `customers.json`, the backup, or CSV/copy unless the user ticks "Include amounts" (§5.7).

### 5.3b Revenue analytics (P2-L; `revenue.js`, A7)

**Import** (`CrmImport.open` spec `invoices`, **exact INVOICE_REGISTER headers**, normalised before comparing):

| field | header | required | type |
|---|---|---|---|
| invoiceNo | `Invoice No` | yes | text |
| date | `Invoice Date` | yes | date (`01-Apr-26`) |
| sourceName (customerField) | `Customer` | yes | text (exact CUSTOMER_MASTER names, so `matchCustomer` step 2) |
| onInvoice | `Customer On Invoice` | no | text |
| erpGroup | `ERP Group` | no | text |
| taxable | `Taxable` | yes | amount (text with commas) |

- Every other column (GSTIN, PO No, Terms Days, Invoice Amount, Due Date, Source File, CGST, SGST, IGST, TCS, Match Method, Parser, Source File Id) is **ignored and not stored**.
- `skipRow`: a blank Invoice No, or a "Total" row.
- The intro text says: "Export the INVOICE_REGISTER tab of the Collections sheet as CSV. **Revenue uses the Taxable column (before GST and TCS). Invoice Amount is not used.** The file is read in this browser only."
- After Confirm, the result line reads "Data through 12 Jul 2026 · 1,040 invoices · 2 duplicates ignored". Then an optional button "Update Last order for 38 customers from this file" (§2.4b), and an optional button "Fill 9 blank groups from ERP Group". That second button only sets a customer's `group` when it is `""` and every invoice row for that customer has the same ERP Group. It is an explicit user action.
- "Clear invoice data" (with confirm) is on the revenue card and on the Export data card.

**Revenue card on the Dashboard** (section 2b, after Money). Needs `CrmRevenue.stats`; empty state below.
- **Related parties switch** (decided): `#incRelated` "Include related parties" (`aria-pressed`, default **off**, persisted `panels.dash.incRelated`). It is shared by the revenue card, the segment-share bars and the Weekly sales review.
  - While off, revenue FYTD/MTD, the monthly trend, top 10, concentration, share by segment and group, and target vs actual all **exclude customers with `relatedParty`**.
  - A visible line under the card title says "Excludes 2 related parties (₹X)" (amount masked by Hide amounts). Clicking it applies `list {extra:{kind:"related"}}`.
  - Money, follow-ups and the customer tiles are not affected.
  - Unmatched invoice rows cannot be classified and stay included; the unmatched note says so.
- Head: the title "Revenue (Taxable, before GST)". Controls: an FY select (`CrmRevenue.fys()`, default the current IST FY) and "Measure to: [Last invoice date] [Today]" (default **last invoice date**, persisted `panels.dash.revTo`). The line "Data through 12 Jul 2026" turns orange with text "Invoice data is N days old" when older than 30 days.
- **Tiles:**
  - "FY 2026-27 to date ₹X". It shows "vs same period last FY +12%" only when the file has prior-FY rows. Click → `list {extra:{kind:"ids", value: all invoiced ids, label:"Invoiced in FY 2026-27"}, sort:"revenue"}`.
  - "Month to date (July 2026) ₹Y". Click → the ids invoiced that month.
- **Monthly trend:** 12 vertical CSS columns Apr→Mar (`.vbars`, `display:grid; grid-template-columns: repeat(12, minmax(0,1fr))`), each a button with the month label and amount (`moneyShort`), height via `style.height`. Prior-FY values (if any) show as a thin grey marker line in each column, with the legend "Last FY". Months after "measure to" are empty. Click → `{extra:{kind:"ids", value: month.ids, label:"Invoiced in Jul 2026"}}`. At 375px the labels shrink to first letters (A M J J A S O N D J F M) and amounts show in each button's `aria-label` and in a details list below.
- **Top 10 customers:** `.hbar` rows "ZF STEERING… ₹1.2 Cr · 18%" → `{kind:"ids", value:[id]}`. "Show these 10" → all ten.
- **Concentration:**
  - "Top customer 31% · Top 5 64%".
  - If top 1 share > threshold: red text "Concentration risk: <name> is 31% of revenue (limit 25%)". Otherwise grey "Top customer below the 25% limit".
  - Threshold: `<input type="number" id="concPct" min="5" max="90" step="1">` "%" (default 25, persisted in targets settings).
  - The numbers click → the ids of top 1 or top 5.
- **Share by segment** (CRM segment, "Not set" last) → `list {segment}` (or `"none"`). **Share by group** (ERP Group from the file, top 8 + "Show all") → `{kind:"ids", value: ids, label:"ERP Group: X"}`. Each bar shows the amount and %. The segment card says: "Set segments on the Customers tab (Edit) to fill this chart."
- **Target vs actual:**
  - "Targets FY 2026-27: ₹A of ₹T (42%)", with a progress bar (navy fill and a 2px orange **pace marker** at `pacePct`).
  - Pace = days elapsed in the FY up to "measure to" ÷ days in the FY.
  - If `pct < pacePct`, red text **"Behind pace: 42% of target, 55% expected"**; else green text "On pace".
  - Basis: customer targets if any are set for this FY, otherwise segment targets (shown as "Based on segment targets").
  - A list of the 5 most-behind customers (or segments) with mini bars → `ids`/`segment` filter. "Behind pace (N customers)" → `{kind:"ids", value, label:"Behind target pace"}`.
  - "Set targets" button → `CrmRevenue.openTargets()`.
  - No targets: "No targets set for FY 2026-27." + "Set targets".
- **Targets dialog** `#targetsDlg`:
  - FY select at the top.
  - Two sections, "By customer" and "By segment". Each row: name/segment, actual FYTD (read-only), and an annual target input (`inputmode="decimal"`, parsed with `parseAmount`, blank = no target). Plus a filter box for the customer list.
  - Save writes `Store.doc("targets")`. Errors: "Row ZF…: target is not a number."
  - At 375px the rows stack.
  - The hint at the top says: "Targets are kept in this browser and in the private backup. They are never saved to git."
- **Empty state** (no invoice data): "No invoice data yet. Export the INVOICE_REGISTER tab of the VFPL Collections Engine sheet as CSV and import it here. Revenue uses the Taxable column (before GST and TCS). Amounts stay in this browser only." + "Import invoices" `#revImportBtn`.
- **Customers tab** (A2, via `CrmRevenue.forCustomer`): when revenue exists, the money cell gets a third line "FY revenue ₹X", plus sort key `revenue`. Without money data it still shows in the same column (header "Money").
- Every amount follows Hide amounts. Totals include unmatched rows ("Includes ₹X from N names not in the CRM" → opens the import's unmatched list). Per-customer figures use matched rows only.

### 5.4 RFQs tab (P2-H/J; `rfqs.js`)

**Toolbar:** view toggle Board | Table (persisted); "+ New RFQ" `#rfqNew`; "Import RFQs" `#rfqImport`; search `#rfqQ` (RFQ no, part, customer); chips "Quote overdue (n)" (red text when n > 0), "Action overdue (n)", "Released parts (n)", "Show lost"; a stage chip row in Table view (All + 7 stages, with counts).

**Board** (`#rfqBoard`):
- Desktop: 7 columns in `STAGES` order, each a `<section aria-labelledby>` with heading "Quoted (4)" and total value "₹12.4 L" (when any value).
- Cards are `<article class="rfq-card" data-id tabindex="-1">` with:
  - RFQ no (bold) · customer;
  - part name / part no · qty;
  - quoted value;
  - status words (§2.5) or "Quote due 21 Oct";
  - "Next: 24 Oct";
  - controls: `button.prev` "◀" (`aria-label="Move RFQ 123 back to Received"`), `button.next` "▶" (`aria-label="Move RFQ 123 to Negotiated"`), `button.edit` "Edit".
- After a move, focus goes to the same card's button in its new column; `App.announce("RFQ 123 moved to Negotiated.")`.
- No drag and drop (keyboard first; may be added later).
- **≤ 860px: stacked sections**, each a `<details open>` per stage with the count in the `<summary>`; cards full width.
- The page never scrolls sideways. On desktop the 7 columns use `grid-template-columns: repeat(7, minmax(0, 1fr))` with small cards; 860–1100px switches to a 4-column wrap.

**Table** (`#rfqTable`):
- Columns: RFQ no · Customer · Part · Qty · Received · Quote due (status words) · Value · Stage (`<select>`, change = move + history) · Next action · Age (days since received) · Edit.
- Sort by received, quote due, value, next action.
- Cards at ≤ 860px as in the Customers tab.
- Lost RFQs are hidden unless "Show lost"; shown greyed with "Lost: <reason>".

**RFQ dialog** `#rfqDlg` (new and edit):
- **Customer:** `<input list="rfqCustomers">` with a datalist of customer names; on save it must match a customer exactly (`Store.matchCustomer`), else `#rfqErr` "Pick a customer from the list, or add the customer first."
- Fields: RFQ no, part name, part no, qty (int), received (date, default today, max today), quote due (date), quoted value (amount, parsed with `CrmCsv.parseAmount`), stage (select; new = Received), next action (date), notes (≤ 1000, counter).
- "Mark as lost" checkbox + reason (≤ 200), edit mode only.
- **Stage history** (edit mode, read-only `ol.hist`): "12 Oct 2026 · Received → Quoted · note".
- Changing the stage in the dialog writes one history row, with an optional "Stage note" input shown when the stage changed.
- Validation messages: "Enter the RFQ number or the part name." (at least one); "RFQ <no> already exists."; "Quantity must be a whole number."; "Quoted value is not a number."

**RFQ import:** `CrmImport.open` with spec `rfqs`. Placeholder synonyms (to be fixed when the sheet is seen; decided, D5):
- customer: `Customer`, `Customer Name`, `Party`
- rfq_no: `RFQ No`, `RFQ Number`, `RFQ #`, `Enquiry No`
- part_name: `Part Name`, `Part`, `Description`
- part_no: `Part No`, `Part Number`, `Drawing No`
- qty: `Qty`, `Quantity`, `Annual Qty`
- received: `Date Received`, `RFQ Date`, `Received`
- quote_due: `Quote Due`, `Due Date`, `Quote Due Date`
- quoted_value: `Quoted Value`, `Quote Value`, `Value`
- stage: `Stage`, `Status`
- next_action: `Next Action Date`, `Next Action`
- notes: `Notes`, `Remarks`

Rules:
- Required: customer, and rfq_no or part_name.
- A stage value must match a STAGES name case-insensitively (also accept "PO received"→PO and "Finalized"→Finalised); otherwise it is a row error.
- Rows **upsert by rfq_no**: existing ones are updated and a stage change adds history with the note "Imported"; new ones are inserted with history.
- Rows without rfq_no are always inserted.
- Unmatched customers keep `customer_name` and `customer_id: null`, shown in grey italic "not in CRM".

### 5.5 Schedule tab (P2-I; `schedule.js`)

Sub-tabs (`role=tablist` inside the panel, persisted): **Visits & calls** (default) | **Orders & dispatch**.

**Visits & calls**
- Toolbar: "◀" `#calPrev`, the month title "October 2026" (`h2`, `aria-live="polite"`), "▶" `#calNext`, "Today" `#calToday`, "+ Add visit or call" `#visitNew`. Chips: "Today (n)", "Next 7 days (n)", "Not done (n)" (red text when n > 0).
- **Desktop (> 860px): month grid + agenda.**
  - The grid is a `<table class="cal">` with Monday-first headers (Mon…Sun) and 6 rows.
  - Each day cell is a `<button class="day" data-date>` with `aria-label="Tuesday 20 October 2026, 2 entries"`. It shows the date number, up to 3 chips ("10:30 Visit · ZF STEERING…"), then "+N more".
  - Today: orange ring plus the visually hidden text "today". Days outside the month are dim. A day with a missed entry has a red dot plus the hidden text "has missed entries".
  - Clicking a day selects it; the agenda (right, 360px) lists that day's entries.
  - Arrow keys move day focus within the grid (Left/Right ±1, Up/Down ±7); Enter selects.
- **≤ 860px: agenda list only.**
  - "Not done" (past, not done) at the top, in red text.
  - Then today and the next 30 days, grouped by day ("Today · Mon 19 Oct", "Tomorrow · Tue 20 Oct", …).
  - The month buttons page the list by 30 days.
- Agenda item: time (or "Any time") · type · customer (button → `CrmCustomers.openNotes`) · note (`textContent`) · status words · a `<input type="checkbox" class="vdone">` labelled "Done" · Edit button.
- Ticking done shows a small inline confirm "Also add to the call log" (checkbox, ticked) + Save. That calls `Store.col("visits").patch` and, if ticked, `Store.addLog` and stores `log_id`.
- **Visit dialog** `#visitDlg`:
  - customer (datalist, must match);
  - type select Visit/Call/Meeting;
  - date (default the selected day);
  - time (`type=time`, optional);
  - note (≤ 500, counter);
  - Done checkbox (edit mode);
  - Delete (edit mode, with confirm).
  - Errors in `#visitErr`.

**Orders & dispatch**
- Toolbar: "Import orders" `#ordersImport`; "Data as of 18 Oct 2026" (orange stale text when > 7 days old); "Clear orders"; chips "Late (n)" (red text), "Due today (n)", "Due this week (n)", "Open (n)", "All"; search.
- Table: Customer · Order / PO no · Part · Qty · Promised · Status words (§2.6) · Status from file (dim). Sorted by promised ascending; late first. Cards at ≤ 860px.
- **Empty state:** "No order schedule imported yet. Export the order or dispatch sheet as CSV and import it here. Columns needed: customer, order or PO number, part, quantity, promised date, status." + Import.
- **Order import spec** (assumed; decided, D5): customer* (`Customer`, `Party`), order_no* (`PO No`, `Order No`, `PO Number`, `SO No`), part (`Part`, `Part Name`, `Item`), qty (`Qty`, `Quantity`), promised* (`Promised Date`, `Delivery Date`, `Due Date`, `Commit Date`), status (`Status`, `Dispatch Status`), dispatched (`Dispatch Date`, `Dispatched On`). Replace-all on Confirm.

### 5.6 Dashboard tab (P2-F; `dashboard.js`)

**Head row:**
- "As of Monday, 19 October 2026 (India time)";
- `#hideAmt` toggle "Hide amounts" (`aria-pressed`, persisted);
- `#printBtn` "Print / Save as PDF" (`no-print`);
- `#weeklyReportBtn` "Weekly sales review" (`no-print`) → `CrmReport.open()`. Hidden if `CrmReport` is missing;
- `#printHead` (print only): logo 48px + "Varsha Forgings · CRM dashboard · 19 Oct 2026 (India time)".

**Sections, in order.** Every card is `section.dcard[aria-labelledby]` with an `h2`. **Every number is a `<button>`** that calls `App.show(tab, filter)`. Clicking it must show exactly that many rows or cards.

1. **Customers at a glance** (tiles `.tiles`, `repeat(auto-fit, minmax(150px, 1fr))`, 2 per row at 375px):

   | Tile | → | Notes |
   |---|---|---|
   | Total customers | `list {}` | |
   | Active / Follow up / At risk | `list {filter}` | label text carries the meaning |
   | Overdue | `list {view:"overdue"}` | red border + "Needs a call now"; "None overdue" when 0 |
   | Due today | `list {view:"today"}` | orange + "Due today" |
   | Next 7 days | `list {view:"week"}` | |
   | No follow-up set | `list {view:"none"}` | |
   | Disputed | `list {extra:{kind:"disputed"}}` | |

2. **Money** (needs `CrmMoney.stats()`; empty state §5.3; "Not available yet" if the module is missing):
   - Tiles:
     - "Total outstanding ₹X" → `list {extra:{kind:"money", value:"outstanding"}, sort:"overdue"}`;
     - "Total overdue ₹Y", red, with the label "Overdue" → `list {extra:{kind:"money", value:"overdue"}, sort:"overdue"}`;
     - "Overdue share N%" → same as overdue.
   - **Aging bar:** one stacked bar of 4 segments for 1–30 / 31–60 / 61–90 / >90 days (navy shades getting darker; >90 uses `--risk`). The legend is 4 buttons "61–90 days · ₹2.1 L · 6 customers" → `list {extra:{kind:"aging", value}}`.
   - **Top 5 overdue:** an ordered list, each name a button → `list {extra:{kind:"ids", value:[id], label:name}}`, with the amount in red and the text "overdue"; a "Show these 5" button → `{kind:"ids", value:[5 ids], label:"Top 5 overdue"}`.
   - Footer: "Data as of 18 Oct 2026 (AGING), 18 Oct 2026 (LIVE_POSITION)", plus "Includes ₹X for N names not in the CRM" (button → `CrmMoney.openImport()`), plus "Import money data".
   - Amounts follow Hide amounts.
   - Out of scope for stage A: payment trends over time (needs history kept in the stage B database).

2b. **Revenue** (`span 12`): see §5.3b. Needs `CrmRevenue`; empty state there.

3. **Attention now** (`span 7`): overdue follow-ups (oldest first, then name), then due today.
   - Each item: name (button → `openNotes`) · red "Overdue by N days" / orange "Due today" · contact and `tel:` phone · last contacted · overdue amount if money exists (red, with "overdue") · `✓ Done` → `CrmCustomers.openDone(id)` · `Notes n` → `openNotes(id)`.
   - At most 10, then "Show all overdue (N)" / "Show all due today (M)".
   - Empty: "Nothing overdue or due today."

4. **Next 7 days** (`span 5`), two lists:
   - (a) Follow-ups grouped by day. The group button "Tue 20 Oct (2)" → `list {extra:{kind:"due", value}}`; footer "All (N)" → `list {view:"week"}`.
   - (b) Visits & calls from `CrmSchedule.visitStats`. Items: "Tue 20 Oct · 10:30 · Visit · ZF…" (button → `schedule {sub:"visits", day}`). Count "N visits and calls" → `schedule {sub:"visits", vflag:"next7"}`. "Not done: N" in red text → `{vflag:"missed"}`.
   - Empty texts for each.

5. **RFQ pipeline** (needs `CrmRfq.stats`):
   - **Funnel:** 7 horizontal bars in stage order (navy fill scaled to the largest stage). Label "Negotiated · 3 · ₹8.2 L" → `rfqs {stage, view:"table"}`.
   - Tiles:
     - "Quote overdue N", red text → `rfqs {flag:"quoteOverdue", view:"table"}`;
     - "Next action overdue N", red → `{flag:"actionOverdue"}`;
     - "Value quoted, no PO yet ₹X" → `rfqs {flag:"openQuoted", view:"table"}` (Quoted + Negotiated + Finalised, not lost);
     - "Won (PO and later) ₹Y" → `rfqs {flag:"won", view:"table"}`.
   - **Hints** (text with clickable numbers):
     - "N% of quoted RFQs reached PO" (N not clickable; the denominator count is a button → `{flag:"quotedEver"}`);
     - "Quotes take N days on average from receipt";
     - "N RFQs stuck in Negotiated for over 30 days" → `{flag:"stuck", stuckStage:"Negotiated"}`.
     The hints need ≥ 3 RFQs, else "Add RFQs to see conversion hints."
   - The filter list therefore is `flag ∈ quoteOverdue|quoteToday|actionOverdue|stuck|openQuoted|won|quotedEver`.
   - Empty: "No RFQs yet. Add them on the RFQs tab or import your RFQ sheet."

6. **Released parts** (P2-J):
   - Tile "Released parts N" → `rfqs {stage:"released", view:"table"}`.
   - Breakdown buttons "Finalised 2 · PO 3 · Sample 1 · PPAP 4" → `rfqs {stage}`.
   - A list of up to 8 parts: "Part name (Part no) · customer · stage" → `CrmRfq.openEdit(id)`.
   - Footnote (`--ink-dim`): **"Released parts = RFQ parts at Finalised, PO, Sample or PPAP. Please confirm this meaning."**

7. **Orders** (needs `CrmSchedule.orderStats`):
   - Tiles: "Late orders N", red + "Late" → `schedule {sub:"orders", oflag:"late"}`; "Due today N"; "Due this week N"; "On time (last 30 days) N%" (not clickable; or "—").
   - "Data as of …".
   - Empty: "No order schedule imported yet." + a button to go to Schedule › Orders.

8. **Customer mix**, three cards (`span 4` each):
   - **Status mix:** a stacked bar (`--ok`/`--warn`/`--risk`, `aria-hidden`) + 3 legend buttons "Active 20 (48%)".
   - **Last order recency:**
     - A toggle "Count days from: Today | Latest order in the data (12 Jul 2026)" (persisted `panels.dash.from`).
     - Bars 0–30 / 31–60 / 61–90 / 91+ / No order on record → `list {extra:{kind:"last", value, ref}}`.
     - Note: "Last order dates come from the Collections sheet, which stops at 12 Jul 2026 …". The date comes from `Store.latestOrder()`.
   - **By state:** bars (top 8 + "Show all") → `list {extra:{kind:"state", value}}`; "Not known" last, grey italic; note "State comes from the GST number." The state is the derived main state (§2.1).

8b. **Segments and groups** (P2-K), two cards (`span 6` each; `span 12` at ≤ 860px):
   - **By segment:** bars for OEM / Tier-1 / Tier-2 / Trader / Export / Not set, showing the customer count, plus overdue ₹ if money is imported and FY revenue ₹ if revenue is imported (small dim text). Click → `list {segment}` (`"none"` for Not set).
   - A small **By vehicle segment** row of chips (PV 3 · CV 9 · …) under it → `list {vseg}`.
   - **By group:** groups with ≥ 1 customer, sorted by customer count then name, top 8 + "Show all". Each row is "Sangkaj Industries · 2 customers · overdue ₹… · revenue ₹…" → `list {group}`. The tile "Customers with no group: N" → `list {group:"none"}`.
   - Empty (no segment or group set on anyone): "No segments or groups set yet. Use Edit on a customer to add them." The counts still show "Not set 42".

9. **Activity:**
   - Tiles "Contacted in last 7 days", "Last 30 days", "Not contacted in 30+ days" (customer counts) → `list {extra:{kind:"contact", value}}`.
   - Recent activity: the 10 newest log entries (date · type · customer button → `openNotes` · "Follow-up done" tag · `.snippet` up to 80 chars).
   - **Empty state:** "No calls or notes logged yet. When you finish a follow-up, press ✓ Done on the customer; use Notes to record any call or visit." + "Go to Attention now".

10. **Quick links** (`no-print`): "Weekly sales review" (→ `CrmReport.open()`), "Download Attention list (CSV)" (via `CrmCsv`), "Open the Export tab".

**Grid:** `.dgrid { display:grid; grid-template-columns: repeat(12, minmax(0,1fr)); gap:16px }`. Sections 1, 2, 5, 7 and 9 are `span 12`; 3 is `span 7` and 4 is `span 5`; 6 is `span 12` (or `span 5` next to a `span 7` funnel when wide); the three cards of section 8 are `span 4` each. At ≤ 860px everything is `span 12`.

**Bars:** `.hbar` is a `<button>` laid out with `grid-template-columns: minmax(90px, 32%) 1fr auto`, track `--line`, fill navy via `style.width`, `min-height: 40px`.

**Re-render:** on `App.onData` and on tab show.

**Pure compute (unit-tested):** `CrmDash.compute(customers, log, today, {from, latestOrder, lastContacted, money, rfq, visits, orders})` returns `{ customers: {...}, attention: [...], upcoming: [...], lastOrder: {...}, byState: [...], contact: {...}, recent: [...] }` plus the passed module stats. Ordering rules are as in each section.

**Print** (`css/dashboard.css`, `@media print`):
- Hide `header, nav.tabs, .no-print, [role=tabpanel]:not(#panel-dash), dialog, .banner`; force `#panel-dash { display:block !important }`. `#printBtn` calls `App.show("dash")` then `print()`.
- Show `#printHead`.
- Cards get `break-inside: avoid`; tiles print in 3 columns; `print-color-adjust: exact` (the red and orange words stay).
- **`.snippet` (note text) is hidden.** Amounts are hidden if Hide amounts is on. Buttons print as plain text.

### 5.7 Export tab (P2-E; `export.js`)

1. **Customers:** scope radios "Customers in the Customers tab now (N), with current filters" (default) / "All customers (M)" (persisted). Show the `CrmCustomers.summary()` line. Two checkboxes, **unticked on every load and never remembered**:
   - "Include notes text (private)";
   - "Include amounts (private)". Shown only if money or revenue exists; it adds the columns Outstanding, Overdue, 1–30, 31–60, 61–90, >90, and FY revenue (Taxable). There is still only one header row, so Sheets stays clean.
2. Buttons:
   - **Download CSV** `#csvBtn`.
   - **Copy for Google Sheets** `#copyBtn`, with fallback `#copyFallback` + `#copyBox` (readonly textarea, selected) when `navigator.clipboard.writeText` rejects. The text says to press Ctrl+C or long-press, then Copy; `execCommand("copy")` is tried.
   - **Download customers.json** `#export` (all customers, no notes, no amounts; git-safe).
   - **Download backup** `#backup` (customers, notes, RFQs, history, visits, orders, targets; **no money, no invoices**): "Private: contains notes and targets. Never commit it."
   - **Weekly sales review** `#weeklyReportBtn2` → `CrmReport.open()` (§5.7b).
3. **RFQs CSV** `#rfqCsvBtn`: scope "RFQs shown in the RFQs tab now" / "All RFQs". Columns: RFQ no, Customer, Part name, Part no, Qty, Received, Quote due, Quoted value, Stage, Stage since, Next action, Lost, Notes. The value column is included because RFQ data is the user's own pipeline; the warning line says "Contains quoted values (private)."
4. **Visits CSV** `#visitCsvBtn` (all): Date, Time, Type, Customer, Note, Done.
5. **Send to Google Sheet automatically** `#autoBtn` (disabled, "Coming next"; design in §8.6).
6. **Data in this browser** (`#dataCard`):
   - counts of customers, notes, RFQs, visits, orders ("as of …"), money ("AGING as of …, LIVE_POSITION as of …"), invoices ("1,040 invoices, data through 12 Jul 2026"), targets ("FY 2026-27: 12 customers, 2 segments");
   - buttons "Clear imported money data" (→ `CrmMoney.clear("all")`), "Clear imported orders" (→ `CrmSchedule.clearOrders()`) and "Clear invoice data" (→ `CrmRevenue.clear()`), each with a confirm;
   - the note "To move everything to another browser, download the backup and import it there." **Backup import is out of scope for stage A** (stage B makes it unnecessary). The note says "Backup import comes with the shared database."
7. `#exportMsg` (`role=status`).

CSV rules (`CrmCsv`):
- A BOM (`\uFEFF`, written as that escape in the JS source) + RFC 4180 (every field quoted, `"` doubled), CRLF rows with a trailing CRLF.
- `safeCell` prefixes `'` to cells starting with `= + - @ \t \r`.
- Dates as `YYYY-MM-DD`; amounts as plain numbers with 2 decimals (no ₹ or commas, so Sheets sums them).
- Customer columns, in this exact order: Customer, Contact person, Phone, City, Group, Segment, Vehicle segment, Plants, Last order, Follow-up, Status, Last contacted, Notes count [, Notes] [, amount columns].
  - Plants: `"Chakan plant (Chakan, Maharashtra); Hosur (Hosur, Tamil Nadu)"`, or empty.
- **Never** emails, GST, ids or timestamps.
- TSV: values have `\t\r\n` replaced by a space.
- File names: `varsha-crm-customers[-shown]-<IST date>.csv`, `varsha-crm-rfqs-<date>.csv`, `varsha-crm-visits-<date>.csv` (all match `*.csv` in `.gitignore`).

### 5.7b Weekly sales review (P2-M; `report.js` + `css/report.css`, A8)

- **Opened** from `#weeklyReportBtn` (Dashboard) and `#weeklyReportBtn2` (Export). It is a full-screen `<dialog id="reportDlg" class="report">`, not a tab.
- **Controls bar** (`no-print`):
  - "From" / "To" dates (default **IST today − 6 … today**, max today, From ≤ To);
  - "Last 7 days" reset;
  - `<label><input type="checkbox" id="repNotes"> Include note text (private)</label>`, unticked on every open and **never remembered**;
  - "Print / Save as PDF" `#repPrint`; Close.
  - The range is also not remembered: it reopens on the last 7 days, a deliberate exception like the notes box.
- **Page** `#reportPage` (an A4 sheet on screen: `width: 210mm; min-height: 297mm; padding: 12mm; background:#fff`; scaled down to fit at ≤ 860px with `width: 100%` and no sideways scroll). It is built with `textContent`, at 10pt base type:
  1. **Header:** logo 40px + "Varsha Forgings · Weekly sales review" + "13 Oct – 19 Oct 2026 (India time)" + "Prepared 19 Oct 2026". Data-as-of dates for money, orders and invoices go in a small footer line.
  2. **Headline row** (6 small boxes): Overdue follow-ups (red word "Overdue") · Due in next 7 days · Calls/visits logged · RFQs moved · Late orders · Revenue FYTD vs target (%). A box is omitted when its module or data is missing.
  3. **RFQ pipeline:** a one-line funnel "Received 4 → Quoted 3 → Negotiated 2 → Finalised 1 → PO 2 → Sample 0 → PPAP 1". Then **stage movements in range**, from `rfq_history` rows with `at` in range, newest first, at most 8 + "+N more": "15 Oct · RFQ 123 · ZF STEERING… · Received → Quoted". Then "New RFQs in range: N" and "Quote overdue: N" (red text).
  4. **Follow-ups:** overdue (oldest first: name, "Overdue by N days", contact, phone), at most 8; then due in the next 7 days, at most 8.
  5. **Contact this week:** counts by type from call-log entries with `at` in range, plus done visits/calls in range that have no `log_id` (no double counting). Then a comma-separated list of customer names. Note text, one line each, only when `#repNotes` is ticked.
  6. **At-risk customers:** status "At risk", sorted by last contacted (oldest or never first): name · last order · last contacted. At most 10 + "+N more".
  7. **Money overdue** (only if imported): total overdue (red, with text), the aging split in one line, the top 5.
  8. **Late orders** (only if imported): count (red, with text) + at most 5 rows.
  9. **Revenue vs target** (only if imported): FYTD, % of target, pace words ("Behind pace" in red / "On pace"), "Data through …". It uses the same "Include related parties" setting as the Dashboard, and prints "Excludes 2 related parties" when they are excluded.
  10. **Top 5 actions for next week** (derived): overdue follow-ups, **oldest first**, as "Call <name> (<contact>, <phone>): follow-up overdue by N days". If fewer than 5, fill with follow-ups due in the next 7 days (soonest first). The rule is printed in small text: "Actions = overdue follow-ups, oldest first, then the next ones due."
- **Print:** `#repPrint` adds `body.print-report`, calls `print()`, and removes the class on `afterprint`.
  ```css
  @page { size: A4; margin: 0; }
  @media print { body.print-report > *:not(#reportDlg) { display: none !important; }
                 body.print-report #reportDlg { position: static; width: auto; height: auto; border: 0; box-shadow: none; }
                 body.print-report .no-print { display: none !important; }
                 #reportPage { width: 210mm; height: 297mm; overflow: hidden; break-after: avoid; } }
  ```
  `print-color-adjust: exact`. Amounts follow Hide amounts.
- **One page:** every list has the caps above. If the content still overflows 297mm on screen (measured after render), a `.overflow-warn` line (`no-print`) says "This week has more items than fit on one page; the lists are cut, so open the tabs for the full lists." The test measures the page.
- **Pure compute:** `CrmReport.compute({from, to}, deps)` returns `{ headline, funnel, moves, newRfqs, quoteOverdue, overdue, dueNext, contact: {byType, names, notes}, atRisk, money, lateOrders, revenue, actions }`. It is unit-tested.

### 5.8 Shared rules for every dialog, the keyboard and 375px

- Use `App.openDialog`: `showModal`, focus the first field, Esc closes, focus returns to the opener after re-render.
- Ctrl/Cmd+Enter submits from a textarea. Errors use `role="alert"`. Counters turn `--warn` at 90% of the limit.
- Every interactive control is a real `<button>`, `<input>` or `<select>` with a visible focus ring (3px orange).
- **375px:** no page-level sideways scroll on any tab, with any dialog or drawer open. Tables become cards. The tab bar and the RFQ board (desktop only) are the only containers that may scroll sideways inside themselves.
- Colours: `--ok`, `--warn` and `--risk` only for status, follow-up, late or overdue meaning, and always with words (rule 7). New tokens go in `:root` in `base.css`: `--navy-2: #2e4f7d; --navy-3: #5b7aa6` (aging shades).

---

## 6. Test plan

### 6.1 Runner and ownership

One command: `NODE_PATH=$(npm root -g) node tests/smoke.js`. Use `--strict` at integration time and before any push to `main`: any SKIP then fails.

The runner (A1):
- runs the static server (types: `.js text/javascript`, `.css text/css`, `.jpg image/jpeg`, `.png image/png`, `.json`, `.html`);
- launches Chromium;
- runs `tests/unit/*.js`, then `tests/checks/*.js`, in filename order;
- prints PASS/FAIL/SKIP; exits 1 on FAIL (or on SKIP with `--strict`).

Module signature: `module.exports = async (t) => {}` with:
```js
t = { browser, url, root, data /* customers.json */, check(name, ok, extra), skip(name, why),
      fresh(opts?) -> {ctx, page},  open(page) /* waits for body[data-ready="1"] */, tab(page, id), reload(page),
      row(page, name), rows(page) /* visible #rows tr */, istToday(offset),
      csvFile(name, text) -> {name, mimeType:"text/csv", buffer},       // for page.setInputFiles
      download(page, clickSelector) -> {name, text},
      has(page, expr) -> boolean /* e.g. "window.CrmRfq" */, fs, path }
```
- Every module uses its own `t.fresh()` context, so modules are independent.
- `99-final` checks "no console errors" across all pages.
- Fixtures use made-up names for unmatched rows (e.g. "Zeta Imaginary Pvt Ltd") and made-up amounts.

| Owner | Files |
|---|---|
| A1 | `tests/smoke.js`, `tests/checks/10-shell.js`, `tests/checks/15-customers-core.js`, `tests/checks/99-final.js`, `tests/unit/csv-unit.js`, `tests/unit/store-unit.js` |
| A2 | `tests/checks/20-customers.js` |
| A3 | `tests/checks/40-dashboard.js`, `tests/unit/dashboard-unit.js` |
| A4 | `tests/checks/50-rfqs.js`, `tests/unit/rfqs-unit.js` |
| A5 | `tests/checks/60-schedule.js`, `tests/checks/70-money.js`, `tests/unit/money-unit.js`, `tests/unit/schedule-unit.js` |
| A6 | `tests/checks/30-export.js`, `tests/unit/export-unit.js` |
| A7 | `tests/checks/75-revenue.js`, `tests/unit/revenue-unit.js` |
| A8 | `tests/checks/80-report.js`, `tests/unit/report-unit.js` |

Cross-module checks (e.g. a dashboard number that needs `CrmRfq`) start with `if (!(await t.has(page, "window.CrmRfq"))) return t.skip(name, "needs A4")`. They must PASS after merge (`--strict`).

### 6.2 Acceptance checks per task (exact names)

**A1 · 10-shell**
- `first visit opens the Dashboard tab`, `tab order is Dashboard, Customers, RFQs, Schedule, Export`
- `tab choice survives a refresh`, `arrow keys move between tabs`
- `logo shows in the header on a white badge` (naturalWidth > 0, badge background white)
- `favicon is a 64px PNG`
- `tab bar fits at 375px without page scroll`
- `every panel stub mounts without console errors`

**A1 · 15-customers-core** (the 27 Phase 1 checks, adapted: open the Customers tab first; duplicate name uses `#formErr`; the export key set includes `id`; export via `#tab-export` then `#export`)
- `rows carry a stable data-id`
- `Phase 1 edits move to the new store` / `... survive a refresh and the notice does not repeat`
- `extra filter chip shows, clears with ×, and survives a refresh`
- `customers.json export never includes notes or amounts`
- `old customers.json without group, segment or plants loads with blanks` (the current file: every customer has `group:""`, `segment:""`, `vehicleSegment:""`, `plants:[]`)
- `unknown segment in customers.json is left blank with a notice` (via `window.CRM_DATA` in an init script)
- `export has the new keys` (the exact key set in §3.1)
- `Markal and KCTR Varsha are flagged as related parties` (exactly those two ids have `relatedParty: true` in the loaded data)

**A1 · units**
- csv-unit: parse (quotes, embedded commas and newlines, BOM, `;` and tab delimiters, CRLF); `findHeader` (title rows above the header, missing fields reported, a `pattern` field matches `ERP 15-Oct`); `parseAmount` (`"1,23,456.78"`→123456.78, `"(1,200)"`→-1200, `"−500"`→-500, `"2,000 Cr"`→-2000, `"₹ 3,400"`→3400, `""`→null, `"12a"`→not ok); `parseDate` (`"05/08/2026"`→2026-08-05, `"12-Jul-2026"`, `"01-Apr-26"`→2026-04-01, `"31/02/2026"`→not ok); `safeCell`; `toCSV`/`toTSV`.
- store-unit: slug for all 42 names is unique; `nameKey("Laxmi Agni Components & Forging Pvt.Ltd-V")` equals `nameKey("LAXMI AGNI COMPONENTS AND FORGING PRIVATE LIMITED V")`; `lastBucket`; `fuKind`; saving plants sets city/state from the first plant; an unknown segment is refused by `validate`; `groups()` is distinct and sorted.

**A1 · 99-final**
- `no innerHTML in any js file`, `CSP meta present`
- `blocked storage shows a warning`
- `no console errors`

**A2 · 20-customers**
- P2-A:
  - `Done button only on rows with a follow-up`
  - `Done with a note and next date moves the follow-up` (ZF at -3, "In 1 week": +7, "In 7 days", row not overdue)
  - `Done adds a log entry and sets Last contacted today`
  - `Done survives a refresh`
  - `Done without a next date clears the follow-up`
  - `Done refuses a past next date`
  - `Esc closes Done without saving`
- P2-B:
  - `Notes drawer adds an entry at the top`
  - `note is limited to 500 characters`
  - `older-dated note sorts below newer ones`
  - `notes and badge survive a refresh`
  - `note text is shown as text, not HTML`
  - `empty note is refused`
- P2-C:
  - `edit changes name, contact, phone and city`
  - `rename keeps the same id`
  - `renamed customer keeps follow-up, status and notes`
  - `edits survive a refresh`
  - `edited contact is no longer shown as a guess`
  - `rename to an existing name is refused`
  - `empty name is refused`
- Money column (skip without `CrmMoney`):
  - `money column appears only after a money import`
  - `overdue amount is red and says Overdue`
  - `sort by overdue puts the largest first`
- P2-K:
  - `segment and vehicle segment come from fixed lists and default to Not set`
  - `group can be typed and is suggested for the next customer`
  - `adding a plant moves the old city into it`
  - `first plant drives the City column and "+N plants" shows`
  - `Make main moves a plant to the top`
  - `plant without city or state is refused`
  - `group, segment and plants survive a refresh`
  - `segment, vehicle and group filters combine with chips and survive a refresh`
  - `badge click applies its filter`
  - `search finds a plant city`
  - `related party tag shows and the checkbox survives a refresh`
  - `a Note entry does not change Last contacted; a Call does`
  - `Edit dialog scrolls and fits at 375px`
- Revenue line (skip without `CrmRevenue`):
  - `FY revenue line appears after an invoice import`
  - `sort by revenue puts the largest first`
- Layout:
  - `no sideways scroll at 375px with the Notes drawer open` / `... Done dialog open`
  - `focus returns to the Notes button after closing the drawer`

**A6 · 30-export** + export-unit
- `Export tab shows customers, RFQs, visits, backup and data cards`
- `CSV starts with a BOM and has the exact header` (BOM `\uFEFF` then `"Customer","Contact person","Phone","City","Group","Segment","Vehicle segment","Plants","Last order","Follow-up","Status","Last contacted","Notes count"`)
- `CSV respects the current filter` / `"All customers" has every row`
- `no notes unless ticked` / `no amounts unless ticked`
- `both boxes are unticked after a refresh` / `scope survives a refresh`
- `CSV guards formulas`
- `CSV has no emails or GST`
- `Copy puts tab-separated rows on the clipboard` / `Copy falls back when the clipboard is blocked`
- `backup has notes, RFQs, visits and targets but no money and no invoices`
- `Weekly sales review button opens the report` *(needs A8)*
- `data card shows invoice data-through date and Clear invoice data works` *(needs A7)*
- `Clear imported money data removes amounts after confirm`
- `RFQs CSV has the expected header and respects the RFQ filter`
- `automatic Sheet export is disabled and marked coming next`
- `no sideways scroll on the Export tab at 375px`

**A3 · 40-dashboard** + dashboard-unit (compute on a hand-made set: attention order, upcoming groups, buckets, state order, contact counts, empty log). Expected numbers are **computed from `t.data`**, never hard-coded.
- `customer tiles match the data`
- `every customer tile opens the matching filter` (loop over 9 tiles: the row count equals the tile)
- `Overdue tile is red and says "Needs a call now"`
- `Attention lists overdue oldest first, then due today`
- `Done from Attention opens the Done dialog` / `saving removes it from Attention and lowers Overdue`
- `Notes from Attention opens the drawer`
- `follow-up day group opens the matching filter`
- `status legend, last-order bars and state bars open the matching filter` (the row count equals the number)
- `"Count days from" choice changes the buckets and survives a refresh`
- `activity empty state shows with no call log` / `recent activity lists a new note`
- `contact tiles open the matching filter`
- `money card shows the empty state before import`
- *(needs A5)* `money tiles show totals after import`, `aging legend opens customers with that bucket`, `top 5 overdue are clickable and sorted`, `Hide amounts masks every amount and survives a refresh`
- *(needs A4)* `RFQ funnel counts per stage open the RFQ table`, `Quote overdue tile is red and opens the matching RFQs`, `Released parts counts Finalised and later and opens them`, `released parts note asks the user to confirm`
- *(needs A5)* `next 7 days visits list opens the Schedule day`, `late orders tile is red and opens late orders`
- `segment bars open the segment filter` / `group rows open the group filter` / `"Not set" opens customers with no segment` (set 2 segments and 1 group of 2 customers in the test first)
- `segments-and-groups empty state shows when none are set`
- *(needs A7)* `revenue card shows the empty state before import and says Taxable is used`, `revenue tiles, trend, top 10 and concentration render after import`, `month column opens customers invoiced that month`
- *(needs A8)* `Weekly sales review button opens the report`
- `dashboard survives a refresh`
- `no sideways scroll on the Dashboard at 375px`
- `print view shows the logo, hides tabs and note text`
- `every dashboard number is a button`

**A4 · 50-rfqs** + rfqs-unit (`rfqStats`: byStage, released, valueQuoted/valueWon, quoteOverdue, quotedToPoPct, avgDaysToQuote, stuck)
- `new RFQ appears in Received with history`
- `customer must be picked from the list`
- `▶ moves a card to the next stage and logs history with today's date`
- `◀ moves it back`
- `focus follows the moved card`
- `stage select in the table moves the RFQ`
- `quote overdue shows red text "Quote overdue by N days"` / `quote due today is orange`
- `action overdue shows red text`
- `board and table views survive a refresh` / `RFQs and history survive a refresh`
- `stage and flag filters survive a refresh`
- `duplicate RFQ no is refused`
- `mark lost hides it unless Show lost`
- `RFQ import matches headers and upserts by RFQ no` (a CSV with 3 rows, one existing: 1 update + history "Imported")
- `RFQ import shows a clear error for missing columns`
- `unmatched customer is kept as text and flagged`
- `board becomes stacked sections at 375px without page scroll`
- `RFQ text is shown as text, not HTML`

**A5 · 60-schedule** + schedule-unit
- `month grid starts on Monday and marks today`
- `add a visit and it shows on its day and in the agenda`
- `visits survive a refresh`
- `past visit not done is red and says "Not done"`
- `marking done can add a call-log entry and updates Last contacted`
- `arrow keys move between days`
- `agenda list replaces the grid at 375px` / `no sideways scroll`
- `sub-view choice survives a refresh`
- `orders import replaces orders and shows "Data as of"`
- `late order is red and says "Late by N days"`
- `done words mark orders done`
- `Late chip count equals rows`
- `Clear orders empties the list after confirm`
- `orders import error lists missing columns`

**A5 · 70-money** + money-unit (`moneyStats`: totals include unmatched rows, per-customer uses matched rows, same-name rows summed, overduePct)
- `money import recognises an AGING file with the exact A–N headers`
- `LIVE_POSITION with an "ERP 15-Oct" header is recognised and Estimated Live becomes outstanding`
- `"As On" (15-Oct-26) sets Data as of`
- `amounts like "1,234,567", "-2,500" and "0" parse`
- `an ERP Group row (Sangkaj) joins both group customers and counts once in totals` (fixture sets `erpGroup` on 2 customers via `window.CRM_DATA`)
- `buckets that do not add up to ERP Overdue show a warning but do not block`
- `>90 includes Pre April and the legend says "of which before April"`
- `related parties stay in money totals`
- `wrong file shows the missing-columns error and blocks import`
- `bad number blocks import with the row number`
- `total rows are skipped`
- `unmatched names are listed and a manual match is remembered next time`
- `amounts survive a refresh`
- `"Data as of" shows the chosen date` / `stale data shows the orange warning`
- `LIVE_POSITION import adds outstanding without removing aging`
- `Clear imported money data removes it`
- `amounts never appear in the customers.json export or the backup`

**A7 · 75-revenue** + revenue-unit (`fyOf`; `revenueStats`: FYTD/MTD with both "measure to" choices, 12 months Apr–Mar, top10 order, top1/top5 share, concentration flag, bySegment/byGroup shares add up to 100%, prior FY only with prior rows, pace %, behind flag, customer basis beats segment basis)

The fixture is built in the test: about 12 invoice rows with the exact INVOICE_REGISTER headers, made-up amounts, a made-up GSTIN `27ABCDE1234F1Z5`, Taxable different from Invoice Amount, one duplicate, one unmatched name, one "Total" row, and one prior-FY row in a second fixture.
- `INVOICE_REGISTER import recognises the exact headers`
- `revenue uses Taxable, not Invoice Amount`
- `dates like 01-Apr-26 and numbers with commas parse`
- `GSTIN and tax columns are never stored` (no `27ABCDE1234F1Z5` and no `CGST` in any localStorage value)
- `duplicate invoice rows are ignored and reported`
- `"Data through" shows the last invoice date`
- `FY to date and month to date match the fixture` (both "measure to" choices)
- `monthly trend runs April to March` / `month column opens customers invoiced that month`
- `top 10 is sorted and each bar opens that customer`
- `concentration risk is red with text above the threshold` / `threshold change survives a refresh`
- `share by segment and by ERP group add up to 100% and open filters`
- `prior-year comparison appears only with prior-year rows`
- `targets per customer and per segment survive a refresh`
- `behind pace is red and says "Behind pace"` / `on pace says "On pace"`
- `Update Last order changes only customers with a newer invoice`
- `Fill blank groups from ERP Group only fills blanks`
- `empty state before import says Taxable is used`
- `Clear invoice data removes it after confirm`
- `revenue never appears in customers.json or the backup`
- `Hide amounts masks revenue`
- `related parties are excluded by default and the note says "Excludes 2 related parties"` (the fixture has invoices for Markal and KCTR)
- `"Include related parties" adds them back to FYTD, top 10, concentration, segment share and targets, and survives a refresh`
- `no sideways scroll on the revenue card and targets dialog at 375px`

**A8 · 80-report** + report-unit (`compute`: range filtering, stage moves in range only, contact counts without double counting, at-risk order, actions = overdue oldest first then due soonest, caps and "+N more")
- `report opens from the Dashboard and the Export tab`
- `default range is the last 7 days in India time`
- `report shows the logo, title and date range`
- `stage movements list only moves inside the range`
- `calls and visits this week are counted with customer names`
- `note text is hidden unless ticked, and the box is unticked when reopened`
- `at-risk list matches status At risk`
- `top 5 actions are overdue follow-ups, oldest first`
- `money, late orders and revenue sections appear only when imported`
- `overdue words are red and in text`
- `print shows only the report` (`emulateMedia({media:'print'})` with `body.print-report`: `#app` hidden, `#reportPage` visible)
- `report fits one A4 page` (at a 794px viewport the `#reportPage` height ≤ 1123px with a busy fixture: 15 overdue, 12 moves, 20 contacts)
- `Hide amounts masks report amounts`
- `revenue section follows the related-party switch and says when they are excluded`
- `no sideways scroll at 375px`

### 6.3 Review checklist (stage A, lead then user, on GitHub Pages, desktop + phone)
1. Tabs work and are remembered.
2. Every dashboard number opens the right list.
3. Done, notes, edit and rename work and survive a refresh.
4. Import real AGING and LIVE_POSITION CSVs: totals match the sheet's own totals to the rupee. Unmatched names make sense. The as-of date is right.
5. RFQ board moves are logged. Released parts make sense (confirm the assumption).
6. Visits calendar and agenda work. An orders CSV (if available) shows late orders correctly.
7. CSV opens in Google Sheets; copy and paste lines up.
8. Print preview of the Dashboard: no note text, and amounts hidden when the toggle is on.
9. Logo badge and favicon look right.
10. `git status` shows no CSV or backup files.
11. Set group, segment and plants on a few customers (e.g. the two Sangkaj customers into one group); check the filters and dashboard breakdowns.
12. Import the real INVOICE_REGISTER CSV: FYTD Taxable matches the sheet's own sum of Taxable for the same dates; "Data through 12 Jul 2026" shows; type a few targets.
13. Print the Weekly sales review to PDF: one A4 page, logo, the right dates, no note text unless ticked.

---

## 7. Build breakdown (Sonnet agents)

Ownership is exclusive while a task runs. Each task uses its own branch `phase2/<task>` and pushes it. It reports the commit and file links plus the live-view link (CLAUDE.md "Links at every step"). The lead merges.

### Stage A

| Task | Owns | Starts after | Parallel with |
|---|---|---|---|
| **A1 Shell + store + split** | `customers.json` (add `relatedParty: true` for the 2 related parties; `erpGroup` values once the lead supplies them; no other data changes), `index.html`, `css/base.css`, `js/store.js`, `js/csv.js`, `js/ui.js`, `js/importer.js`, `js/app.js`, `js/boot.js`, the first version of `js/customers.js` + `css/customers.css` (Phase 1 features ported), stubs of every other module file, `assets/favicon-64.png`, `.gitignore`, the runner + A1 tests | design approved | none |
| **A2 Customers features** (P2-A/B/C/K + money and revenue lines) | `js/customers.js`, `css/customers.css`, `tests/checks/20-customers.js` | A1 merged | A3–A8 |
| **A3 Dashboard** (P2-F + released parts + segment/group breakdowns + the revenue card layout) | `js/dashboard.js`, `css/dashboard.css`, `tests/checks/40-dashboard.js`, `tests/unit/dashboard-unit.js` | A1 merged | A2, A4–A8 |
| **A4 RFQs** (P2-H/J) | `js/rfqs.js`, `css/rfqs.css`, `tests/checks/50-rfqs.js`, `tests/unit/rfqs-unit.js` | A1 merged | A2, A3, A5–A8 |
| **A5 Schedule + Money import** (P2-I, P2-G) | `js/schedule.js`, `css/schedule.css`, `js/money.js`, `css/money.css`, `tests/checks/60-schedule.js`, `tests/checks/70-money.js`, `tests/unit/money-unit.js`, `tests/unit/schedule-unit.js` | A1 merged (+ the lead's exact AGING/LIVE_POSITION headers when available) | A2–A4, A6–A8 |
| **A6 Export + integration** (P2-E) | `js/export.js`, `css/export.css`, `tests/checks/30-export.js`, `tests/unit/export-unit.js`; after all merges: `README.md` + the `--strict` integration run | A1 merged; integration after A2–A5, A7, A8 | A2–A5, A7, A8 |
| **A7 Revenue + targets** (P2-L) | `js/revenue.js`, `css/revenue.css`, `tests/checks/75-revenue.js`, `tests/unit/revenue-unit.js` | A1 merged | A2–A6, A8 |
| **A8 Weekly sales review** (P2-M) | `js/report.js`, `css/report.css`, `tests/checks/80-report.js`, `tests/unit/report-unit.js` | A1 merged | A2–A7 |

How the revenue card is split: **A7 builds the whole revenue card DOM** as `CrmRevenue.renderCard(el)`, plus the targets dialog and the import. A3 only puts a slot `<section id="dashRevenue">` in the grid and calls `CrmRevenue.renderCard(slot)` when the module exists (empty state otherwise). Add `renderCard(el)` to the §4.5 `CrmRevenue` contract; A1 includes it in the stub. This way the large revenue UI is owned by one agent.

P2-K is split by file: data, validation, seed and export in `store.js` (**A1**); the Edit dialog sections, badges, filters and search in `customers.js` (**A2**); the breakdown cards in `dashboard.js` (**A3**); the CSV columns in `export.js` (**A6**).

Order: **A1 (about 10–12 h) → A2 ∥ A3 ∥ A4 ∥ A5 ∥ A6 ∥ A7 ∥ A8 (about 20–24 h) → merge in the order A2, A5, A4, A7, A8, A3, A6, running the full suite after each merge (about 4 h) → A6 integration (`--strict`, zero SKIP) + README (about 4 h) → the user reviews on Pages → GO for stage B.** Total is about 48 h.

**A1 owns the split.**
- Step 1: move the inline `<style>` into `css/base.css` (+ the Customers parts into `css/customers.css`) and the inline `<script>` into `js/app.js` / `js/customers.js`, with **no behaviour change**. The 27 old checks must pass at this point.
- Step 2: build the Store, the contracts (§4) and the tabs. Each stub registers its panel with a "Coming in this build" placeholder.
- If anyone needs a contract change, they report it to the lead. Only A1 (in a small follow-up commit) changes `store.js`, `app.js`, `csv.js`, `ui.js`, `importer.js`, `base.css` or `index.html`; the others rebase.

What each task reports: test output (PASS/SKIP counts), the API as built (or "matches §4"), screenshots at 1280px and 375px (and print for A3) saved outside the repo with their paths listed, and the branch, commit and live links.

**A1 inputs and acceptance**
- **Inputs:** §1–§4, §5.1, §5.2 (Phase 1 parts + extra filter), §5.8, §6.1, and the A1 checks.
- **Acceptance:** A1 checks pass; no CSP violations; the favicon looks right; Phase 1 behaviour is unchanged.

**A2–A8 inputs and acceptance**
- **Inputs:** their §5 section, §4 contracts, and their §6.2 checks.
- **Acceptance:** their checks pass on their branch (cross-module ones may SKIP) and every earlier check still passes. After merge everything passes with `--strict`.

### Stage B (after GO)

| Task | Owns | Notes |
|---|---|---|
| **B1 Backend** | `supabase/migrations/*.sql`, `supabase/verify_rls.sql`, `scripts/make-seed.js` | §8.1–8.3; the lead creates the project (§8.2) |
| **B2 Data layer + login** | `js/store.js` (SupabaseBackend, queue, cache, auth), `config.js`, `js/auth.js` (new), `css/auth.css`, the CSP update in `index.html`, `tests/checks/80-auth-queue.js` | §8.4; fake auth + offline tests, no network |
| **B3 Deploy + live check** | `config.js` (URL + key) | §8.5 |

### CLAUDE.md wording the lead should update (this agent did not edit it)
- Rule 1: "Customers are seeded from `customers.json`. Edits, notes, RFQs, visits, orders and imported amounts live in this browser (stage A) or in the private database (stage B). **Amounts and notes are never committed**; `*.csv` and backups are gitignored. Imports are CSVs downloaded from the sheet; the page never writes to the sheet."
- Rule 2: "... included in an export: customer fields in customers.json; notes, RFQs, visits and orders in the backup. Amounts are re-imported from the sheet. The 'Include notes' and 'Include amounts' boxes are deliberately not remembered."
- Rule 3: "`tests/smoke.js` runs `tests/unit/*` and `tests/checks/*`; each task adds its own module; use `--strict` before pushing to main."
- Rule 8: "Only the tab bar and the desktop RFQ board may scroll sideways inside themselves."
- New gotchas:
  - "`display` on a `<dialog>` shows it when closed; style `dialog[open]` only."
  - "Wait for `body[data-ready]`, not `#rows tr`."
  - "Serve `.js` as `text/javascript` in the test server."
  - "Imported dates are day-first (DD/MM)."

---

## 8. Stage B design (kept for after GO)

### 8.1 SQL migration `supabase/migrations/20261019000100_phase2.sql` (customers, call log, security; copy as is)

```sql
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.ist_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create table public.allowed_users (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%._%'),
  note text not null default '', created_at timestamptz not null default now());

create table public.customers (
  id           text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 64),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  contact      text not null default '' check (char_length(contact) <= 80),
  contact_from text not null default '' check (contact_from in ('', 'email')),
  city         text not null default '' check (char_length(city) <= 60),
  state        text not null default '' check (char_length(state) <= 60),
  phone        text not null default '' check (char_length(phone) <= 30),
  last_order   date, follow_up date,
  status       text not null default 'Active' check (status in ('Active', 'Follow up', 'At risk')),
  disputed     boolean not null default false,
  source       text not null default 'manual' check (source in ('seed', 'manual')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default '');
create unique index customers_name_lower_uniq on public.customers (lower(name));
create index customers_follow_up_idx on public.customers (follow_up) where follow_up is not null;

create table public.call_log (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers (id) on delete cascade,
  at date not null default private.ist_today(),
  type text not null check (type in ('Call', 'Visit', 'Email', 'Telegram', 'Note')),
  note text not null default '' check (char_length(note) <= 500),
  done_follow_up date, next_follow_up date,
  created_at timestamptz not null default now(), created_by text not null default '');
create index call_log_customer_at_idx on public.call_log (customer_id, at desc, created_at desc);
create index call_log_at_idx on public.call_log (at desc);

create or replace function private.customers_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_at := now(); new.updated_at := new.created_at;
    new.updated_by := coalesce(auth.jwt() ->> 'email', 'seed');
  else
    if new.id <> old.id then raise exception 'Customer id cannot change' using errcode = '22023'; end if;
    new.created_at := old.created_at; new.source := old.source;
    new.updated_at := clock_timestamp(); new.updated_by := coalesce(auth.jwt() ->> 'email', old.updated_by);
  end if;
  return new;
end $$;
create trigger customers_before_write before insert or update on public.customers
  for each row execute function private.customers_before_write();

create or replace function private.call_log_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.at > private.ist_today() + 1 then raise exception 'Note date cannot be in the future' using errcode = '22023'; end if;
  new.created_at := now(); new.created_by := coalesce(auth.jwt() ->> 'email', 'seed');
  return new;
end $$;
create trigger call_log_before_insert before insert on public.call_log
  for each row execute function private.call_log_before_insert();

create or replace function private.is_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.allowed_users a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')))
     and exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;
revoke all on function private.is_allowed() from public, anon;
grant execute on function private.is_allowed() to authenticated;
revoke all on function private.ist_today() from public, anon;
grant execute on function private.ist_today() to authenticated;

create or replace function public.am_i_allowed() returns boolean
language sql stable security invoker set search_path = '' as $$ select private.is_allowed() $$;

create or replace function public.mark_done(p_log_id uuid, p_customer_id text, p_at date, p_type text, p_note text, p_next date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_today date := private.ist_today(); v_prev date; v_cust public.customers; v_log public.call_log;
begin
  if p_next is not null and p_next < v_today then
    raise exception 'Next follow-up cannot be in the past' using errcode = '22023'; end if;
  select follow_up into v_prev from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  insert into public.call_log (id, customer_id, at, type, note, done_follow_up, next_follow_up)
  values (p_log_id, p_customer_id, coalesce(p_at, v_today), p_type, coalesce(p_note, ''), v_prev, p_next)
  on conflict (id) do nothing returning * into v_log;
  if v_log.id is not null then
    update public.customers set follow_up = p_next where id = p_customer_id returning * into v_cust;
  else
    select * into v_log from public.call_log where id = p_log_id;
    select * into v_cust from public.customers where id = p_customer_id;
  end if;
  return jsonb_build_object('customer', to_jsonb(v_cust), 'log', to_jsonb(v_log));
end $$;
revoke all on function public.am_i_allowed() from public, anon;
revoke all on function public.mark_done(uuid, text, date, text, text, date) from public, anon;
grant execute on function public.am_i_allowed() to authenticated;
grant execute on function public.mark_done(uuid, text, date, text, text, date) to authenticated;

revoke all on public.customers, public.call_log, public.allowed_users from anon, authenticated;
grant select, delete on public.customers to authenticated;
grant insert (id, name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed) on public.customers to authenticated;
grant update (name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed) on public.customers to authenticated;
grant select on public.call_log to authenticated;
grant insert (id, customer_id, at, type, note, done_follow_up, next_follow_up) on public.call_log to authenticated;

alter table public.allowed_users enable row level security;     -- no policies on purpose
alter table public.customers enable row level security;
alter table public.call_log enable row level security;
create policy customers_select on public.customers for select to authenticated using ((select private.is_allowed()));
create policy customers_insert on public.customers for insert to authenticated with check ((select private.is_allowed()));
create policy customers_update on public.customers for update to authenticated
  using ((select private.is_allowed())) with check ((select private.is_allowed()));
create policy customers_delete on public.customers for delete to authenticated
  using ((select private.is_allowed()) and source = 'manual');
create policy call_log_select on public.call_log for select to authenticated using ((select private.is_allowed()));
create policy call_log_insert on public.call_log for insert to authenticated with check ((select private.is_allowed()));

-- The one view for the future Telegram reminder (11:00 IST = 05:30 UTC), service_role only:
create view public.v_followups_due with (security_invoker = true) as
select c.id, c.name, c.contact, c.phone, c.city, c.status, c.follow_up,
       private.ist_today() - c.follow_up as days_overdue,
       case when c.follow_up < private.ist_today() then 'overdue' else 'today' end as bucket,
       (select max(l.at) from public.call_log l where l.customer_id = c.id) as last_contacted
from public.customers c
where c.follow_up is not null and c.follow_up <= private.ist_today()
order by c.follow_up, c.name;
revoke all on public.v_followups_due from public, anon, authenticated;
grant select on public.v_followups_due to service_role;
```

**Second migration `20261019000200_phase2_more.sql`** (B1 writes it from these column lists; the same pattern applies to each table: `revoke all ... from anon, authenticated`; grant select/insert/update/delete to authenticated; RLS on; one `for all to authenticated using ((select private.is_allowed())) with check ((select private.is_allowed()))` policy; an `updated_at` trigger like the customers one):
- `rfqs` (columns as in §2.5; `stage` check in STAGES; unique index on `lower(rfq_no)` where `rfq_no <> ''`; `customer_id` references customers on delete restrict).
- `rfq_history` (insert and select only, no update or delete; FK to rfqs on delete cascade).
- `visits` (§2.6; FK customers on delete restrict).
- `orders` (§2.6; plus `import_id uuid`) and `order_imports(id, file_name, file_date, as_of, imported_at, rows)`.
- `money_imports(id, kind check in ('aging','live'), file_name, file_date, as_of, imported_at)` and `money_rows(import_id, source_name, customer_id null, b1_30, b31_60, b61_90, b90, overdue, outstanding)`, numeric(14,2). Only the latest import per kind is shown; older ones keep the history that the deferred "payment trend" idea needs.
- `aliases(source_name text pk, customer_id text null)`.
- `customers`: add `grp text not null default ''`, `segment text not null default '' check (segment in ('', 'OEM', 'Tier-1', 'Tier-2', 'Trader', 'Export'))`, `vehicle_segment text not null default '' check (... the 6 values or '')`, `plants jsonb not null default '[]'` (a `plants` table later, for the parts master), `related_party boolean not null default false`, `erp_group text not null default ''`. Add them to the column grants.
- `invoice_imports(id, file_name, file_date, as_of, data_through, imported_at)` and `invoices(import_id, invoice_no, invoice_date, customer_id null, source_name, on_invoice, erp_group, taxable numeric(14,2))`. **No GSTIN or tax columns**, even in the private DB, unless a later wave needs them.
- `targets(fy text, kind text check (kind in ('customer', 'segment')), key text, amount numeric(14,2), primary key (fy, kind, key))` and `settings(key text pk, value jsonb)` (concentration %).

Seed: `node scripts/make-seed.js customers.json > supabase/.generated/seed.sql` (gitignored). It is one transaction of `INSERT ... ON CONFLICT (id) DO NOTHING`, `source='seed'`, and uses `require("../js/store.js").slug`. Seed from the user's latest stage A export, and import the stage A backup with a small B1 script.

### 8.2 Dashboard settings (the lead does these)
1. New project: free plan, **ap-south-1**, DB password kept in a password manager.
2. Auth -> Email: on. **Sign-ups OFF. Confirm email ON.** Minimum password length 12, with lower, upper and digits. Turn off phone, anonymous and all OAuth providers.
3. URL configuration: Site URL `https://erpvarsha-star.github.io/vfpl-crm/` (+ `http://localhost:8080/**`).
4. Users -> Add user `<ALLOWED_EMAIL>` with **Auto Confirm**, then `insert into public.allowed_users (email, note) values (lower('<ALLOWED_EMAIL>'), 'owner');` (user first, then the allowlist).
5. Keep the default rate limits. Turn off `pg_graphql`. Expose the `public` schema only. Max rows 1000 (the store pages with `range()`).
6. Key: publishable `sb_publishable_...`, or the legacy anon JWT. **Never** service_role or `sb_secret_` in `config.js`; a smoke guard checks this.
7. Emergency lock: `revoke all on public.customers, public.call_log from authenticated;` (+ the other tables). Never disable RLS.

| Caller | Can | Cannot |
|---|---|---|
| anon | auth endpoints (sign in, rate limited) | sign up; any table, view or RPC (401/42501) |
| signed in, not allowlisted | sign in, `am_i_allowed()` = false | any row (0 rows / 42501) |
| allowed + confirmed | everything the UI does | change ids, `source` or timestamps; delete seed customers; edit or delete log or history rows; read `allowed_users` |
| service_role (server only) | everything (bypasses RLS) | never in the browser or git |

### 8.3 `verify_rls.sql` (B1)
- `DO` blocks under `set local role anon` / `authenticated` with `set_config('request.jwt.claims', …)`.
- Anon is denied on every table, view and RPC.
- A stranger sees 0 rows and is refused on insert, `allowed_users` and `mark_done`.
- The allowed user (claims from `auth.users where email = '<ALLOWED_EMAIL>'`) can read, insert, update, log, `mark_done` and delete a `zz-rls-probe` row, but cannot delete a seed row, change an id, or update a log or history row.
- Everything is rolled back; the script ends with `select 'ALL RLS CHECKS PASSED'`.

### 8.4 Client (B2)
- `@supabase/supabase-js@2.49.4` UMD from jsDelivr, loaded only when `config.js` is filled, with an SRI sha384 (`curl -sL URL | openssl dgst -sha384 -binary | openssl base64 -A`). Plan B: vendor the file.
- `createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "varsha-crm-auth" } })`.
- CSP: `script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://*.supabase.co wss://*.supabase.co`.
- SupabaseBackend implements the same backend calls (`fetchAll` paged by 1000; `upsert ignoreDuplicates` for inserts; conditional patch `.lte("updated_at", base)`; `rpc("mark_done")`; `rpc("am_i_allowed")`).
- Errors are normalized to `{kind: "network"|"auth"|"denied"|"invalid"}`.
- **Write queue** `varsha-crm-queue-v1`: saved before sending, flushed serially.
  - Network errors keep the op and show the banner "N changes not saved to the database yet" with Retry. Retries happen on `online`, on visibility, and every 30 s.
  - Auth errors show sign-in and keep the queue.
  - Invalid or denied errors drop the op, revert, and show an error.
- **LWW**: the patch is conditional on the `updated_at` seen when it was edited.
  - On conflict, the client's edit time is compared with the server `updated_at`: the later one wins. A notice says when the server value was kept.
  - Later ops for the same row get their base rewritten after our own success.
- Cache `varsha-crm-cache-v1` (per email, cleared on sign-out).
- **Auth UI** (`js/auth.js`): sign in, denied, set new password after recovery. Forgot password only if `allowPasswordReset`. **No sign-up screen.** Logo at 72px. Sign-out warns about pending changes.
- **Tests:** LocalBackend with `window.CRM_TEST = {fakeAuth, deniedUser}` and `__crmFake.setOffline()`. No network.

### 8.5 Live checklist (B3)
1. `curl -s "$URL/rest/v1/customers?select=id&limit=1" -H "apikey: $KEY"` returns 401/42501, never rows. Repeat for every table, the view and the RPCs.
2. `curl -s -X POST "$URL/auth/v1/signup" -H "apikey: $KEY" -H "content-type: application/json" -d '{"email":"probe@example.com","password":"Probe-12345678"}'` returns 422 `signup_disabled`.
3. `verify_rls.sql` passes; Advisors show no WARN or ERROR (one INFO on `allowed_users` is expected).
4. Two devices see the same edits. The offline queue works. Sign-out clears the cache.
5. `git grep -nE "sb_secret_|service_role"` finds only the guard and the docs.
6. `v_followups_due` matches the dashboard's Overdue + Due today.

### 8.6 Later, design only
- **Automatic Google Sheet export.** Recommended: (a) a Google Apps Script web app in a **new** sheet "Varsha CRM export", POSTed by a Supabase scheduled Edge Function, with the token stored as a Supabase secret. Rejected: (b) Zapier (webhooks are paid, and a third party sees the data) and (c) a service account (a heavy key to manage). It never touches "VFPL Collections Engine". No notes or amounts unless the user turns them on.
- **Money straight from the sheet:** a read-only server job (Apps Script or service account) pulls AGING and LIVE_POSITION into `money_*` tables daily. It never writes to the sheet.
- **Payment trend** charts from the kept `money_imports` history.
- **Telegram 11:00 IST:** pg_cron `30 5 * * *` UTC calls an Edge Function that reads `v_followups_due` (+ late orders + overdue quotes) and sends names, days and contact person, without phones.

---

## 9. Risks and Plan B

| # | Risk | Plan B |
|---|---|---|
| 1 | The real AGING/LIVE_POSITION headers differ from the placeholders. | Header matching shows the exact missing and found columns; A5 adds the lead's headers as the first synonyms; the spec is one constant. |
| 2 | Wrong money totals (bad parsing, total rows counted twice). | Strict parsing blocks the import on any bad cell; "Total" rows are skipped and listed; the review step compares with the sheet's own totals to the rupee. |
| 3 | Name matching misses or mis-matches customers. | Exact, then `nameKey`, then remembered manual matches; unmatched names are listed every time; totals include them, so nothing silently disappears. |
| 4 | Amounts leak into git or prints. | Kept in their own key, excluded from `customers.json` and the backup, `*.csv` gitignored, the Hide amounts toggle also covers print, tests use fake amounts; `git status` is part of the review checklist. |
| 5 | Stage A data is per-browser, so phone and PC differ. | Stated on the page; backup to move data; stage B fixes it. |
| 6 | Six parallel agents collide. | Whole-file ownership, frozen §4 contracts, stubs from A1, a fixed merge order with a full suite after each merge, `--strict` at the end. |
| 7 | A contract gap is found mid-build. | Report it to the lead; A1 makes a small follow-up commit; others rebase. Nobody edits files they do not own. |
| 8 | RFQ, order and visit fields are assumptions. | All in one spec/constant per module; the review confirms them; changes are local to that module. |
| 9 | The desktop RFQ board is cramped (7 columns). | Compact cards; 4-column wrap from 860–1100px; Table view as the alternative. |
| 10 | localStorage limit (about 5 MB). | Imports replace old data; `#storageWarn` on a failed write; stage B moves data to the DB. |
| 11 | The clipboard is blocked. | Textarea fallback. |
| 12 | The CSP blocks something on Pages. | Check the console at review; widen only that directive; never `'unsafe-inline'` scripts. |
| 13 | GitHub Pages caches old files. | `?v=` on every asset, bumped per release. |
| B | Supabase pauses after 7 idle days; RLS mistakes; CDN or key problems; reset email limits; no free backups. | Restore button + cache; `verify_rls.sql` + curl + Advisors + emergency revoke; vendored library or legacy anon key; the lead resets passwords; weekly backup download. |

---

## 10. Decisions, assumptions and open questions

**Decided by the user (built this way):**
- D1. Money: outstanding = LIVE_POSITION "Estimated Live"; overdue = AGING "ERP Overdue"; buckets = AGING 1-30 / 31-60 / 61-90 / >90. Exact headers are in §5.3. When a name has no exact match, AGING and LIVE_POSITION rows join on the master's ERP Group (Sangkaj).
- D2. RFQs get a "Lost" marker (with a reason) outside the 7 stages.
- D3. Marking a visit or call done also adds a call-log entry (ticked by default, can be unticked).
- D4. Phone numbers stay in the public `customers.json` for the review (stage B plan: blank them after seeding the private DB).
- D5. RFQ and order imports use the assumed columns now; the mapping is fixed once the sheets are seen.
- D6. Plain "Note" entries do not count as Last contacted (`CONTACT_TYPES` = Call, Visit, Email, Telegram).
- D7. Notes and RFQ history are append-only (correct with a new entry).
- D8. Tabs open on the last used tab, and on the Dashboard for a first visit.
- D9. Related parties: `relatedParty = true` for VARSHA FORGINGS LTD MARKAL and KCTR VARSHA AUTOMOTIVE PVT. LTD. They are excluded by default from revenue, concentration, top-customer, segment-share and target numbers (switch "Include related parties", remembered, plus the note "Excludes 2 related parties"). They still show on the Customers tab with a tag, and in follow-ups.
- D10. First-review scope = this doc's stage A (the "Owner's Path"). The extra items in `docs/ExpertReview_19OCT2026_0510.md` are later waves (§11).

**Assumptions for the user to confirm at the HTML review** (each is a one-place change):
- A1. **Released parts** = RFQs at Finalised, PO, Sample or PPAP (the note is on the dashboard).
- A2. RFQ fields as in §2.5 and order fields as in §2.6 (headers are placeholders).
- A3. "Cr" means credit (negative); dates in imports are day-first.
- A4. The calendar week starts on Monday; "Meeting" logs as "Visit" in the call log.
- A5. Target pace is linear by days in the India FY; "Behind pace" means % of target < % of the FY elapsed.
- A6. Revenue "measure to" defaults to the last invoice date, because the register stops at 12 Jul 2026.

**Open questions (at most 5; none blocks the build; each has a recommended default that builders use)**
1. **Which "overdue" is the headline?** AGING has both "ERP Overdue" and "Model Overdue".
   *Recommended:* ERP Overdue (built this way). The importer warns if the buckets do not add up to it.
2. **"Pre April" column.** Should it be inside the ">90 days" bucket?
   *Recommended:* yes, shown as ">90 days (of which before April ₹X)".
3. **Targets basis.** Per customer, per segment, or both, and which counts if both are typed?
   *Recommended:* allow both; the total uses customer targets when any exist for the FY, otherwise segment targets.
4. **Concentration limit.** What default for the "top customer share" risk flag?
   *Recommended:* 25% (the user can change it on the dashboard).
5. **ERP Group per customer.** The ERP-Group join needs the CUSTOMER_MASTER "ERP Group" value for the 42 customers.
   *Recommended:* the lead has a Sonnet agent read that one column (names only, no amounts) and gives it to A1 for `customers.json`. Until then the join finds nothing and the Sangkaj rows show as unmatched (they still count in totals).

---

## 11. Later (not in the first review; the data shapes leave room)

One line each, with where it fits:
- **Multiple contacts with roles:** a `contacts` collection `{id, customer_id, name, role, plant_id, phone, email (private), decisionMaker}`. `contact`/`phone` stay as the display copy.
- **Account owner / "My customers":** `owner`, `backupOwner` text fields on customers (stage B: tied to login users).
- **Parts master:** a `parts` collection `{id, customer_id, plant_id, rfq_id, customerPartNo, drawingNo, drawingRev, materialGrade, …}`. Released parts later read from it.
- **RFQ upgrades:** probability weighting by stage, `expectedSop`, `outcome`/`winReason`/`lossReason`/`competitors`, quote turnaround from `rfq_history` (already recorded), `annualVolume`/`quotedPrice`/`toolingCost`.
- **Complaints / 8D and on-time delivery:** a `complaints` collection; OTIF from a `schedule` collection or the orders import.
- **Account health score and dormant list:** computed only, from last order, revenue trend, overdue, contact recency and complaints. Advisory; never changes the manual status.
- **Tasks and visit reports/minutes:** `log.attendees`, `log.purpose`, `log.actions[] {text, owner, due, doneOn}` on call-log rows.
- **Price and steel-variation calendar:** a `commercial` object per customer (RM index basis, revision frequency, next revision due, claim status). Amounts private.
- **Change history and required fields:** a full audit trail needs stage B (`change_log` table, who changed what). Required-field rules go in each module's `validate`.

**How the stage A shapes stay open for these:**
- Every row is a JSON object with a uuid or slug `id`, so new optional keys need no migration.
- New collections plug into `Store.col(name)`.
- localdb has `v` for upgrade steps (`Store` runs `migrate(fromV)` on load).
- Plants have ids, and log, RFQ and visit rows carry `customer_id`, so contacts, parts and minutes can link to them.

**Field-name alignment with `docs/ExpertReview_19OCT2026_0510.md`:**
- Same names: `relatedParty`, `plants[] {id, name, city, state}`, `segment`, `owner`/`backupOwner` (later), `contacts[]` (later).
- Different names: this build uses `group` (a parent group name, as the user asked) and a single `vehicleSegment`.
- Later moves:
  - a `groups[]` registry with `groupId = slug(group)`;
  - `vehicleSegments = [vehicleSegment]`;
  - adding "Other" to `SEGMENTS` (the review's list).
  These are additive, one-step migrations.
