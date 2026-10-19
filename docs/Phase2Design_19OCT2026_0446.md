# Varsha CRM - Phase 2 design

Date: 19 Oct 2026, 04:46 IST. Author: Opus design agent. Status: ready for build after the lead's review.
Scope: P2-A Mark done, P2-B Notes and call log, P2-C Edit customer details, P2-E Export tab, and the move to Supabase (Postgres + Auth + RLS). Telegram reminder: hooks only.

Words used here:
- **IST today** = `new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })`, which is the existing `todayISO()`. In SQL it is `private.ist_today()`.
- **supabase mode** = `config.js` holds a project URL and key. The page talks to Supabase.
- **local mode** = `config.js` is blank, or a test forces it. The page keeps a "server" in localStorage, seeded from `customers.json`. Tests use this mode, and so does Plan B.

---

## 0. Decisions in one place

1. **The database is the source of truth.** In supabase mode the page reads and writes Supabase only. `customers.json` becomes (a) the one-time seed, (b) the data for local mode and tests, (c) the git-safe export format (customer fields only, never notes).
2. **Stable id.** `customers.id` is a text slug made from the name when the row is created, and it never changes. A rename changes `name` only. Everything else (follow-ups, status, notes) is keyed by `id`.
3. **Security comes from RLS plus an allowlist, not from secrecy.** The anon key or publishable key sits in a committed `config.js`. Every table is revoked from `anon`. Every policy needs `private.is_allowed()`: the JWT email must be in `allowed_users` and the auth user must be email-confirmed. Sign-ups are off in the dashboard.
4. **One `store.js` module with two backends.** `SupabaseBackend` (supabase-js) and `LocalBackend` (localStorage) share one Store layer that handles optimistic updates, the write queue, last-write-wins, caching and the export builders. Tests run the real Store against `LocalBackend` with fake auth, so no network is needed.
5. **Every write goes through a queue that is saved before it is sent.** A refresh, a dropped network or an expired session never loses an edit. Conflicts are settled by last-write-wins on `updated_at`.
6. **Notes never reach git.** `customers.json` export has no notes. Notes leave the browser only through (a) the "Download backup (with notes)" file, whose name matches a `.gitignore` pattern, and (b) CSV or copy exports when the user ticks "Include notes text".
7. **Mark done is one atomic RPC** (`public.mark_done`). It writes the log entry and sets or clears the follow-up in one transaction, and it is idempotent by a client-made UUID.
8. **The inline script moves to `app.js`.** That allows a strict CSP: `script-src 'self' https://cdn.jsdelivr.net`. supabase-js is pinned and loaded with SRI, and only in supabase mode.

---

## 1. Architecture

```
 Browser (GitHub Pages, public static files)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ index.html  markup + CSS + CSP meta                                  │
 │ config.js   { supabaseUrl, supabaseKey }  <- public on purpose       │
 │ store.js    Store API ── backend ──┬─ SupabaseBackend (supabase-js)  │
 │                                    └─ LocalBackend (localStorage)    │
 │ export.js   CSV / TSV / JSON builders (pure functions)               │
 │ app.js      UI: table, dialogs, drawer, tabs, auth screens           │
 │ localStorage: session token, cache (last snapshot), write queue,     │
 │               view state (filters/search/sort/tab)                   │
 └───────────────┬──────────────────────────────────────────────────────┘
                 │ HTTPS (apikey header + user JWT)
 Supabase project (free tier, ap-south-1 Mumbai)
 ┌───────────────▼──────────────────────────────────────────────────────┐
 │ Auth (GoTrue): email+password, sign-ups OFF, confirm email ON        │
 │ PostgREST /rest/v1: tables customers, call_log; rpc mark_done,       │
 │                     am_i_allowed                                     │
 │ Postgres: RLS on every table; policies call private.is_allowed()     │
 │           private schema (NOT exposed): is_allowed(), ist_today(),   │
 │           triggers                                                   │
 │ allowed_users: RLS on, no policies, no grants -> invisible to API    │
 │ v_followups_due (security_invoker, service_role only) -> future      │
 │   Telegram 11:00 IST function (pg_cron + Edge Function, later)       │
 └──────────────────────────────────────────────────────────────────────┘
 git (public repo): code, config.js (public key), customers.json (seed,
 no notes), SQL migration. NEVER: notes, backups, service_role key.
```

**What lives where, and why**

| Thing | Where | Why |
|---|---|---|
| Customer rows, call log | Supabase Postgres | One private copy shared by every device. The repo is public. |
| Who may see data | `public.allowed_users` (no API access) | Open sign-ups or a leaked key still cannot read anything. |
| Project URL + publishable/anon key | `config.js` (committed) | Safe by design. Without a session for an allowed user, the key reaches nothing. |
| Session token | localStorage `varsha-crm-auth` (supabase-js) | Signed in after a refresh. |
| Cache of last snapshot | localStorage `varsha-crm-cache-v1` | Instant render and offline reading. Cleared on sign-out. |
| Pending writes | localStorage `varsha-crm-queue-v1` | Offline edits survive a refresh. |
| View state | localStorage `varsha-crm-view-v1` (+ `tab`, `exportScope`) | Phase 1 behaviour, unchanged. |
| Seed | `customers.json` -> `scripts/make-seed.js` -> SQL (output not committed) | The repo file stays the seed and the backup format. |

**Mode selection (`Store.init`)**, first match wins:
1. `window.CRM_TEST` is set (only Playwright sets it, via `addInitScript`): local mode with fake auth.
2. `CRM_CONFIG.supabaseUrl` and `CRM_CONFIG.supabaseKey` are both non-empty: supabase mode.
3. Otherwise: local mode with no auth (Phase 1 experience plus the new features; also the double-click preview using `window.CRM_DATA`).

---

## 2. Data model

### 2.1 Migration file `supabase/migrations/20261019000100_phase2.sql` (copy as is)

```sql
-- Varsha CRM Phase 2 schema. Run once as the project owner (SQL Editor).
create extension if not exists pgcrypto;          -- gen_random_uuid (already on in Supabase)
create schema if not exists private;              -- NOT in the API's exposed schemas
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------- helpers ----------
create or replace function private.ist_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- ---------- tables ----------
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
  id             uuid primary key default gen_random_uuid(),   -- client sends its own UUID
  customer_id    text not null references public.customers (id) on delete cascade,
  at             date not null default private.ist_today(),
  type           text not null check (type in ('Call', 'Visit', 'Email', 'Telegram', 'Note')),
  note           text not null default '' check (char_length(note) <= 500),
  done_follow_up date,          -- set when this entry closed a follow-up (Mark done)
  next_follow_up date,          -- the next date chosen in Mark done (history only)
  created_at     timestamptz not null default now(),
  created_by     text not null default ''
);
create index call_log_customer_at_idx on public.call_log (customer_id, at desc, created_at desc);

-- ---------- triggers ----------
create or replace function private.customers_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := new.created_at;            -- equal timestamps = "never edited"
    new.updated_by := coalesce(auth.jwt() ->> 'email', 'seed');
  else
    if new.id <> old.id then
      raise exception 'Customer id cannot change' using errcode = '22023';
    end if;
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

-- ---------- allowlist check ----------
create or replace function private.is_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.allowed_users a
           where a.email = lower(coalesce(auth.jwt() ->> 'email', '')))
     and exists (
           select 1 from auth.users u
           where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;
revoke all on function private.is_allowed() from public, anon;
grant execute on function private.is_allowed() to authenticated;
revoke all on function private.ist_today() from public, anon;
grant execute on function private.ist_today() to authenticated;

create or replace function public.am_i_allowed() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.is_allowed()
$$;

-- ---------- mark done (atomic, idempotent by p_log_id) ----------
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
  if not found then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  insert into public.call_log (id, customer_id, at, type, note, done_follow_up, next_follow_up)
  values (p_log_id, p_customer_id, coalesce(p_at, v_today), p_type, coalesce(p_note, ''), v_prev, p_next)
  on conflict (id) do nothing
  returning * into v_log;
  if v_log.id is not null then
    update public.customers set follow_up = p_next where id = p_customer_id returning * into v_cust;
  else                                            -- replay of an op that already landed
    select * into v_log  from public.call_log  where id = p_log_id;
    select * into v_cust from public.customers where id = p_customer_id;
  end if;
  return jsonb_build_object('customer', to_jsonb(v_cust), 'log', to_jsonb(v_log));
end $$;

revoke all on function public.am_i_allowed() from public, anon;
revoke all on function public.mark_done(uuid, text, date, text, text, date) from public, anon;
grant execute on function public.am_i_allowed() to authenticated;
grant execute on function public.mark_done(uuid, text, date, text, text, date) to authenticated;

-- ---------- grants (least privilege; column-level where it matters) ----------
revoke all on public.customers, public.call_log, public.allowed_users from anon, authenticated;
grant select, delete on public.customers to authenticated;
grant insert (id, name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed)
  on public.customers to authenticated;
grant update (name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed)
  on public.customers to authenticated;
grant select on public.call_log to authenticated;
grant insert (id, customer_id, at, type, note, done_follow_up, next_follow_up)
  on public.call_log to authenticated;
-- no update/delete on call_log (append-only); nothing at all on allowed_users

-- ---------- RLS ----------
alter table public.allowed_users enable row level security;   -- no policies on purpose
alter table public.customers     enable row level security;
alter table public.call_log      enable row level security;

create policy customers_select on public.customers for select to authenticated
  using ((select private.is_allowed()));
create policy customers_insert on public.customers for insert to authenticated
  with check ((select private.is_allowed()));
create policy customers_update on public.customers for update to authenticated
  using ((select private.is_allowed())) with check ((select private.is_allowed()));
create policy customers_delete on public.customers for delete to authenticated
  using ((select private.is_allowed()) and source = 'manual');  -- seed rows cannot be deleted

create policy call_log_select on public.call_log for select to authenticated
  using ((select private.is_allowed()));
create policy call_log_insert on public.call_log for insert to authenticated
  with check ((select private.is_allowed()));

-- ---------- the one view for the future Telegram reminder (11:00 IST) ----------
create view public.v_followups_due with (security_invoker = true) as
select c.id, c.name, c.contact, c.phone, c.city, c.status, c.follow_up,
       private.ist_today() - c.follow_up                                  as days_overdue,
       case when c.follow_up < private.ist_today() then 'overdue' else 'today' end as bucket,
       (select max(l.at) from public.call_log l where l.customer_id = c.id) as last_contacted
from public.customers c
where c.follow_up is not null and c.follow_up <= private.ist_today()
order by c.follow_up, c.name;
revoke all on public.v_followups_due from public, anon, authenticated;
grant select on public.v_followups_due to service_role;
```

