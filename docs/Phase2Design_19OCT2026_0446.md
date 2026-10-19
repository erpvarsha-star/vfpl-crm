# Varsha CRM - Phase 2 design

Date: 19 Oct 2026, 04:46 IST. Author: Opus design agent. Status: ready for the lead's review.

**Two stages.**
- **Stage A (build now): a working HTML prototype** on GitHub Pages using browser storage only, for the user to review. It covers the tabs (Dashboard, Customers, Export), the logo, Mark done (P2-A), Notes and call log (P2-B), Edit customer (P2-C), the Export tab (P2-E) and the Dashboard (P2-F). **No Supabase calls, no login, no keys in stage A.**
- **Stage B (only after the user's GO on stage A): Supabase.** Private Postgres, Auth, RLS and allowlist, and the same `Store` API backed by the database. The Telegram reminder hook is in stage B, design only.

Words used here:
- **IST today** = `new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })`, the existing `todayISO()`. In SQL it is `private.ist_today()`.
- **localdb** = the browser "database" in localStorage key `varsha-crm-localdb-v1` (stage A).
- **Store** = the one data module (`store.js`) the UI talks to. In stage A it is backed by localdb; in stage B by Supabase. The UI does not change between stages.

---

## 0. Key decisions

1. **The `Store` interface comes first.** Stage A builds the full Promise-based `Store` API on a `LocalBackend` with the same rows and column names as the stage B database. Stage B adds `SupabaseBackend`, a write queue and login behind the same API, with no UI rewrite.
2. **Stable id.** Every customer gets a text slug `id` from its name at creation, and it never changes. Rename changes `name` only. Follow-ups, status and notes are keyed by `id`. Phase 1 edits keyed by NAME are migrated once on first load.
3. **Three tabs: Dashboard (first and default), Customers, Export.** The chosen tab persists across refresh. Each tab panel is rendered by its own file, so Sonnet agents can build them in parallel without touching the same file.
4. **The Dashboard is read-only and every number is a button.** Clicking a number opens the Customers tab with the exact matching filter, and the row count equals the number clicked. Charts are CSS bars, with no libraries.
5. **Notes never reach git.** The `customers.json` export never has notes. Notes leave the browser only in "Download backup (with notes)", or in CSV and copy when the user ticks "Include notes text". Backup and CSV file names are gitignored.
6. **Stage B security is RLS plus an allowlist, not secrecy.** Only the publishable or anon key goes in a committed `config.js`. Everything is revoked from `anon`. Policies need `private.is_allowed()`: the JWT email is in `allowed_users` and the user is confirmed. Sign-ups are off.
7. **Mark done is one atomic operation** (stage A: one localdb write; stage B: the `public.mark_done` RPC, idempotent by a client UUID).
8. **The inline script moves to `app.js`**, so a strict CSP is possible (`script-src 'self'`). Stage B adds the pinned supabase-js from jsDelivr with SRI.

---

## 1. Architecture

### 1.1 Stage A (prototype, now)

```
 Browser (GitHub Pages, public static files, no build step)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ index.html     markup (header+logo, tabs, Customers panel, dialogs), │
 │                base CSS tokens, CSP meta                             │
 │ store.js       Store API  ── LocalBackend (localStorage "localdb")   │
 │                shared pure helpers: fuKind, lastBucket, slug, ...    │
 │ app.js         Customers tab, dialogs (Done, Notes, Edit/Add), tabs, │
 │                filters, window.App contract                          │
 │ export.js      Export tab (renders #panel-export) + CSV/TSV builders │
 │ dashboard.js   Dashboard tab (renders #panel-dash) + stats compute   │
 │ export.css, dashboard.css   tab-specific styles                      │
 │ assets/        varsha-logo.jpg, favicon-64.png                       │
 │ customers.json seed (42 customers, no notes)                         │
 │ localStorage:  varsha-crm-localdb-v1 (customers + call log),         │
 │                varsha-crm-view-v1 (tab, filters, search, sort, ...)  │
 └──────────────────────────────────────────────────────────────────────┘
 Data stays in the one browser it was typed in, as in Phase 1.
 Share via Export -> customers.json (git-safe) or the backup file (private).
```

### 1.2 Stage B (after GO)

```
 Browser: same files + config.js { supabaseUrl, supabaseKey } (public on purpose)
          store.js gains SupabaseBackend + write queue + cache + auth
          localStorage: session token, cache, queue, view state
                 │ HTTPS (apikey + user JWT)
 Supabase (free, ap-south-1)
   Auth: email+password, sign-ups OFF, confirm email ON
   PostgREST: customers, call_log, rpc mark_done, rpc am_i_allowed
   RLS on every table -> private.is_allowed() (allowlist + confirmed)
   allowed_users: RLS on, no policies, no grants (invisible to the API)
   v_followups_due (service_role only) -> Telegram 11:00 IST (later)
 git (public): code, config.js (public key), customers.json (seed), SQL.
 NEVER in git: notes, backups, CSVs, service_role key.
```

**What lives where, and why**

| Thing | Stage A | Stage B | Why |
|---|---|---|---|
| Customers + call log | localdb (this browser) | Supabase Postgres | B: one private copy for every device |
| Who may see data | n/a (own browser) | `allowed_users` | B: open sign-ups or a leaked key reach nothing |
| URL + key | none | `config.js` (committed) | Safe by design with RLS |
| View state (tab, filters, search, sort, export scope, dashboard "count from") | `varsha-crm-view-v1` | same | Phase 1 behaviour |
| Seed | `customers.json` | `customers.json` -> `scripts/make-seed.js` -> SQL | One source |

---

## 2. Data model

### 2.1 Row shape (identical in localdb and Postgres)

Customer row (snake_case):
`{ id, name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed, source, created_at, updated_at, updated_by }`
- `source` is `"seed"` or `"manual"`.
- Dates are `YYYY-MM-DD` or `null`. Timestamps are ISO strings.

Log row:
`{ id /* uuid */, customer_id, at, type, note, done_follow_up, next_follow_up, created_at, created_by }`
- `type` is one of Call, Visit, Email, Telegram, Note.
- `note` is at most 500 characters.

UI objects (camelCase, Phase 1 names kept), mapped in `store.js`:

| UI | Row | Rule |
|---|---|---|
| `id` | `id` | slug, never changes |
| `name` `contact` `city` `state` `phone` | same | `''` when empty |
| `contactFrom` | `contact_from` | becomes `''` when `contact` is edited by hand |
| `last` | `last_order` | `''` <-> `null` |
| `followUp` | `follow_up` | `''` <-> `null` |
| `status` `disputed` | same | |
| `added` | `source === "manual"` | only these show the remove × |
| `updatedAt` `createdAt` | `updated_at` `created_at` | exact strings |

LogEntry: `{ id, customerId, at, type, note, doneFollowUp, nextFollowUp, createdAt, createdBy, pending }`. `pending` is always false in stage A.

### 2.2 Slug rule (shared by the browser and the stage B seed script)

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
I checked all 42 current names: every slug is unique. Examples: `ZF STEERING GEAR (INDIA) LTD` -> `zf-steering-gear-india-ltd`; `Ziemer GmbH & Co. KG` -> `ziemer-gmbh-and-co-kg`. If an input row already has `id` (a Phase 2 export), that id is used as given.

`store.js` guards every `window`/`document` access and ends with `if (typeof module !== "undefined") module.exports = { slug: slug, fuKind: fuKind, lastBucket: lastBucket, addDays: addDays, dayNum: dayNum };`, so Node scripts and unit tests can `require` it.

### 2.3 localdb (stage A): `varsha-crm-localdb-v1`

`{ v: 1, customers: Row[], log: Row[], deleted: string[] /* ids of removed customers */ }`

Seeding on every load, from `window.CRM_DATA` or `fetch("customers.json", {cache:"no-store"})`:
- A seed customer whose id is not in localdb and not in `deleted` is inserted with `source:"seed"` and `created_at === updated_at`.
- A seed customer already in localdb **that was never edited** (`updated_at === created_at`) gets its fields refreshed from the file. This keeps the Phase 1 behaviour where a committed `customers.json` change shows up.
- Edited rows keep the browser's values.

Rules (the same ones Postgres enforces in stage B):
- Unique `lower(name)`.
- Only `source:"manual"` rows can be removed. Removing one deletes its log rows, and its id goes into `deleted`.
- A patch sets `updated_at = new Date().toISOString()`.
- `mark_done` = in one write: insert a log row with `done_follow_up = old follow_up`, then set `follow_up = next` (or null).

### 2.4 Moving Phase 1 edits (keyed by NAME) to ids, once per browser

Runs in `Store.load()` after seeding (stage A), or after the first server fetch (stage B):
```
legacy = JSON.parse(localStorage["varsha-crm-local-v2"])   // {added:[], status:{name:v}, follow:{name:v}}
if (!legacy || localStorage["varsha-crm-legacy-done-v1"]) return
find(name) = row with name === name, else lower(name) === lower(name), else id === slug(name)
for [name, v] in legacy.status: r = find(name)
   r && r.status !== v && r.updatedAt === r.createdAt -> setStatus(r.id, v); moved++
   else if r && r.status !== v                        -> skipped++  (already edited since)
for [name, v] in legacy.follow: same rule with followUp
for a in legacy.added: !find(a.name) -> addCustomer(a); moved++   else skipped++
localStorage["varsha-crm-local-v2-backup"] = raw;  remove "varsha-crm-local-v2"
localStorage["varsha-crm-legacy-done-v1"] = "1"
notice: "Moved 3 changes saved by the old version of this page." (+ " 1 was skipped because a newer value exists.")
```
In stage A every row is fresh, so all Phase 1 edits move. The `updatedAt === createdAt` guard matters in stage B, where a second device must not overwrite newer database values.

### 2.5 Stage B: Postgres migration `supabase/migrations/20261019000100_phase2.sql` (copy as is)

```sql
-- Varsha CRM Phase 2 schema (stage B). Run once as the project owner.
create extension if not exists pgcrypto;
create schema if not exists private;              -- NOT an exposed API schema
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.ist_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create table public.allowed_users (
  email      text primary key check (email = lower(btrim(email)) and email like '%_@_%._%'),
  note       text not null default '',
  created_at timestamptz not null default now()
);

create table public.customers (
  id           text primary key
               check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) <= 64),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  contact      text not null default '' check (char_length(contact) <= 80),
  contact_from text not null default '' check (contact_from in ('', 'email')),
  city         text not null default '' check (char_length(city) <= 60),
  state        text not null default '' check (char_length(state) <= 60),
  phone        text not null default '' check (char_length(phone) <= 30),
  last_order   date,
  follow_up    date,
  status       text not null default 'Active' check (status in ('Active', 'Follow up', 'At risk')),
  disputed     boolean not null default false,
  source       text not null default 'manual' check (source in ('seed', 'manual')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default ''
);
create unique index customers_name_lower_uniq on public.customers (lower(name));
create index customers_follow_up_idx on public.customers (follow_up) where follow_up is not null;

create table public.call_log (
  id             uuid primary key default gen_random_uuid(),
  customer_id    text not null references public.customers (id) on delete cascade,
  at             date not null default private.ist_today(),
  type           text not null check (type in ('Call', 'Visit', 'Email', 'Telegram', 'Note')),
  note           text not null default '' check (char_length(note) <= 500),
  done_follow_up date,
  next_follow_up date,
  created_at     timestamptz not null default now(),
  created_by     text not null default ''
);
create index call_log_customer_at_idx on public.call_log (customer_id, at desc, created_at desc);
create index call_log_at_idx on public.call_log (at desc);     -- dashboard "recent activity"

create or replace function private.customers_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := new.created_at;                -- equal = never edited
    new.updated_by := coalesce(auth.jwt() ->> 'email', 'seed');
  else
    if new.id <> old.id then raise exception 'Customer id cannot change' using errcode = '22023'; end if;
    new.created_at := old.created_at;
    new.source     := old.source;
    new.updated_at := clock_timestamp();
    new.updated_by := coalesce(auth.jwt() ->> 'email', old.updated_by);
  end if;
  return new;
end $$;
create trigger customers_before_write before insert or update on public.customers
  for each row execute function private.customers_before_write();

create or replace function private.call_log_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.at > private.ist_today() + 1 then
    raise exception 'Note date cannot be in the future' using errcode = '22023';
  end if;
  new.created_at := now();
  new.created_by := coalesce(auth.jwt() ->> 'email', 'seed');
  return new;
end $$;
create trigger call_log_before_insert before insert on public.call_log
  for each row execute function private.call_log_before_insert();

create or replace function private.is_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.allowed_users a
                 where a.email = lower(coalesce(auth.jwt() ->> 'email', '')))
     and exists (select 1 from auth.users u
                 where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;
revoke all on function private.is_allowed() from public, anon;
grant execute on function private.is_allowed() to authenticated;
revoke all on function private.ist_today() from public, anon;
grant execute on function private.ist_today() to authenticated;

create or replace function public.am_i_allowed() returns boolean
language sql stable security invoker set search_path = '' as $$ select private.is_allowed() $$;

create or replace function public.mark_done(
  p_log_id uuid, p_customer_id text, p_at date, p_type text, p_note text, p_next date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_today date := private.ist_today();
  v_prev  date;
  v_cust  public.customers;
  v_log   public.call_log;
begin
  if p_next is not null and p_next < v_today then
    raise exception 'Next follow-up cannot be in the past' using errcode = '22023';
  end if;
  select follow_up into v_prev from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  insert into public.call_log (id, customer_id, at, type, note, done_follow_up, next_follow_up)
  values (p_log_id, p_customer_id, coalesce(p_at, v_today), p_type, coalesce(p_note, ''), v_prev, p_next)
  on conflict (id) do nothing
  returning * into v_log;
  if v_log.id is not null then
    update public.customers set follow_up = p_next where id = p_customer_id returning * into v_cust;
  else                                               -- replay of an op that already landed
    select * into v_log  from public.call_log  where id = p_log_id;
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
grant insert (id, name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed)
  on public.customers to authenticated;
grant update (name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed)
  on public.customers to authenticated;
grant select on public.call_log to authenticated;
grant insert (id, customer_id, at, type, note, done_follow_up, next_follow_up)
  on public.call_log to authenticated;

alter table public.allowed_users enable row level security;     -- no policies on purpose
alter table public.customers     enable row level security;
alter table public.call_log      enable row level security;
create policy customers_select on public.customers for select to authenticated
  using ((select private.is_allowed()));
create policy customers_insert on public.customers for insert to authenticated
  with check ((select private.is_allowed()));
create policy customers_update on public.customers for update to authenticated
  using ((select private.is_allowed())) with check ((select private.is_allowed()));
create policy customers_delete on public.customers for delete to authenticated
  using ((select private.is_allowed()) and source = 'manual');
create policy call_log_select on public.call_log for select to authenticated
  using ((select private.is_allowed()));
create policy call_log_insert on public.call_log for insert to authenticated
  with check ((select private.is_allowed()));

-- The one view the future Telegram reminder (11:00 IST = 05:30 UTC) reads:
create view public.v_followups_due with (security_invoker = true) as
select c.id, c.name, c.contact, c.phone, c.city, c.status, c.follow_up,
       private.ist_today() - c.follow_up                                   as days_overdue,
       case when c.follow_up < private.ist_today() then 'overdue' else 'today' end as bucket,
       (select max(l.at) from public.call_log l where l.customer_id = c.id) as last_contacted
from public.customers c
where c.follow_up is not null and c.follow_up <= private.ist_today()
order by c.follow_up, c.name;
revoke all on public.v_followups_due from public, anon, authenticated;
grant select on public.v_followups_due to service_role;
```
Notes:
- `(select private.is_allowed())` is evaluated once per statement.
- `service_role` bypasses RLS and is only for the future server function. Its key is never in git, `config.js` or chat.
- The Advisor shows one expected INFO ("RLS enabled, no policy" on `allowed_users`). Any WARN or ERROR must be fixed.

Seed (stage B):
- `node scripts/make-seed.js customers.json > supabase/.generated/seed.sql` (gitignored).
- One transaction of `INSERT ... ON CONFLICT (id) DO NOTHING`, `source='seed'`, `'` doubled, empty dates -> `NULL`.
- It uses `require("../store.js").slug`.
- Seed from the freshest data: the user clicks "Download customers.json" on the stage A page first and hands it over.

---

## 3. Security

### 3.1 Stage A
- There is no backend, no keys and no login. Data stays in the user's browser.
- The public page code holds nothing secret.
- Rules that still apply:
  - `textContent` only. A test greps for `innerHTML`.
  - The `customers.json` export has exactly these keys: `id,name,contact,contactFrom,city,state,phone,last,followUp,status,disputed`. No notes.
  - The backup and CSV files are gitignored: `.gitignore` gets `varsha-crm-backup-*.json`, `varsha-crm-*.csv`, `supabase/.generated/`, `.env*`, `node_modules/` (A1 creates it).
- CSP meta tag, stage A:
  ```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'">
  ```
  Bar widths are set with `el.style.width = ...` (CSSOM). CSP does not block that.
- Known exposure that already exists: the committed `customers.json` (company names, 10 contact names, 42 phones) is public. See Open Question 1.

### 3.2 Stage B: who can do what

| Caller | Can | Cannot |
|---|---|---|
| anon (public key only) | Auth endpoints: sign in (rate limited); reset (only if enabled) | Sign up (off). Any table, view or RPC (revoked: 401/42501). See `allowed_users` |
| Signed in, not allowlisted | Sign in; `am_i_allowed()` = false, so the page shows "not allowed" | See rows (0), insert (42501), update or delete (0 rows), `mark_done` ("Customer not found") |
| Allowed + confirmed | Read all; add, edit and remove hand-added customers; add log entries; mark done | Change `id`, `source`, `created_at`, `updated_*`; delete seed rows; edit or delete log entries; read `allowed_users` or the view |
| service_role (future server only) | Everything; reads `v_followups_due` | Never in the browser or git |

### 3.3 Stage B dashboard settings (the lead does these)
1. New project: free plan, **ap-south-1**, strong DB password kept in a password manager.
2. Auth -> Providers -> Email: on. **Allow new users to sign up: OFF.** **Confirm email: ON.** Secure password change on. Minimum password length 12, with lower, upper and digits.
3. Turn off phone, anonymous and all OAuth providers.
4. Auth -> URL Configuration: Site URL `https://erpvarsha-star.github.io/vfpl-crm/`. Redirects: that URL plus `http://localhost:8080/**`.
5. Auth -> Users -> Add user -> Create new user: `<ALLOWED_EMAIL>`, strong password, **Auto Confirm**. Then run `insert into public.allowed_users (email, note) values (lower('<ALLOWED_EMAIL>'), 'owner');`. Create the user first, then the allowlist row.
6. Rate limits: keep the defaults (per-IP sign-in limits; built-in SMTP is about 2 emails per hour). CAPTCHA (Turnstile, free) later, if needed.
7. Extensions: turn `pg_graphql` **off**. Exposed schemas: `public` only. Max rows stays 1000 (the store pages).
8. Key: the publishable key (`sb_publishable_...`), or the legacy anon JWT if the pinned supabase-js has trouble with it.
   Emergency lock: `revoke all on public.customers, public.call_log from authenticated;`. Never disable RLS.

### 3.4 Stage B browser additions
- CSP widens to `script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://*.supabase.co wss://*.supabase.co`.
- `@supabase/supabase-js@2.49.4` UMD, loaded dynamically by `store.js` only when configured, with `integrity` (SRI sha384, computed by B2 with `curl -sL URL | openssl dgst -sha384 -binary | openssl base64 -A`) and `crossOrigin="anonymous"`. Plan B: vendor the file.
- `createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "varsha-crm-auth" } })`.
- A smoke guard: `config.js` has no `sb_secret_` or `service_role`, and any JWT in it decodes to `role: "anon"`.

---

## 4. Client design

### 4.1 Files and load order (stage A)

```html
<head> ...
  <link rel="icon" type="image/png" sizes="64x64" href="assets/favicon-64.png">
  <link rel="stylesheet" href="dashboard.css?v=2">
  <link rel="stylesheet" href="export.css?v=2">
</head>
<body> ...
  <script src="store.js?v=2" defer></script>
  <script src="export.js?v=2" defer></script>
  <script src="dashboard.js?v=2" defer></script>
  <script src="app.js?v=2" defer></script>   <!-- last: mounts the panels -->
</body>
```
`?v=` defeats GitHub Pages caching; bump it on every release. Stage B adds `<script src="config.js?v=N" defer>` before `store.js`.

### 4.2 `store.js`: public API (exact; the same in both stages)

Every write:
1. validates and resolves `{ok:false, error, field}` with no change if invalid;
2. applies the change and fires `onChange("local")` synchronously;
3. persists (stage A: localdb; stage B: saves the queue op, then sends);
4. resolves `{ok:true, queued:false}` in stage A.

```js
window.Store = {
  init(): Promise<{ mode: "local"|"supabase", user: {email:string}|null }>,  // stage A: {mode:"local", user:null}
  load(): Promise<{ ok: boolean, error?: string }>,   // seed + migrate (§2.3, §2.4), then onChange("load")
  status(): { mode, pending: number, storageOK: boolean, loadError: string },
  onChange(cb: (reason: "load"|"local"|"server"|"queue"|"conflict"|"error"|"notice"|"auth", detail?) => void): void,

  // pure helpers (also exported to Node)
  todayISO(): string, addDays(iso, n): string, dayNum(iso): number,
  fuKind(c, today): "overdue"|"today"|"week"|"later"|"none",        // moved from Phase 1 code
  fuText(c, today): string,                                          // "Overdue by 3 days" / "Due today" / ...
  lastBucket(c, refISO): "0-30"|"31-60"|"61-90"|"91+"|"never",       // days from c.last to refISO
  slug(name, isTaken?): string,
  validate(kind: "customer"|"log"|"done", f, selfId?): { ok: boolean, errors: {[field]: string} },

  // reads (synchronous)
  customers(): Customer[], get(id): Customer|undefined,
  listLog(id): LogEntry[],             // newest first: at desc, createdAt desc, id desc
  allLog(): LogEntry[],                // every entry, newest first (Dashboard activity)
  logCount(id): number,
  lastContacted(id): string,           // newest `at` among CONTACT_TYPES, or ""
  latestOrder(): string,               // max(last) over all customers ("2026-07-12" today)

  // writes
  addCustomer(f: {name, contact?, phone?, city?, last?, followUp?, status?}): Promise<Result & {id?}>,
  saveCustomer(id, f: {name, contact, phone, city, last}): Promise<Result>,   // P2-C
  setStatus(id, status): Promise<Result>,
  setFollowUp(id, isoOrEmpty): Promise<Result>,
  removeCustomer(id): Promise<Result>,                 // only added === true
  addLog(id, e: {at?, type, note}): Promise<Result & {entry?}>,
  markDone(id, d: {type, note?, next?}): Promise<Result & {entry?}>,
  pending(): number, flush(): Promise<void>,           // stage A: 0 / no-op

  // auth (stage A stubs: current() -> {email:null, local:true}; others resolve {ok:true})
  auth: { current(), signIn(email, pw), signOut(opts?), sendReset(email), setPassword(pw), onEvent(cb) },
  isAllowed(): Promise<boolean>,                       // stage A: true

  // export payloads
  exportCustomersJson(): { note: string, customers: object[] },   // all customers, exact keys §3.1, no notes
  exportBackup(): { format: "varsha-crm-backup-v1", exportedAt: string, note: string,
                    customers: object[], callLog: object[] }
};
// Result = { ok: true, queued: boolean } | { ok: false, error: string, field?: string }
// CONTACT_TYPES = ["Call","Visit","Email","Telegram","Note"]  (constant at the top of store.js; Open Question 2)
```

Validation (same messages everywhere):

| Field | Rule | Message |
|---|---|---|
| name | trimmed, 1–120 chars | "Enter the customer name." |
| name | unique, case-insensitive, ignoring `selfId` | "<name> is already in the list." |
| contact | ≤ 80 | |
| city | ≤ 60 | |
| phone | ≤ 30 and `/^[0-9+()\-\s.\/–]*$/` | "Phone can only have digits, spaces and + ( ) - /" |
| last, followUp | `''` or ISO | |
| at | ISO and ≤ IST today | "Date cannot be in the future." |
| next | `''` or ≥ IST today | "Next follow-up cannot be in the past." |
| note | ≤ 500; required for `addLog`, optional for `markDone` | "Write a note." |
| status / type | in their lists | |

`saveCustomer` sets `contactFrom = ""` when `contact` changes.

Storage blocked (stage A): localdb writes fail. Keep data in memory and show `#storageWarn` with the Phase 1 text: "This browser is blocking saved changes ... Use the Export tab to keep them."

No `console.error` anywhere, because the smoke test fails on console errors. Use `console.warn`.

### 4.3 `window.App`: the contract between panels (created in `app.js` by A1)

```js
window.App = {
  goTo(tab: "dash"|"list"|"export"): void,             // switches tab, saves the view, moves focus to the panel heading
  applyFilter(f: { view?, filter?, q?, extra? }): void, // RESETS view/filter/q/extra to defaults, applies f, goTo("list")
  visibleCustomers(): Customer[],                       // the Customers tab list, filtered and sorted
  viewSummary(): string,                                // "Follow-ups: Overdue · Status: All · Search: none · Last order 91+ days"
  openDone(id): void, openNotes(id): void, openEdit(id): void,   // A1 stubs (no-op + console.warn); A2 implements
  download(filename: string, text: string, mime: string): void,  // Blob + <a download>, as Phase 1
  onRender(cb: () => void): void,                       // called after every Store change render
  fmtDate(iso): string,                                 // "12 Oct 2026" (en-IN, as Phase 1)
  today(): string                                       // IST today
};
```
Mounting, in `app.js` boot:
- `if (window.CrmDash) CrmDash.mount($("panel-dash"), App, Store); else` show the placeholder.
- The same for `CrmExportUI` with `#panel-export`.
- `app.js` binds the placeholder `#export` and `#backup` buttons **only when `!window.CrmExportUI`**. This prevents double handlers.

### 4.4 Customers tab: the new "extra" filter (A1, in `app.js`)

The Dashboard needs filters Phase 1 does not have. `state.extra` is `null` or one of:

| `extra` | Matches | Chip label |
|---|---|---|
| `{kind:"last", value:"0-30"\|"31-60"\|"61-90"\|"91+"\|"never", ref:"YYYY-MM-DD"}` | `Store.lastBucket(c, ref) === value` | "Last order 61–90 days ago" / "No order on record" |
| `{kind:"state", value:"Maharashtra"}` (`""` = not known) | `c.state === value` | "State: Maharashtra" / "State: not known" |
| `{kind:"disputed"}` | `c.disputed` | "Disputed" |
| `{kind:"contact", value:"7d"\|"30d"\|"stale30"}` | `lastContacted` within 0–6 days / 0–29 days / empty or ≥ 30 days ago | "Contacted in the last 7 days" / "... 30 days" / "Not contacted in 30+ days" |
| `{kind:"due", value:"YYYY-MM-DD"}` | `c.followUp === value` | "Follow-up on Wed 21 Oct" |

- It shows as a removable chip in a third `.bar` row: `<div class="bar" id="extraBar" hidden><span class="bar-label">Also</span><span class="chip on" id="extraChip"></span><button class="clr" id="extraClear" aria-label="Clear this filter">×</button></div>`.
- It is saved in `varsha-crm-view-v1` and validated on load (unknown kinds are dropped).
- The foot line includes it: "Showing 9 of 42 customers."

View key additions: `tab` ("dash" default | "list" | "export"), `extra`, `exportScope` ("shown" default | "all"), `dashFrom` ("today" default | "data").

### 4.5 Stage B additions (B2 owns; summary, details kept for later)

- **SupabaseBackend**: same backend interface as LocalBackend.
  - `fetchAll` pages with `range(i, i+999)`.
  - `insertCustomer` and `insertLog` use `upsert(..., {onConflict:"id", ignoreDuplicates:true})`.
  - `patchCustomer(id, patch, base)` uses `.update(patch).eq("id", id).lte("updated_at", base).select()`; 0 rows means a conflict.
  - `markDone` uses `rpc("mark_done")`; `isAllowed` uses `rpc("am_i_allowed")`.
- Errors are normalized to `{kind: "network"|"auth"|"denied"|"invalid"}`.
- **Queue** `varsha-crm-queue-v1`: every write is saved before it is sent, and the queue is flushed serially.
  - Network errors keep the op and show the banner "N changes not saved to the database yet ..." with Retry. Retries happen on `online`, on visibility, and every 30 s.
  - Auth errors show sign-in and keep the queue.
  - Invalid or denied errors drop the op, revert, and show an error banner.
- **LWW**: a patch is conditional on the `updated_at` seen when it was edited.
  - On conflict: if the op's client time is later than the server `updated_at`, re-send it unconditionally; otherwise keep the server value and show the notice "A newer change from another device was kept for <name>".
  - After our own success, later queued ops for that row get their base rewritten.
- **Cache** `varsha-crm-cache-v1` `{email, at, customers, log}`: render instantly and work offline. Cleared on sign-out.
- **Auth screens**: sign in; denied; set new password after recovery. Forgot password only if `allowPasswordReset`. **No sign-up screen** (admins add users). The logo appears on the login card. Sign-out warns if anything is pending.
- **Tests in stage B** use `LocalBackend` with `window.CRM_TEST = { fakeAuth, deniedUser }` and a `__crmFake.setOffline()` hook. No network.

---

## 5. UI specs

### 5.1 Header and logo

- `assets/varsha-logo.jpg`: the user's file (200×200 JPEG, white background), committed as is. **A1** copies it from the path the lead gives (it is in the session scratchpad `.../images/1.jpg` now).
- **Header:** left of the "Varsha Forgings / Varsha CRM / date" block, a white rounded badge (the dark-grey wordmark is unreadable on navy):
  ```html
  <div class="brand">
    <span class="logo-badge"><img src="assets/varsha-logo.jpg" alt="Varsha Forgings" width="64" height="64"></span>
    <div> company / h1 / date (existing) </div>
  </div>
  ```
  ```css
  .brand { display: flex; align-items: center; gap: 16px; }
  .logo-badge { flex: none; background: #fff; border-radius: 16px; padding: 6px; box-shadow: 0 6px 18px rgba(0,0,0,.25); line-height: 0; }
  .logo-badge img { width: 64px; height: 64px; object-fit: contain; display: block; }
  @media (max-width: 860px) { .logo-badge img { width: 44px; height: 44px; } .logo-badge { border-radius: 12px; padding: 4px; } }
  ```
- **Favicon:** `assets/favicon-64.png`, the circle only, with a transparent background. **A1 makes it** with Pillow (12.x is installed):
  ```
  python3 -I - <<'EOF'
  from PIL import Image, ImageDraw
  src = Image.open("assets/varsha-logo.jpg").convert("RGB")
  w, h = src.size
  pts = [(x, y) for y in range(int(h * .75)) for x in range(w) if min(src.getpixel((x, y))) < 200]
  x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts); y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
  s = max(x1 - x0, y1 - y0) + 2; cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
  crop = src.crop((cx - s // 2, cy - s // 2, cx - s // 2 + s, cy - s // 2 + s)).resize((256, 256), Image.LANCZOS).convert("RGBA")
  mask = Image.new("L", (256, 256), 0); ImageDraw.Draw(mask).ellipse((2, 2, 253, 253), fill=255)
  crop.putalpha(mask); crop.resize((64, 64), Image.LANCZOS).save("assets/favicon-64.png")
  EOF
  ```
  In the current file the circle's bounding box is about x 43–165, y 23–145. The wordmark starts at y 156 and the top 75% cut excludes it. A1 opens the PNG and confirms it is the circle with the V.
- **Login card (stage B):** the logo at 72px above "Varsha CRM".
- **Dashboard print header:** see §5.8.

### 5.2 Tabs

```html
<nav class="tabs no-print" role="tablist" aria-label="Sections">
  <button role="tab" id="tab-dash"   aria-controls="panel-dash"   aria-selected="true">Dashboard</button>
  <button role="tab" id="tab-list"   aria-controls="panel-list"   aria-selected="false" tabindex="-1">Customers</button>
  <button role="tab" id="tab-export" aria-controls="panel-export" aria-selected="false" tabindex="-1">Export</button>
</nav>
<!-- banners #storageWarn, #syncErr, #notice, #unsaved sit here, above the panels -->
<section id="panel-dash"   role="tabpanel" aria-labelledby="tab-dash"></section>
<section id="panel-list"   role="tabpanel" aria-labelledby="tab-list" hidden> existing filters, rule, table, foot </section>
<section id="panel-export" role="tabpanel" aria-labelledby="tab-export" hidden> placeholder: #export, #backup buttons </section>
```
- Default is Dashboard. The tab is saved in the view key and survives refresh.
- Keys: Left/Right/Home/End move between tabs (roving tabindex). Enter/Space is native.
- Style: tabs sit on the paper background below the header, with a 3px orange underline on the selected tab, navy text, and `--ink-dim` for the others. Each tab has a minimum height of 44px. At ≤ 860px each tab is `flex: 1`.
- "+ Add customer" stays in the header on every tab. After saving it goes to the Customers tab (as in Phase 1, filters reset).
- The Phase 1 `#unsaved` banner ("N changes saved in this browser only" + Download) is **removed**. It is replaced by the always-visible Export tab and a one-line foot note on the Customers tab: "Changes are saved in this browser. Use the Export tab to share or back them up." In stage B `#unsaved` returns as the pending-queue banner.

### 5.3 Customers tab additions (row level)

- **Last contacted:** under the name inside `td.name`: `<div class="lc">Last contacted 12 Oct 2026 · 7 days ago</div>`, or "Last contacted today" / "... yesterday". With none: "No contact logged yet". `--ink-dim`, `.8rem`, never coloured. It shows in the 375px card too.
- **Actions** `td.act > .acts`, in order:
  - `button.btn-sm.done-btn` "✓ Done": only if `followUp` is set. `aria-label="Mark follow-up done for <name>"`, `aria-haspopup="dialog"`.
  - `button.btn-sm.notes-btn` "Notes" + `<span class="badge">3</span>` (badge only when > 0). `aria-label="Notes for <name>, 3 entries"`, or "no entries".
  - `button.btn-sm.edit-btn` "Edit": `aria-label="Edit <name>"`.
  - `.rm` × for hand-added rows only. Confirm: "Remove <name> from the list? Its N notes will be deleted too."
- `<tr data-id="<id>">`. The actions `<th>` holds `<span class="sr">Actions</span>`, with a `.sr` visually-hidden class.
- CSS:
  ```css
  .acts { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .btn-sm { font: inherit; font-size: .85rem; font-weight: 700; padding: 6px 10px; min-height: 36px; border-radius: 8px;
            border: 1.5px solid var(--line); background: #fff; color: var(--navy); cursor: pointer; white-space: nowrap; }
  .btn-sm:hover { border-color: var(--navy); }
  .btn-sm:focus-visible { outline: 3px solid var(--orange); outline-offset: 2px; }
  .badge { display: inline-block; min-width: 20px; margin-left: 6px; padding: 1px 6px; border-radius: 999px;
           background: var(--navy); color: #fff; font-size: .75rem; text-align: center; }
  .lc { font-size: .8rem; font-weight: 500; color: var(--ink-dim); margin-top: 3px; }
  @media (max-width: 860px) { td.act, .acts { justify-content: flex-start; } .btn-sm { min-height: 40px; padding: 8px 12px; } }
  ```

### 5.4 Done dialog (P2-A)

```html
<dialog id="doneDlg" aria-labelledby="doneTitle" aria-describedby="doneDue">
  <div class="dlg-head" id="doneTitle">Mark follow-up done</div>
  <form id="doneForm" method="dialog" novalidate>
    <p class="dlg-sub"><b id="doneName"></b> <span id="doneDue"></span></p>  <!-- "Follow-up was 16 Oct 2026 · Overdue by 3 days" -->
    <label>How did you follow up?
      <select name="type"><option selected>Call</option><option>Visit</option><option>Email</option><option>Telegram</option><option>Note</option></select></label>
    <label>Outcome note (optional) <textarea name="note" maxlength="500" rows="3"></textarea>
      <span class="count" id="doneCount">0/500</span></label>
    <label>Next follow-up (optional) <input name="next" type="date"></label>   <!-- min = IST today -->
    <div class="quick" role="group" aria-label="Quick next dates">
      <button type="button" class="btn-sm" data-days="7">In 1 week</button>
      <button type="button" class="btn-sm" data-days="14">In 2 weeks</button>
      <button type="button" class="btn-sm" data-days="30">In 1 month</button></div>
    <p class="note">Leave the date empty to clear the follow-up. Status does not change.</p>
    <p class="err" id="doneErr" role="alert" hidden></p>
    <div class="actions"><button class="btn" type="button" id="doneCancel">Cancel</button>
      <button class="btn primary" type="submit">Save</button></div>
  </form>
</dialog>
```
- Save calls `Store.markDone(id, {type, note, next})` and closes the dialog. The row now shows the new follow-up (or none), the badge +1 and "Last contacted today".
- The `#live` region (`aria-live="polite"`, visually hidden) says "Marked done. Next follow-up 26 Oct 2026." or "Marked done. No follow-up set."
- Status never changes (rule 6).
- A past `next` shows `#doneErr` and nothing is saved. Esc or Cancel closes without saving.
- It works the same when opened from the Dashboard.

### 5.5 Notes drawer (P2-B)

```html
<dialog id="notesDlg" class="drawer" aria-labelledby="notesTitle">
  <div class="dlg-head drawer-head"><span id="notesTitle">Notes</span>
    <button class="x" type="button" id="notesClose" aria-label="Close notes">×</button></div>
  <div class="drawer-body">
    <p class="dlg-sub" id="notesSub"></p>                 <!-- "<name> · Last contacted 12 Oct 2026 · 3 entries" -->
    <form id="noteForm" novalidate>
      <div class="two">
        <label>Type <select name="type"><option>Call</option><option>Visit</option><option>Email</option><option>Telegram</option><option selected>Note</option></select></label>
        <label>Date <input name="at" type="date"></label></div>   <!-- value = max = IST today -->
      <label>Note <textarea name="note" maxlength="500" rows="3" required></textarea>
        <span class="count" id="noteCount">0/500</span></label>
      <p class="err" id="noteErr" role="alert" hidden></p>
      <div class="actions"><button class="btn primary" type="submit">Save note</button></div>
    </form>
    <h3 class="hist-h">History</h3>
    <ol class="log" id="notesList" aria-label="Notes history, newest first"></ol>
    <p class="muted" id="notesEmpty">No notes yet.</p>
  </div>
</dialog>
```
- Each `<li>` is built with `textContent`:
  `<div class="log-meta"><time datetime="…">12 Oct 2026</time> · <span class="log-type">Call</span> [<span class="tag-done">Follow-up done</span>]</div><p class="log-text"></p>[<div class="log-next">Next follow-up: 26 Oct 2026</div>]`.
  `.log-text { white-space: pre-wrap; overflow-wrap: anywhere; }`.
- After a save: the form resets (type kept, date back to today), the entry appears at the top, the badge and Last contacted update, and focus returns to the textarea. The drawer re-renders on `Store.onChange` while open.
- CSS. Watch out: `display` on a `<dialog>` shows it even when closed, so style only `[open]`:
  ```css
  dialog.drawer { margin: 0 0 0 auto; width: min(440px, 100vw); height: 100dvh; max-height: 100dvh; border-radius: 0; }
  dialog.drawer[open] { display: flex; flex-direction: column; }
  .drawer-head { display: flex; justify-content: space-between; align-items: center; }
  .drawer-body { flex: 1; overflow-y: auto; padding: 16px 20px 24px; display: grid; gap: 14px; align-content: start; }
  .drawer form { padding: 0; }
  textarea { width: 100%; min-width: 0; font: inherit; font-size: 1rem; padding: 10px 12px; border: 1.5px solid var(--line);
             border-radius: 10px; color: var(--ink); background: #fff; resize: vertical; }
  @media (max-width: 860px) { dialog.drawer { width: 100vw; } }
  ```

### 5.6 Edit dialog (P2-C): reuses `#dlg`

- `#dlg[data-mode="add"|"edit"]`. Edit mode:
  - title "Edit customer";
  - the follow-up/status row `<div class="two" id="addOnly">` is hidden;
  - submit button "Save changes";
  - fields are prefilled with `.value`.
- Saving calls `Store.saveCustomer(id, {name, contact, phone, city, last})`.
- Errors show in `<p class="err" id="formErr" role="alert">` and the dialog stays open. **This replaces Phase 1's `alert()` in add mode too.**
- The id never changes, so the follow-up, status and notes stay attached.
- Use `form.elements.name`, not `form.name`.

### 5.7 Dialog keyboard and focus (all dialogs)

- `showModal()`. Esc closes.
- Focus on open: Done -> type select; Notes -> textarea; Edit -> name.
- On close, focus returns to the opener. Rows are rebuilt on render, so remember `{panel, id, cls}` and refocus `[data-id="<id>"] .<cls>` in that panel after render.
- Ctrl/Cmd+Enter submits from a textarea. Errors use `role="alert"`. Counters turn `--warn` at 450 or more characters.

### 5.8 Dashboard tab (P2-F), rendered by `dashboard.js` into `#panel-dash`

**Data:** `Store.customers()`, `Store.allLog()`, `Store.lastContacted()`, `Store.fuKind()`, `Store.lastBucket()`, IST today. Nothing else. **Money is out of scope** for stage A: outstanding and overdue amounts from the Collections sheet would need the private database. That is a stage B+ idea and is never committed to git (CLAUDE.md rule 1).

**Pure compute** (unit-tested):
```js
window.CrmDash = {
  compute(customers, log, today, opts /* {from:"today"|"data", latestOrder, lastContacted(id)} */): {
    total, status: {Active, "Follow up", "At risk"},
    fu: {overdue, today, week, none, later},
    disputed,
    attention: [{id, name, contact, phone, followUp, kind:"overdue"|"today", days}], // overdue by followUp asc (oldest first), then name; then today by name
    upcoming: [{date, label /* "Tomorrow · Tue 20 Oct" */, items:[{id, name}]}],    // today+1 .. today+7, empty days omitted
    lastOrder: {"0-30", "31-60", "61-90", "91+", never, ref},                       // ref = today or latestOrder
    byState: [{state /* "" = not known */, n}],                                     // n desc, then name; "" last
    contact: {d7, d30, stale30},                                                    // counts of CUSTOMERS
    recent: [{entryId, customerId, name, at, type, done:boolean, snippet /* first 80 chars */}] // newest 10
  },
  mount(panelEl, App, Store): void      // builds DOM with createElement/textContent; re-renders on App.onRender
};
```

**Layout**, top to bottom. Every card is a `<section class="dcard" aria-labelledby>` with an `<h2>`.

1. **Head row:** `<h2 class="sr">Dashboard</h2>`, plus "As of Monday, 19 October 2026 (India time)" and a `#printBtn` "Print / Save as PDF" (`no-print`).

2. **KPI tiles** (`.tiles`, CSS grid `repeat(auto-fit, minmax(150px, 1fr))`; at 375px, 2 per row). Each tile is a `<button class="tile" data-k="…">` containing a big number, a label and a short sub-line. `aria-label` = "<label>: <n> customers. Show them."

   | Tile | Number | Click -> `App.applyFilter(...)` | Style |
   |---|---|---|---|
   | Total customers | total | `{}` | navy |
   | Active | status.Active | `{filter:"Active"}` | green text label "Active" |
   | Follow up | status["Follow up"] | `{filter:"Follow up"}` | orange label |
   | At risk | status["At risk"] | `{filter:"At risk"}` | red label |
   | Overdue | fu.overdue | `{view:"overdue"}` | red border + sub "Needs a call now" (text, not just colour); grey "None overdue" when 0 |
   | Due today | fu.today | `{view:"today"}` | orange border + "Due today" |
   | Next 7 days | fu.week | `{view:"week"}` | navy |
   | No follow-up set | fu.none | `{view:"none"}` | navy |
   | Disputed | disputed | `{extra:{kind:"disputed"}}` | navy, with the existing red "Disputed" tag style |

3. **Attention now** (left column on desktop, `grid-column: span 7`):
   - Ordered list of `attention`, first 10. Each `<li>`:
     - name (button -> `App.openNotes(id)`);
     - `<span class="rel over">Overdue by N days</span>` (red + text) or `<span class="rel today">Due today</span>` (orange);
     - contact, and phone as a `tel:` link;
     - "Last contacted …";
     - buttons `✓ Done` (-> `App.openDone(id)`) and `Notes 3` (-> `App.openNotes(id)`).
   - Footer buttons: "Show all overdue (N)" -> `{view:"overdue"}` and "Show all due today (M)" -> `{view:"today"}`.
   - Empty: "Nothing overdue or due today."

4. **Next 7 days** (right column, `span 5`):
   - Day groups from `upcoming`.
   - Each group header is a button "Tomorrow · Tue 20 Oct (2)" -> `{extra:{kind:"due", value:date}}`.
   - Names are buttons -> `App.openNotes(id)`.
   - Footer: "Show all next 7 days (N)" -> `{view:"week"}`.
   - Empty: "No follow-ups in the next 7 days."

5. **Status mix:**
   - One stacked CSS bar (`.stack`, height 18px, rounded) with 3 segments, `style.width = pct + "%"`, colours `--ok`, `--warn`, `--risk`. The segments are `aria-hidden`.
   - Below it a legend of 3 buttons: "Active 20 (48%)" etc., each -> `{filter: …}`.
   - The text carries the meaning (rule 7).

6. **Last order recency:**
   - A toggle `role="radiogroup"` "Count days from: [Today] [Latest order in the data (12 Jul 2026)]". The choice persists as `dashFrom`.
   - 5 bar rows (`.hbar` buttons): "0–30 days", "31–60", "61–90", "91+ days", "No order on record". Each shows a navy fill bar scaled to the largest bucket, plus the count. Click -> `{extra:{kind:"last", value, ref}}`.
   - Note under it, in `--ink-dim`: "Last order dates come from the Collections sheet, which stops at 12 Jul 2026, so counting from today puts most customers in 91+." The date comes from `Store.latestOrder()`, not hard-coded.

7. **Customers by state:**
   - Bar rows for `byState` (navy fill, count). "Not known" goes last, in grey italic.
   - Click -> `{extra:{kind:"state", value}}`.
   - Note: "State comes from the GST number."
   - Rows show at most 8 plus a "Show all states" toggle (a local, not persisted UI state).

8. **Activity (call log):**
   - Three tiles (buttons): "Contacted in last 7 days: N" -> `{extra:{kind:"contact", value:"7d"}}`, "Last 30 days: N" -> `"30d"`, "Not contacted in 30+ days: N" -> `"stale30"`. All three count **customers**, so they match the filtered rows.
   - Under them, "Recent activity": the newest 10 entries. Each shows date · type · customer (button -> `App.openNotes`) · "Follow-up done" tag · snippet (`textContent`, max 80 chars + "…").
   - **Empty state (no log entries at all):** the card body is replaced by "No calls or notes logged yet. When you finish a follow-up, press ✓ Done on the customer; use Notes to record any call or visit." plus a button "Go to Attention now" (scrolls and focuses the Attention card). The three tiles still show (0, 0, total).

9. **Quick export** (`no-print`): "Download Attention list (CSV)" uses `CrmExport.table` on the attention customers; if export.js is absent, the button is hidden. "Open the Export tab" -> `App.goTo("export")`.

**Grid:** desktop `.dgrid { display: grid; grid-template-columns: repeat(12, minmax(0,1fr)); gap: 16px; }`. Cards 3–4 are `span 7` / `span 5`; 5–7 are `span 4` each; 8 is `span 12`. At ≤ 860px everything is `span 12`, one column. Cards are white, with the `--line` border and radius 14px (same as `.card`). Every `.hbar` is a button with `min-height: 40px`.

**Bars:** `.hbar { display:grid; grid-template-columns: minmax(90px, 32%) 1fr auto; gap:10px; align-items:center }`, track `--line`, fill `--navy`, with `style.width` set via the CSSOM.

**Refresh:** the dashboard re-renders on every Store change (via `App.onRender`) and on tab show. IST today is recomputed at each render.

**Print** (`dashboard.css`, `@media print`):
- `header, nav.tabs, .no-print, #panel-list, #panel-export, dialog, .banner { display: none !important; }` and `#panel-dash { display: block !important; }`.
- Print shows the dashboard even when another tab is active. `#printBtn` calls `App.goTo("dash")` and then `window.print()`.
- `#printHead` (hidden on screen) shows the logo at 48px plus "Varsha Forgings · CRM dashboard · 19 Oct 2026 (India time)".
- Cards: `break-inside: avoid`. Tiles in 3 columns.
- `* { print-color-adjust: exact; -webkit-print-color-adjust: exact; }` keeps the red and orange; the text still says Overdue / Due today.
- Recent-activity note snippets are **hidden in print** (`.snippet { display:none }`), because notes are sensitive.
- Buttons print as plain text (`border:0; background:none`).

### 5.9 Export tab (P2-E), rendered by `export.js` into `#panel-export`

1. **Scope**: `<fieldset><legend>Which customers</legend>`, with radios:
   - `shown`: "Customers in the Customers tab now (N), with your current filters and search". This is the default.
   - `all`: "All customers (M)".
   It persists as `exportScope`. A live line under it shows `App.viewSummary()`.
2. `<label><input type="checkbox" id="incNotes"> Include notes text (private: only tick this if the file stays with you)</label>`. It is unticked on every load and **never remembered** (deliberate privacy exception). It affects CSV and Copy only.
3. Cards, each with a title, one line of text and a button:
   - **Download CSV** `#csvBtn`: "Opens in Google Sheets (File > Import > Upload) or Excel."
   - **Copy for Google Sheets** `#copyBtn`: "Copies the rows. Click cell A1 in your sheet and press Ctrl+V."
   - **Download customers.json** `#export`: "All customers, no notes. Safe to commit to git as the backup."
   - **Download backup (with notes)** `#backup`: "Everything, including private notes. Keep it safe; never commit it."
   - **Send to Google Sheet automatically** `#autoBtn` `disabled`, plus a "Coming next" tag: "Will update a separate Google Sheet every day. It will not touch the Collections Engine sheet."
4. `<p id="exportMsg" role="status">`: "Downloaded 12 customers." / "Copied 12 rows. Click cell A1 in your sheet and press Ctrl+V."
5. Fallback (hidden): `<div id="copyFallback" hidden><p>Your browser blocked copying. Select all the text below and copy it (Ctrl+C, or long-press then Copy).</p><textarea id="copyBox" readonly rows="8"></textarea></div>`.

Builders (also `module.exports` for Node):
```js
window.CrmExport = {
  COLUMNS: ["Customer", "Contact person", "Phone", "City", "Last order", "Follow-up", "Status", "Last contacted", "Notes count"],
  table(rows, store, opts /* {includeNotes} */): string[][],  // header first; adds "Notes" only if includeNotes
  toCSV(table): string,      // "﻿" + RFC 4180: every field quoted, " doubled, "\r\n" rows + trailing "\r\n"
  toTSV(table): string,      // \t \r \n inside values -> " "; rows joined by "\n"
  safeCell(v): string,       // /^[=+\-@\t\r]/ -> prefix "'" (formula-injection guard)
  fileName(scope, today): string   // "varsha-crm-customers-2026-10-19.csv" | "varsha-crm-customers-shown-2026-10-19.csv"
};
window.CrmExportUI = { mount(panelEl, App, Store) };
```
- Cell values:
  - name, contact, phone (stored text), city (or state if no city);
  - dates as `YYYY-MM-DD` or empty;
  - status, last contacted, and notes count as a number.
- The notes column holds all entries, newest first, joined by `" | "`, each as `"2026-10-12 Call: text"`, with `" (follow-up done)"` on Done entries.
- **Never included:** emails, GST, `contactFrom`, `disputed`, `id`, timestamps.
- `shown` uses `App.visibleCustomers()`, so the export follows the current filters including `extra`.
- Copy:
  ```js
  try { await navigator.clipboard.writeText(tsv) }
  catch { show #copyFallback; copyBox.value = tsv; copyBox.focus(); copyBox.select();
          try { document.execCommand("copy") } catch {} }
  ```
- Download uses `App.download(name, csv, "text/csv;charset=utf-8")`.
- At 375px, cards stack and buttons are full width.

**"Send to Google Sheet automatically", compared (design only, stage B+):**

| Option | How | Cost | Secrets | Verdict |
|---|---|---|---|---|
| (a) Google Apps Script web app | The user creates a **new** sheet "Varsha CRM export", pastes a ~40-line `doPost` script that checks a token and overwrites a `Customers` tab, and deploys it as a web app. A Supabase Edge Function (daily via pg_cron, plus an on-demand "Send now" that checks the JWT and `am_i_allowed`) POSTs the rows. | $0 | URL + token as **Supabase secrets** | **Recommended**: free, no Google Cloud project, easy to revoke |
| (b) Zapier webhook | POST to a Catch Hook -> Sheets row | Webhooks need a paid plan | Hook URL acts as a password | No: cost, third party, row-by-row appends |
| (c) Supabase function + Google service account | Cloud project, service account key as a secret, Sheets API | $0 | Long-lived private key | Workable but heavy for 42 rows |

Rules for whichever option is built:
- A new spreadsheet only. The script hard-codes its own spreadsheet id and must **never** touch "VFPL Collections Engine".
- No notes unless the user turns them on.
- No secret ever sits in the browser. It needs stage B, because the browser alone cannot hold a secret.

### 5.10 375px
- Customers rows stay as cards, with `.lc` under the name and the action buttons wrapped.
- Dialogs use `min(480px, 100vw - 32px)`; the drawer is full screen.
- Dashboard: one column, tiles 2 per row, bar labels wrap.
- Export: cards stack.
- No sideways scroll anywhere. Tests check all three tabs plus the open drawer and dialog.

### 5.11 Copy
`#rule`: "Pick a status and a follow-up date on each row. A follow-up date in the past turns red. Press Done when you have followed up, and Notes to see the call log. Last order is the customer's latest invoice date in the Collections sheet (it runs to 12 Jul 2026). Grey italic contact names are guessed from email addresses, and grey states come from GST numbers."

---

## 6. Test plan

### 6.1 Structure (A1 sets this up; one command still runs everything)

`NODE_PATH=$(npm root -g) node tests/smoke.js`

The runner (A1 owns it):
- starts the static server. Its `types` map gains `.js: text/javascript`, `.css: text/css`, `.jpg: image/jpeg`, `.png: image/png`.
- launches Chromium;
- runs every `tests/unit/*.js`, then every `tests/checks/*.js`, in filename order;
- prints PASS/FAIL and exits 1 on any failure.

Each module is `module.exports = async (t) => { ... }` with:
```js
t = { browser, url, root, data /* parsed customers.json */, check(name, ok, extra),
      fresh(opts?) /* -> {ctx, page} new context, clean storage, 1280x900, errors collected */,
      open(page) /* goto + wait for app ready: document.body.dataset.ready === "1" */,
      tab(page, "dash"|"list"|"export"), reload(page), row(page, name), rows(page) /* visible #rows tr count */,
      istToday(offset), fs, path,
      requires(page, elementId) /* -> true if #elementId exists; else prints "SKIP <name> (needs ...)" and returns false */ }
```
- Every module uses its own `t.fresh()` context, so modules are independent and agents can add them in parallel.
- `app.js` sets `document.body.dataset.ready = "1"` after the first render (replacing "wait for `#rows tr`", which would time out while the Customers panel is hidden).
- The final module `tests/checks/99-final.js` (A1) checks "no console errors" across all pages.

| File | Owner |
|---|---|
| `tests/smoke.js` (runner), `tests/checks/10-core.js`, `tests/checks/99-final.js` | A1 |
| `tests/checks/20-features.js` | A2 |
| `tests/checks/30-export.js`, `tests/unit/export-unit.js` | A3 |
| `tests/checks/40-dashboard.js`, `tests/unit/dashboard-unit.js` | A4 |

### 6.2 Checks (exact names)

**10-core (A1)**: all 27 Phase 1 checks, adapted. They open the Customers tab first. The duplicate-name check reads `#formErr`. The export check clicks `#tab-export` then `#export` and expects keys `city,contact,contactFrom,disputed,followUp,id,last,name,phone,state,status`. The "nothing unsaved on a clean load" check becomes `no notice on a clean load`. Then:
- `first visit opens the Dashboard tab` and `tab order is Dashboard, Customers, Export`
- `tab choice survives a refresh` (choose Export, reload, Export selected and its panel visible)
- `arrow keys move between tabs`
- `rows carry a stable data-id` (ZF row `data-id="zf-steering-gear-india-ltd"`)
- `Phase 1 edits move to the new store`: fresh context, init script sets `varsha-crm-local-v2` to `{status:{"NR INDUSTRIES":"At risk"}, follow:{"NEEL METAL PRODUCTS LIMITED": istToday(2)}, added:[{name:"Legacy Forge", phone:"9000000000", status:"Active", followUp:""}]}`. Result: NR is At risk, NEEL follow-up is +2, 43 rows, `#notice` contains "Moved 3 changes".
- `moved edits survive a refresh and the notice does not repeat` (legacy key gone, `-backup` key present)
- `extra filter chip shows, clears with ×, and survives a refresh` (set via `page.evaluate(() => App.applyFilter({extra:{kind:"disputed"}}))`)
- `logo shows in the header` (`.logo-badge img` naturalWidth > 0) and `favicon is a 64px PNG` (fetch `assets/favicon-64.png`: 200, `image/png`, PNG header width 64)
- `customers.json export never includes notes` (after adding a note through `Store.addLog` in `page.evaluate`, no `note` or `callLog` keys and the text is absent)
- `backup file includes notes and is named varsha-crm-backup-<IST date>.json`

**20-features (A2)**:
- P2-A:
  - `Done button only on rows with a follow-up`
  - `Done with a note and next date moves the follow-up` (ZF at istToday(-3); note "Spoke to Swapnil"; "In 1 week": input = istToday(7), `.rel` "In 7 days", row not `overdue`)
  - `Done adds a log entry and sets Last contacted today` (badge "1", `.lc` "Last contacted today")
  - `Done survives a refresh` (and the drawer shows "Follow-up done" + the note)
  - `Done without a next date clears the follow-up` ("No follow-up set" count +1; kept after reload)
  - `Done refuses a past next date`
  - `Esc closes Done without saving`
- P2-B:
  - `Notes drawer adds an entry at the top`
  - `note is limited to 500 characters` (600 typed, 500 kept, `#noteCount` "500/500")
  - `older-dated note sorts below newer ones`
  - `notes and badge survive a refresh`
  - `Last contacted is the newest date`
  - `note text is shown as text, not HTML` (`<b>x</b>` is literal; no `li b`)
  - `empty note is refused`
- P2-C:
  - `edit changes name, contact, phone and city` (ZF -> "ZF STEERING GEAR INDIA LTD PUNE", "Anil Kulkarni", "9123456789", "Pune")
  - `rename keeps the same id`
  - `renamed customer keeps follow-up, status and notes`
  - `edits survive a refresh`
  - `edited contact is no longer shown as a guess`
  - `rename to an existing name is refused` (`#formErr`)
  - `empty name is refused`
- Layout:
  - `no sideways scroll at 375px with the Notes drawer open`
  - `... with the Done dialog open`
  - `Done, Notes and Edit buttons are visible in the phone card`
  - `focus returns to the Notes button after closing the drawer`

**30-export (A3)** + `tests/unit/export-unit.js` (quoting of `"`, `,`, newline, `–`, Devanagari; `safeCell`; TSV flattening; BOM):
- `Export tab shows scope, notes box and five options`
- `CSV starts with a BOM and has the exact header`: `﻿"Customer","Contact person","Phone","City","Last order","Follow-up","Status","Last contacted","Notes count"`
- `CSV respects the current filter` (Overdue filter on: data rows = the Overdue chip count; filename contains `shown`)
- `CSV "All customers" has every row`
- `CSV has no notes unless the box is ticked`, then ticked: last header `"Notes"` and the note text present
- `notes box is unticked after a refresh` and `export scope survives a refresh`
- `CSV guards formulas` (contact "=1+1" becomes `"'=1+1"`)
- `CSV has no emails or GST` (no `\S+@\S+\.\S+`, no `\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z0-9]`)
- `Copy puts tab-separated rows on the clipboard` (context `permissions: ['clipboard-read','clipboard-write']`; text starts `Customer\tContact person`; lines = rows + 1)
- `Copy falls back when the clipboard is blocked` (init script makes `writeText` reject; `#copyFallback` visible; `#copyBox` starts `Customer\t`)
- `automatic Sheet export is marked coming next and disabled`
- `no sideways scroll on the Export tab at 375px`

**40-dashboard (A4)** + `tests/unit/dashboard-unit.js` (`compute()` on a hand-made 6-customer set: buckets, ordering, state sort, contact counts, empty log). Expected numbers are **computed from `t.data` in the test**, never typed in by hand:
- `KPI tiles match the data` (total 42; Active/Follow up/At risk/Disputed counts from `customers.json`)
- `every KPI number opens the matching Customers filter` (loop over all 9 tiles: click, then the visible row count equals the tile number; go back to Dashboard)
- `Overdue tile shows red text and "Needs a call now"` (set ZF -3: tile 1, sub-text present, colour `rgb(180, 35, 24)`)
- `Attention lists overdue oldest first, then due today` (ZF -3, NR -5, NEEL 0: order NR, ZF, NEEL; texts "Overdue by 5 days", "Overdue by 3 days", "Due today")
- `Done from Attention opens the Done dialog for that customer` (title contains ZF), then `saving removes it from Attention and lowers Overdue`
- `Notes from Attention opens the Notes drawer`
- `Next 7 days groups by date and the day count filters` (follow-up +2 on one customer: the group button "(1)" gives 1 row)
- `status legend numbers open the status filter`
- `last-order buckets add up to the total` and `"No order on record" matches customers without a last order`
- `"Count days from" choice changes the buckets and survives a refresh`
- `state bar opens the state filter` (Maharashtra count = rows)
- `activity shows the empty state with no call log`, then after one note: `recent activity lists the note and hides the empty state`
- `contact tiles open the matching filter` ("Contacted in last 7 days" = 1, then 1 row)
- `dashboard survives a refresh` (tab still Dashboard, numbers unchanged)
- `no sideways scroll on the Dashboard at 375px`
- `print view shows the dashboard with the logo and hides tabs and notes` (`page.emulateMedia({media:'print'})`: `#printHead img` naturalWidth > 0, `nav.tabs` hidden, `.snippet` hidden)
- `every dashboard number is a button` (all `.tile`, `.hbar` and legend items are `BUTTON` elements)

**99-final (A1)**:
- `no innerHTML in index.html, app.js, store.js, export.js, dashboard.js`
- `blocked storage shows a warning` (Phase 1 check, kept)
- `no console errors` (all pages, all modules)
- Stage B adds `config.js holds no secret key` and the auth, queue and offline checks.

### 6.3 Stage A review checklist (lead, then the user)
Use GitHub Pages (or `npx serve .`) on desktop and on a phone:
1. The tabs work and the tab is remembered after a refresh.
2. Every dashboard number opens the right list.
3. Mark done, notes, edit and rename all work, and survive a refresh.
4. The CSV opens in Google Sheets with `–` and Devanagari intact. Copy and paste into Sheets lines up.
5. Print preview of the Dashboard looks right, with no note text.
6. The logo is readable on its white badge, and the favicon shows.
7. `git status` shows no backup or CSV files.

### 6.4 Stage B live checklist (B3 deploy agent)
1. `curl -s "$URL/rest/v1/customers?select=id&limit=1" -H "apikey: $KEY"` returns 401/42501 and never rows. Same for `call_log`, `allowed_users`, `v_followups_due` and `POST rpc/mark_done`.
2. `curl -s -X POST "$URL/auth/v1/signup" -H "apikey: $KEY" -H "content-type: application/json" -d '{"email":"probe@example.com","password":"Probe-12345678"}'` returns 422 `signup_disabled`.
3. `supabase/verify_rls.sql` prints `ALL RLS CHECKS PASSED`. Advisors show no WARN or ERROR.
4. Sign in as `<ALLOWED_EMAIL>`. Repeat §6.3 items 2–4 on two devices: an edit on one shows on the other after a refresh.
5. Go offline, change a status: the banner shows. Go online and press Retry: it is saved.
6. Sign out: the cache key is gone. `git grep -nE "sb_secret_|service_role"` finds only the guard and the docs.
7. `select * from public.v_followups_due;` matches the Overdue + Due today tiles.
8. Delete probe rows: `delete from public.customers where id like 'zz-%';`.

---

## 7. Build breakdown (Sonnet agents)

File ownership is exclusive while a task runs. Each task works on its own branch `phase2/<task>` and reports with commit and file links plus the live-view link (CLAUDE.md "Links at every step"). The lead merges.

### Stage A (now)

| Task | Owns | Starts after | Parallel with |
|---|---|---|---|
| **A1 Foundation** | `index.html`, `app.js` (new), `store.js` (new), `assets/varsha-logo.jpg`, `assets/favicon-64.png`, `.gitignore`, `tests/smoke.js`, `tests/checks/10-core.js`, `tests/checks/99-final.js`, **stub** files `export.js`, `export.css`, `dashboard.js`, `dashboard.css` (one-line comments) | design approved | none |
| **A2 Features P2-A/B/C** | `app.js`, `index.html`, `tests/checks/20-features.js` | A1 merged | A3, A4 |
| **A3 Export P2-E** | `export.js`, `export.css`, `tests/checks/30-export.js`, `tests/unit/export-unit.js` | A1 merged | A2, A4 |
| **A4 Dashboard P2-F** | `dashboard.js`, `dashboard.css`, `tests/checks/40-dashboard.js`, `tests/unit/dashboard-unit.js` | A1 merged | A2, A3 |
| **A5 Docs + review deploy** (lead or Sonnet) | `README.md`, the GitHub Pages check | A2, A3, A4 merged | none |

Order: **A1 -> (A2 ∥ A3 ∥ A4) -> merge A2 first, then A3 and A4 rebase (no shared files) -> full suite -> A5 -> the user reviews -> GO for stage B.**
A4's Done/Notes-from-Attention checks call `App.openDone/openNotes`. On A4's branch these are A1's stubs, so A4 marks those 3 checks with `t.requires("doneDlg")`: the check is skipped with a "SKIP (needs A2)" line when `#doneDlg` is missing. They must PASS after the merge.

**A1 Foundation**
- **Inputs:** this doc §1.1, §2.1–2.4, §3.1, §4.1–4.4, §5.1–5.3 (structure only), §5.11, §6.1–6.2 (10-core, 99-final); the logo path from the lead.
- **Do:**
  1. Move the inline script into `app.js` unchanged and run the old tests (27 pass).
  2. Add the CSP meta, `defer` scripts, tabs, logo badge, favicon (the §5.1 script) and `.gitignore`.
  3. Write `store.js` with LocalBackend, migration, validation, helpers, `exportCustomersJson` and `exportBackup`.
  4. Rewire `app.js` to `Store` (remove `local`, `build`, `baseStatus`, `baseFollow`, everything keyed by name); `data-id`; `visibleCustomers()`; the extra filter; the `window.App` contract with stubs; placeholder export panel; `body.dataset.ready`.
  5. Turn smoke.js into the runner.
- **Acceptance:** all 10-core and 99-final checks pass; no `innerHTML`; no CSP violations; every Phase 1 behaviour unchanged; the favicon shows the circle.
- **Report:** test output, the `Store` and `App` APIs as built (list any difference from §4.2–4.3), a favicon screenshot path, branch and commit links, live link.

**A2 Features**
- **Inputs:** §5.3–5.7, §6.2 (20-features).
- **Do:** row actions, Last contacted, Done dialog, Notes drawer, Edit mode with `#formErr`, `#live`, focus return; implement `App.openDone`, `openNotes` and `openEdit`. Use only `Store` methods; if something is missing, report it, do not edit `store.js`.
- **Acceptance:** 20-features plus all earlier checks pass.
- **Report:** test output, 1280px and 375px screenshots (stored outside the repo), links.

**A3 Export**
- **Inputs:** §5.9, §6.2 (30-export).
- **Do:** `CrmExport` + `CrmExportUI.mount` (replaces the placeholder panel content, keeps the ids `export` and `backup`), `export.css`, tests.
- **Acceptance:** export-unit + 30-export + all earlier checks pass.
- **Report:** test output, a sample CSV header line, links.

**A4 Dashboard**
- **Inputs:** §5.8, §4.3–4.4, §6.2 (40-dashboard).
- **Do:** `CrmDash.compute` + `mount`, `dashboard.css` including print, tests.
- **Acceptance:** dashboard-unit + 40-dashboard pass (3 SKIPs allowed only before the A2 merge); the 375px and print checks pass.
- **Report:** test output, desktop, phone and print-preview screenshots, links.

**A5**
- Update the README: tabs, Mark done, notes, edit, export, the backup warning, "notes never in git", the logo, the test layout.
- Run the §6.3 checklist on GitHub Pages and send the user the review links.

### Stage B (only after the user's GO on stage A)

| Task | Owns | Starts after | Parallel with |
|---|---|---|---|
| **B1 Backend** | `supabase/migrations/20261019000100_phase2.sql`, `supabase/verify_rls.sql`, `scripts/make-seed.js` | GO; the deploy half waits for the lead's §3.3 setup | B2 |
| **B2 Data layer + login** | `store.js` (SupabaseBackend, queue, cache, auth), `config.js` (blank), `app.js` + `index.html` (auth screens, `#who`, pending banner, CSP widening), `tests/checks/50-auth-queue.js` | GO | B1 |
| **B3 Deploy + live check** | `config.js` (URL + key only) | B1 deployed + B2 merged | none |

- **B1:**
  - Write the §2.5 SQL exactly.
  - Write `verify_rls.sql`. It runs `DO` blocks under `set local role anon` / `authenticated` with `set_config('request.jwt.claims', ...)`. A stranger must see 0 rows and be refused on insert, `allowed_users` and `mark_done`. The allowed user (claims from `auth.users where email = '<ALLOWED_EMAIL>'`) can read ≥42, insert, update, log, `mark_done` and delete a `zz-rls-probe` row, but cannot delete a seed row, change an id, or update a log entry. Everything is rolled back, and the script ends with `select 'ALL RLS CHECKS PASSED'`.
  - Write `make-seed.js`.
  - Apply in the SQL Editor (or with the Supabase MCP only if the lead grants it), seed from the user's latest export, verify, and run curl checks 1–2.
  - **Report:** project URL, which key type (public), all outputs. Never the service_role key or the DB password.
- **B2:**
  - Implement §4.5 and §3.4.
  - Fake-auth and offline tests: login screen, wrong password, session survives refresh, denied user, sign-out clears the cache, offline change queued and kept after refresh and sent on Retry, config guard.
  - Pin supabase-js and compute the SRI.
  - **Acceptance:** all stage A checks plus the new ones pass with no network.
- **B3:**
  - Fill `config.js`, run §6.4, report.
  - If the publishable key fails, use the legacy anon key.

### CLAUDE.md updates the lead should make (this agent did not edit it)
- Rule 1 (stage A wording): "Customers are seeded from `customers.json`. Edits and the call log live in this browser (localdb) until stage B moves them to Supabase. Notes are never committed. Backup and CSV files are gitignored."
- Rule 2: "... included in the export: customer fields in customers.json, notes in the backup file. The 'Include notes' box is deliberately not remembered."
- Rule 3: "`tests/smoke.js` runs `tests/unit/*` and `tests/checks/*`. Each task adds its own module."
- New gotchas:
  - "`display` on a `<dialog>` shows it even when closed; style `dialog[open]` only."
  - "Wait for `body[data-ready]`, not `#rows tr`, because the Customers panel may be hidden."
  - "Serve `.js` as `text/javascript` in the test server."
  - Stage B: "PostgREST returns at most 1000 rows per request; page with `range()`."
  - Stage B: "Free Supabase projects pause after 7 idle days."
  - "Only the publishable or anon key in `config.js`."

---

## 8. Risks and Plan B

| # | Risk | Plan B |
|---|---|---|
| 1 | Stage A data lives in one browser; the user reviews on a phone and a PC and sees different data. | Expected and stated on the page ("saved in this browser"). Export customers.json / backup to move data. Stage B fixes it. |
| 2 | Parallel agents A2/A3/A4 break each other. | Disjoint files; the `App` contract is frozen by A1; merge A2 first and rerun the full suite after each merge. |
| 3 | The `App`/`Store` contract misses something a panel needs. | The agent reports it, the lead adds it in a small A1 follow-up commit, and the others rebase. Agents never edit files they do not own. |
| 4 | Dashboard numbers drift from the Customers filters. | Tiles and filters share `Store.fuKind/lastBucket` and `App.applyFilter`; the "every KPI number opens the matching filter" check compares counts. |
| 5 | The last-order buckets look wrong, because the data stops at 12 Jul 2026. | The "Count days from: latest order in data" toggle and the explicit note. |
| 6 | Print layouts differ by browser. | Test in Chromium (print media emulation); manual check in A5; keep print CSS simple (block layout, avoid page breaks inside cards). |
| 7 | The clipboard API is blocked (http, iframe, Firefox permissions). | Selectable textarea fallback + `execCommand("copy")`. |
| 8 | The CSP blocks something not covered by tests. | A5 checks the console on Pages; widen only the exact directive; never `'unsafe-inline'` for scripts. |
| 9 | The favicon crop includes the wordmark or is off-centre. | The script cuts at 75% height and auto-detects the circle; A1 checks visually; fallback: hand-crop box (43, 23, 166, 146). |
| 10 | GitHub Pages caches an old `app.js`. | `?v=` on every asset, bumped each release. |
| 11 | localStorage fills up with notes (about 5 MB). | `#storageWarn` + export; stage B moves notes to the DB. |
| B1 | Free Supabase pauses after 7 idle days. | The cache keeps the page readable and writes are queued; the lead presses Restore; daily use and the future Telegram job keep it awake. |
| B2 | RLS mistake. | `verify_rls.sql` + curl + Advisors before go-live; emergency `revoke ... from authenticated`. |
| B3 | CDN, SRI or publishable-key problems with supabase-js. | Vendor the file; use the legacy anon key. |
| B4 | Password reset email not delivered (built-in SMTP). | The lead resets it in the dashboard; free SMTP later. |
| B5 | No backups on the free plan. | Weekly "Download backup (with notes)", off git. |

## 9. Open questions for the user (each with a recommended answer)

1. **Phone numbers and contact names in the public repo.** `customers.json` is public on GitHub Pages and in git history. Keep them?
   *Recommended:* keep them for the stage A review (nothing new is exposed). In stage B, once they are seeded into the private DB, blank `phone` and `contact` in the committed file. Do not rewrite history.
2. **Should a "Note" entry count as "Last contacted" (and in the Dashboard contact tiles)?**
   *Recommended:* no; count only Call, Visit, Email and Telegram. It is a one-line `CONTACT_TYPES` change. Builders use all five until you answer.
3. **Can log entries be edited or deleted on the page?**
   *Recommended:* no (append-only); add a correcting note instead.
4. **Default tab on open: Dashboard (as requested), or the last tab used?**
   *Recommended:* the last tab used (it persists), with Dashboard on the very first visit. This is what the design does.
5. **Stage B automatic Google Sheet + Telegram contents.** Apps Script into a new sheet; should phone numbers go to Telegram or the sheet?
   *Recommended:* Apps Script web app called by a Supabase scheduled function into a **new** "Varsha CRM export" sheet. The Telegram reminder lists name, days overdue and contact person, with no phones. Forgot-password stays hidden (`allowPasswordReset:false`) until a free SMTP is set up.
