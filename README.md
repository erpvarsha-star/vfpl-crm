# Varsha CRM

Customer tracker for Varsha Forgings. Navy and orange, plain HTML, CSS and JavaScript files, no build step and no server code. This is the stage A prototype: everything you type or import stays in your browser. Supabase (shared database and login) comes after the HTML has been reviewed.

## The tabs

- **Dashboard** - every number is a button that opens the matching list. Customers at a glance, follow-ups to do now, money (outstanding, overdue, aging), revenue and targets, RFQs and released parts, orders and dispatch, leads, and a printable weekly sales review.
- **Customers** - the customer list: contact, phone, city or plants, last order, follow-up date, status, notes and call log, Mark done, Edit, group, segment and vehicle segment, money and revenue lines.
- **Leads** - prospects and dormant leads: buckets, follow-ups, log a touch, convert to a customer or an RFQ, and import of the lead trackers.
- **RFQs** - the pipeline from Received to PPAP (board and table), quote and action dates, lost marker, released parts, and import of the Hub sheets.
- **Schedule** - visits and calls on a calendar, typed upcoming orders, and the dispatch history (by customer, by part, by month).
- **Export** - CSV and "Copy for Google Sheets", `customers.json`, the private backup and its restore, the weekly review, and the list of what this browser holds with buttons to clear imported data.

## Files

- `index.html` - the page. `css/` and `js/` hold one stylesheet and one script per module (`store.js` is the only data layer; `csv.js` and `importer.js` are shared by every import).
- `customers.json` - the customer list the page starts from. Names, contact people and phones only. No notes, no amounts, no emails.
- `tests/smoke.js` - the test runner; `tests/unit/` and `tests/checks/` hold the tests.
- `docs/` - the design documents. `CLAUDE.md` - the project rules.

## Where your data lives

Everything is saved in this browser (`localStorage`) and survives a refresh. It is not shared with other browsers or devices.

- Customer edits, notes, RFQs, leads, visits and typed orders: key `varsha-crm-localdb-v1`.
- Imported money, invoices and dispatch history, name matches, targets and the tab and filter choices each have their own key.

To move to another browser, use **Export > Download backup** and **Restore from backup** there. To change the shared customer list, use **Download customers.json** and replace the file in this repo.

## How imports work

Imports are CSV files you download from the Google Sheets by hand (File > Download > Comma-separated values). The page never writes to a sheet. The file is read in your browser; it is not uploaded anywhere.

| What | Where to start | File |
|---|---|---|
| Money | Dashboard > Import money data | AGING tab, LIVE_POSITION tab |
| Revenue | Dashboard > Import invoices | INVOICE_REGISTER tab (the Taxable column is used) |
| Dispatch history | Schedule > Dispatch history | Date, Customer, Part Code, Quantity, Slip Type |
| RFQs | RFQs > Import RFQs | Hub "Action Pending (Internal)" and "Awaiting Customer Response", or an RFQ list |
| Leads | Leads > Import leads | the Hub dormant leads sheet and the older lead trackers |

The import dialog checks the column headers (and says exactly which are missing), blocks the import on a bad number or date, lists names it could not match to a customer so you can match them by hand (the choice is remembered), and shows a "Data as of" date. Amounts and invoice dates show "data through <date>" because the sheet may be behind.

Some imports ask you to review before anything is saved (RFQs and leads).

## What never goes into git

Real amounts, emails, lead phone numbers, notes and GST numbers never go in git. They live only in the browser. `*.csv` files and `varsha-crm-backup-*.json` are ignored by git, so a downloaded sheet or backup cannot be committed by accident. `customers.json` is the only data file in the repo. The tests use made-up names and amounts that are built inside the test.

The Export boxes "Include notes", "Include contact details" and "Include amounts" are off every time the page opens and are never remembered. Without a tick, no file has note text, lead or RFQ emails and phones, RFQ contact references or amounts.

## Run it

Open it through a web server (GitHub Pages, or any static server). Double-clicking `index.html` cannot load `customers.json`.

```
python3 -m http.server 8000
```

then open http://localhost:8000/ (any other static server works, for example `npx http-server`).

## Tests

```
npm i playwright            # once; or use a global Playwright
node tests/smoke.js --strict
```

The runner starts its own server and Chromium, runs every file in `tests/unit/` and then `tests/checks/` (sorted by name), and checks that every action survives a refresh. `--strict` makes any skipped check a failure. Run it before every push; do not push on a failure. If Playwright is installed globally, point `NODE_PATH` at the global modules, or link them: `ln -s "$(npm root -g)" node_modules` (`node_modules` is ignored by git).

## Plan B

- If hosting is down, run any static server on this folder (see "Run it").
- If the browser blocks storage (private window, storage turned off), the red banner says so. Changes then last only until a refresh: use **Export > Download customers.json** and **Download backup** to keep them.
- If a file will not import, check the column message in the dialog, or export the right tab again.

## Privacy

`customers.json` holds customer names, a few contact names and phone numbers. Keep this repo private if you do not want them public.
