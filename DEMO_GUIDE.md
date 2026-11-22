# FestPass demo guide

This guide is for presenting FestPass in class. It covers the demo accounts, what data is already loaded, how to reset everything, and a click-by-click script for every feature.

Nothing in the demo data skips a business rule. The base data (`database/seed.sql`) is inserted under the database triggers and CHECK constraints. The demo scenarios (`server/scripts/demoScenarios.js`) are created through the real REST API, signed in as the person who would do each step, so every permission check, validation and rule applies exactly as it does in the browser. If a rule ever changes, the reset stops with an error instead of loading data the rules would not allow.

---

## 1. Before class

### Reset to the demo state

```bash
npm run demo:reset
```

This drops and recreates the `festpass` database, loads the schema and base data, and then plays the demo scenarios through the API. It takes about 10 seconds and prints what it created. Run it again any time you want to start over, for example after a rehearsal.

> **Run it on the day of the presentation.** All dates are relative to the day you reset. *Bosphorus Beats* is live from yesterday until tomorrow, so if you reset more than a day early, the scheduled job will mark it COMPLETED and the gate demo will refuse every ticket.

`npm run demo:reset` works while the servers are running, so you don't need to stop them first. `npm run db:init` still works as before: it loads only the base data, without the demo scenarios.

### Start the three services

```bash
npm run dev:api          # Express  :4000
npm run dev:analytics    # FastAPI  :8000
npm run dev:client       # React    :5173  -> open http://localhost:5173
```

(Or `npm run build && npm start` for a single port, plus `npm run dev:analytics`.)

### Print the gate scanner codes

```bash
npm run demo:qr
```

This prints real QR codes from the database, one for each gate outcome: admit, duplicate, re-entry, refunded, voided, wrong festival and unknown code. The codes change on every reset, so run it **after** `demo:reset` and keep the terminal open during the gate demo.

### Presenting tips

- Use a **normal window for the organizer** and a **private window for the attendee**, so you can switch roles without signing out. Sign-in data is stored per browser profile.
- The sign-in page has one-click buttons for the main demo accounts.
- Payments go through a simulated gateway. Any card number works, **except numbers ending in `0002`, which are declined**.
- Scheduled jobs (checkout expiry, stall-fee deadline, festival lifecycle) run every 30 seconds inside the API.

---

## 2. Demo accounts

Every account uses the password **`Password123!`**.

| Role | Email | Who | Use it to show |
|---|---|---|---|
| Organizer | `organizer@festpass.com` | Selin Arslan | Dashboard, festivals, tiers, stalls, vendor approvals, cancellation, users, CSV exports |
| Organizer | `organizer2@festpass.com` | Kerem Yildiz | Owns only *Cappadocia Echoes* (DRAFT): organizers only see and manage their own festivals |
| Attendee | `ayse@festpass.com` | Ayse Korkmaz | Tickets with QR, transfers, refunds, a ticket for the live festival |
| Attendee | `can@festpass.com` | Can Aydin | A ticket for the live festival, a ticket at the 50 % refund band, an expired checkout |
| Attendee | `elif@festpass.com` | Elif Polat | Declined card followed by a successful payment; a ticket 5 days out (no refund) |
| Attendee (15 years old) | `deniz@festpass.com` | Deniz Kurt | The age limit (rule 4) |
| Vendor manager | `vendor@festpass.com` | Murat Ozturk | Two active food and beverage businesses: a paid stall, and an approved stall with the fee deadline running |
| Vendor manager | `vendor2@festpass.com` | Ece Sahin | Applications in every stage, a blacklisted business, an expiring hygiene certificate |
| Gate staff | `gate@festpass.com` | Burak Demir | The scanner at *Bosphorus Beats* |
| Gate staff | `gate2@festpass.com` | Zeynep Kaya | A second scanner (two gates at once) |
| Finance auditor | `auditor@festpass.com` | Hakan Celik | Read-only finance overview, ledger, reconciliation, audit trail |