Notes for T1:
- `select private.is_allowed()` is wrapped in `(select ...)` so Postgres runs it once per statement, not once per row.
- `service_role` bypasses RLS. Only the future server-side function uses it. Its key is **never** put in git, `config.js` or chat.
- The Security Advisor will show one INFO, "RLS enabled, no policy" on `allowed_users`. That is intended. Any WARN or ERROR must be fixed before go-live.

### 2.2 Row <-> UI mapping (in `store.js`)

| UI (camelCase, same as Phase 1) | DB column | Rule |
|---|---|---|
| `id` | `id` | slug, never changes |
| `name` `contact` `city` `state` `phone` | same | `''` when empty |
| `contactFrom` | `contact_from` | set to `''` when the user edits `contact` by hand |
| `last` | `last_order` | `''` <-> `null` |
| `followUp` | `follow_up` | `''` <-> `null` |
| `status` `disputed` | same | |
| `added` | `source === 'manual'` | only these show the remove × (same as Phase 1) |
| `updatedAt` `createdAt` | `updated_at` `created_at` | strings exactly as the server sent them |

Log entry in the UI: `{ id, customerId, at, type, note, doneFollowUp, nextFollowUp, createdAt, createdBy, pending }`. `pending` is true while the entry is still in the queue.

### 2.3 Slug rule (one function, shared by the browser and the seed script)

```js
// store.js, exported as Store.slug and (in Node) module.exports.slug
function slug(name, isTaken) {
  var base = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/, "") || "customer";
  var id = base, n = 2;
  while (isTaken && isTaken(id)) id = base + "-" + n++;
  return id;
}
```
I checked all 42 current names: every slug is unique, with no suffixes. Examples: `ZF STEERING GEAR (INDIA) LTD` -> `zf-steering-gear-india-ltd`, `Ziemer GmbH & Co. KG` -> `ziemer-gmbh-and-co-kg`, `FRAP S.p.A` -> `frap-s-p-a`. If an input row already has `id` (a Phase 2 export), the seed uses it as given.

### 2.4 Seed

`scripts/make-seed.js` (Node, no dependencies):
- `node scripts/make-seed.js customers.json > supabase/.generated/seed.sql`. That folder is gitignored.
- The output is one transaction with an `INSERT INTO public.customers (id, name, contact, contact_from, city, state, phone, last_order, follow_up, status, disputed, source) VALUES (...) ON CONFLICT (id) DO NOTHING;` per customer, `source = 'seed'`. Strings are escaped by doubling `'`. Empty dates become `NULL`. Re-running it is safe.
- It must `require("../store.js").slug`, so `store.js` guards all `window`/`document` access (`if (typeof window !== "undefined")`) and ends with `if (typeof module !== "undefined") module.exports = { slug: slug };`.
- **Seed from the freshest data:** before the switch, the user clicks "Download customers.json" on the live Phase 1 page and gives the file to the lead. T1 seeds from that file, which carries the Phase 1 browser edits. The repo copy is the fallback.

### 2.5 Moving Phase 1 browser edits (keyed by NAME) to ids, on first load

This is the safety net in case the user did not export first. It runs once per browser, in `Store.load()`, right after the first successful server fetch (both modes):

```
legacy = JSON.parse(localStorage["varsha-crm-local-v2"])   // {added:[], status:{name:v}, follow:{name:v}}
if (!legacy || localStorage["varsha-crm-legacy-done-v1"]) return
find(name) = row whose name === name, else whose lower(name) === lower(name), else whose id === slug(name)
for each [name, v] in legacy.status: r = find(name)
    if r && r.status !== v && r.updatedAt === r.createdAt  -> setStatus(r.id, v), moved++
    else if r && r.status !== v                             -> skipped++   (DB already has a newer edit)
for each [name, v] in legacy.follow: same rule with followUp
for each a in legacy.added: if !find(a.name) -> addCustomer(a), moved++  else skipped++
localStorage["varsha-crm-local-v2-backup"] = raw string;  remove "varsha-crm-local-v2"
localStorage["varsha-crm-legacy-done-v1"] = "1"
if (moved || skipped) notice: "Moved 3 changes from this browser to the database." (+ " 1 was skipped because the database already had a newer value.")
```
The `updatedAt === createdAt` guard means a second device with stale edits cannot overwrite changes already made in the database.

---

## 3. Security

### 3.1 What each caller can do

| Caller | Can | Cannot |
|---|---|---|
| Anyone holding the public key (anon) | Hit the Auth endpoints: sign in (rate limited), password reset request (only if enabled). | Sign up (disabled). Read or write any table, view or RPC (all revoked: HTTP 401, code 42501). See `allowed_users`. |
| Signed-in user **not** on the allowlist (only possible if an admin creates one) | Sign in. `am_i_allowed()` returns false, so the page shows "not allowed". | See any row (RLS returns 0 rows). Insert (42501). Update or delete (0 rows). Use `mark_done` ("Customer not found"). |
| Allowed, confirmed user | Read all customers and log entries. Insert, edit and remove hand-added customers. Add log entries. Mark done. | Change `id`, `source`, `created_at` or `updated_*` (column grants plus trigger). Delete seed customers. Edit or delete log entries. Read `allowed_users` or the view. |
| `service_role` (server only, future) | Everything (bypasses RLS). Reads `v_followups_due`. | It is never in the browser or in git. |

### 3.2 Dashboard settings (the lead does these before T1 deploys)

1. Create the project: free plan, region **ap-south-1 (Mumbai)**, strong DB password kept in a password manager.
2. Authentication -> Sign In / Providers -> Email: **Enabled**. **Allow new users to sign up: OFF**. **Confirm email: ON**. Secure password change: ON. Minimum password length **12**, with "lowercase, uppercase, digits".
3. Authentication: turn **off** every other provider: phone, anonymous sign-ins, and all OAuth providers.
4. Authentication -> URL Configuration: Site URL `https://erpvarsha-star.github.io/vfpl-crm/`. Redirect URLs: the same URL plus `http://localhost:8080/**`.
5. Authentication -> Users -> **Add user -> Create new user**: email `<ALLOWED_EMAIL>`, a strong password, tick **Auto Confirm User**. Then in the SQL Editor: `insert into public.allowed_users (email, note) values (lower('<ALLOWED_EMAIL>'), 'owner');` (after the migration). Order matters: create the user **before** adding the email to the allowlist.
6. Authentication -> Rate Limits: keep the defaults. Sign-in attempts are limited per IP, and the built-in SMTP sends about 2 emails per hour. Optional later: CAPTCHA (Cloudflare Turnstile, free) on sign-in.
7. Database -> Extensions: turn **off `pg_graphql`** (we do not use it, so it is surface we do not need).
8. API settings: exposed schemas `public` only (do not add `private`). Max rows stays 1000; the store pages past it.
9. Later, for team logins: repeat step 5 per person. To remove someone: `delete from public.allowed_users where email = '...'`, and also delete the auth user.

