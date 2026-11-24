# FestPass

**Music festival ticketing & vendor management.** Named digital tickets with unique QR codes, gate scanning with anti‑passback, one controlled transfer per ticket, date‑based refunds, vendor registration, stall applications and allocation, a single payment ledger, and dashboards for organizers and auditors.

| Layer | Technology | Folder |
|---|---|---|
| Presentation | React 18 + Vite, React Router, Recharts, `qrcode.react`, `html5-qrcode` | [`client/`](client) |
| API | Python FastAPI: Pydantic validation, JWT role‑based auth, bcrypt, scheduled jobs, analytics and CSV exports | [`api/`](api) |
| Data | MySQL 8.0, InnoDB, utf8mb4: 11 tables, CHECK/UNIQUE/FK constraints, 12 triggers, 6 views | [`database/`](database) |

```
Browser (React) ──/api, /analytics──► FastAPI ──► MySQL 8 (single source of truth)
```

One FastAPI app serves the core API (`/api`), the read‑only analytics (`/analytics`) and, in production, the built React app.

---

## Live demo

**https://festpass-web-production.up.railway.app**: open it in any browser, nothing to install. Sign in with a [demo account](#5-demo-accounts), for example `can@festpass.com` (fan), `organizer@festpass.com` (organizer) or `gate@festpass.com` (gate staff). The password for every account is `Password123!`.