There are also 40 generated fans (`fan1@example.com` … `fan40@example.com`, same password) who make up the crowd in the dashboards.

### What each role can and cannot do

| | Attendee | Organizer | Vendor manager | Gate staff | Auditor |
|---|---|---|---|---|---|
| Buy, transfer, refund own tickets | ✓ | | | | |
| Create and manage own festivals, tiers, stalls | | ✓ (own only) | | | |
| Review stall applications and vendors | | ✓ | | | |
| Register businesses, apply for stalls, pay fees | | | ✓ | | |
| Scan tickets at the gate | | | | ✓ | |
| Dashboards, reports, CSV exports | | ✓ | | | ✓ (read-only) |
| Ledger, reconciliation, audit trail | | ✓ | | | ✓ (read-only) |
| Manage users and staff | | ✓ | | | can view the list |

Every limit is enforced by the API (403), not just hidden in the menu. The auditor sees no write buttons anywhere.

---

## 3. What's in the demo data

### Festivals (dates are relative to the day you reset)

| Festival | City | Status | When | Shows |
|---|---|---|---|---|
| **Bosphorus Beats** | Istanbul | **LIVE** | yesterday to tomorrow | Gate scanning, people inside now, hourly entry chart |
| **Istanbul Sound Festival** | Istanbul | **ON_SALE** | in 45 days | Buying, 90 % refund band, stall map with 12 stalls |
| **Aegean Waves** | Izmir | ON_SALE | in 15 days | 50 % refund band, late vendor cancellation |
| **Antalya Sunset Sessions** | Antalya | ON_SALE | in 5 days | No refunds (under 7 days), 18+ age limit |
| **Cappadocia Echoes** | Nevsehir | DRAFT | in 90 days | Lifecycle start, owned by organizer2 |
| **Ankara Rock Nights** | Ankara | COMPLETED | 40 days ago | History: 90 % of the crowd checked in |
| **Black Sea Jazz Days** | Trabzon | CANCELLED | (was in 30 days) | Rule 7: every ticket refunded 100 %, open checkout voided, stall fee returned |

### Tickets in every status

| Status | Where to see it |
|---|---|
| VALID | Most tickets. Ayse's and Can's *Bosphorus Beats* tickets are VALID and ready to scan |
| CHECKED_IN | About half the *Bosphorus Beats* crowd and most of *Ankara Rock Nights* |
| REFUNDED | Ayse's VIP ticket (90 %), a fan's Istanbul ticket (90 %), a fan's Aegean ticket (50 %), and every *Black Sea Jazz Days* ticket (100 %) |
| VOID | Can's expired Istanbul checkout (rule 3), fan22's cancelled checkout, and the open checkout at *Black Sea Jazz Days* when it was cancelled |

### Orders and payments

- Around 290 paid orders spread over the last weeks, paid by card, bank transfer and wallet.
- EXPIRED: Can left a 2-ticket checkout open; the expiry job released it (the tickets returned to the quota).
- CANCELLED: fan22 cancelled a checkout before paying, and the *Black Sea Jazz Days* checkout was voided when that festival was cancelled.
- REFUNDED: orders whose tickets were all refunded.
- A FAILED payment: Elif's card was declined at *Aegean Waves*, then she paid by wallet (both rows are in the ledger).
- REFUND payment rows are always separate rows that never exceed what was captured (rule 13).

### Transfers

- Can transferred one *Aegean Waves* ticket to Ayse (a new QR was issued).
- A fan transferred an Istanbul ticket to fan30.

### Vendors and stall applications