### 3.3 Keys

- Use the **publishable key** (`sb_publishable_...`) or, if the pinned supabase-js has trouble with it, the **legacy anon JWT**. Both act as the `anon` role.
- `tests/smoke.js` gets a static guard (§6.3). `config.js` must not contain `sb_secret_` or `service_role`, and any JWT in it must decode to `"role":"anon"`.
- Emergency lock-down (paste into the SQL Editor): `revoke all on public.customers, public.call_log from authenticated;`. Never disable RLS. To restore access, re-run the grants block of the migration.

### 3.4 PII and notes never reach git

- Notes live in Postgres, in the signed-in browser's cache (cleared on sign-out), and in files the user downloads on purpose.
- `.gitignore` (T1 creates it): `supabase/.generated/`, `varsha-crm-backup-*.json`, `varsha-crm-*.csv`, `.env*`, `node_modules/`.
- The `customers.json` export has exactly these keys: `id,name,contact,contactFrom,city,state,phone,last,followUp,status,disputed`. A test enforces it.
- Known exposure that already exists: the committed `customers.json` (company names, 10 contact names, 42 phones) is public on a public repo and in its history. See Open Question 1.
- No emails or GST numbers anywhere, as in Phase 1. Auth emails stay inside Supabase Auth and the `allowed_users` table.

### 3.5 Browser hardening

- A CSP meta tag in `index.html` (the inline script moves to `app.js`):
  ```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data: blob:; base-uri 'none'; form-action 'self'; object-src 'none'">
  ```
- All text goes in with `textContent` or `.value`, never `innerHTML` (a test greps for it).
- The SRI hash on supabase-js covers a tampered CDN.

---

## 4. Client design (no build step)

### 4.1 Files and load order

```html
<!-- end of <body> in index.html; ?v= bumps defeat GitHub Pages caching -->
<script src="config.js?v=2" defer></script>
<script src="store.js?v=2" defer></script>
<script src="export.js?v=2" defer></script>
<script src="app.js?v=2" defer></script>
```

`config.js`, committed:
```js
// Public by design. The database only lets in signed-in users on the allowed list (RLS).
// NEVER put the service_role or sb_secret_ key here.
window.CRM_CONFIG = {
  supabaseUrl: "",                 // "https://<ref>.supabase.co"; blank = local mode
  supabaseKey: "",                 // "sb_publishable_..." or legacy anon JWT
  allowPasswordReset: false,       // Open Question 5
  siteUrl: "https://erpvarsha-star.github.io/vfpl-crm/"
};
```

**supabase-js**: pin `@supabase/supabase-js@2.49.4`, UMD build, jsDelivr. It is loaded **only in supabase mode**, from `store.js`:
```js
var SB_JS = { url: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js",
              sri: "sha384-<T2 computes>" };
// T2: curl -sL "$URL" | openssl dgst -sha384 -binary | openssl base64 -A
function loadSupabaseJs() {
  return new Promise(function (res, rej) {
    if (window.supabase && window.supabase.createClient) return res();
    var s = document.createElement("script");
    s.src = SB_JS.url; s.integrity = SB_JS.sri; s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer";
    s.onload = function () { res(); };
    s.onerror = function () { rej({ kind: "network", message: "Could not load the database library." }); };
    document.head.appendChild(s);
  });
}
```
If 2.49.4 fails the live check, T2 may pick a newer 2.x that is at least 2 weeks old. It must record the version and SRI in its report. Plan B: vendor the same file to `vendor/supabase-js-<ver>.js` and point `SB_JS.url` at it, with no SRI needed (same origin).

Client creation:
```js
sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "varsha-crm-auth" }
});
```

### 4.2 `store.js`: public API (exact)

All dates are `YYYY-MM-DD`. `id` is the customer slug. Every mutating call: (1) validates and resolves `{ok:false,error,field}` without writing if invalid; (2) applies the change to in-memory state and fires `onChange("local")` **synchronously**; (3) appends the op to the queue and saves the queue **in the same tick**; (4) starts `flush()`; (5) resolves `{ok:true, queued:boolean}` when the op is acknowledged, or when it stays queued after a network failure.

```js
window.Store = {
  // lifecycle
  init(): Promise<{ mode: "supabase"|"local", user: {email:string}|null, fakeAuth: boolean }>,
  load(): Promise<{ ok: boolean, fromCache: boolean, error?: string }>, // cache first (onChange "cache"), then server ("server"), then migration
  status(): { mode, online: boolean, pending: number, lastSyncAt: string|"", loadError: string|"" },
  onChange(cb: (reason: "cache"|"server"|"local"|"queue"|"conflict"|"error"|"auth"|"notice", detail?: any) => void): void,
  todayISO(): string,                                  // IST today
  addDays(iso: string, n: number): string,

  // auth (in local mode without fake auth these are no-ops and current() returns {email:null, local:true})
  auth: {
    current(): { email: string|null, local?: boolean } | null,
    signIn(email: string, password: string): Promise<{ok:true}|{ok:false, error:string}>,
    signOut(opts?: { force?: boolean }): Promise<{ ok: boolean, pending: number }>, // ok:false if pending>0 and !force
    sendReset(email: string): Promise<{ok:boolean, error?:string}>,        // only if allowPasswordReset
    setPassword(pw: string): Promise<{ok:boolean, error?:string}>,         // after "recovery"
    onEvent(cb: (e: "signed_in"|"signed_out"|"recovery"|"expired") => void): void
  },
  isAllowed(): Promise<boolean>,                      // rpc am_i_allowed (local: email === fake email)

  // reads (synchronous, from current optimistic state)
  customers(): Customer[],
  get(id: string): Customer|undefined,
  listLog(id: string): LogEntry[],                    // newest first: at desc, createdAt desc, id desc
  logCount(id: string): number,
  lastContacted(id: string): string,                  // newest `at` among CONTACT_TYPES, or ""

  // writes
  addCustomer(f: {name, contact?, phone?, city?, last?, followUp?, status?}): Promise<Result & {id?: string}>,
  saveCustomer(id, f: {name, contact, phone, city, last}): Promise<Result>,   // P2-C
  setStatus(id, status: "Active"|"Follow up"|"At risk"): Promise<Result>,
  setFollowUp(id, iso: string /* "" clears */): Promise<Result>,
  removeCustomer(id): Promise<Result>,                // refused unless added === true
  addLog(id, e: {at?: string, type: LogType, note: string}): Promise<Result & {entry?: LogEntry}>,
  markDone(id, d: {type: LogType, note?: string, next?: string}): Promise<Result & {entry?: LogEntry}>,
  pending(): number,
  flush(): Promise<void>,                             // single-flight

  // helpers / export
  slug(name, isTaken?): string,
  validate(kind: "customer"|"log"|"done", f, selfId?): { ok: boolean, errors: { [field]: string } },
  exportCustomersJson(): { note: string, customers: object[] },   // all customers, no notes, exact keys §3.4
  exportBackup(): { format: "varsha-crm-backup-v1", exportedAt: string, note: string,
                    customers: object[], callLog: object[] }
};
// Result = { ok: true, queued: boolean } | { ok: false, error: string, field?: string }
// LogType = "Call"|"Visit"|"Email"|"Telegram"|"Note"
// CONTACT_TYPES = ["Call","Visit","Email","Telegram","Note"]   // constant at top of store.js (Open Question 2)
```

**Validation** (same messages in both backends):

| Field | Rule | Message |
|---|---|---|
| name | trimmed, 1–120 chars | "Enter the customer name." |
| name | unique, case-insensitive, ignoring `selfId` | "<name> is already in the list." |
| contact | ≤ 80 chars | |
| city | ≤ 60 chars | |
| phone | ≤ 30 chars, `/^[0-9+()\-\s.\/–]*$/` (the current data includes `–` and `/`) | "Phone can only have digits, spaces and + ( ) - /" |
| last, followUp, at | `''` or ISO | |
| at | ≤ IST today | "Date cannot be in the future." |
| next | `''` or ≥ IST today | "Next follow-up cannot be in the past." |
| note | ≤ 500 chars; required for `addLog`, optional for `markDone` | "Write a note." |
| status / type | in their lists | |

`saveCustomer` sets `contactFrom = ""` when `contact` differs from the stored value.

### 4.3 Backend interface (internal to `store.js`; both backends implement it)