Hosted on [Railway](https://railway.com): one service built from this repo's `Dockerfile` (React + FastAPI), plus a MySQL 8 service with a persistent volume. Every push to `main` redeploys automatically. On first start the container loads `database/festpass.sql`; later starts keep the existing data (`python -m scripts.init_db --if-empty`).

Railway variables for the web service (see [`api/.env.example`](api/.env.example)): `APP_ENV=production`, `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD` referencing the MySQL service (`${{MySQL.MYSQLHOST}}` etc.), `DB_NAME=festpass`, `DB_TIMEZONE=+03:00`, `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `PORT=8000`. CORS needs no setup because the site and API share one origin.

Concert photos in `client/public/img` are from [Unsplash](https://unsplash.com/license) (free to use). Each festival's genre, photo and accent colour are picked from its name in `client/src/lib/vibe.js`, because the schema stores no genre.

## Quick start

### Easiest: everything in Docker (any OS)

Needs only [Docker Desktop](https://www.docker.com/products/docker-desktop/), running. No Python, Node or MySQL install.

1. In the project folder: `docker compose up -d --build` (first time takes a few minutes)
2. Load the demo data (first time only, or to reset): `docker compose exec app python -m scripts.init_db`
3. Open http://localhost:8000 and sign in with a [demo account](#5-demo-accounts).

| To… | Run |
|---|---|
| Stop | `docker compose down` (data is kept) |
| Start again | `docker compose up -d` |
| Apply code changes | `docker compose up -d --build` |
| See errors | `docker logs festpass-app` |
| Open a MySQL prompt | `docker exec -it festpass-mysql mysql -u root -proot festpass` |

Optional: copy `api/.env.example` to `api/.env` to set your own `JWT_SECRET`; Docker picks it up.

### Windows, step by step without Docker for the app (for development, live reload)

Do this once:

1. Allow npm and venv scripts to run (fixes `npm.ps1 cannot be loaded because running scripts is disabled`):
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```
   Answer `Y`, then close and reopen the terminal.
2. Start MySQL only: `docker compose up -d mysql` (wait about 20 seconds the first time). If the Docker app is running, stop it first: `docker compose stop app` (both use port 8000).
3. Create the Python environment and install everything:
   ```powershell
   python -m venv api\.venv
   api\.venv\Scripts\activate
   npm run install:all
   ```
4. Create the config file: `copy api\.env.example api\.env`
5. Load the database: `npm run db:init`

Every time you run the app:

1. Terminal 1: `api\.venv\Scripts\activate`, then `npm run dev:api`
2. Terminal 2: `npm run dev:client`
3. Open http://localhost:5173 and sign in with a [demo account](#5-demo-accounts).

Stop with `Ctrl+C` in each terminal. Docker Desktop must be running before step 1.

The sections below cover the same setup for macOS/Linux and for a local MySQL without Docker.

### 1. Requirements
- Python 3.10+
- Node.js 18+ and npm (React client only)
- MySQL 8.0 (local install, or `docker compose up -d mysql` with the included [`docker-compose.yml`](docker-compose.yml))

### 2. Database user
With a local MySQL, create the app user once (as root):

```sql
CREATE USER 'festpass'@'localhost' IDENTIFIED BY 'festpass';
GRANT ALL PRIVILEGES ON festpass.* TO 'festpass'@'localhost';
GRANT CREATE, DROP ON *.* TO 'festpass'@'localhost';
-- only if binary logging is on (MySQL default) and the user is not SUPER:
SET GLOBAL log_bin_trust_function_creators = 1;
```

(Using Docker? `docker compose up -d mysql` does all of this for you.)

### 3. Install, configure, seed

```bash
git clone https://github.com/IamMikerex/festpass.git && cd festpass
python -m venv api/.venv
source api/.venv/bin/activate            # Windows: api\.venv\Scripts\activate
npm run install:all                      # client npm deps + api pip deps

cp api/.env.example api/.env             # set DB_* and a long random JWT_SECRET
npm run db:init                          # drops + recreates `festpass` from database/festpass.sql
```

`database/festpass.sql` is self-contained: tables, triggers, views and demo data. You can import it directly instead:
`mysql -u root -p < database/festpass.sql` (or MySQL Workbench → *File → Run SQL Script*).

### 4. Run (two terminals)

```bash
npm run dev:api          # FastAPI      http://localhost:8000/api   (interactive docs: /api/docs)
npm run dev:client       # React (Vite) http://localhost:5173
```

Open **http://localhost:5173**. Vite proxies `/api` and `/analytics` to FastAPI.

**Production-style single port:** `npm run build` then `npm start` serves the built React app and the whole API from FastAPI on port 8000.

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

To scan without a camera: as an attendee open **Show QR**, or copy a ticket's `qr_token` from the database, and paste it into the scanner's manual field.

### 6. Tests

```bash
npm test     # 24 pytest tests: every business rule + analytics (re-seeds the DB!)
```

The suite starts the real API on a free port and runs against real MySQL, covering every rule below, including concurrency (8 parallel buyers for the last ticket; the same QR at two gates at once).

---

## Business rules → where they are enforced

| # | Rule | Database | API |
|---|---|---|---|
| 1 | ≤ `max_per_order` per tier per order; ≤ 10 tickets per buyer per festival (PAID + PENDING) | `chk_tiers_max`, `trg_tickets_bi` | `services/orders.py` |
| 2 | Tier quota is hard; Σ quotas ≤ `daily_capacity` | `trg_tiers_bi/bu`, `trg_festivals_bu` | `SELECT … FOR UPDATE` on tier rows |
| 3 | 10‑minute checkout hold → EXPIRED + tickets VOID | `chk_orders_expiry` | order‑expiry job (`jobs.py`, `FOR UPDATE SKIP LOCKED`) + check at payment |
| 4 | Holder age ≥ `min_age` on start date | `trg_tickets_bi`, `trg_tickets_bu` | pre‑checks with friendly messages |
| 5 | One transfer, VALID only, ≥ 48 h before start; new QR token | `UNIQUE(ticket_id)`, `chk_transfers_users`, `trg_transfers_bi`, `trg_tickets_bu` | `services/tickets.py` (row lock) |
| 6 | Refund 90% (≥ 30 days) / 50% (7–29) / 0% (< 7); never after check‑in | `v_ticket_refund_quote` | `services/tickets.py` |
| 7 | Cancellation → 100% refunds (one REFUND row per order), approved stalls annulled + fees reimbursed | | `services/festivals.py#cancel_festival` (one transaction) |
| 8 | Anti‑passback: IN accepted only if VALID/CHECKED_IN, festival live, last accepted scan is OUT or none | `v_ticket_last_scan`, `trg_scans_bi` | `services/scans.py` (ticket row lock) |
| 9 | Vendor ACTIVE, license (and hygiene cert. for FOOD/BEVERAGE) valid through `end_date` | `chk_vendors_hygiene`, `trg_alloc_bi`, `trg_alloc_bu` | `services/vendors.py#eligibility` |
| 10 | One APPROVED allocation per stall; ≤ 2 approved stalls per vendor per festival | `UNIQUE(stall_id, approved_marker)`, `trg_alloc_bu` | stall row lock before approval |
| 11 | Fee due within 7 days of approval else auto‑CANCELLED; vendor cancel < 21 days → 50% forfeited | `v_allocation_balance` | fee‑deadline job, `services/vendors.py#cancel` |
| 12 | DRAFT → ON_SALE → LIVE → COMPLETED, any but COMPLETED → CANCELLED; sell only ON_SALE; price frozen after first sale | `trg_festivals_bu`, `trg_tickets_bi`, `trg_tiers_bu` | lifecycle job advances ON_SALE→LIVE→COMPLETED by date |
| 13 | Payment belongs to exactly one order or allocation; Σ REFUND ≤ Σ CAPTURED | `chk_payments_arc`, `trg_payments_bi`, `UNIQUE(provider_ref)` | idempotent webhook, reconciliation report |

Concurrency cases from Part 3 d: overselling (tier row `FOR UPDATE`), the same QR at two gates (ticket row `FOR UPDATE`), two coordinators approving one stall (stall row `FOR UPDATE` + unique marker), refund vs. transfer (both lock the ticket and re‑check `VALID`), duplicate webhooks (`UNIQUE(provider_ref)`).

### Notes on the schema
- Table and column names, types and constraints follow the assignment document. No calculated values are stored; totals, sold counts, remaining quota, refund quotes, fee balances and "inside now" counts come from the views in Part 3 of [`festpass.sql`](database/festpass.sql).
- MySQL does not allow `ON UPDATE CASCADE` on a column that a `CHECK` constraint uses. `Payments.order_id/allocation_id` and `TicketTransfers.from_user_id/to_user_id` therefore use `ON UPDATE RESTRICT`. Surrogate keys never change, so behaviour is identical.
- Extra guard triggers beyond the document: festival organizer must have role ORGANIZER, vendor manager must be VENDOR_MANAGER, scans must be made by GATE_STAFF, refunds cannot exceed charges (rule 13), terminal ticket states cannot change.
- Users are never hard‑deleted: "Delete" sets `account_status = 'DELETED'` and anonymises name/email/phone (KVKK) while keeping orders, payments and scans for the audit trail.

---

## API overview

All routes are JSON. Send `Authorization: Bearer <token>` from `/api/auth/login`.

**Core, `/api`** (interactive docs at `/api/docs`)

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

**Analytics, `/analytics`** (read‑only; ORGANIZER sees own festivals, AUDITOR sees all)

`GET /dashboard`, `GET /festivals/{id}/report`, `GET /festivals/{id}/attendees`, `GET /payments`, `GET /reconciliation`, `GET /transfers`, `GET /scans`, `GET /tickets/{id}/trail`. Add `?format=csv` to attendees, payments, transfers and scans for a CSV download.

### Payments
The gateway is simulated (`api/app/services/gateway.py`): every method captures instantly, except a card number ending in **0002**, which is declined and recorded as a FAILED payment. Each charge and refund is its own `Payments` row with a unique `provider_ref`. To plug in a real PSP, replace `gateway.charge` and `gateway.refund_reference` and point its webhook at `POST /api/payments/webhook`.

---

## Security
- Passwords hashed with bcrypt (cost 10); only the hash is stored (`CHAR(60)`).
- JWT (HS256, 8 h) with role checks on every route; suspended/deleted accounts are rejected on each request.
- Public sign‑up can only create attendee or vendor accounts; staff accounts are created by organizers.
- All SQL is parameterised; every body, path and query parameter is validated by Pydantic.
- Organizers only see and change their own festivals; the auditor role is read‑only.
- QR tokens are 256‑bit random values and are only returned to the current holder of a paid ticket; ticket IDs are UUIDs.
- Login and registration are rate‑limited; security headers are set on every response; the webhook secret is compared in constant time.

## Project layout

```
database/   festpass.sql (tables, triggers, views, demo data) · grant.sql (app user, run as root)
api/        FastAPI: app/routers (HTTP), app/services (business rules), app/jobs.py, scripts/init_db.py, tests/
client/     React app: src/pages (public, attendee, vendor, gate, admin), src/components
```