| Business | Manager | Status | Applications |
|---|---|---|---|
| Anadolu Lezzetleri Gida (food) | vendor@ | ACTIVE | Istanbul F-01 **APPROVED + paid**; Bosphorus F-01 APPROVED + paid; Black Sea Jazz F-01 **CANCELLED** by the festival cancellation (fee refunded) |
| Kahve Duragi Icecek (beverage) | vendor@ | ACTIVE | Istanbul F-02 **APPROVED, fee due** (7-day countdown running) |
| Retro Merch Tekstil (merch) | vendor2@ | ACTIVE | Istanbul M-01 and F-02 **APPLIED** (waiting for review); Istanbul E-01 **REJECTED**; Bosphorus M-01 APPROVED + paid; Istanbul C-01 **CANCELLED** (fee not paid within 7 days); Aegean F-02 **CANCELLED** by the vendor 15 days before (50 % forfeited) |
| Gece Atistirmalik Gida (food) | vendor2@ | ACTIVE, hygiene certificate expires in 20 days | Aegean F-01 **APPLIED** |
| Festival Power Services (service) | vendor2@ | **PENDING_REVIEW** | none yet: waiting for the organizer to approve the business |
| Kordon Street Snacks (food) | vendor2@ | **BLACKLISTED** | Istanbul F-05 **REJECTED** automatically when it was blacklisted |

### Gate scans

- *Ankara Rock Nights*: historic entries.
- *Bosphorus Beats*: entries over the last 10 hours across gates NORTH-1, NORTH-2 and SOUTH-1, some exits, and refused scans of every kind: duplicate, invalid, wrong festival and festival not running.

---

## 4. Demo scenarios, step by step

A suggested 15-minute order: **1 → 2 → 5 → 6 → 7 → 8**. Pick from 3, 4 and 9 if you have time.

### Scenario 1: Organizer dashboard and analytics (FastAPI)
Sign in as **organizer@festpass.com**.
1. **Dashboard**: net revenue, tickets sold, refunds and stall fees, the 30-day revenue chart (captured charges against refunds), the payment-method split and the latest orders. Point out the footer: these figures come from the FastAPI analytics service.
2. The yellow **Needs your review** banner counts the pending stall applications and the new vendor.
3. **Festivals → Bosphorus Beats → Overview**: sales per tier, daily sales and the hourly gate-entry chart.
4. **Attendees** tab: filter by status (VALID / CHECKED_IN / REFUNDED / VOID), then **Export CSV**.
5. **Gate scans** tab: every scan with its result, gate and staff member; **Export CSV**.
6. **Payments & refunds**: the full ledger, including the FAILED card payment and the REFUND rows.
7. Optional: open `http://localhost:8000/analytics/docs` to show the FastAPI interactive docs.

### Scenario 2: Buying a ticket (rules 1, 3, 4, 12, 13)
Sign in as **can@festpass.com** (private window).
1. **Festivals → Istanbul Sound Festival → Choose tickets**: pick 1 General and continue to **Checkout**. Point out the 10-minute hold countdown (rule 3).
2. Pay by card with `4000 0000 0000 0002`: **declined**. The order stays pending and the failed attempt is recorded.
3. Pay again with any other number (for example `4111 1111 1111 1111`): paid. The ticket appears in **My tickets** with a QR code.
4. **Rule 1**: try to buy 7 General tickets in one order (the tier allows at most 6), or more than 10 tickets in total for this festival: refused.
5. **Rule 4**: in **Name tickets for friends**, enter `deniz@festpass.com` on *Antalya Sunset Sessions* (18+): refused because Deniz is 15. Signing in as Deniz and buying directly is refused too.
6. **Rule 12**: *Cappadocia Echoes* is still DRAFT, so it cannot be bought; *Ankara Rock Nights* is COMPLETED.
7. **Rule 3**: **Orders** shows Can's earlier checkout as *Expired*. To show it live, start a checkout and wait 10 minutes; the job expires it within 30 seconds of the deadline.

### Scenario 3: Transfers (rule 5)
Sign in as **elif@festpass.com**.
1. **My tickets**: her *Istanbul Sound Festival* ticket (Ayse bought it and named Elif as the holder) → **Transfer** → `can@festpass.com`. The ticket now belongs to Can with a **new** QR code, and the old QR stops working at the gate.
2. Sign in as **ayse@festpass.com**: her *Aegean Waves* ticket came from Can and is marked *Transferred*. It cannot be transferred again (one transfer per ticket).
3. A transfer to `deniz@festpass.com` is refused (rule 4). Transfers also close 48 hours before the festival starts, so the *Bosphorus Beats* tickets cannot be transferred.

