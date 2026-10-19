# Varsha CRM - expert review (sales and marketing)

Date: 19 Oct 2026, 05:10 IST. Author: Head of Marketing & Sales review agent (Opus). Status: advisory, for the lead and the user.
Scope: what is MISSING for Varsha CRM to be the source of truth and to grow a hot-forging business supplying OEMs and Tier-1/Tier-2 auto and CV customers.
Read: `CLAUDE.md`, `index.html`, `customers.json`, `docs/Phase2Design_19OCT2026_0446.md`. Nothing else was changed.

Ground rules this review respects (already decided, not reopened): the customer fields; the manual status (Active / Follow up / At risk); money only through a browser-only CSV import from the Collections sheet, never in git; RFQ stages Received > Quoted > Negotiated > Finalised > PO > Sample > PPAP; schedule via CSV plus a visits calendar; released parts = finalised parts; notes never in git; Telegram later; HTML first, then Supabase after GO.

Facts from today's `customers.json` (counted, not estimated):

| Fact | Count |
|---|---|
| Customers | 42 |
| Status Active / Follow up / At risk | 15 / 1 / 26 |
| With any invoice on record (register stops 12 Jul 2026) | 17 |
| With no order on record | 25 (13 of them not disputed) |
| City filled | 0 |
| State filled (from GSTIN) | 18 |
| Contact person filled | 10, all guessed from email, no role |
| Follow-up date set | 0 |
| Marked disputed | 12, with no reason, amount or owner |
| Overseas accounts (Ziemer, Lindner, BHC Gummi-Metall, FRAP) | 4, none with an order on record |
| Names that look like one group or plant, or another billing entity | Sangkaj Auto Components + Sangkaj Industries; Akar Auto (Unit-2); Omkar Engineering Unit-II; Amtek Auto (Sanaswadi); Tork Motors "Billing 1"; Laxmi Agni "-V" |
| Names that look internal or related-party (to confirm) | VARSHA FORGINGS LTD MARKAL; KCTR VARSHA AUTOMOTIVE |

---

## 1. Verdict

1. **Good today:** fast and simple, works on a phone, honest about where its data comes from (guessed contacts in grey italics, the register cut-off date stated). It has the overdue follow-up rule, edits that survive a refresh, and a strict no-money and no-notes-in-git rule. Phase 2 adds a clean `Store` layer, stable ids and a call log, so the move to stage B is cheap.
2. **Gap 1, accounts:** the list holds billing names, not accounts. It has no owner, no group or plant, no segment (OEM, Tier-1, Tier-2, Trader, Export) and no A/B/C tier, so concentration, share of wallet and "my accounts" cannot be measured.
3. **Gap 2, growth pipeline:** the RFQ stages are agreed but nothing records value. There is no annual volume, price, tooling, probability, SOP date, competitor or win/loss reason, so the CRM cannot forecast new business or show why it is lost.
4. **Gap 3, people and visits:** each customer has one guessed contact with no role. Forging sales needs buyer, SQA/quality, NPD and accounts contacts, a decision-maker flag, and visit minutes with action items.
5. **Gap 4, voice of the customer:** nothing records complaints/PPM/8D, OTIF, PPAP or approvals, audits and vendor codes, or steel-price and annual price revisions. These are the main reasons an OEM gives a supplier more business or takes it away. **Gap 5, source of truth:** the browser prototype keeps data on each device, "last order" stopped on 12 Jul 2026 and no audit trail exists. Only stage B (shared database, login, history) can make it the single source of truth.

