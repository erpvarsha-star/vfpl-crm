# Varsha CRM

Customer tracker for Varsha Forgings. Navy and orange, one page, no build step.

## Files

- `index.html` - the tracker (customer, contact person, phone, city, last order, follow-up date, status; **+ Add customer** form).
- `customers.json` - the customer data. This file is the source of truth.
- `tests/smoke.js` - browser test. Run it before every push.
- `CLAUDE.md` - the project rules.

## How the data works

- The page loads `customers.json`, so open it from a web server or GitHub Pages. Double-clicking `index.html` shows a "could not load" message.
- `last` is the customer's latest invoice date in the Collections Engine sheet (INVOICE_REGISTER, which runs to 12-Jul-2026).
- `contact` is guessed from the customer's email address and `state` from the GST number. They show in grey italics.
- `status` (Active, Follow up, At risk) is set by hand. The starting values were a suggestion based on days since the last invoice.
- `followUp` is a date picked from a calendar on each row. A date in the past turns red and says how many days overdue. The filter buttons at the top show Overdue, Due today, Next 7 days or No follow-up set.
- Your filters, search and sort order are remembered when you refresh.

## Changing the data

Edits made in the page (a new customer, a changed status) are kept in that browser only. To share them:

1. Click **Download customers.json** in the page.
2. Replace `customers.json` in this repo with the downloaded file and commit it.

You can also edit `customers.json` directly.

## Tests

```
NODE_PATH=$(npm root -g) node tests/smoke.js
```

(or `npm i playwright` first). It starts its own server and checks every action survives a refresh.

## Privacy

`customers.json` holds customer names and phone numbers. Keep this repo private if you do not want them public.
