# FestPass

**Music festival ticketing & vendor management.** Named digital tickets with unique QR codes, gate scanning with anti‑passback, one controlled transfer per ticket, date‑based refunds, vendor registration, stall applications and allocation, a single payment ledger, and dashboards for organizers and auditors.

| Layer | Technology | Folder |
|---|---|---|
| Presentation | React 18 + Vite, React Router, Recharts, `qrcode.react`, `html5-qrcode` | [`client/`](client) |
| Core API | Node.js + Express, JWT role‑based auth, bcrypt, zod validation, scheduled jobs | [`server/`](server) |
| Analytics API | Python FastAPI (read‑only): dashboards, reports, ledgers, audit trails, CSV exports | [`reports/`](reports) |
| Data | MySQL 8.0, InnoDB, utf8mb4: 11 tables, CHECK/UNIQUE/FK constraints, 12 triggers, 6 views | [`database/`](database) |

```
Browser (React) ──/api────────► Express  ──┐
                └─/analytics──► FastAPI  ──┴──► MySQL 8 (single source of truth)
```

Both services share the same database and the same JWT secret: Express issues the token at sign‑in, FastAPI verifies it.

---

## Quick start

### 1. Requirements
- Node.js 18+ and npm
- Python 3.10+
- MySQL 8.0 (local install, or `docker compose up -d` with the included [`docker-compose.yml`](docker-compose.yml))

### 2. Database user
With a local MySQL, create the app user once (as root):

```sql
CREATE USER 'festpass'@'localhost' IDENTIFIED BY 'festpass';
GRANT ALL PRIVILEGES ON festpass.* TO 'festpass'@'localhost';
GRANT CREATE, DROP ON *.* TO 'festpass'@'localhost';
-- only if binary logging is on (MySQL default) and the user is not SUPER:
SET GLOBAL log_bin_trust_function_creators = 1;
```

(Using Docker? `docker compose up -d` does all of this for you.)

### 3. Install, configure, seed

```bash
git clone https://github.com/IamMikerex/festpass.git && cd festpass
npm run install:all                      # server + client npm deps, reports/.venv with pip deps

cp server/.env.example server/.env       # set DB_* and a long random JWT_SECRET
cp reports/.env.example reports/.env     # same DB_* and the SAME JWT_SECRET

npm run db:init                          # drops + creates `festpass`, loads schema.sql and seed.sql
```

You can also load the SQL directly: `mysql -u root -p < database/schema.sql && mysql -u root -p festpass < database/seed.sql`.

### 4. Run (three terminals)

```bash
npm run dev:api          # Express      http://localhost:4000/api
npm run dev:analytics    # FastAPI      http://localhost:8000/analytics  (docs: /analytics/docs)
npm run dev:client       # React (Vite) http://localhost:5173
```

Open **http://localhost:5173**. Vite proxies `/api` and `/analytics` to the two services.

**Production-style single port:** `npm run build` then `npm start` serves the built React app from Express on port 4000 and forwards `/analytics/*` to FastAPI (`ANALYTICS_URL`).

### 5. Demo accounts
Every seeded account uses the password **`Password123!`** (the sign‑in page has one‑click buttons).

| Role | Email | Try this |
|---|---|---|
| Attendee | `ayse@festpass.com` | My tickets → Show QR, Transfer, Refund 90% |
| Attendee | `can@festpass.com` | Buy tickets, pay (card ending `0002` is declined) |
| Attendee (15 years old) | `deniz@festpass.com` | Age limit blocks purchase (rule 4) |
| Organizer | `organizer@festpass.com` | Dashboard, festival lifecycle, tiers, stalls, approvals, cancellations, users |
| Organizer (other) | `organizer2@festpass.com` | Owns only *Cappadocia Echoes* (scoping) |
| Vendor manager | `vendor@festpass.com` | Businesses, stall map, apply, pay fee, cancel |
| Vendor manager | `vendor2@festpass.com` | One vendor with an expiring hygiene certificate (rule 9) |
| Gate staff | `gate@festpass.com` | Scanner on *Bosphorus Beats* (live now) |
| Finance auditor | `auditor@festpass.com` | Read‑only ledger, reconciliation, audit trail |

Seed dates are relative to the day you run `db:init`, so there is always a live festival (gate demo), one 5 days out (no refund band), one 15 days out (50% band), one 45 days out (90% band), a draft and a completed one. Re‑run `npm run db:init` to reset.

### Presenting the system (demo mode)

```bash
npm run demo:reset   # base data + demo scenarios played through the real API (run it on the day you present)
npm run demo:qr      # real QR codes for each gate outcome: admit, duplicate, re-entry, refunded, void, wrong festival
```

