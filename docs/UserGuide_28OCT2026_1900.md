# Varsha CRM - owner's guide (2 pages)

Date: 28 Oct 2026. For the owner. Plain steps, no technical knowledge needed. The big picture is in `docs/Vision_28OCT2026_1900.md`.

## Page 1 - First run (about 30 minutes, once)

**Before you start:** use one browser on one computer. Your edits, notes, RFQs and leads are saved in that browser. They do not follow you to another browser or phone until the shared database (stage B) is switched on.

**First-run checklist**
1. [ ] Open the CRM link. Wait until the customer list appears. If a banner says storage is blocked, leave private/incognito mode, or use **Export > Download backup** often.
2. [ ] **Connect the sheets.** The CRM never writes to your Google Sheet. In Google Sheets open each tab below, choose File > Download > CSV, then use the **Import** button on the matching CRM tab:
   - INVOICE_REGISTER, for revenue and "last order"
   - Collections (AGING and LIVE_POSITION), for outstanding and overdue
   - Hub RFQ sheet, on the RFQs tab
   - Orders and dispatch, on the Schedule tab
   - Lead trackers, on the Leads tab
3. [ ] If an import lists **unmatched names**, pick the right customer once. The CRM remembers your choice.
4. [ ] Read the label **"Data through <date>"**. The invoice register currently ends 12 Jul 2026, so "last order" may be out of date until newer invoices are loaded.
5. [ ] **Review each customer** (start with the 10 biggest): fix contact and phone, add plants, group, segment and vehicle segment, and set the **status by hand** (Active, Follow up, At risk). The CRM never changes status for you.
6. [ ] Set a **next follow-up date** for every customer you want to hear from. Dates are India time.
7. [ ] Type your **targets** on the Dashboard so the pace bars mean something.
8. [ ] Look at the **Dashboard**. Click any number: it opens the list behind it, and the row count matches.
9. [ ] **Back up now:** Export > tick what you need > Download backup. Keep the file private; do not email it or put it in the code folder.
10. [ ] Refresh the page. Everything you did should still be there. If not, tell the builder.

**Colours mean something**
- Red with the words "Overdue by N days" = the date has passed.
- Orange = due today.
- Green = fine. Navy and orange are just the look.

## Page 2 - Every day, week and month

**Your daily 5-minute routine ("My day")**
1. Open **Today** (until it is added, use the Dashboard follow-up numbers). Read the red lines first, then orange.
2. For each call or visit: do it, press **Mark done**, write one line of note, and set the next follow-up date (or choose none on purpose).
3. Open **RFQs**. If a quote went out, a PO arrived, or a sample or PPAP was approved, move the RFQ to that stage so the date is recorded.
4. Add any new enquiry in **Leads** or **RFQs** straight away, with a follow-up date. Do not keep it in your head.
5. If a customer has gone quiet, check its status and change it by hand if it needs attention.
6. Once a week (Friday is good): **Export > Download backup**.

Tip: **Ctrl+K** searches customers, leads and RFQs once the search module is added. On a phone only the tab bar scrolls sideways; the page does not.

**Weekly sales review (Monday, one hour)**
- Open the Dashboard on a big screen, or print the **Weekly sales review** (one A4 page).
- Walk through: billing vs target, top overdue payments, new and stuck RFQs, parts waiting for PO, sample or PPAP, customers at risk, next week's visits.
- Every action gets an owner and a date **in the CRM**, not on paper.

**Monthly review (first working day)**
- Re-import INVOICE_REGISTER and Collections first, so the numbers are current.
- Review billing vs budget by segment, concentration (how much one customer is), RFQ conversion and quote turnaround, and dormant customers to wake up. Reset targets.
- Print or save as PDF from the Dashboard. Leave "Include notes", "Include contact details" and "Include amounts" **unticked** unless the copy stays inside the company.

**Things to know**
- Amounts, emails, lead phones, notes and GST numbers never go to the code repository. The Export tick-boxes start unticked every time, on purpose.
- If a number looks wrong, check "Data through" first. Old data is the usual cause.
- If the site is down: any static server on the folder works, or restore your backup file in another browser (Export > Restore).
- Coming after your GO: shared login, a Telegram reminder every day at 11:00 India time, and automatic sheet refresh.