### Scenario 4: Refunds (rule 6)
1. As **ayse@festpass.com**: her VIP ticket shows **Refunded**. A VALID *Istanbul Sound Festival* ticket (45 days out) offers **Refund** at **90 %**.
2. As **can@festpass.com**: his *Aegean Waves* ticket (15 days out) offers a refund at **50 %**.
3. As **elif@festpass.com**: her *Antalya Sunset Sessions* ticket (5 days out) cannot be refunded (under 7 days).
4. Checked-in tickets can never be refunded.
5. The refund appears as a separate REFUND row under **Payments** and in the organizer's ledger (rule 13).

### Scenario 5: Gate scanning with real QR codes (rule 8)
Sign in as **gate@festpass.com**. Choose **Bosphorus Beats (live)** and a gate, for example `NORTH-1`. Then either:
- **Camera:** in the attendee window, open Ayse's *Bosphorus Beats* ticket → **Show QR**, then click **Start camera** on the scanner and hold the QR up to it. A phone signed in as Ayse works too.
- **Typed:** paste a code from `npm run demo:qr` into the scanner's code box.

Run through the `demo:qr` list in order:

| Code | Direction | Result |
|---|---|---|
| Ayse, valid ticket | IN | **ADMIT**, and the ticket becomes CHECKED_IN |
| the same code again | IN | **REFUSE**: already inside (anti-passback) |
| the same code | OUT | exit accepted |
| the same code | IN | **ADMIT** again (re-entry after leaving) |
| Can, valid ticket | IN | **ADMIT** |
| Already inside | IN | **REFUSE**: duplicate |
| Checked in, then left | IN | **ADMIT** (re-entry) |
| Refunded ticket | IN | **REFUSE**: ticket not valid |
| Voided ticket | IN | **REFUSE**: ticket not valid |
| Ticket for another festival | IN | **REFUSE**: wrong festival |
| Made-up code | IN | **REFUSE**: not a FestPass ticket |

Afterwards, show the organizer's **Bosphorus Beats → Gate scans** tab: every scan you just made is there with its result.

### Scenario 6: Vendor manager (rules 9, 10, 11)
Sign in as **vendor@festpass.com**.
1. **My businesses**: two ACTIVE businesses with their license and hygiene certificate dates.
2. **Applications & fees**: Kahve Duragi's approved stall F-02 shows the fee and the days left to pay. **Pay fee** → paid (rule 11).
3. **Find a stall**: pick *Istanbul Sound Festival*. The site map shows free and taken stalls. Apply for a free one, for example F-03.

Then sign in as **vendor2@festpass.com**.
4. **Applications & fees** shows every stage: APPLIED, APPROVED, REJECTED, CANCELLED (missed the 7-day fee deadline), CANCELLED by the vendor 15 days out with 50 % forfeited, and the rejected application of the blacklisted business.
5. **Rule 9**: in **Find a stall**, choose *Gece Atistirmalik Gida* and *Istanbul Sound Festival*: **Your eligibility** says the hygiene certificate expires before the festival ends, so it cannot apply. On *Aegean Waves* (ends sooner) it can.
6. **Rule 11**: cancelling a paid stall less than 21 days before the festival forfeits 50 %; earlier cancellations are refunded in full.

### Scenario 7: Organizer reviews vendors (rules 9, 10)
Sign in as **organizer@festpass.com**.
1. **Vendors & stalls → Vendor registry**: **Activate** *Festival Power Services* (PENDING_REVIEW → ACTIVE). **Blacklist** is on the same row.
2. **Stall applications**: approve Retro Merch for **M-01** → approved, and the fee deadline starts.
3. Try to approve Retro Merch for **F-02** → refused: F-02 already has an approved vendor (rule 10, one vendor per stall).
4. Rule 10 also allows at most 2 approved stalls per vendor per festival; a third approval is refused.
5. **Festivals → Istanbul Sound Festival → Stalls & vendors**: the site map, the applications and their payment status. Click a stall to edit it; an unused stall can be deleted.