`demo:reset` adds a cancelled festival, tickets in every status (VALID, CHECKED_IN, REFUNDED, VOID), a declined card payment, refunds in each band, transfers, stall applications in every stage, a blacklisted vendor and refused gate scans. Every step goes through the API as the user who would do it, so no business rule is bypassed. **[DEMO_GUIDE.md](DEMO_GUIDE.md)** has the accounts, the data and a click-by-click script for each feature.

To scan without a camera: paste a code from `npm run demo:qr` into the scanner's code box, or open an attendee's **Show QR** on a phone and use the scanner's camera.

### 6. Tests

```bash
npm test     # 15 Express business-rule tests (re-seeds the DB!) + 7 FastAPI tests
```

The Express suite runs against real MySQL and covers every rule below, including concurrency (8 parallel buyers for the last ticket; the same QR at two gates at once).

---

## Frontend design

The React client uses a dark, festival-night theme with neon purple, magenta and orange accents (all tokens live at the top of `client/src/styles.css`).

- **Visitors** get an immersive home page: a full-screen hero for the next festival with a live countdown, poster-style festival cards, on-site zones and a vendor call-to-action.
- **Signed-in fans, organizers, auditors and vendors** get a sidebar grouped into sections, with the main action pinned at the top (Find tickets, New festival, Apply for a stall). On phones the sidebar becomes a drawer and a bottom tab bar appears.
- **Gate staff** get a minimal one-column scanner with large Entry/Exit buttons and a full-width ADMIT/REFUSE result.

Festival imagery: the database stores no images, so each festival shows generated poster art (stage lights, lasers, crowd silhouette) with an event photo from Unsplash fading in on top. Photo IDs are in `client/src/lib/media.js`; swap them for your own photography, or set `VITE_REMOTE_PHOTOS=false` in `client/.env` to use only the generated art (for example offline).

## Business rules → where they are enforced

| # | Rule | Database | API |
|---|---|---|---|
| 1 | ≤ `max_per_order` per tier per order; ≤ 10 tickets per buyer per festival (PAID + PENDING) | `chk_tiers_max`, `trg_tickets_bi` | `services/orders.js` |
| 2 | Tier quota is hard; Σ quotas ≤ `daily_capacity` | `trg_tiers_bi/bu`, `trg_festivals_bu` | `SELECT … FOR UPDATE` on tier rows |
| 3 | 10‑minute checkout hold → EXPIRED + tickets VOID | `chk_orders_expiry` | order‑expiry job (`jobs.js`, `FOR UPDATE SKIP LOCKED`) + check at payment |
| 4 | Holder age ≥ `min_age` on start date | `trg_tickets_bi`, `trg_tickets_bu` | pre‑checks with friendly messages |
| 5 | One transfer, VALID only, ≥ 48 h before start; new QR token | `UNIQUE(ticket_id)`, `chk_transfers_users`, `trg_transfers_bi`, `trg_tickets_bu` | `services/tickets.js` (row lock) |
| 6 | Refund 90% (≥ 30 days) / 50% (7–29) / 0% (< 7); never after check‑in | `v_ticket_refund_quote` | `services/tickets.js` |
| 7 | Cancellation → 100% refunds (one REFUND row per order), approved stalls annulled + fees reimbursed | | `services/festivals.js#cancelFestival` (one transaction) |
| 8 | Anti‑passback: IN accepted only if VALID/CHECKED_IN, festival live, last accepted scan is OUT or none | `v_ticket_last_scan`, `trg_scans_bi` | `services/scans.js` (ticket row lock) |
| 9 | Vendor ACTIVE, license (and hygiene cert. for FOOD/BEVERAGE) valid through `end_date` | `chk_vendors_hygiene`, `trg_alloc_bi`, `trg_alloc_bu` | `services/vendors.js#eligibility` |
| 10 | One APPROVED allocation per stall; ≤ 2 approved stalls per vendor per festival | `UNIQUE(stall_id, approved_marker)`, `trg_alloc_bu` | stall row lock before approval |
| 11 | Fee due within 7 days of approval else auto‑CANCELLED; vendor cancel < 21 days → 50% forfeited | `v_allocation_balance` | fee‑deadline job, `services/vendors.js#cancel` |
| 12 | DRAFT → ON_SALE → LIVE → COMPLETED, any but COMPLETED → CANCELLED; sell only ON_SALE; price frozen after first sale | `trg_festivals_bu`, `trg_tickets_bi`, `trg_tiers_bu` | lifecycle job advances ON_SALE→LIVE→COMPLETED by date |
| 13 | Payment belongs to exactly one order or allocation; Σ REFUND ≤ Σ CAPTURED | `chk_payments_arc`, `trg_payments_bi`, `UNIQUE(provider_ref)` | idempotent webhook, reconciliation report |