```js
backend = {
  auth: { getUser(), signIn(email, pw), signOut(), sendReset(email, redirectTo), updatePassword(pw), onEvent(cb) },
  isAllowed(): Promise<boolean>,
  fetchAll(): Promise<{ customers: Row[], log: Row[] }>,    // pages of 1000 via range()
  fetchCustomer(id): Promise<Row|null>,
  insertCustomer(row): Promise<Row>,                         // ON CONFLICT (id) DO NOTHING; returns existing row
  patchCustomer(id, patch, baseUpdatedAt|null): Promise<Row|null>, // null = condition failed (0 rows)
  deleteCustomer(id): Promise<void>,                         // 0 rows is not an error
  insertLog(row): Promise<Row>,                              // ON CONFLICT (id) DO NOTHING
  markDone(args): Promise<{ customer: Row, log: Row }>
};
// every rejection is normalized to { kind, message, code }:
//  "network": fetch TypeError, status 0, 408, 429, 5xx, library failed to load   -> keep op, retry
//  "auth":    401 with JWT/expired codes (PGRST301), no session                  -> keep op, show sign-in
//  "denied":  403, 42501                                                         -> drop op, revert, error
//  "invalid": 23505 (dup name), 23514, 22001, 22023, 22P02, P0002                -> drop op, revert, error
```

SupabaseBackend essentials:
```js
fetchAll: loop i = 0, 1000, ...: sb.from("customers").select("*").order("id").range(i, i + 999) until a page has < 1000 rows;
          same for call_log with .order("created_at").order("id")
insertCustomer: sb.from("customers").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select().maybeSingle()
                -> data || fetchCustomer(row.id)
patchCustomer:  q = sb.from("customers").update(patch).eq("id", id); if (base) q = q.lte("updated_at", base);
                { data } = await q.select();  return data.length ? data[0] : null
deleteCustomer: sb.from("customers").delete().eq("id", id)
insertLog:      sb.from("call_log").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select().maybeSingle()
markDone:       sb.rpc("mark_done", { p_log_id, p_customer_id, p_at, p_type, p_note, p_next })
isAllowed:      sb.rpc("am_i_allowed")  -> data === true
```
Patches never include `updated_at`, `created_at`, `source` or `id`.

**LocalBackend**: the "server" lives in localStorage `varsha-crm-localdb-v1` as `{ v:1, customers: Row[], log: Row[], deleted: string[] }`, using the same snake_case rows as the DB.
- On first use it seeds from `window.CRM_DATA` or `fetch("customers.json", {cache:"no-store"})` with `source:"seed"` and slug ids. On later loads it adds any seed id not yet present and not in `deleted`.
- It enforces the same rules as the DB: unique lower(name) -> `invalid`; delete of a seed row -> `denied`; `mark_done` semantics; `updated_at = new Date().toISOString()` on patch and `created_at === updated_at` on insert.
- Fake auth is on only when `window.CRM_TEST.fakeAuth = { email, password }`. The session is kept in localStorage `varsha-crm-fake-session`. `isAllowed()` is true only for `fakeAuth.email`; a second login `CRM_TEST.deniedUser = { email, password }` signs in but is not allowed.
- Test hook, created only when `CRM_TEST` is set: `window.__crmFake = { setOffline(bool) }`. The flag lives in sessionStorage so it survives a reload. While offline, every backend call rejects with `{kind:"network"}`.

### 4.4 Optimistic state, queue, last-write-wins

- **State** = last server snapshot + every queued op replayed on top. It is rebuilt on every `load()`, so a refresh shows pending edits.
- **Cache** `varsha-crm-cache-v1` = `{ email, at, customers: Row[], log: Row[] }`, written after every successful fetch or ack. It is ignored if `email` differs from the signed-in user, and removed on sign-out.
- **Queue** `varsha-crm-queue-v1` = array of ops `{ opId, email, at /* client ISO time */, kind, ... }`:
  - `{kind:"add", row}`
  - `{kind:"patch", id, fields, base /* updatedAt seen when edited */}`
  - `{kind:"remove", id}`
  - `{kind:"log", row}`
  - `{kind:"done", args}`
  The queue is saved **before** the network call.
- **flush()**, serial and single-flight. For each op belonging to the current email:
  - `add`: `insertCustomer`. If the returned row has the same id but a different name (another device used the slug), make a new slug with `-2`..., rewrite the op and queued ops for the old id, and retry.
  - `patch`: `patchCustomer(id, fields, base)`.
    - Got a row: success. Rewrite `base` of later queued patches for the same id to the new `updated_at`, because those are our own edits.
    - Got `null`: fetch the row. Missing -> drop the op with the notice "<name> was removed on another device." If `Date.parse(op.at) > Date.parse(row.updated_at)` -> `patchCustomer(id, fields, null)` (ours is later, ours wins). Otherwise drop the op, adopt the server row, notice "A newer change from another device was kept for <name>." (`onChange("conflict")`).
  - `remove`, `log`, `done`: idempotent, sent as is.
  - On success: merge the returned rows, remove the op, save the cache, `onChange("queue")`.
  - On `network`: stop. The banner shows the pending count. Retry on `online`, on `visibilitychange`->visible, every 30 s while pending > 0, and on "Retry now".
  - On `auth`: stop and `onEvent("expired")`. The app shows sign-in over the page and keeps the queue; it flushes after sign-in.
  - On `invalid` or `denied`: drop the op, refetch that customer (or roll back the optimistic log entry), and `onChange("error", {message: "Could not save <name>: <reason>. The change was undone."})`.
- **Background refresh:** on `visibilitychange`->visible, if the last fetch was more than 60 s ago, `load()` runs quietly so the user sees edits from the phone or desktop.
- **Storage blocked:** writes still go straight to the database, but the cache and queue cannot persist. The existing `#storageWarn` shows the new text: "This browser is blocking saved data. Changes are sent to the database straight away, but if you are offline they will be lost when you refresh."
- **No `console.error`** from the store, because the smoke test fails on console errors. Use `console.warn`.

### 4.5 Screens and boot (`app.js`)

Boot:
1. `#boot` shows "Loading…".
2. `Store.init()`.
3. If auth is needed and there is no user: `#authView`.
4. Signed in: `isAllowed()`. False: `#deniedBox`. True: show `#app`, `Store.load()`, render on every `onChange`.

Auth markup, added in `index.html` before `#app`. The existing `<header>` and `<main>` are wrapped in `<div id="app" hidden>`:
```html
<div id="boot" class="boot">Loading…</div>
<section id="authView" class="auth" hidden aria-labelledby="authTitle">
  <div class="auth-card">
    <div class="company">Varsha Forgings</div>
    <h1 id="authTitle">Varsha <span>CRM</span></h1>
    <form id="signInForm" novalidate>
      <label>Email <input name="email" type="email" autocomplete="username" required></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
      <p class="err" id="authErr" role="alert" hidden></p>
      <button class="btn primary" type="submit">Sign in</button>
      <button class="link" type="button" id="forgot" hidden>Forgot password?</button>
    </form>
    <form id="resetForm" hidden> email + "Send reset link" + "Back to sign in" </form>
    <form id="newPassForm" hidden> new password (autocomplete=new-password, min 12) + confirm + "Save password" </form>
    <div id="deniedBox" hidden>
      <p>Signed in as <b id="deniedEmail"></b>, but this account is not on the allowed list. Ask the admin to add you.</p>
      <button class="btn" type="button" id="deniedOut">Sign out</button>
    </div>
    <p class="note" id="authMsg" role="status"></p>
  </div>
</section>
```
- Header (inside `#app`): `<div class="who" id="who" hidden><span id="whoEmail"></span> <button class="link" id="signOut" type="button">Sign out</button></div>`. It is hidden in local mode without auth.
- **There is no sign-up screen, by design.** Sign-ups are disabled, so people are added by the admin (§3.2 step 5).
- Sign-in error copy: "Email or password is wrong." (for any 400 from auth); "Too many attempts. Wait a few minutes and try again." (429); "No connection. Check your internet." (network).
- Sign-out: if `pending() > 0`, `confirm("3 changes are not saved to the database yet. Sign out anyway and lose them?")`. On OK, `signOut({force:true})` clears the session, cache and queue (view state is kept).
- Recovery link: supabase-js fires `PASSWORD_RECOVERY`, which shows `#newPassForm`.
- In local mode without fake auth, `#modeNote` (`.banner`) shows: "Not connected to the database. Changes stay in this browser; use the Export tab to keep them."

Banners (inside `main`, above the table):

| id | role | When | Text |
|---|---|---|---|
| `#storageWarn` | alert | storage blocked | §4.4 |
| `#unsaved` | status | `pending() > 0` | "N change(s) not saved to the database yet. They are kept in this browser and will be sent when the connection is back." + `<button id="retry">Retry now</button>` |
| `#syncErr` | alert | invalid/denied drop | message + dismiss × |
| `#notice` | status | migration, conflicts, load-from-cache | message + dismiss × |
| `#modeNote` | none | local mode, no auth | above |