### Scenario 8: Festival lifecycle and cancellation (rules 2, 7, 12)
Signed in as **organizer@festpass.com**:
1. **Festivals → Black Sea Jazz Days** (CANCELLED): every ticket REFUNDED at 100 %, the open checkout VOID, and the stall allocation CANCELLED with its fee refunded. This is rule 7, already carried out by the reset.
2. Create a festival with **New festival** → add a tier → **Open ticket sales**. The status moves DRAFT → ON_SALE.
3. **Rule 2**: on a tier, set a quota above the festival's daily capacity → refused.
4. **Rule 12**: on a tier that already sold tickets, change the price → refused (prices freeze after the first sale). A COMPLETED festival cannot be edited or reopened.
5. Optional, live: **Cancel festival** on *Antalya Sunset Sessions* and show the summary (tickets refunded, stall fees reimbursed). This cannot be undone, so run `npm run demo:reset` afterwards.
6. Sign in as **organizer2@festpass.com**: Kerem sees only *Cappadocia Echoes* and can **Open ticket sales** on it.

### Scenario 9: Auditor and users
1. Sign in as **auditor@festpass.com**: **Finance overview**, **Ledger** (charges, refunds and failed payments, filterable), **Reconciliation**, and **Audit trail** (look up a ticket to see its order, payments, transfer and scans). There are no write buttons anywhere, and any write attempt returns 403.
2. As **organizer@festpass.com** → **Users & staff**: create a gate staff account and sign in with it; suspend a user; delete a user, which anonymises the account (KVKK) but keeps their orders, payments and scans for the audit trail.

---

## 5. Business rules at a glance

| # | Rule | Where to show it |
|---|---|---|
| 1 | Per-order and 10-per-festival limits | Scenario 2.4 |
| 2 | Tier quota ≤ capacity | Scenario 8.3 |
| 3 | 10-minute checkout hold | Scenario 2.1 and 2.7 (Can's expired order) |
| 4 | Minimum age on the start date | Scenario 2.5 and 3.3 (Deniz) |
| 5 | One transfer, ≥ 48 h before start, new QR | Scenario 3 |
| 6 | Refund 90 / 50 / 0 %, never after check-in | Scenario 4 |
| 7 | Cancellation refunds everything | Scenario 8.1 (Black Sea Jazz Days) |
| 8 | Anti-passback at the gate | Scenario 5 |
| 9 | Vendor ACTIVE, license and hygiene certificate valid | Scenario 6.5 |
| 10 | One vendor per stall, ≤ 2 stalls per vendor per festival | Scenario 7.3 |
| 11 | Stall fee within 7 days; late vendor cancellation forfeits 50 % | Scenario 6.2, 6.4 |
| 12 | Festival lifecycle, price freeze | Scenario 8.2, 8.4 |
| 13 | Refunds never exceed charges; one ledger | Scenario 1.6, 4.5 |

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| The gate refuses every ticket with "festival not running" | The reset is more than a day old. Run `npm run demo:reset` and `npm run demo:qr` again. |
| A `demo:qr` code gives an unexpected result | It was already scanned during a rehearsal. Reset, or use the next code. |
| `demo:reset` fails with "You do not have the SUPER privilege…" | Run once as MySQL root: `SET GLOBAL log_bin_trust_function_creators = 1;` (see README). |
| `demo:reset` fails with `ECONNREFUSED` | MySQL isn't running. Start it (or `docker compose up -d`). |
| The dashboard shows no charts | The FastAPI service isn't running: `npm run dev:analytics`. |
| The camera doesn't start | Browsers only allow the camera on `localhost` or HTTPS. Use the typed code instead. |
| Too many sign-in attempts | Only failed sign-ins count (30 per 15 minutes). Restarting the API resets the counter. |
| `npm test` changed the data | The test suite re-creates the database. Run `npm run demo:reset` afterwards. |