Concurrency cases from Part 3 d: overselling (tier row `FOR UPDATE`), the same QR at two gates (ticket row `FOR UPDATE`), two coordinators approving one stall (stall row `FOR UPDATE` + unique marker), refund vs. transfer (both lock the ticket and re‑check `VALID`), duplicate webhooks (`UNIQUE(provider_ref)`).

### Notes on the schema
- Table and column names, types and constraints follow the assignment document. No calculated values are stored; totals, sold counts, remaining quota, refund quotes, fee balances and "inside now" counts come from the views at the end of [`schema.sql`](database/schema.sql).
- MySQL does not allow `ON UPDATE CASCADE` on a column that a `CHECK` constraint uses. `Payments.order_id/allocation_id` and `TicketTransfers.from_user_id/to_user_id` therefore use `ON UPDATE RESTRICT`. Surrogate keys never change, so behaviour is identical.
- Extra guard triggers beyond the document: festival organizer must have role ORGANIZER, vendor manager must be VENDOR_MANAGER, scans must be made by GATE_STAFF, refunds cannot exceed charges (rule 13), terminal ticket states cannot change.
- Users are never hard‑deleted: "Delete" sets `account_status = 'DELETED'` and anonymises name/email/phone (KVKK) while keeping orders, payments and scans for the audit trail.

---

## API overview

All routes are JSON. Send `Authorization: Bearer <token>` from `/api/auth/login`.

**Express, `/api`**

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` (ATTENDEE or VENDOR_MANAGER), `POST /auth/login`, `GET/PUT /auth/me`, `PUT /auth/password` |
| Festivals | `GET /festivals`, `GET /festivals/:id`, `GET /festivals/mine`, `POST /festivals`, `PUT /festivals/:id`, `POST /festivals/:id/status`, `DELETE /festivals/:id` (draft) |
| Tiers | `POST /festivals/:id/tiers`, `PUT/DELETE /festivals/:id/tiers/:tierId` |
| Stalls | `GET/POST /festivals/:id/stalls`, `PUT/DELETE /festivals/:id/stalls/:stallId`, `GET /festivals/:id/allocations` |
| Orders | `POST /orders`, `GET /orders`, `GET /orders/:id`, `POST /orders/:id/pay`, `POST /orders/:id/cancel` |
| Tickets | `GET /tickets`, `GET /tickets/:id` (QR only for the holder), `GET /tickets/:id/history`, `POST /tickets/:id/transfer`, `POST /tickets/:id/refund` |
| Gate | `POST /scans`, `GET /scans/recent`, `GET /scans/festivals` |
| Vendors | `GET/POST /vendors`, `GET /vendors/mine`, `PUT /vendors/:id`, `POST /vendors/:id/status` |
| Allocations | `POST /allocations`, `GET /allocations/mine`, `GET /allocations/pending`, `POST /allocations/:id/approve|reject|cancel|pay` |
| Payments | `POST /payments/webhook` (header `X-Webhook-Secret`), `GET /payments/mine` |
| Admin | `GET/POST /admin/users`, `PATCH /admin/users/:id/status` |

**FastAPI, `/analytics`** (ORGANIZER sees own festivals, AUDITOR sees all; interactive docs at `/analytics/docs`)

`GET /dashboard`, `GET /festivals/{id}/report`, `GET /festivals/{id}/attendees`, `GET /payments`, `GET /reconciliation`, `GET /transfers`, `GET /scans`, `GET /tickets/{id}/trail`. Add `?format=csv` to attendees, payments, transfers and scans for a CSV download.

### Payments
The gateway is simulated (`server/src/services/gateway.js`): every method captures instantly, except a card number ending in **0002**, which is declined and recorded as a FAILED payment. Each charge and refund is its own `Payments` row with a unique `provider_ref`. To plug in a real PSP, replace `gateway.charge/refund` and point its webhook at `POST /api/payments/webhook`.

---

## Security
- Passwords hashed with bcrypt (cost 10); only the hash is stored (`CHAR(60)`).
- JWT (HS256, 8 h) with role checks on every route; suspended/deleted accounts are rejected on each request.
- Public sign‑up can only create attendee or vendor accounts; staff accounts are created by organizers.
- All SQL is parameterised; inputs validated with zod (Express) and typed query parameters (FastAPI).
- Organizers only see and change their own festivals; the auditor role is read‑only.
- QR tokens are 256‑bit random values and are only returned to the current holder of a paid ticket; ticket IDs are UUIDs.
- Login and registration are rate‑limited; helmet sets security headers; the webhook secret is compared in constant time.

## Project layout

```
database/   schema.sql (tables, triggers, views) · seed.sql · grant.sql
server/     Express API: src/routes, src/services (business rules), src/jobs.js, tests/
reports/    FastAPI analytics: app/reports.py, tests/
client/     React app: src/pages (public, attendee, vendor, gate, admin), src/components
```