The Phase 1 `#export` button is **moved** out of `#unsaved` into the Export tab (§5.7). It keeps the id `export`.

Load errors:
- With a cache: render it plus `#notice` "Could not reach the database. Showing the copy saved in this browser at 10:42."
- Without a cache: `#empty` shows "Could not reach the database (<reason>). If this lasts, the free project may be paused; the admin can restore it in Supabase." plus a Retry button.

### 4.6 Phase 1 behaviour that must not change

Filters, counts, search, sort, the overdue red row plus "Overdue by N days" text, Due today orange, India dates, tel links, grey italic guesses, the Disputed tag, add customer, remove (hand-added only), refresh persistence of edits and view, blocked-storage warning, 375px card layout, the export file.

The `render()` filter and sort move into `visibleCustomers()` so the table and P2-E use the same list.

---

## 5. UI specs

### 5.1 Row layout additions

- **Last contacted:** a line under the customer name, inside `td.name`: `<div class="lc">Last contacted 12 Oct 2026 · 7 days ago</div>`. For today: "Last contacted today"; for yesterday: "Last contacted yesterday". With none: "No contact logged yet". Colour is `--ink-dim` at `.8rem`, never red or green (rule 7). The same line appears in the 375px card, under the name.
- **Actions cell** `td.act` holds `<div class="acts">` with, in this order:
  - `button.btn-sm.done-btn` "✓ Done": only when `followUp` is set (overdue, today or later). `aria-label="Mark follow-up done for <name>"`, `aria-haspopup="dialog"`.
  - `button.btn-sm.notes-btn` "Notes" + `<span class="badge">3</span>`: the badge is only shown when count > 0. `aria-label="Notes for <name>, 3 entries"` (or "no entries"), `aria-haspopup="dialog"`.
  - `button.btn-sm.edit-btn` "Edit": `aria-label="Edit <name>"`.
  - Existing `.rm` ×: hand-added only. Confirm text: "Remove <name> from the list? Its N notes will be deleted too."
- Every `<tr>` gets `data-id="<id>"`. The `<th>` over the actions column gets `<span class="sr">Actions</span>`, with the `.sr` visually-hidden utility class.
- CSS (new tokens are not needed; reuse the existing ones):
  ```css
  .acts { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .btn-sm { font: inherit; font-size: .85rem; font-weight: 700; padding: 6px 10px; min-height: 36px; border-radius: 8px;
            border: 1.5px solid var(--line); background: #fff; color: var(--navy); cursor: pointer; white-space: nowrap; }
  .btn-sm:hover { border-color: var(--navy); }
  .btn-sm:focus-visible { outline: 3px solid var(--orange); outline-offset: 2px; }
  .badge { display: inline-block; min-width: 20px; margin-left: 6px; padding: 1px 6px; border-radius: 999px;
           background: var(--navy); color: #fff; font-size: .75rem; text-align: center; }
  .lc { font-size: .8rem; font-weight: 500; color: var(--ink-dim); margin-top: 3px; }
  @media (max-width: 860px) { td.act { justify-content: flex-start; } .acts { justify-content: flex-start; }
                              .btn-sm { min-height: 40px; padding: 8px 12px; } }
  ```

### 5.2 Done dialog (P2-A)

```html
<dialog id="doneDlg" aria-labelledby="doneTitle" aria-describedby="doneDue">
  <div class="dlg-head" id="doneTitle">Mark follow-up done</div>
  <form id="doneForm" method="dialog" novalidate>
    <p class="dlg-sub"><b id="doneName"></b> <span id="doneDue"></span></p>   <!-- "Follow-up was 16 Oct 2026 · Overdue by 3 days" -->
    <label>How did you follow up?
      <select name="type"><option selected>Call</option><option>Visit</option><option>Email</option><option>Telegram</option><option>Note</option></select></label>
    <label>Outcome note (optional)
      <textarea name="note" maxlength="500" rows="3"></textarea>
      <span class="count" id="doneCount">0/500</span></label>
    <label>Next follow-up (optional)
      <input name="next" type="date"></label>                                <!-- min = IST today -->
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
- On save: `Store.markDone(id, {type, note, next})`. The dialog closes. The row now shows the new follow-up (or none), the badge +1, and "Last contacted today". `#live` (an `aria-live="polite"` visually hidden div) says "Marked done. Next follow-up 26 Oct 2026." or "Marked done. No follow-up set."
- Status is **not** changed (rule 6).
- Validation: `next < today` shows `#doneErr` "Next follow-up cannot be in the past." and nothing is saved.
- Esc or Cancel closes without saving.
- Quick buttons fill `next = Store.addDays(today, n)`.

### 5.3 Notes drawer (P2-B)

```html
<dialog id="notesDlg" class="drawer" aria-labelledby="notesTitle">
  <div class="dlg-head drawer-head"><span id="notesTitle">Notes</span>
    <button class="x" type="button" id="notesClose" aria-label="Close notes">×</button></div>
  <div class="drawer-body">
    <p class="dlg-sub" id="notesSub"></p>                     <!-- "<name> · Last contacted 12 Oct 2026 · 3 entries" -->
    <form id="noteForm" novalidate>
      <div class="two">
        <label>Type <select name="type"><option>Call</option><option>Visit</option><option>Email</option><option>Telegram</option><option selected>Note</option></select></label>
        <label>Date <input name="at" type="date"></label>   <!-- value = max = IST today -->
      </div>
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
  `<div class="log-meta"><time datetime="2026-10-12">12 Oct 2026</time> · <span class="log-type">Call</span> [<span class="tag-done">Follow-up done</span>] [<span class="tag-pending">Not saved yet</span>]</div><p class="log-text"></p>[<div class="log-next">Next follow-up: 26 Oct 2026</div>]`.
  `.log-text { white-space: pre-wrap; overflow-wrap: anywhere; }`. An empty note shows nothing; a Done entry still shows its meta line.
- After a note is saved: the form resets (type keeps its last value, date resets to today), the entry appears at the top, the row badge and Last contacted update, and focus goes back to the textarea.
- The drawer re-renders on `Store.onChange` while open.
- CSS (watch out: `display` on a dialog overrides the closed state, so only style `[open]`):
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

### 5.4 Edit dialog (P2-C): reuses `#dlg`

- `#dlg` gets `data-mode="add"|"edit"`. In edit mode:
  - Title "Edit customer".
  - The follow-up/status row (`<div class="two" id="addOnly">`) is hidden; those fields are edited on the row.
  - Submit text "Save changes".
  - Note "Changes are saved to the database for everyone."
  - Fields are prefilled with `.value`.
- Submit: `Store.saveCustomer(id, {name, contact, phone, city, last})`.
- Duplicate name or empty name: show the inline `<p class="err" id="formErr" role="alert">` and keep the dialog open. **This replaces Phase 1's `alert()` for add mode too**, and the test changes to match.
- The `id` never changes, so the follow-up, status and notes stay attached after a rename.
- `form.name` is the input named "name". Keep using `form.elements.name` to avoid confusion with the form's own `name` property.

### 5.5 Keyboard and focus (all dialogs)

- `showModal()` traps focus. Esc closes (native `cancel`).
- The first field gets focus on open: Done -> type select; Notes -> note textarea; Edit -> name.
- On close, focus goes back to the button that opened the dialog. Rows are rebuilt by `render()`, so store `{id, cls}` and refocus `tr[data-id="<id>"] .<cls>` after render.
- In textareas, Ctrl+Enter or Cmd+Enter submits. In single-line inputs, Enter submits.
- Every error `<p>` has `role="alert"`. Counters (`.count`) update on `input`. They are not live regions, to avoid noisy announcements, but the counter text turns `--warn` at 450 or more characters.

### 5.6 375px

Cards as today. The name block includes `.lc`; the action buttons wrap left-aligned. Dialogs are `width: min(480px, calc(100vw - 32px))`, and the drawer is full screen. No sideways scroll anywhere: the test checks with the drawer open, the Done dialog open, and on the Export tab.

### 5.7 Export tab (P2-E)

