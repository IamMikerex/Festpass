# FestPass presentation: speaker notes

Open `FestPass-presentation.html` in a browser to present (arrow keys or click, F for full screen). `FestPass-presentation.pdf` is the same deck as a PDF.

## 1. FestPass

Introduce the team and the project in one breath: FestPass is a complete festival platform. Attendees buy and hold tickets, organizers run festivals and vendors, gate staff scan QR codes, and an auditor checks the money. The point of this talk is the actual implementation: the schema, the 13 rules and how the code keeps them true. Fill in the bracketed names, course code and date before presenting.

## 2. Project introduction and objectives

The objective was not just a working website but a database that defends its own rules. That is why the counts at the bottom matter: 11 tables with CHECK, UNIQUE and foreign-key constraints, 12 triggers that raise SQLSTATE 45000 when a rule is broken, and 6 views that the API and analytics share. The five roles are attendee, organizer, vendor manager, gate staff and finance auditor.

## 3. Problems FestPass solves

Each row here maps to one or more of the 13 business rules that come later. The key message: these are problems of concurrency, fraud and money, so they have to be solved in the database and in transactions, not only in the user interface.

## 4. System architecture

The browser only ever talks to Express. Express owns every write and runs each business operation in a database transaction. Requests under /analytics are forwarded to FastAPI, which verifies the same JWT and only has SELECT privileges. In development Vite proxies /api to port 4000 and /analytics to port 8000; in production Express serves the built React app and the proxy on one port. MySQL is the single source of truth: if the API had a bug, the triggers would still refuse an invalid change.

## 5. Database ER diagram

Users is the hub: every actor is a row in Users with one of five roles, so Festivals (organizer_id), Orders (buyer_id), Tickets (holder_id), TicketTransfers (from and to), Vendors (manager_id), GateScans (staff_id) and StallAllocations (reviewed_by, optional) all point to it. The ticket side runs Festivals to TicketTiers to Tickets, with Orders grouping the tickets a buyer paid for. The vendor side runs Festivals to Stalls to StallAllocations to Vendors. Payments is an exclusive arc: each payment belongs to exactly one order or one stall allocation, never both, enforced by chk_payments_arc.

## 6. Database tables and relationships

Point out three design choices. First, Tickets use a UUID primary key and a separate 64-character QR token, so the token can be replaced on transfer without changing the ticket's identity. Second, StallAllocations has a generated column approved_marker that is 1 only when APPROVED, so UNIQUE(stall_id, approved_marker) allows many rejected applications but only one approved one. Third, Payments either points at an order or at an allocation, never both. Six views sit on top: v_tier_availability, v_order_totals, v_ticket_refund_quote, v_ticket_last_scan, v_festival_stats and v_allocation_balance.

## 7. The 13 business rules: tickets and money

Each rule is enforced twice. The API checks first so the user gets a clear message, and the database checks again with a trigger, constraint or view so that no code path can skip it. Rule 2 is the concurrency rule: tier rows are locked with SELECT ... FOR UPDATE, so two buyers can never both take the last ticket. Rule 3 is handled by a job that runs every 30 seconds with FOR UPDATE SKIP LOCKED, and payment also re-checks the hold.

## 8. The 13 business rules: gates and vendors

Rule 8 is demonstrated live at the gate later. Rule 10 uses the generated approved_marker column so a plain UNIQUE index does the work. Rule 11 and rule 12 are time-based, so a scheduled job in Express advances festivals by date and cancels unpaid stall approvals; the triggers still refuse an illegal status jump such as COMPLETED back to ON_SALE. Rule 13 protects the money: the CHECK constraint enforces the exclusive arc, the trigger compares refunds with captured charges, and the unique provider reference makes the payment webhook idempotent.

## 9. How ticket purchasing works

Walk through one purchase. Step 2 is the heart of it: locking the tier rows means a second buyer waits until the first transaction commits, then sees the updated count, so the quota can never be oversold. Each check gives a friendly message that names the rule, for example "You will be under 16 on the festival start date (rule 4)" for a festival with a minimum age of 16. The trigger trg_tickets_bi repeats the checks inside MySQL. In the demo, a card ending 0002 is declined, which shows that a failed payment leaves the order pending and the tickets held until they expire.

## 10. How QR validation works at the gate

The gate staff app uses the phone camera or a typed code and calls POST /scans with the token, gate code and direction. The service locks the ticket row, reads the last accepted scan from v_ticket_last_scan, decides the result and writes a GateScans row, even for refusals, so the audit trail is complete. The trigger trg_scans_bi enforces the same anti-passback rule inside MySQL. In the live demo we scan Ayse's ticket twice: the second scan is refused as a duplicate until she scans OUT.

## 11. How FastAPI provides analytics

The split is deliberate: Express owns every write, and FastAPI is a separate read-only reporting service, which is how real systems keep heavy reporting away from the transactional path. The dashboard returns total tickets sold, revenue, tickets remaining, attendance, vendor application stats, refund and payment summaries, gate statistics and a gap-filled daily sales series, all filtered by festival and date. Because the MySQL account it uses has only SELECT privileges, even a bug in the reporting code cannot change data. The reconciliation report checks that every paid order matches its captured payments, which backs up rule 13.

## 12. Security and transaction integrity

Security has two halves. The left card is about access: who is allowed to call what. The right card is about integrity: once a call is allowed, the data still cannot end up wrong. The strongest point to make is defence in depth: the API checks a rule for a good error message, and the database checks it again in a trigger. For example, the festival cancellation in rule 7 refunds every order, annuls every approved stall and reimburses fees inside one transaction, so a crash half-way leaves nothing half-refunded.

## 13. Deployment and operations

Keep this slide short; it shows the project runs outside a laptop. Docker Compose brings up MySQL, runs the migration once, then starts the web and analytics containers. Migration is safe to repeat: it only loads the schema when the tables are missing. Each service has a health check, and both refuse to start in production with weak secrets. The development setup is unchanged, so the demo can run either way.

## 14. Live demonstration scenarios

Before class: run npm run demo:reset, start the three services, then npm run demo:qr to print fresh gate codes. Every account uses the demo password listed in DEMO_GUIDE.md. Suggested order if time is short: 1, 2, 5 and 8, which together show analytics, purchasing, QR validation and the transactional cancellation. Each refusal on screen names the rule it enforces, so point that out as it happens. If something goes wrong, run the reset again; it takes a few seconds and rebuilds the same demo state.

## 15. Every rule is checked twice: once by the API for a clear message, and once by MySQL so nothing can slip through.

Close with the main idea: FestPass is a full system, but its core is the database design. Constraints, triggers, views and row-level locking keep the 13 business rules true under concurrency, and the API and the analytics service are built on top of that. Then invite questions; good backup slides are the ER diagram and the two rule tables.
