# Varsha CRM - project rules

Independent project. Work only in this repo (`vfpl-crm`). Never touch `vfpl-dashboard-26-27`.

## Rules (apply to every change)

1. **Data**: customers live in `customers.json`. Never commit emails, GST numbers, bank patterns or payment amounts. Never write to the Google Sheet.
2. **Persistence**: every action a user can take must survive a refresh (saved in `localStorage`) and be included in the "Download customers.json" export. If storage is blocked, show the warning banner.
3. **Tests**: every new action gets a check in `tests/smoke.js`, including a refresh check. Run `NODE_PATH=$(npm root -g) node tests/smoke.js` before every push and report the result. Do not push on a failure.
4. **Overdue**: a follow-up date before today is red AND says "Overdue by N days". Due today is orange. Never rely on colour alone.
5. **Dates**: stored as `YYYY-MM-DD`; "today" is always India time (`Asia/Kolkata`).
6. **Status**: Active / Follow up / At risk is set by hand. No automatic rule.
7. **Look**: navy and orange. Colours are tokens in `:root`. Green / orange / red only for status and follow-up meaning.
8. **Safety**: build text with `textContent`, never `innerHTML`. Page must work at 375px wide with no sideways scroll.
9. **Plan B**: if hosting is unavailable, run any static server on the folder; if storage is blocked, export the JSON.

## Who does what (model roles)

- **Opus designs.** Architecture, data model, security and UI specs are written by an Opus agent first.
- **Sonnet agents build, read and deploy.** Every build, read (repo, sheet, database) and deploy task is done by a Sonnet agent that reports back to the lead.
- **The lead checks.** The lead briefs each agent fully, then verifies the result (tests, diff, live check) before telling the user it is done. Agents do not push to `main` without the lead's check.
- **Links at every step:** after each completed step, push and give the user the git links (commit, files) and the live-view link, so they can check it in a browser.
- **Process per phase:** blueprint, the user's GO, design, build, test, deploy, then a short skill harvest (new gotchas go in the list below).

## Gotchas (learned the hard way)

- CSS `display` on an element overrides the `hidden` attribute. Keep `[hidden] { display: none !important; }`.
- A global `margin: 0` reset breaks `<dialog>` centring. Keep `dialog { margin: auto; }`.
- Opening `index.html` by double-click cannot fetch `customers.json`. Previews inject the data as `window.CRM_DATA`.
- `pkill -f <text>` can kill the shell that contains that text. Kill by PID.
- The sheet's `INVOICE_REGISTER` stops at 1,200 rows (12-Jul-2026), so "last order" may be out of date.