**Two notes for the lead about the current Phase 2 design** (it predates some of the user's decisions):
- §5.8 says "Money is out of scope for stage A", but the user has since decided on a browser-only Collections CSV import. The RFQs and Schedule tabs are also not in §5.2 yet. These need a design addendum.
- §3.1 checks that the `customers.json` export has an exact key list, and Phase 1's `clean()` drops unknown keys. Every new public field below must be added to that list, and every private field must go to the backup file only (§3).

**Honest limit of stage A:** the HTML prototype is a good place to review screens and workflows. It is **not** a source of truth.
- Two people on two devices see two different CRMs.
- Clearing the browser loses the data.
- CSV imports (collections, billing, schedule) exist only on the device that imported them.
- Nothing records who changed what.
- "Owner" is just text, because there is no login.

Only stage B delivers one shared copy, a named user on every change, an audit trail, role-based visibility of money, scheduled imports, reminders and backups.

---

## 2. Gap table (ordered by business impact)

Effort: **S** = under half a day for one build agent, **M** = 1-2 days, **L** = 3+ days. Stage: **A** = can be built in the HTML prototype; **A\*** = works in A only on the device that imported the CSV; **B** = needs the shared database and login.

| # | Pri | Gap | Why it matters in auto forging | Recommended feature | Fields to add (name: type) | Where in the UI | Effort | Stage |
|---|---|---|---|---|---|---|---|---|
| 1 | MUST | No account owner | OEM and Tier-1 accounts are won and kept through one named person who chases schedules, quotes and payments. With no owner, follow-ups drift and nobody answers for a lost account. | Owner and backup owner on every account; "My accounts" filter; KPIs split by owner | `owner`: string (from a settings list of users), `backupOwner`: string | Customers column + filter chip; Edit dialog; Dashboard "by owner" | S | A (text); B (tied to login) |
| 2 | MUST | "Last order" is stale and billing is absent | The register stops on 12 Jul 2026 and 25 of 42 accounts show no order, so the status, dormant and tier logic all run on old data. A sales head steers by monthly billing per customer. | Invoice register CSV import (browser-only, same pattern as Collections): monthly totals per customer recompute `last`, TTM billing and tier. Show "Billing data as of <date>" everywhere. | `billing.asOf`: date; `billing.byMonth`: {"YYYY-MM": number} (private); `last`: date (recomputed); `ttm`: number (computed, private) | Export/Import tab; Customers "Last order"; Dashboard | M | A\* |
| 3 | MUST | No single shared copy, no audit trail, no roles | A CRM that each person keeps separately is a diary, not a source of truth. IATF-minded customers and management need to know who changed a status, a date or a price, and when. | Stage B: shared Postgres, login, `change_log` on every write, roles (sales, accounts, quality, management) | `change_log`: {id: uuid, entity: text, entity_id: text, field: text, old: jsonb, new: jsonb, at: timestamptz, by: text} | Customer drawer "History"; Admin | L | B |
| 4 | MUST | RFQs have stages but no value | You cannot forecast new business, rank RFQs or plan press and die-shop load without annual volume, price and tooling | RFQ record with value, probability by stage, SOP date and tooling (§4) | See §4.2: `annualVolume`, `quotedPrice`, `targetPrice`, `annualValue`, `toolingCost`, `stage`, `stageDates`, `probability`, `expectedSop` | RFQs tab (list + funnel); Customer drawer "RFQs" | M | A |
| 5 | MUST | No account structure (group, plants, billing entities, related party) | OEMs buy from several plants, each with its own buyer, vendor code and schedule. Groups (for example the two Sangkaj names, to confirm) must roll up for concentration. Internal or related-party billing (Markal, KCTR Varsha, to confirm) distorts growth KPIs. | Account group with plants/units; several billing names; related-party flag kept out of growth KPIs | `groupId`: string; `plants[]`: {id, name, city, state, vendorCode (private)}; `billingNames[]`: string; `relatedParty`: boolean | Edit dialog "Account" section; Customers "Group by account" toggle | M | A |
| 6 | MUST | No segment, vehicle segment or tier | OEM, Tier-1 and Tier-2 buy differently (PPAP depth, price-down pressure, payment terms). CV, tractor and 2W cycles differ. Coverage effort should follow tier A/B/C. | Segment + vehicle segment + computed tier with a manual override | `segment`: enum; `vehicleSegments`: enum[]; `country`: ISO-2; `tier`: computed A/B/C/P; `tierOverride`: ""/A/B/C; `tierOverrideReason`: string | Customers columns and filters; Dashboard mix | S | A (tier A\*) |
| 7 | MUST | One guessed contact, no roles | Price is set by purchase, approval by SQA/quality, new parts by NPD/development, payment by accounts. Losing one contact must not lose the account. | Several contacts per account with a role, plant and decision-maker flag | `contacts[]`: see §3.3 | Customer drawer "People"; Notes dialog picks a contact | M | A (private: backup only) |
| 8 | MUST | No win/loss reason or competitor | Without reasons you repeat the same losses on price, lead time or capacity. Competitor names show where you stand in a commodity. | Required outcome and reason when an RFQ closes; competitor list | `outcome`: enum; `lossReason`: enum; `winReason`: enum; `competitors`: string[]; `incumbent`: string; `priceGapPct`: number (computed) | RFQ close dialog (required); Dashboard win/loss | S | A |
| 9 | MUST | No quote turnaround or stage-ageing alerts | Buyers judge forging suppliers on quote speed. A quote that waits two weeks for costing, or a sample stuck for months, quietly loses the business. | Turnaround days and age in stage, with alerts at thresholds (§4.4) | `stageDates`: {received, quoted, negotiated, finalised, po, sample, ppap}: date; `quoteDueDate`: date; computed `tatDays`, `daysInStage` | RFQs tab badges ("In stage 34 days"); Dashboard alert list | S | A |
| 10 | MUST | No parts master / released-parts view | A forging business is part-numbers, drawings, material grades, dies and annual volumes. "Released parts" is the real order book. | Parts master linked to customer and RFQ; "Released parts" view = stage Finalised or later (§4.3) | See §4.1: `partId`, `customerPartNo`, `drawingNo`, `drawingRev`, `materialGrade`, `forgingWeightKg`, `process`, `annualVolume`, `dieNo`, `partStatus`, `sopDate` | RFQs tab "Released parts" view; Customer drawer "Parts" | M | A (no prices in git) |
| 11 | SHOULD | Visits are just a log type, with no minutes or actions | A visit to a buyer, SQA or NPD team produces commitments (re-quote, sample date, 8D reply). Without owners and due dates they are lost. | Visit report on the Visit log type: attendees, purpose, minutes, action items with owner and due date. Plan visits on the Schedule calendar. | `log.attendees`: contactId[]; `log.purpose`: enum (Relationship, RFQ/Negotiation, Complaint, Audit, Payment, New part, Price revision); `log.actions[]`: {text, owner, due: date, doneOn: date} | Notes drawer (Visit form); Schedule tab visits calendar; Dashboard "Open actions" | M | A (private) |
| 12 | SHOULD | No complaints / PPM / 8D | One line-stopping complaint can cost a Tier-1 or OEM account. Customer PPM decides supplier ratings and new-business eligibility. | Complaint log per customer and part, 8D stage, ageing, PPM | `complaints[]`: {id, customerId, plantId, partId, date, source: enum (Incoming, Line, Field, Audit), defect: string, qtyRejected: int, severity: enum (Line stop, Major, Minor), d8Stage: enum (D0-D8), containmentOn: date, closedOn: date, owner, debitNote (private)} | Customer drawer "Quality"; Dashboard complaints tile | M | A |
| 13 | SHOULD | No OTIF / schedule adherence | OEM schedules (monthly with weekly or daily call-offs) are scored; poor adherence means premium freight, debit notes and a lower rating | Adherence from the schedule CSV: scheduled vs dispatched per part per month | `schedule[]`: {customerId, plantId, partNo, month: "YYYY-MM", schedQty: int, dispatchedQty: int, onTimeQty: int}; computed `otifPct` | Schedule tab; Customer drawer; Health score | M | A\* |
| 14 | SHOULD | No PPAP, approvals, audits or vendor codes | New parts earn money only after PPAP approval. Approved-supplier status, vendor codes per plant, customer audits and IATF 16949 certificate validity decide whether you may quote at all. | PPAP status on the part; approvals block on the account; VFPL certificate expiry in settings | Part `ppap`: {level: 1-5, submittedOn, approvedOn, pswStatus: enum (Pending, Approved, Interim, Rejected)}; account `approvals`: {approvedSince: date, lastAuditOn: date, auditScore: string, nextAuditOn: date, supplierRating: string, ratingMonth: "YYYY-MM"}; settings `iatfCertExpiry`: date | Customer drawer "Approvals"; RFQs PPAP column; Dashboard "Due in 60 days" | M | A |
| 15 | SHOULD | No price-revision / steel-variation tracking | Steel is the largest cost in a forging. Missed raw-material revisions and unplanned annual price-downs erode margin quietly. | Commercial block per account: RM index basis, revision frequency, next revision due, claim status, annual negotiation month | `commercial`: {rmIndexSource: string, rmBaseRatePerKg (private), rmBaseDate: date, revisionFreq: enum (Monthly, Quarterly, Half-yearly, Yearly, None), lastRevisionOn: date, nextRevisionDue: date (computed), claimStatus: enum (Not due, To submit, Submitted, Agreed, Rejected), negotiationMonth: 1-12, priceDownPct (private), paymentTermsDays: int} | Customer drawer "Commercial"; Dashboard "Revisions due" | M | A (amounts private, B for sharing) |
| 16 | SHOULD | No dormant or never-billed reactivation | Dormant OEM and Tier-1 accounts with dies still in your custody are the cheapest growth: the part is approved and the tooling exists | Computed dormant list (§5.2) with a reason and a reactivation plan | `reactivation`: {reason: enum (Programme ended, Lost to competitor, Price, Quality, Payment hold by us, Unknown), plan: string, owner, nextStepOn: date} | Dashboard list; Customers filter "Dormant" | S | A |
| 17 | SHOULD | "Disputed" has no reason | 12 accounts are flagged with no type, owner or next step, so nobody can work them | Dispute details | `disputeType`: enum (Payment, Quality debit, Commercial/price, Legal, Data mismatch); `disputeSince`: date; `disputeOwner`; `disputeNext`: date; `disputeAmount` (private) | Edit dialog; Dashboard tile | S | A |
| 18 | SHOULD | No prospects / target accounts | Growth needs a named list of OEMs and Tier-1s to win, with the commodity fit (for example steering, axle, transmission or engine forgings) and an estimated potential | Prospects in the same list with a lifecycle field | `lifecycle`: enum (Prospect, Developing, Active, Dormant, Lost, Internal); `targetAccount`: boolean; `leadSource`: enum (Referral, Existing group, Trade show, Website, Cold, Customer portal RFQ); `commodityFit`: string; `potentialAnnual` (private) | Customers filter "Prospects"; Dashboard "Targets" | S | A |
| 19 | SHOULD | No account health score | The manual status needs a second opinion built from facts, so At risk is spotted before the orders stop | Advisory score with its reasons (§5). It never changes the manual status. | Computed only: `health`: {score: 0-100, band, reasons[], coverage} | Customers badge; Customer drawer; Dashboard | S (once the signals exist) | A |
| 20 | LATER | No share of wallet | An account at 5% share has room to grow; one at 70% is a concentration risk for both sides | Estimated yearly forging buy of the customer's relevant commodity | `estForgingSpend` (private), `sowPct` = TTM billing / estForgingSpend (computed) | Customer drawer; Dashboard | S | A\* |
| 21 | LATER | Die life and custody not visible | Customer-paid dies in your custody are an asset and a commitment. Die renewal near end of life is a commercial conversation (who pays). | Die list per part | `dies[]`: {dieNo, partId, ownership: enum (Customer, Amortised, VFPL), lifeStrokes: int, strokesUsed: int, status: enum (In use, Re-sink due, Idle in custody, Scrapped), cost (private)} | Customer drawer "Parts"; Dashboard "Dies at 80% life" | M | A |
| 22 | LATER | Documents scattered | Drawings, PPAP files and quotations must be one click away, never in git | Link fields only (Drive folder URLs) | `docsUrl`: string on account, part and RFQ | Drawers | S | A |
| 23 | LATER | Reminders and scheduled imports | Daily nudges keep the data current without opening the page | Telegram (already pending) + scheduled Sheet imports | Server side only | n/a | M | B |

---

## 3. Customer model upgrade

### 3.1 Principles
- **Additive only.** Every existing key stays with the same name and meaning: `name, contact, contactFrom, city, state, phone, last, followUp, status, disputed`, plus `id` from Phase 2. All new keys are optional, and a missing key means "not set".
- **`contact` and `phone` stay** as the display copy of the primary contact, so Phase 1 and Phase 2 screens keep working. `contacts[]` becomes the full list.
- **Manual `status` is unchanged.** `lifecycle` (Prospect / Developing / Active / Dormant / Lost / Internal) is a separate descriptive field, and the health score is advisory.
- **Two files.**
  - `customers.json` (public, in git) holds identity and classification only.
  - A private layer (localdb plus "Download backup", gitignored; stage B tables with RLS) holds everything about people, money, prices and performance.

### 3.2 Extended `customers.json` (public seed). Values shown are empty placeholders, not data

```json
{
  "note": "Source: ... (unchanged)",
  "schemaVersion": 2,
  "groups": [
    { "id": "sangkaj", "name": "Sangkaj (to confirm: same group?)" }
  ],
  "settings": {
    "users": ["<owner names, set by the user>"],
    "tierRule": "pareto-70-90-ttm"
  },
  "customers": [
    {
      "id": "sangkaj-auto-components-private-limited",
      "name": "SANGKAJ AUTO COMPONENTS PRIVATE LIMITED",
      "contact": "Ganesh Gajakosh, Sachin Niture",
      "contactFrom": "email",
      "city": "",
      "state": "Maharashtra",
      "phone": "8983305259",
      "last": "2026-06-29",
      "followUp": "",
      "status": "Active",
      "disputed": false,

      "groupId": "sangkaj",
      "billingNames": [],
      "plants": [
        { "id": "p1", "name": "", "city": "", "state": "" }
      ],
      "segment": "",
      "vehicleSegments": [],
      "country": "IN",
      "lifecycle": "",
      "relatedParty": false,
      "owner": "",
      "backupOwner": "",
      "targetAccount": false,
      "leadSource": "",
      "commodityFit": "",
      "tierOverride": "",
      "tierOverrideReason": "",
      "disputeType": "",
      "disputeSince": "",
      "docsUrl": ""
    }
  ]
}
```

| Field | Type | Allowed values / rule |
|---|---|---|
| `groupId` | string | id from `groups[]`; `""` = standalone |
| `billingNames` | string[] | other invoice names that map to this account (for example "TORK MOTORS- Billing 1"), used to match CSV imports |
| `plants[]` | object[] | `{id, name, city, state}`; the vendor code per plant is private (§3.4) |
| `segment` | enum | `OEM`, `Tier-1`, `Tier-2`, `Trader`, `Export`, `Other`. Rule: Export = invoiced outside India. A foreign OEM is `Export`, with the OEM/Tier fact kept in `exportBuyerType` (optional, same enum without Export). |
| `vehicleSegments` | enum[] | `PV`, `CV`, `Tractor`, `2W`, `Off-highway`, `Other` (several allowed) |
| `country` | ISO-3166 alpha-2 | `IN` default |
| `lifecycle` | enum | `Prospect`, `Developing` (RFQ/PPAP, no serial billing yet), `Active`, `Dormant`, `Lost`, `Internal` |
| `relatedParty` | boolean | true = excluded from concentration, growth and win-rate KPIs (candidates: Markal, KCTR Varsha - to confirm) |
| `owner`, `backupOwner` | string | must be in `settings.users`; `owner` required (§7) |
| `tierOverride` | `""`/`A`/`B`/`C` | needs `tierOverrideReason` |
| `disputeType` | enum | `Payment`, `Quality debit`, `Commercial/price`, `Legal`, `Data mismatch` |

Note on `segment`, which needs care in these 42 rows (to confirm, not decided here):
- Kalyani Technoforge is itself a forging company: probably a customer for overflow or job work and also a competitor.
- SRJ Peety Steels is a steel company: is it a customer, a supplier, or both?
- S K Traders is a `Trader`.

### 3.3 Private layer (never in git): localdb + backup file in stage A, RLS tables in stage B

```json
{
  "customerId": "sangkaj-auto-components-private-limited",
  "contacts": [
    {
      "id": "<uuid>",
      "name": "",
      "role": "",
      "plantId": "",
      "phone": "",
      "email": "",
      "isDecisionMaker": false,
      "influence": "",
      "source": "guessed-email",
      "lastMetOn": "",
      "active": true
    }
  ],
  "vendorCodes": { "p1": "" },
  "approvals": { "approvedSince": "", "lastAuditOn": "", "auditScore": "", "nextAuditOn": "", "supplierRating": "", "ratingMonth": "" },
  "commercial": { "rmIndexSource": "", "rmBaseRatePerKg": null, "rmBaseDate": "", "revisionFreq": "", "lastRevisionOn": "", "claimStatus": "", "negotiationMonth": null, "priceDownPct": null, "paymentTermsDays": null },
  "dispute": { "owner": "", "next": "", "amount": null, "detail": "" },
  "reactivation": { "reason": "", "plan": "", "owner": "", "nextStepOn": "" },
  "estForgingSpend": null,
  "potentialAnnual": null
}
```
- `role` enum: `Purchase head`, `Buyer`, `SQA / Supplier quality`, `Quality head`, `NPD / Development`, `Engineering / Design`, `Plant head`, `Logistics / Stores`, `Accounts / Payables`, `Owner / MD`, `Other`.
- `influence` enum: `High`, `Medium`, `Low`. `source` enum: `guessed-email`, `confirmed`.
- Migration: split today's `contact` on commas into `contacts[]` with `source:"guessed-email"`, `role:""`. The first one becomes primary. Keep `contact` as the display copy.

### 3.4 What must stay out of the public repo
- **Never in git:** contact emails, personal mobiles of buyers, vendor codes, GSTIN, every amount (billing, outstanding, prices, RM base rates, die costs, dispute amounts, potential), complaint debit notes, competitor prices, win/loss commentary, notes and visit minutes, health-score reasons (they quote money and complaints) and **tier** (it ranks your customers by billing; compute it at runtime from the imported billing).
- **Already exposed:** 42 phone numbers and 10 contact names. That is design Open Question 1, and its recommendation (blank them in the committed file after the stage B seed) is endorsed.
- **Safe in git:** name, id, group, billing names, plants' city and state, segment, vehicle segment, country, lifecycle, related-party flag, owner names (internal, low risk; leave them out if the repo is public and that worries you), target flag, docs link only if the folder is access-controlled.

### 3.5 Tier rule (to confirm)
Use trailing-12-month (TTM) billing from the invoice CSV, excluding `relatedParty`.
1. Sort accounts (rolled up by `groupId`) by TTM billing, highest first.
2. **A** = the accounts that together make the first 70% of total TTM billing. **B** = the next 20% (cumulative 70-90%). **C** = the rest with any billing in 12 months. **P** = no billing in 12 months (prospect, developing or dormant).
3. Strategic uplift: an OEM or Tier-1 with an RFQ at PO, Sample or PPAP is shown at least **B** (it will bill soon).
4. `tierOverride` beats both rules and needs a reason.

Why Pareto rather than fixed ₹ thresholds: it needs no numbers in git, adjusts as the company grows, and matches how coverage is planned (A accounts get monthly visits, B quarterly, C on demand).

---

## 4. Parts and RFQ

### 4.1 Parts master (`parts[]`, stage A localdb; public-safe fields could live in a `parts.json`, but private by default)

| Field | Type | Notes |
|---|---|---|
| `id` | string | slug of customerId + customerPartNo |
| `customerId`, `plantId` | string | plant = where it is delivered |
| `customerPartNo` | string | required |
| `ourPartNo` | string | internal code |
| `description` | string | for example "flange yoke", "steering pinion blank" |
| `drawingNo`, `drawingRev` | string | the revision is required for PPAP and pricing |
| `materialGrade` | string | as on the drawing (for example a customer or EN/SAE/IS grade) |
| `forgingWeightKg`, `cutWeightKg`, `finishWeightKg` | number | yield = forging / cut; drives the RM claim |
| `process` | enum[] | `Hot forged`, `Heat treated`, `Shot blasted`, `Proof machined`, `Fully machined`, `Other` |
| `heatTreatment` | enum | `None`, `Normalising`, `Hardening & tempering`, `Isothermal annealing`, `Other` |
| `pressLine` | string | which press or line; supports a capacity check at RFQ |
| `annualVolume` | int (pcs/yr) | current schedule-based estimate |
| `pricePerPc` | number, private | effective rate |
| `dieNo`, `dieOwnership` | string, enum | `Customer`, `Amortised`, `VFPL` |
| `partStatus` | enum | `Development`, `PPAP submitted`, `Released (serial)`, `Service only`, `Discontinued` |
| `ppap` | object | `{level: 1-5, submittedOn, approvedOn, pswStatus}` |
| `programme` | string | vehicle or platform, if known |
| `sopDate`, `eopDate` | date | |
| `rfqId` | string | the RFQ it came from |
| `docsUrl` | string | Drive link; drawings never go in git |

### 4.2 RFQ record (`rfqs[]`)

| Field | Type | Rule |
|---|---|---|
| `id` | string | `RFQ-YYYY-NNN` |
| `customerId`, `plantId`, `contactId` | string | buyer contact |
| `owner` | string | required |
| `receivedOn` | date | required; also `stageDates.received` |
| `quoteDueDate` | date | the customer's deadline |
| `partId` or `newPartDesc` | string | one required |
| `customerPartNo`, `drawingRev`, `materialGrade`, `forgingWeightKg` | | copied to the part on Finalised |
| `feasibility` | enum | `Go`, `Go with deviation`, `No-go` (+ `feasibilityNote`) |
| `annualVolume` | int (pcs/yr) | required by Quoted |
| `targetPrice` | number, private | the customer's target per piece, if given |
| `quotedPrice` | number, private | latest quoted per piece; `quoteRevisions`: int |
| `priceBasis` | string | RM base rate and index date the quote assumes |
| `toolingCost` | number, private | die and tooling quote |
| `toolingPaidBy` | enum | `Customer`, `Amortised`, `VFPL` (+ `amortisationQty`: int) |
| `annualValue` | number, computed, private | `annualVolume × quotedPrice` (else × targetPrice) |
| `stage` | enum | `Received`, `Quoted`, `Negotiated`, `Finalised`, `PO`, `Sample`, `PPAP` (as decided) |
| `stageDates` | {stage: date} | set automatically when the stage changes; can be edited |
| `probability` | int % | default by stage (table below); override needs `probabilityNote` |
| `weightedValue` | computed | `annualValue × probability / 100` |
| `expectedSop` | date | required from Finalised |
| `programme`, `vehicleSegment` | string, enum | |
| `competitors` | string[] | who else is quoting |
| `incumbent` | string | current supplier, if it is a resourcing |
| `outcome` | enum | `Open`, `Won` (PPAP approved), `Lost`, `Dropped by customer`, `Regretted by us`, `On hold` |
| `lossReason` / `winReason` | enum | Loss: `Price`, `Lead time`, `Capacity`, `Technical / feasibility`, `Quality history`, `Incumbent / relationship`, `Project cancelled`, `No response`. Win: `Price`, `Lead time`, `Quality record`, `Relationship`, `Technical capability`, `Single source`. One is required when outcome ≠ Open/On hold. |
| `priceGapPct` | computed | `(quotedPrice − targetPrice) / targetPrice × 100` |
| `nextAction`, `nextActionOn` | string, date | required while Open (feeds the Attention list) |
| `poNo`, `poDate` | string, date | at PO |
| `sampleQty`, `sampleSentOn`, `sampleResult` | int, date, enum | `Accepted`, `Rework`, `Rejected` |

**Default probability by stage (recommended, to confirm with your own win history after 6 months):**

| Stage | Meaning | Probability |
|---|---|---|
| Received | RFQ in hand, feasibility pending | 10% |
| Quoted | Quote sent | 20% |
| Negotiated | Price or terms in discussion | 40% |
| Finalised | Price agreed, nomination or LoI expected | 70% |
| PO | Development PO / tooling PO received | 85% |
| Sample | Samples submitted | 90% |
| PPAP | PPAP submitted, awaiting approval | 95%; becomes `outcome: Won` (100%) when PSW is approved and the part moves to `Released (serial)` |

Lost, Dropped and Regretted count as 0%. On hold keeps the stage % but is shown apart and left out of the weighted total.

### 4.3 "Released parts" view (exact definition)
- **Includes:** every RFQ with `stage ∈ {Finalised, PO, Sample, PPAP}` and `outcome ∈ {Open, Won}`, plus every part with `partStatus = Released (serial)` that has no RFQ record (legacy serial parts).
- **Excludes:** Lost, Dropped, Regretted and On hold. On hold gets its own collapsed group.
- **Groups**, in this order: Finalised (awaiting PO) · PO (die in making) · Sample (samples sent) · PPAP (submitted) · Serial (PPAP approved).
- **Columns:** customer · plant · part no · rev · material · forging wt · annual volume · stage · days in stage · PO date · sample date · PPAP status · expected SOP · owner.
- **Header line:** "N released parts · annual value ₹X (private, shown only if prices are present on this device) · N reach SOP in the next 6 months".

### 4.4 Quote turnaround and stage-ageing alerts
- `tatDays` = `stageDates.quoted − stageDates.received`, in calendar days (Sundays included; keep it simple). Report the median and the % within target.
- **Ageing:** `daysInStage` = IST today − date the current stage was entered.
- **Suggested alert thresholds (to confirm):**

| Stage | Orange (watch) | Red (alert, with text "In Quoted for 35 days") |
|---|---|---|
| Received (not yet quoted) | > 5 days or quoteDueDate within 2 days | > 7 days or past quoteDueDate |
| Quoted | > 14 days without a logged follow-up | > 30 days |
| Negotiated | > 21 days | > 45 days |
| Finalised (no PO) | > 21 days | > 45 days |
| PO (no sample) | > 60 days | > 90 days, or past the promised sample date |
| Sample (no PPAP) | > 30 days | > 60 days |
| PPAP (not approved) | > 21 days | > 45 days |

As with follow-ups (rule 4), never rely on colour alone. Each alert carries text.

---

## 5. Account health score (advisory)

### 5.1 Formula
The score is shown beside the manual status. It never sets the status (CLAUDE.md rule 6). It uses only signals the CRM will hold.

| Signal | Weight | Points |
|---|---|---|
| Order recency: days from the last invoice to the billing data's as-of date (not today, while the register is stale) | 25 | ≤ 30 d: 25 · 31-60: 15 · 61-90: 5 · > 90 or never: 0 |
| Overdue money: overdue / outstanding (Collections CSV) | 20 | 0%: 20 · ≤ 10%: 15 · ≤ 25%: 8 · > 25%: 0. Capped at 5 if any amount is in the 90+ bucket |
| Last contact (Call, Visit, Email, Telegram) | 15 | ≤ 14 d: 15 · 15-30: 10 · 31-60: 5 · > 60 or none: 0 (Tier A: 0 points after 30 d) |
| Open complaints | 15 | none: 15 · 1 open < 30 d: 8 · any open ≥ 30 d, or any Line stop/Field in 90 d: 0 |
| Schedule adherence (OTIF, last 3 months) | 15 | ≥ 95%: 15 · 90-95: 10 · 80-90: 5 · < 80: 0 |
| RFQ activity | 10 | open RFQ or one received in 90 d: 10 · in 180 d: 5 · none: 0 |

- **Score** = 100 × (sum of points of the signals that have data) / (sum of weights of those signals).
- **Coverage** = the number of signals with data. If coverage is under 3, show "Not enough data", not a number.
- **Bands:** **75-100 Healthy** · **50-74 Watch** · **0-49 Weak**.
- **Badge style:** a neutral navy outline badge with the word plus the score ("Watch 58"), so it is not confused with the manual green/orange/red status (rule 7).
- **Mismatch hint:** when the status is Active and the band is Weak, or the status is At risk and the band is Healthy, show a small text chip "Check status". The user decides.
- **Reasons list** (customer drawer and tooltip): the signals that lost the most points, worst first, in plain words. For example:
  - "No invoice for 98 days (data as of 12 Jul 2026)"
  - "28% of outstanding is overdue; some in 90+ days"
  - "Not contacted for 45 days"
  - "1 complaint open for 34 days (D4)"
  - "OTIF 86% in the last 3 months"
  - "No RFQ in 180 days"

  Plus the missing signals: "No collections data on this device".
- **Stage A caveats:**
  - Money and OTIF come from per-device CSVs, so the score can differ between devices. Show "Based on data imported on this device".
  - Reasons quote money and complaints, so they are never exported to `customers.json`.

### 5.2 Dormant customers to reactivate (rule, to confirm)
- **Dormant** = an account (rolled up by group) that is not `relatedParty`, not disputed, and has billing in the last 36 months but **no invoice in the last 120 days** before the billing as-of date. This is shown in the list, and `lifecycle` is suggested as Dormant; it is not set automatically.
- **Never billed** = in the master with no invoice on record (today 13 accounts that are not disputed). The owner must sort each one into Prospect, Lost or Data gap (for example a missing billing-name match).
- **Order of the list:** tier last held (A first) → number of released parts or dies still in custody → TTM billing a year ago.
- **Each row shows:** last invoice date, months since, owner, `reactivation.reason`, next step. One-click actions: "Plan visit" (Schedule) or "Log call".
- **Why it is cheap growth:** parts that are already approved and dies in custody need no new PPAP. A re-quote at current steel prices is often all it takes.
- **Important today:** the register stops on 12 Jul 2026, so counted from today almost everyone looks dormant. The rule must use the billing as-of date (the same idea as the design's "Count days from" toggle) until the invoice CSV is refreshed.

---

## 6. Dashboard KPIs for the weekly sales review

"A" = possible in stage A from data typed in the page. "A\*" = possible in stage A only after a CSV import on that device. "B" = needs stage B. Money tiles show "Import the Collections/Invoice CSV on this device to see this" when the data is missing, never a zero.

| # | Tile / list / chart | Formula | Data source | Stage |
|---|---|---|---|---|
| 1 | Billing this month, FY to date, vs same period last year | Σ invoice value in period; growth % = (this − last) / last | Invoice register CSV | A\* |
| 2 | Customer concentration | top-1, top-5, top-10 share of TTM billing (groups rolled up, related party excluded) | Invoice CSV + groups | A\* |
| 3 | Billing mix by segment and vehicle segment | Σ TTM by `segment` / `vehicleSegments` (multi-segment accounts split equally, noted) | Invoice CSV + master | A\* |
| 4 | Tier mix | count and TTM share for A/B/C/P | Invoice CSV + tier rule | A\* |
| 5 | Pipeline value | Σ `annualValue` of open RFQs; weighted = Σ `annualValue × probability` | RFQs | A |
| 6 | RFQ funnel | count and value by stage; conversion = RFQs that reached stage n+1 / reached stage n (last 12 months) | RFQs `stageDates` | A |
| 7 | Win rate | won / (won + lost + dropped), last 12 months, by count and value; by segment | RFQs `outcome` | A |
| 8 | Loss reasons | count by `lossReason`, last 12 months; top competitor names | RFQs | A |
| 9 | Quote turnaround | median `tatDays` (last 90 days); % within 5 days; list "Waiting for quote" with days | RFQs | A |
| 10 | Stage-ageing alerts | RFQs at orange or red per §4.4, oldest first | RFQs | A |
| 11 | New business coming | released parts with `expectedSop` in the next 6 months; weighted annualised value | RFQs / parts | A |
| 12 | Overdue follow-ups and RFQ next actions | existing overdue/today counts + RFQs with `nextActionOn` < today | Customers, RFQs | A |
| 13 | Tier-A not contacted in 30 days | count + list | Call log + tier | A\* (tier needs billing) |
| 14 | Dormant and never-billed accounts | per §5.2 | Invoice CSV + master | A\* |
| 15 | Health: Weak and Watch accounts; status mismatches | per §5.1 | All signals | A / A\* |
| 16 | Complaints | open count; open > 30 days; customer PPM = rejected qty / supplied qty × 1,000,000 (rolling 3 months) | Complaint log + dispatch qty from schedule CSV | A (count) / A\* (PPM) |
| 17 | OTIF by customer | Σ onTimeQty / Σ schedQty, last 3 months; worst 5 | Schedule CSV | A\* |
| 18 | Collections risk | outstanding; overdue; aging 0-30 / 31-60 / 61-90 / 90+; top 5 overdue accounts; DSO = outstanding / TTM billing × 365 | Collections CSV (+ invoice CSV for DSO) | A\* |
| 19 | Disputed accounts | count by `disputeType`, ageing since `disputeSince` | Master | A |
| 20 | Price revisions due | accounts with `nextRevisionDue` ≤ today + 30 or `claimStatus = To submit` | Commercial block | A |
| 21 | Approvals and audits due | `nextAuditOn` and the VFPL IATF certificate within 60 days; PPAP pending > 45 days | Approvals, parts | A |
| 22 | Visits | planned vs done this month; visits with no minutes after 48 h; open action items past due | Schedule calendar, call log | A |
| 23 | New accounts | prospects added; first-ever PO from a new account this FY | Master, RFQs | A |
| 24 | Activity by owner | calls and visits logged per owner per week | Call log with a logged-in user | B |

Keep the Phase 2 design's principles: every number is a button that opens the matching filtered list, and print hides note text. In print, also hide money unless the user ticks "Include amounts".

---

## 7. Operating rhythm and data governance

### 7.1 Daily (each owner, 15 minutes)
1. Open Dashboard → Attention: overdue and due-today follow-ups, RFQ next actions due, red ageing alerts.
2. Make the calls. **Log every customer touch the same day** (Done or Notes), always with a next follow-up date or an explicit "none".
3. Update the RFQ stage the moment a quote, PO, sample or PSW happens (stage dates drive turnaround and ageing).
4. Record any complaint the same day it is received (even before quality takes it on), and assign an owner.

### 7.2 Weekly sales review (Monday, 60 minutes, screen-shared from the Dashboard)
1. **Numbers (5 min):** billing last week and FY to date vs last year; concentration.
2. **Collections (10 min, with accounts):** top 5 overdue, 90+ bucket, disputes, and who calls whom.
3. **Pipeline (15 min):** new RFQs; quotes due this week; red ageing; wins and losses with reasons; weighted pipeline movement.
4. **Released parts / NPD (10 min):** PO → sample → PPAP status; SOP dates at risk.
5. **Quality and delivery (10 min, with quality):** open complaints and 8D stage; OTIF misses; anything that threatens a rating.
6. **Accounts (5 min):** 2 tier-A accounts in rotation; Weak health and status mismatches; dormant reactivation progress.
7. **Next week (5 min):** visits planned; action items recap (owner + date logged in the CRM, not in a notebook).

### 7.3 Monthly management report (first working day; Print / PDF from the Dashboard)
- Billing vs budget and last year, by segment, vehicle segment and tier; top-10 and concentration trend.
- Pipeline: weighted value, funnel conversion, win rate and loss reasons, quote turnaround.
- New business: parts reaching SOP and their annualised value; new accounts.
- Customer performance: OTIF and PPM by customer, open 8Ds, audits and ratings received.
- Commercial: price revisions submitted, agreed and pending; annual negotiation calendar.
- Collections: aging, DSO, disputes.
- Account health movers, plus dormant accounts and prospects.
- **Quarterly:** tier-A account plans; preparation for the annual price negotiations (steel basis, price-down asks); competitor review.

### 7.4 Required fields (the CRM is the source of truth only if these are always filled)

| Record | Required |
|---|---|
| Account | `name`, `owner`, `segment`, `lifecycle`, `state` (or `country` if overseas); `disputeType` when `disputed` |
| Contact | `name`, `role`, one of `phone`/`email`; at least one contact per Active account |
| Log / visit | `type`, `at`, `note`; for Visit: `purpose`, and an owner + due date on every action item |
| RFQ | `customerId`, `owner`, `receivedOn`, part (`partId` or `newPartDesc`), `annualVolume` (by Quoted), `stage`, `nextActionOn` while Open, `expectedSop` from Finalised, `lossReason`/`winReason` on close |
| Complaint | `date`, `customerId`, `partId`, `defect`, `severity`, `owner` |
| Follow-up | every Active and Follow up account has a follow-up date (Dashboard tile "No follow-up set" should trend to 0; today all 42 are unset) |

Enforce these in the dialogs with the same inline error style as the design (`#formErr`), not with `alert()`.

### 7.5 Governance

| Topic | Stage A (prototype) | Stage B (source of truth) |
|---|---|---|
| Ownership | `owner` text field + "My accounts" filter | owner = a login user; only the owner, backup or management edits commercial fields |
| Audit trail | `updated_at` only; no "who" | `change_log` trigger on every table: who, when, field, old → new; customer drawer "History" |
| Duplicate check | warn on add/edit when the normalised name matches (strip `PVT`, `LTD`, `LIMITED`, `PRIVATE`, punctuation, `UNIT-n`) or the phone matches; suggest "add as plant of …" | the same, plus a unique GSTIN (private column) |
| Imports | CSV import shows "as of" date, rows matched / unmatched (via `billingNames`), never overwrites typed data | scheduled import from the Sheets into the private database; import log table |
| Exports | `customers.json` (public fields only) and backup (private) | database backup weekly, off git |
| Roles | none (one browser = one person) | **Sales:** own and read all accounts, see their own accounts' overdue totals. **Accounts:** collections import, disputes, payment notes. **Quality:** complaints, PPAP, OTIF, audits. **Management:** everything, targets, tier override, user admin. |
| Deletion | only hand-added rows (design) | soft delete (`archived_at`); log and RFQ history is append-only |

---

## 8. Roadmap: two paths

### 8.1 Architect's path (everything valuable)

| Wave | Content | Parallel build agents | Duration (build + user review) |
|---|---|---|---|
| 0 | Design addendum to Phase 2: data model of §3-§4, the RFQs and Schedule tabs, the CSV import framework, the export key list | 1 Opus | 1 day |
| 1 | Phase 2 as designed (A1-A5) plus: account fields (#1, #5, #6, #17, #18), contacts (#7), RFQ tab with value, win/loss, turnaround, ageing and released parts (#4, #8-#10), invoice + collections CSV import (#2), Dashboard KPIs 1-14 and 18-19 | 4 Sonnet (Foundation → Accounts+Contacts ∥ RFQ+Parts ∥ Imports ∥ Dashboard) | 4-5 days + 2-3 days review |
| 2 | Visit reports and actions + Schedule calendar (#11), complaints/PPM/8D (#12), OTIF from the schedule CSV (#13), PPAP/approvals/audits (#14), price revisions (#15), dormant workflow (#16), health score (#19), KPIs 15-17 and 20-23 | 3-4 Sonnet | 4-5 days + 2-3 days review |
| GO | User says GO for Supabase | | |
| 3 (B) | Postgres schema for every entity, RLS by role, `change_log` audit triggers, login, migration of each device's localdb (merge with conflict report), private import pipeline, weekly backup | 3 Sonnet (Schema+RLS ∥ Data layer+Auth ∥ Import+Migration) + 1 deploy | 7-10 days + review |
| 4 (B) | Telegram reminders, scheduled Sheet imports, monthly report PDF, activity by owner (KPI 24), share of wallet, dies (#20-#22) | 2 Sonnet | 4-5 days |

Realistic total: **about 5-7 weeks of calendar time**. The user's review cycles, not the build, are the limiting factor. **Leaves out:** nothing on this list. What lies beyond it: an ERP/Tally integration for live billing and dispatch, customer-portal scraping (schedules and ratings), quotation costing sheets (RM, forging, HT and machining cost build-up) and capacity planning. These belong to ERP or estimating tools, not the CRM.

### 8.2 Owner's path (about 80% of the value in 48 hours, stage A)
Build these on top of Phase 2 A1-A5, which is assumed to be in progress:

1. **Account fields** on the Edit dialog and Customers filters: `owner`, `segment`, `vehicleSegments`, `groupId` + `plants[]` (name/city/state), `relatedParty`, `lifecycle`, `targetAccount`, `disputeType`. Includes the "My accounts", "Prospects" and "Group by account" views.
2. **Contacts with roles** (`contacts[]` with role, plant, decision-maker), kept in localdb and the backup only.
3. **RFQs tab** with the §4.2 core: value fields (volume, quoted/target price, tooling), stage with automatic `stageDates`, default probability, `expectedSop`, competitors, outcome + required win/loss reason, `nextAction`/`nextActionOn`.
4. **Turnaround and ageing badges** (§4.4) and the **Released parts view** (§4.3) as a filter of the RFQs tab.
5. **Invoice register CSV import** next to the already-decided Collections CSV import (same browser-only code): refreshes `last`, TTM billing and the tier A/B/C, with an "as of" date.
6. **Dashboard additions:** KPIs 2 (concentration), 4 (tier mix), 5 (pipeline + weighted), 6 (funnel), 7 (win rate), 9 (quote turnaround), 10 (ageing alerts), 14 (dormant + never billed) and 18 (collections aging, already decided).
7. **Required fields** of §7.4 for account (owner, segment, lifecycle) and RFQ; the duplicate-name warning.

**The Owner's path leaves out:**
- visit minutes and action items (use Notes for now);
- complaints/PPM/8D, OTIF, PPAP and approvals, audits and vendor codes;
- price-revision tracking;
- the health score (needs the quality and delivery signals);
- dies and share of wallet;
- **everything that makes it a source of truth:** shared data, logins, audit trail, roles, scheduled imports and Telegram.

Until stage B, one designated "master" browser should hold the data, and others should only view exports.

---

## 9. Questions for the user (each with a recommendation)

1. **Who owns each account?**
   (a) One named owner per account, set now in the Edit dialog. (b) Owner by region (Maharashtra / South / North / Export). (c) Everything owned by the Head of Sales until the team is set.
   **Recommended: (a)**, with (c) as the starting default for any account not yet assigned.
2. **Tier A/B/C rule?**
   (a) Pareto on TTM billing: A = first 70%, B = 70-90%, C = the rest, with a strategic uplift for live PO/Sample/PPAP. (b) Fixed ₹ thresholds that you set. (c) Set by hand only.
   **Recommended: (a)**, with an override that needs a reason.
3. **VARSHA FORGINGS LTD MARKAL and KCTR VARSHA AUTOMOTIVE: are they internal or related parties?**
   (a) Yes: mark them related party and keep them out of concentration and growth KPIs, but keep them in the list. (b) Treat them as normal customers. (c) Remove them from the CRM.
   **Recommended: (a)**.
4. **Import the invoice register as a CSV in stage A (browser-only, like Collections) to refresh "last order" and compute billing and tier?**
   (a) Yes, monthly totals per customer only. (b) Yes, invoice-level rows. (c) No, wait for stage B.
   **Recommended: (a)**. It is the smallest private footprint that still drives tier, dormant and concentration.
5. **Dormant threshold (no invoice for N days, counted from the billing as-of date)?**
   (a) 90 days. (b) 120 days. (c) 180 days.
   **Recommended: (b) 120 days**. It allows for monthly schedules with an occasional skipped month, and catches a lost programme within one quarter.
6. **Which path now?**
   (a) Owner's path in 48 hours, then Wave 2 of the Architect's path, then GO for stage B. (b) Architect's path straight through. (c) Owner's path only, then stage B.
   **Recommended: (a)**. You get the growth view (accounts, RFQ value, released parts, concentration) this week, and quality and delivery follow before the database is designed, so the stage B schema is built once.