**Tabs.** Below the header, inside `#app`:
```html
<nav class="tabs" role="tablist" aria-label="Sections">
  <button role="tab" id="tab-list" aria-controls="panel-list" aria-selected="true">Customers</button>
  <button role="tab" id="tab-export" aria-controls="panel-export" aria-selected="false" tabindex="-1">Export</button>
</nav>
<section id="panel-list" role="tabpanel" aria-labelledby="tab-list"> ...existing filters, banners, table... </section>
<section id="panel-export" role="tabpanel" aria-labelledby="tab-export" hidden> ... </section>
```
- Left/Right arrow keys move between tabs (roving tabindex). Home and End also work.
- The chosen tab is saved in the view key (`state.tab: "list"|"export"`) and survives a refresh.
- Banners (`#unsaved`, `#syncErr`, `#storageWarn`) sit **above** the tabs so they show on both.
- Style: navy underline 3px on the selected tab, `--ink-dim` text otherwise. On a phone the tabs are 50% width each.

**Export panel**, top to bottom:
1. Scope (a radio group, `fieldset` + `legend` "Which customers"):
   - `exportScope=shown` "Customers shown in the list now (N), with your current filters and search". This is the default.
   - `exportScope=all` "All customers (M)".
   The choice is saved in the view key.
   The live summary under it reads: "Filters: Overdue · Status: All · Search: "zf"" (or "No filters").
2. `<label><input type="checkbox" id="incNotes"> Include notes text (private: only tick this if the file stays with you)</label>`. It is unticked on every page load and **never remembered** (a deliberate exception to the refresh-persistence rule, for privacy). It affects CSV and Copy only.
3. Cards, each with a title, a one-line description and a button:
   - **Download CSV** `#csvBtn`: "Opens in Google Sheets with File > Import > Upload, or in Excel."
   - **Copy for Google Sheets** `#copyBtn`: "Copies the rows. Click cell A1 in your sheet and press Ctrl+V."
   - **Download customers.json** `#export` (existing id): "All customers, no notes. Safe to commit to git as the backup."
   - **Download backup (with notes)** `#backup`: "Everything, including private notes. Keep it safe and never commit it."
   - **Send to Google Sheet automatically** `#autoBtn`, `disabled`, plus a "Coming next" tag: "Will update a separate Google Sheet every day. Not the Collections Engine sheet."
4. `<p id="exportMsg" role="status">`: "Downloaded 12 customers." / "Copied 12 rows. Click cell A1 in your sheet and press Ctrl+V."
5. Copy fallback (hidden): `<div id="copyFallback" hidden><p>Your browser blocked copying. Select all the text below and copy it (Ctrl+C, or long-press then Copy).</p><textarea id="copyBox" readonly rows="8"></textarea></div>`.

**`export.js`**, pure functions with no DOM (also `module.exports` for Node tests):
```js
window.CrmExport = {
  COLUMNS: ["Customer", "Contact person", "Phone", "City", "Last order", "Follow-up", "Status", "Last contacted", "Notes count"],
  // rows: Customer[] (already filtered/sorted by the caller); store: { logCount(id), lastContacted(id), listLog(id) }
  table(rows, store, opts /* { includeNotes: boolean } */): string[][],  // header row first; adds "Notes" column only if includeNotes
  toCSV(table): string,     // "﻿" + RFC 4180: every field in double quotes, " doubled, rows joined by "\r\n", trailing "\r\n"
  toTSV(table): string,     // header + rows; \t, \r, \n inside values -> single space; rows joined by "\n"
  safeCell(v): string,      // if /^[=+\-@\t\r]/ prefix "'" (formula injection guard for Sheets/Excel)
  fileName(scope, today): string  // "varsha-crm-customers-2026-10-19.csv" or "varsha-crm-customers-shown-2026-10-19.csv"
};
```
- Cell values:
  - name, contact, phone (raw stored text), city (or state when no city, as on screen);
  - last order, follow-up, last contacted as `YYYY-MM-DD` or empty (Sheets reads these as dates);
  - status text;
  - notes count as a number.
- The notes column (only when ticked) holds every entry, newest first, joined by `" | "`, each as `"2026-10-12 Call: text"`. Done entries add `" (follow-up done)"`.
- Never included: emails, GST, `contactFrom`, `disputed`, `id`, internal timestamps.
- Copy:
  ```js
  try { await navigator.clipboard.writeText(tsv); msg("Copied ...") }
  catch { show #copyFallback; copyBox.value = tsv; copyBox.focus(); copyBox.select();
          try { document.execCommand("copy") } catch {} }
  ```
  The fallback stays visible until the next export action.
- Download uses the existing Blob + `<a download>` pattern with `type: "text/csv;charset=utf-8"`.

**"Send to Google Sheet automatically", design only, coming next**

| Option | How | Cost | Secrets | Verdict |
|---|---|---|---|---|
| (a) Google Apps Script web app | The user makes a **new** sheet "Varsha CRM export" and pastes a ~40-line Apps Script (`doPost`) that checks a shared token and overwrites the `Customers` tab. Deploy it as a web app ("Execute as: me", "Anyone"). A Supabase Edge Function (daily at 11:05 IST via pg_cron, plus an on-demand "Send now" that checks the caller's JWT and `am_i_allowed`) POSTs the rows. | $0 | Web-app URL + token stored as **Supabase secrets** (never in the page or git) | **Recommended.** Free, data stays in Google, no Google Cloud project, easy to revoke (re-deploy) |
| (b) Zapier webhook | The page or a function POSTs to a "Catch Hook" Zap -> Google Sheets row. | Webhooks need a paid Zapier plan; the free tier is 100 tasks/month | Hook URL acts as a password | Not recommended: cost, a third party sees customer data, row-by-row appends |
| (c) Supabase function + Google service account | Google Cloud project, service account, JSON key as a Supabase secret, sheet shared with the SA email, the function calls the Sheets API. | $0 | Long-lived SA private key | Workable but heavy: key management and Cloud console setup for a 42-row sheet |

Rules for whichever option is built later:
- The target is a **new** spreadsheet only. The Apps Script hard-codes its own spreadsheet id and refuses others. It must never touch "VFPL Collections Engine" (CLAUDE.md rule 1).
- No notes text unless the user explicitly turns it on in settings.
- It is never called from the browser with a secret.

### 5.8 Page copy updates

`#rule` text: "Pick a status and a follow-up date on each row. A follow-up date in the past turns red. Press Done when you have followed up, and Notes to see the call log. Last order is the customer's latest invoice date in the Collections sheet (it runs to 12 Jul 2026). Grey italic contact names are guessed from email addresses, and grey states come from GST numbers."

---

## 6. Test plan

### 6.1 How smoke.js runs with no Supabase

- `ctx.addInitScript(() => { window.CRM_TEST = { fakeAuth: { email: "owner@example.test", password: "test-pass-123" }, deniedUser: { email: "other@example.test", password: "test-pass-123" } }; })` on every context. Store then picks LocalBackend with fake auth. supabase-js is never requested, so there is no network and no CDN.
- The test server adds `'.js': 'text/javascript'` to `types`. Without it, `.js` would be served as `text/plain`.
- Helper `login(page, who = 'owner')` fills `#signInForm` and waits for `#rows tr`. `reload()` keeps waiting for `#rows tr`, because the session persists.
- Every existing check stays, with these exact changes:
  - (a) log in once after `goto`;
  - (b) the duplicate-name check reads `#formErr` instead of accepting `alert`;
  - (c) the export key check expects `city,contact,contactFrom,disputed,followUp,id,last,name,phone,state,status`;
  - (d) the export click goes to the Export tab first (`#tab-export`);
  - (e) the blocked-storage context logs in first.
- Clipboard: the main context is created with `permissions: ['clipboard-read', 'clipboard-write']`.

### 6.2 New checks (exact names; each fails with a useful `extra`)

Auth (T2):
- `login screen shows before sign-in` (`#authView` visible, `#app` hidden)
- `wrong password shows an error` (`#authErr` = "Email or password is wrong.")
- `sign-in shows all 42 customers` and `header shows the signed-in email`
- `session survives a refresh` (no `#authView` after reload)
- `not-allowed user sees the denied message and no rows` (new context, deniedUser)
- `sign out returns to the login screen and clears the cache` (after reload still login; `localStorage['varsha-crm-cache-v1']` is null)

Migration and queue (T2):
- `Phase 1 browser edits move to the database`. New context with init script setting `varsha-crm-local-v2` = `{status:{"NR INDUSTRIES":"At risk"}, follow:{"NEEL METAL PRODUCTS LIMITED": istToday(2)}, added:[{name:"Legacy Forge", phone:"9000000000", status:"Active", followUp:""}]}`. After login: NR = At risk, NEEL follow-up = +2, Legacy Forge exists (43 rows), `#notice` contains "Moved 3 changes".
- `moved edits survive a refresh and the notice does not repeat`. The legacy key is gone and the backup key exists.
- `offline change shows right away and is queued`. `__crmFake.setOffline(true)`, set a status: the select shows the new value and `#unsaved` shows "1 change".
- `queued change survives a refresh while offline`
- `queued change is sent when back online`. `setOffline(false)`, click `#retry`: `#unsaved` hidden, reload, value kept.

P2-A Done (T3):
- `Done button only on rows with a follow-up` (count of `.done-btn` equals rows with a date)
- `Done with a note and next date moves the follow-up`: ZF row, note "Spoke to Swapnil", quick "In 1 week": input = istToday(7), `.rel` "In 7 days", row not `overdue`
- `Done adds a log entry and sets Last contacted today` (badge "1", `.lc` "Last contacted today")
- `Done survives a refresh` (all three above after reload; the drawer shows "Follow-up done" and the note text)
- `Done without a next date clears the follow-up` (NEEL: input empty, "No follow-up set" count +1, kept after reload)
- `Done refuses a past next date` (`#doneErr` visible, follow-up unchanged)
- `Esc closes Done without saving` (badge unchanged)

P2-B Notes (T3):
- `Notes drawer adds an entry at the top` (type Visit, "Met at plant"; first `li` contains it; badge +1)
- `note is limited to 500 characters` (fill 600 chars: value length 500, `#noteCount` "500/500")
- `older-dated note sorts below newer ones` (add at istToday(-5): it appears last)
- `notes and badge survive a refresh` and `Last contacted is the newest date`
- `note text is shown as text, not HTML` (note `<b>x</b>`: `li .log-text` innerText contains `<b>x</b>` and `li b` count is 0)
- `empty note is refused` (`#noteErr` visible)

P2-C Edit (T3):
- `edit changes name, contact, phone and city` (ZF -> "ZF STEERING GEAR INDIA LTD PUNE", "Anil Kulkarni", "9123456789", "Pune")
- `rename keeps the same id` (`data-id` = `zf-steering-gear-india-ltd`)
- `renamed customer keeps follow-up, status and notes`, then `edits survive a refresh`
- `edited contact is no longer shown as a guess` (no `.guess` on the contact cell)
- `rename to an existing name is refused` (`#formErr` shows "is already in the list"; row count unchanged)

P2-E Export (T4):
- `Export tab opens and survives a refresh` (`aria-selected`, panel visible after reload)
- `CSV starts with a BOM and has the exact header`: `﻿"Customer","Contact person","Phone","City","Last order","Follow-up","Status","Last contacted","Notes count"`
- `CSV respects the current filter` (Overdue filter on: data rows = Overdue chip count; filename contains `shown`)
- `CSV "All customers" has every row` (rows = total)
- `CSV has no notes unless the box is ticked` (no "Notes" header and no note text; tick: header ends `,"Notes"`, the ZF row contains "Spoke to Swapnil")
- `notes box is unticked after a refresh`
- `CSV guards formulas` (customer added with contact "=1+1": cell is `"'=1+1"`)
- `CSV has no emails or GST` (no `@`-email pattern and no 15-char GSTIN pattern `\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z0-9]` in the output)
- `Copy puts tab-separated rows on the clipboard` (readText starts with `Customer\tContact person`; line count = rows + 1)
- `Copy falls back when the clipboard is blocked` (new context with init script `navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'))`: `#copyFallback` visible, `#copyBox` value starts with `Customer\t`)
- `backup file includes notes and is named varsha-crm-backup-<date>.json` (`callLog.length >= 1`)
- `customers.json export never includes notes` (no `note`/`callLog` keys; ZF note text absent)
- `automatic Sheet export is marked coming next and disabled`
- `no sideways scroll on the Export tab at 375px`

Layout, security guards (T2 adds the guards, T3 the layout):
- `no sideways scroll on a phone with the Notes drawer open` and `...with the Done dialog open`
- `Done, Notes and Edit buttons are visible in the phone card`
- `no innerHTML in index.html, app.js, store.js or export.js` (fs read + regex `/innerHTML/`)
- `config.js holds no secret key` (no `sb_secret_`, no `service_role`; any `eyJ...` JWT payload has `role === "anon"`)
- `no console errors` stays last.

`tests/export-unit.js` (T4, plain Node, `node tests/export-unit.js`) unit-tests `toCSV` quoting (quotes, commas, newlines, `–`, Devanagari), `safeCell`, `toTSV` tab and newline flattening, and the BOM. The lead runs it next to smoke.js.

### 6.3 Live checklist against the real project (T5 deploy agent, after T1 + lead merge)

1. `curl -s "$URL/rest/v1/customers?select=id&limit=1" -H "apikey: $KEY"` returns an error (401/42501), **never rows**. Same for `call_log`, `allowed_users`, `v_followups_due`, and `POST rpc/mark_done`. With a legacy JWT key, add `-H "Authorization: Bearer $KEY"`; with `sb_publishable_` keys, send only `apikey`.
2. `curl -s -X POST "$URL/auth/v1/signup" -H "apikey: $KEY" -H "content-type: application/json" -d '{"email":"probe@example.com","password":"Probe-12345678"}'` returns 422 `signup_disabled`.
3. `supabase/verify_rls.sql` in the SQL Editor ends with `ALL RLS CHECKS PASSED`.
4. Advisors -> Security: no ERROR or WARN (the INFO on `allowed_users` is expected).
5. Live page: sign in as `<ALLOWED_EMAIL>`: 42 rows, header email. Then:
   - Set a status, a follow-up and Done with a note; add a note; edit a name.
   - Refresh: everything is kept.
   - Open on a phone (375px): the same data is there.
6. Offline: in DevTools set Network to Offline, change a status: banner "1 change". Go online and press Retry: the banner clears, refresh, the change is kept.
7. Export tab: CSV opens in Google Sheets (File > Import > Upload) with readable `–` and Devanagari. Copy, then paste into a blank Sheet: the columns line up.
8. Sign out: the login screen shows and `varsha-crm-cache-v1` is gone (DevTools > Application).
9. `git grep -nE "sb_secret_|service_role|varsha-crm-backup"` in the repo finds only the guard test and the docs. `git status` shows no backup or CSV files.
10. SQL Editor: `select * from public.v_followups_due;` matches the page's Overdue + Due today counts.
11. Clean up any probe rows (`delete from public.customers where id like 'zz-%';`).

---

## 7. Build breakdown (Sonnet agents)

File ownership is exclusive while a task runs. Tasks that share a file run **one after another**, never at the same time.

| Task | Owns (creates/edits) | Starts after | Can run in parallel with |
|---|---|---|---|
| **T1 Backend** | `supabase/migrations/20261019000100_phase2.sql`, `supabase/verify_rls.sql`, `scripts/make-seed.js`, `.gitignore` | design approved; deploy half waits for the lead to create the project (§3.2) | T2 |
| **T2 Data layer + login** | `store.js`, `config.js`, `app.js` (new, moved from inline), `index.html`, `tests/smoke.js` | design approved | T1 |
| **T3 Features P2-A/B/C** | `app.js`, `index.html`, `tests/smoke.js` | T2 reported + lead check | T4 part 1 |
| **T4 Export P2-E** | part 1: `export.js`, `tests/export-unit.js`; part 2: `app.js`, `index.html`, `tests/smoke.js`, `README.md` | part 1: T2 reported (it needs `Store` reads); part 2: T3 reported + lead check | part 1 with T3 |
| **T5 Deploy + live check** | `config.js` (fill URL + key only) | T1 deployed + T4 part 2 checked; lead merges | none |

Order: **T1 ∥ T2 → T3 (∥ T4.1) → T4.2 → lead review → T5.**
Each task works on its own branch `phase2/tN-...` and pushes it, then reports with commit and file links. Merges to `main` are the lead's call (CLAUDE.md).

### T1 Backend
- **Inputs:** §2, §3, `customers.json` (or the Phase 1 export the lead hands over), the slug function from §2.3. T1 can copy it into make-seed.js until store.js exists, then switch to `require("../store.js").slug`.
- **Do:**
  - Write the migration exactly as in §2.1.
  - Write `verify_rls.sql`: transactions that switch role with `set local role anon` / `authenticated` and `set_config('request.jwt.claims', ...)`. Each check is a `DO` block that raises `FAIL n: ...` on failure. It covers anon denied on every table, view and RPC; a stranger sees 0 rows and cannot insert, update, read `allowed_users` or use `mark_done`; the allowed user (claims built from `auth.users where email = '<ALLOWED_EMAIL>'`) can read ≥42, insert, update, log, mark_done and delete a `zz-rls-probe` row, but cannot delete a seed row, change an id, or update a log entry. Everything is rolled back, and the script ends with `select 'ALL RLS CHECKS PASSED'`.
  - Write `make-seed.js` (§2.4) and `.gitignore` (§3.4).
  - Once the lead has created the project and the user: apply the migration, insert the allowlist row, generate and run the seed, run `verify_rls.sql`, run curl checks 1–2 from §6.3, and run the Advisors. Use the SQL Editor, or the Supabase MCP `apply_migration`/`execute_sql` tools only if the lead grants them.
- **Acceptance:** `select count(*) from customers` = 42 (or the export's count), all with `source='seed'`; verify script passes; anon curl gets no rows; signup returns 422; no Advisor WARN or ERROR.
- **Report:** project ref and URL, which key type to use (publishable or legacy anon; this value is public), the outputs of each check, and any deviation from the SQL. Never paste the service_role key or the DB password.

### T2 Data layer + login
- **Inputs:** §1, §4, §5.5, §6.1, and the current `index.html` / `tests/smoke.js`.
- **Do:**
  - Move the inline `<script>` into `app.js` unchanged first, and run the tests (27 pass). Then add the CSP meta, the `defer` script tags, and `config.js` with blank values.
  - Write `store.js` with both backends, the queue, LWW, cache, migration (§2.5), validation, `exportCustomersJson`, `exportBackup` and `slug`.
  - Rewire `app.js` to use `Store` (remove `local`, `build`, `baseStatus` and everything keyed by name); `data-id` on rows; `visibleCustomers()`.
  - Add the auth screens, `#who`, the banners table from §4.5, and `#modeNote`.
  - Put a temporary Export tab shell containing `#export` and `#backup`, so the Phase 1 export check keeps working. T4 replaces it.
  - Update smoke.js per §6.1 and add the Auth, Migration, Queue and guard checks from §6.2.
  - Compute the SRI for the pinned supabase-js and write the SupabaseBackend. It cannot be run without the project; T5 verifies it.
- **Acceptance:** `NODE_PATH=$(npm root -g) node tests/smoke.js` passes all checks (27 adapted + about 13 new). No `innerHTML`. Local mode without `CRM_TEST` still works by serving the folder with any static server, with no login. Every Phase 1 behaviour in §4.6 is unchanged. The page passes CSP with no violations in the console.
- **Report:** test output, supabase-js version + SRI, the exact `Store` API as built (any signature difference from §4.2 must be listed), branch and commit link.

### T3 Features P2-A, P2-B, P2-C
- **Inputs:** §5.1–5.6, §5.8, §6.2 (P2-A/B/C + layout), T2's report.
- **Do:** row actions, Last contacted, the Done dialog, the Notes drawer, edit mode of `#dlg` with `#formErr`, the `#live` region, focus return, CSS from §5, the `#rule` copy. Only use `Store` methods; if something is missing, report it rather than reaching into the backends.
- **Acceptance:** all smoke checks pass (T2's plus about 25 new); 375px checks pass; keyboard: Esc closes every dialog and focus returns to the trigger button (check by hand and say so in the report).
- **Report:** test output, before/after screenshots at 1280px and 375px (saved outside the repo, paths in the report), branch and commit link.

### T4 Export P2-E
- **Part 1, in parallel with T3:** `export.js` per §5.7 and `tests/export-unit.js`. It touches no DOM files.
- **Part 2, after T3:**
  - The tab markup and ARIA, and the Export panel replacing T2's shell (keep the ids `export` and `backup`).
  - Scope radio and the view-state keys `tab` and `exportScope`; the notes checkbox (not persisted).
  - CSV download, copy with fallback, and the disabled "coming next" card.
  - The P2-E checks in smoke.js.
  - README updates: files list, login, Export tab, backup warning, a "notes never in git" line, and the test command for the unit tests.
- **Acceptance:** `node tests/export-unit.js` and smoke.js both pass, and a 375px export check passes.
- **Report:** both test outputs, a sample CSV header line, branch and commit link.

### T5 Deploy + live check
- Fill `config.js` with the URL and key from T1's report. The lead pushes or merges; GitHub Pages serves the site.
- Run the §6.3 checklist and fill it in with pass/fail and evidence. If check 5 fails because of the publishable key, switch to the legacy anon key and record it.
- **Report:** the live URL, the checklist results, and any fixes needed (as findings, not edits, unless the lead asks).

### CLAUDE.md updates the lead should make (not done by this agent)
- Rule 1: "Customers live in the Supabase database. `customers.json` is the seed, the local-mode data and the git-safe export (no notes). Call-log notes are never committed. Backup and CSV files are gitignored."
- Rule 2: "Every action is saved to the database (queued in localStorage when offline) and must survive a refresh. Customer fields are in the customers.json export; notes are in the backup export. The 'Include notes' box is deliberately not remembered."
- New rule: "Only the publishable or anon key goes in `config.js`. Never the service_role or secret key."
- New gotchas:
  - "PostgREST returns at most 1000 rows per request; page with `range()`."
  - "Supabase free projects pause after 7 days without activity."
  - "`display` on a `<dialog>` shows it even when closed; style `dialog[open]` only."
  - "Serve `.js` as `text/javascript` in the test server."

---

## 8. Risks and Plan B

| # | Risk | Plan B |
|---|---|---|
| 1 | The free project **pauses after 7 days idle**, so the page cannot reach the database. | The cache keeps the last copy readable and writes are queued. The lead presses Restore in the dashboard (about 1 minute). Daily use, and later the daily Telegram job, keeps the project awake. Check after the first quiet week. |
| 2 | An RLS or grant mistake exposes data. | `verify_rls.sql`, the anon curl checks and the Advisors run before go-live. Emergency: `revoke all on public.customers, public.call_log from authenticated;` (the page stops working, the data is safe), then fix and re-grant. |
| 3 | The CDN is down or the SRI does not match, so supabase-js does not load. | The error banner says so. Vendor the pinned file into `vendor/` and point `SB_JS.url` at it. |
| 4 | The publishable key does not work with the pinned supabase-js. | Use the legacy anon JWT (same `anon` role, same safety). |
| 5 | Password reset email is not delivered (built-in SMTP is limited). | The lead resets it in Dashboard -> Users, or deletes and re-creates the user with the same email (the allowlist row stays). Later: free SMTP such as Brevo. |
| 6 | No backups on the free plan. | "Download backup (with notes)" weekly, kept off git. Optional monthly `pg_dump` by the lead with the DB connection string. |
| 7 | The localStorage cache fills up as notes grow (about 5 MB). | Cache writes fail quietly and show `#storageWarn`. Plan B: cache only customers plus log counts, and load a customer's notes when the drawer opens. |
| 8 | Device clock skew affects LWW in a real conflict. | Single user now, so conflicts are rare. Server `updated_at` decides; client time is only used for queued ops in a genuine conflict. A notice tells the user which value was kept. |
| 9 | Stale Phase 1 edits from a second browser overwrite newer data. | The `updated_at === created_at` guard, plus seeding from the user's fresh export. |
| 10 | GitHub Pages serves an old `app.js` with a new `index.html`. | `?v=` cache-bust on every script tag, bumped on every release. |
| 11 | Two agents edit the same file. | The ownership table and sequential slots in §7; each task on its own branch. |
| 12 | The CSP blocks something in production that tests did not hit (the Supabase domain). | T5 checks the console. Plan B: widen `connect-src` to the exact project URL; never add `'unsafe-inline'` to `script-src`. |
| 13 | Supabase is unavailable for a long time. | Clear `config.js` values to fall back to local mode (Phase 1 behaviour + features, one browser) and restore from the backup file later with `make-seed.js`. Log rows need a small import script; write it only if needed. |

## 9. Open questions for the user (each with a recommended answer)

1. **Phone numbers and contact names are public today.** `customers.json` is in a public repo and served by GitHub Pages. Once the data is in the private database, should the committed file keep them?
   *Recommended:* after T1 seeds and verifies, blank `phone` and `contact` in the committed `customers.json` (tests do not depend on them). Accept that git history still has them; rewriting history is not worth the risk.
2. **Should a "Note" entry count as "Last contacted"?** A note is not always a contact.
   *Recommended:* no; count only Call, Visit, Email and Telegram. It is a one-line change to `CONTACT_TYPES`. Builders use all five until you answer.
3. **Can log entries be edited or deleted from the page?**
   *Recommended:* no for now (append-only). Fix a mistake by adding a new note. The admin can delete a row in Supabase if really needed.
4. **For the automatic Google Sheet (coming next): Apps Script into a new sheet, and should phones go to Telegram or Sheets?**
   *Recommended:* Apps Script web app called by a Supabase scheduled function, writing to a **new** sheet "Varsha CRM export". The Telegram reminder lists customer name, days overdue and contact person, and leaves out phone numbers.
5. **"Forgot password" on the login screen?** The built-in email service is very limited.
   *Recommended:* hide it for now (`allowPasswordReset: false`); the lead resets passwords in the dashboard. Turn it on later with a free SMTP provider when the team logins arrive.
