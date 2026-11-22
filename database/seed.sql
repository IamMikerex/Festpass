-- =====================================================================
-- FestPass demo seed data. Run AFTER schema.sql.
--   mysql -u root -p festpass < database/seed.sql
-- All dates are relative to the day you seed, so the demo always has an
-- upcoming festival, a LIVE festival (for gate scanning) and a completed one.
-- Every account's password is:  Password123!
-- =====================================================================
USE festpass;

SET @pw = '$2a$10$kSWEXFwL3zMeAgG69jcnNObHw7Cq003Winb7sPUtfjsBKG.rYjJje';

-- ---------------------------------------------------------------- Users
INSERT INTO Users (email, password_hash, full_name, phone, date_of_birth, role) VALUES
 ('organizer@festpass.com', @pw, 'Selin Arslan',    '+905301110001', '1988-04-12', 'ORGANIZER'),
 ('organizer2@festpass.com',@pw, 'Kerem Yildiz',    '+905301110002', '1985-09-30', 'ORGANIZER'),
 ('gate@festpass.com',      @pw, 'Burak Demir',     '+905301110003', '1999-01-20', 'GATE_STAFF'),
 ('gate2@festpass.com',     @pw, 'Zeynep Kaya',     '+905301110004', '2000-06-05', 'GATE_STAFF'),
 ('auditor@festpass.com',   @pw, 'Hakan Celik',     '+905301110005', '1979-11-11', 'AUDITOR'),
 ('vendor@festpass.com',    @pw, 'Murat Ozturk',    '+905301110006', '1983-02-17', 'VENDOR_MANAGER'),
 ('vendor2@festpass.com',   @pw, 'Ece Sahin',       '+905301110007', '1991-07-08', 'VENDOR_MANAGER'),
 ('ayse@festpass.com',      @pw, 'Ayse Korkmaz',    '+905301110008', '2001-03-14', 'ATTENDEE'),
 ('can@festpass.com',       @pw, 'Can Aydin',       '+905301110009', '1998-12-01', 'ATTENDEE'),
 ('elif@festpass.com',      @pw, 'Elif Polat',      '+905301110010', '2003-08-22', 'ATTENDEE'),
 ('deniz@festpass.com',     @pw, 'Deniz Kurt (minor)', '+905301110011', CURDATE() - INTERVAL 15 YEAR, 'ATTENDEE');

SET @org  = (SELECT user_id FROM Users WHERE email = 'organizer@festpass.com');
SET @org2 = (SELECT user_id FROM Users WHERE email = 'organizer2@festpass.com');
SET @gate = (SELECT user_id FROM Users WHERE email = 'gate@festpass.com');
SET @vm1  = (SELECT user_id FROM Users WHERE email = 'vendor@festpass.com');
SET @vm2  = (SELECT user_id FROM Users WHERE email = 'vendor2@festpass.com');
SET @ayse = (SELECT user_id FROM Users WHERE email = 'ayse@festpass.com');
SET @can  = (SELECT user_id FROM Users WHERE email = 'can@festpass.com');
SET @elif = (SELECT user_id FROM Users WHERE email = 'elif@festpass.com');

-- 40 extra attendees so dashboards have realistic volume
DELIMITER $$
CREATE PROCEDURE seed_attendees()
BEGIN
  DECLARE i INT DEFAULT 1;
  WHILE i <= 40 DO
    INSERT INTO Users (email, password_hash, full_name, date_of_birth, role)
    VALUES (CONCAT('fan', i, '@example.com'), @pw,
            CONCAT(ELT(1 + (i MOD 10), 'Mert','Selin','Emre','Irem','Ozan','Melis','Kaan','Derya','Baris','Yasemin'), ' ',
                   ELT(1 + ((i * 7) MOD 10), 'Acar','Bulut','Cetin','Dogan','Erdem','Firat','Gunes','Isik','Koc','Ucar')),
            DATE('1990-01-01') + INTERVAL (i * 97) DAY, 'ATTENDEE');
    SET i = i + 1;
  END WHILE;
END$$
DELIMITER ;
CALL seed_attendees();
DROP PROCEDURE seed_attendees;

-- ------------------------------------------------------------ Festivals
INSERT INTO Festivals (organizer_id, name, venue_name, city, start_date, end_date, daily_capacity, min_age) VALUES
 (@org,  'Istanbul Sound Festival', 'KucukCiftlik Park',     'Istanbul', CURDATE() + INTERVAL 45 DAY, CURDATE() + INTERVAL 47 DAY, 6000, 16),
 (@org,  'Bosphorus Beats',         'Maslak Festival Area',  'Istanbul', CURDATE() - INTERVAL 1 DAY,  CURDATE() + INTERVAL 1 DAY,  3000, 18),
 (@org,  'Aegean Waves',            'Alsancak Kordon',       'Izmir',    CURDATE() + INTERVAL 15 DAY, CURDATE() + INTERVAL 16 DAY, 2500, 16),
 (@org,  'Antalya Sunset Sessions', 'Konyaalti Beach Stage', 'Antalya',  CURDATE() + INTERVAL 5 DAY,  CURDATE() + INTERVAL 6 DAY,  1500, 18),
 (@org2, 'Cappadocia Echoes',       'Goreme Open Air',       'Nevsehir', CURDATE() + INTERVAL 90 DAY, CURDATE() + INTERVAL 92 DAY, 4000, 16),
 (@org,  'Ankara Rock Nights',      'ODTU Stadium',          'Ankara',   CURDATE() - INTERVAL 40 DAY, CURDATE() - INTERVAL 38 DAY, 2000, 16);

SET @f1 = (SELECT festival_id FROM Festivals WHERE name = 'Istanbul Sound Festival');
SET @f2 = (SELECT festival_id FROM Festivals WHERE name = 'Bosphorus Beats');
SET @f3 = (SELECT festival_id FROM Festivals WHERE name = 'Aegean Waves');
SET @f4 = (SELECT festival_id FROM Festivals WHERE name = 'Antalya Sunset Sessions');
SET @f5 = (SELECT festival_id FROM Festivals WHERE name = 'Cappadocia Echoes');
SET @f6 = (SELECT festival_id FROM Festivals WHERE name = 'Ankara Rock Nights');

-- --------------------------------------------------------- Ticket tiers
INSERT INTO TicketTiers (festival_id, tier_name, price, quota, max_per_order, sale_start, sale_end) VALUES
 (@f1, 'Early Bird',   1250.00, 1000, 6, NOW() - INTERVAL 30 DAY, NOW() + INTERVAL 40 DAY),
 (@f1, 'General',      1850.00, 4000, 6, NOW() - INTERVAL 30 DAY, NOW() + INTERVAL 44 DAY),
 (@f1, 'VIP',          4500.00,  500, 4, NOW() - INTERVAL 30 DAY, NOW() + INTERVAL 44 DAY),
 (@f2, 'General',      1500.00, 2600, 6, NOW() - INTERVAL 60 DAY, NOW() + INTERVAL 1 DAY),
 (@f2, 'VIP',          3600.00,  400, 4, NOW() - INTERVAL 60 DAY, NOW() + INTERVAL 1 DAY),
 (@f3, 'General',       950.00, 2000, 6, NOW() - INTERVAL 20 DAY, NOW() + INTERVAL 14 DAY),
 (@f3, 'Backstage',    2750.00,  100, 2, NOW() - INTERVAL 20 DAY, NOW() + INTERVAL 14 DAY),
 (@f4, 'Sunset Pass',  1100.00, 1500, 6, NOW() - INTERVAL 20 DAY, NOW() + INTERVAL 4 DAY),
 (@f5, 'Early Bird',   1400.00, 1000, 6, NOW() + INTERVAL 7 DAY,  NOW() + INTERVAL 60 DAY),
 (@f5, 'General',      2100.00, 3000, 6, NOW() + INTERVAL 7 DAY,  NOW() + INTERVAL 89 DAY),
 (@f6, 'General',       900.00, 1800, 6, NOW() - INTERVAL 90 DAY, NOW() - INTERVAL 40 DAY),
 (@f6, 'VIP',          2200.00,  200, 4, NOW() - INTERVAL 90 DAY, NOW() - INTERVAL 40 DAY);

-- Open sales (rule 12: DRAFT -> ON_SALE)
UPDATE Festivals SET status = 'ON_SALE' WHERE festival_id IN (@f1, @f2, @f3, @f4, @f6);

-- ---------------------------------------------------- Orders & payments
-- Generates paid orders spread over the past weeks (rules 1, 2, 3, 13 hold).
DELIMITER $$
CREATE PROCEDURE seed_orders(IN p_fest BIGINT UNSIGNED, IN p_orders INT, IN p_days_back INT)
BEGIN
  DECLARE i INT DEFAULT 0;
  DECLARE v_buyer BIGINT UNSIGNED;
  DECLARE v_tier BIGINT UNSIGNED;
  DECLARE v_qty INT;
  DECLARE v_created DATETIME;
  DECLARE v_order BIGINT UNSIGNED;
  DECLARE v_total DECIMAL(10,2);
  DECLARE k INT;
  WHILE i < p_orders DO
    SELECT user_id INTO v_buyer FROM Users
     WHERE role = 'ATTENDEE' AND email LIKE 'fan%@example.com'
     ORDER BY RAND() LIMIT 1;
    SELECT tier_id INTO v_tier FROM TicketTiers WHERE festival_id = p_fest ORDER BY RAND() LIMIT 1;
    SET v_qty = 1 + FLOOR(RAND() * 3);
    SET v_created = NOW() - INTERVAL FLOOR(1 + RAND() * p_days_back) DAY - INTERVAL FLOOR(RAND() * 600) MINUTE;
    IF (SELECT COUNT(*) FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
         WHERE o.buyer_id = v_buyer AND o.festival_id = p_fest
           AND o.status IN ('PENDING','PAID') AND tk.status IN ('VALID','CHECKED_IN')) + v_qty <= 10 THEN
      INSERT INTO Orders (buyer_id, festival_id, status, created_at, expires_at, paid_at)
      VALUES (v_buyer, p_fest, 'PAID', v_created, v_created + INTERVAL 10 MINUTE, v_created + INTERVAL 2 MINUTE);
      SET v_order = LAST_INSERT_ID();
      SET k = 0;
      WHILE k < v_qty DO
        INSERT INTO Tickets (order_id, tier_id, holder_id, qr_token, issued_at)
        VALUES (v_order, v_tier, v_buyer, SHA2(CONCAT(UUID(), RAND(), k), 256), v_created);
        SET k = k + 1;
      END WHILE;
      SELECT SUM(t.price) INTO v_total FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id WHERE tk.order_id = v_order;
      IF v_total > 0 THEN
        INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref, processed_at)
        VALUES (v_order, 'CHARGE', v_total, ELT(1 + FLOOR(RAND() * 3), 'CARD', 'BANK_TRANSFER', 'WALLET'),
                'CAPTURED', CONCAT('SEED-', v_order, '-', LEFT(SHA2(UUID(), 256), 12)), v_created + INTERVAL 2 MINUTE);
      END IF;
    END IF;
    SET i = i + 1;
  END WHILE;
END$$
DELIMITER ;

CALL seed_orders(@f1, 90, 28);
CALL seed_orders(@f2, 70, 50);
CALL seed_orders(@f3, 40, 18);
CALL seed_orders(@f4, 25, 18);
CALL seed_orders(@f6, 60, 80);
DROP PROCEDURE seed_orders;

-- Named demo orders for the demo attendees -----------------------------
-- Ayse: 2 x General for Istanbul Sound Festival (one for herself, one named for Elif)
INSERT INTO Orders (buyer_id, festival_id, status, created_at, expires_at, paid_at)
VALUES (@ayse, @f1, 'PAID', NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY + INTERVAL 10 MINUTE, NOW() - INTERVAL 3 DAY + INTERVAL 1 MINUTE);
SET @o1 = LAST_INSERT_ID();
SET @tierF1Gen = (SELECT tier_id FROM TicketTiers WHERE festival_id = @f1 AND tier_name = 'General');
SET @tierF1Vip = (SELECT tier_id FROM TicketTiers WHERE festival_id = @f1 AND tier_name = 'VIP');
INSERT INTO Tickets (order_id, tier_id, holder_id, qr_token, issued_at) VALUES
 (@o1, @tierF1Gen, @ayse, SHA2(CONCAT(UUID(), RAND()), 256), NOW() - INTERVAL 3 DAY),
 (@o1, @tierF1Gen, @elif, SHA2(CONCAT(UUID(), RAND()), 256), NOW() - INTERVAL 3 DAY);
INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@o1, 'CHARGE', 3700.00, 'CARD', 'CAPTURED', 'DEMO-AYSE-F1-0001', NOW() - INTERVAL 3 DAY + INTERVAL 1 MINUTE);

-- Ayse: 1 x VIP for Istanbul Sound Festival, later partly refunded (90 % band, rule 6)
INSERT INTO Orders (buyer_id, festival_id, status, created_at, expires_at, paid_at)
VALUES (@ayse, @f1, 'PAID', NOW() - INTERVAL 6 DAY, NOW() - INTERVAL 6 DAY + INTERVAL 10 MINUTE, NOW() - INTERVAL 6 DAY + INTERVAL 1 MINUTE);
SET @o2 = LAST_INSERT_ID();
INSERT INTO Tickets (order_id, tier_id, holder_id, qr_token, issued_at, status)
VALUES (@o2, @tierF1Vip, @ayse, SHA2(CONCAT(UUID(), RAND()), 256), NOW() - INTERVAL 6 DAY, 'VALID');
INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@o2, 'CHARGE', 4500.00, 'WALLET', 'CAPTURED', 'DEMO-AYSE-F1-0002', NOW() - INTERVAL 6 DAY + INTERVAL 1 MINUTE);
INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@o2, 'REFUND', 4050.00, 'WALLET', 'CAPTURED', 'DEMO-AYSE-F1-0002-R1', NOW() - INTERVAL 2 DAY);
UPDATE Tickets SET status = 'REFUNDED' WHERE order_id = @o2;
UPDATE Orders SET status = 'REFUNDED' WHERE order_id = @o2;

-- Can: 1 x General for Aegean Waves, plus a ticket Can then transferred to Ayse (rule 5)
INSERT INTO Orders (buyer_id, festival_id, status, created_at, expires_at, paid_at)
VALUES (@can, @f3, 'PAID', NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY + INTERVAL 10 MINUTE, NOW() - INTERVAL 5 DAY + INTERVAL 1 MINUTE);
SET @o3 = LAST_INSERT_ID();
SET @tierF3Gen = (SELECT tier_id FROM TicketTiers WHERE festival_id = @f3 AND tier_name = 'General');
INSERT INTO Tickets (order_id, tier_id, holder_id, qr_token, issued_at) VALUES
 (@o3, @tierF3Gen, @can, SHA2(CONCAT(UUID(), RAND()), 256), NOW() - INTERVAL 5 DAY),
 (@o3, @tierF3Gen, @can, SHA2(CONCAT(UUID(), RAND()), 256), NOW() - INTERVAL 5 DAY);
INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@o3, 'CHARGE', 1900.00, 'CARD', 'CAPTURED', 'DEMO-CAN-F3-0001', NOW() - INTERVAL 5 DAY + INTERVAL 1 MINUTE);
SET @tx = (SELECT ticket_id FROM Tickets WHERE order_id = @o3 ORDER BY ticket_id LIMIT 1);
INSERT INTO TicketTransfers (ticket_id, from_user_id, to_user_id, transferred_at) VALUES (@tx, @can, @ayse, NOW() - INTERVAL 1 DAY);
UPDATE Tickets SET holder_id = @ayse, qr_token = SHA2(CONCAT(UUID(), RAND(), 'transfer'), 256) WHERE ticket_id = @tx;

-- Ayse and Can: tickets for the LIVE festival so the gate scanner can be demoed
SET @tierF2Gen = (SELECT tier_id FROM TicketTiers WHERE festival_id = @f2 AND tier_name = 'General');
INSERT INTO Orders (buyer_id, festival_id, status, created_at, expires_at, paid_at)
VALUES (@ayse, @f2, 'PAID', NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 10 DAY + INTERVAL 10 MINUTE, NOW() - INTERVAL 10 DAY + INTERVAL 1 MINUTE);
SET @o4 = LAST_INSERT_ID();
INSERT INTO Tickets (order_id, tier_id, holder_id, qr_token, issued_at) VALUES
 (@o4, @tierF2Gen, @ayse, SHA2(CONCAT(UUID(), RAND()), 256), NOW() - INTERVAL 10 DAY),
 (@o4, @tierF2Gen, @can,  SHA2(CONCAT(UUID(), RAND()), 256), NOW() - INTERVAL 10 DAY);
INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@o4, 'CHARGE', 3000.00, 'CARD', 'CAPTURED', 'DEMO-AYSE-F2-0001', NOW() - INTERVAL 10 DAY + INTERVAL 1 MINUTE);

-- Elif: Antalya Sunset Sessions (5 days out: no refund band, transfer still open)
SET @tierF4 = (SELECT tier_id FROM TicketTiers WHERE festival_id = @f4 LIMIT 1);
INSERT INTO Orders (buyer_id, festival_id, status, created_at, expires_at, paid_at)
VALUES (@elif, @f4, 'PAID', NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY + INTERVAL 10 MINUTE, NOW() - INTERVAL 4 DAY + INTERVAL 1 MINUTE);
SET @o5 = LAST_INSERT_ID();
INSERT INTO Tickets (order_id, tier_id, holder_id, qr_token, issued_at)
VALUES (@o5, @tierF4, @elif, SHA2(CONCAT(UUID(), RAND()), 256), NOW() - INTERVAL 4 DAY);
INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@o5, 'CHARGE', 1100.00, 'BANK_TRANSFER', 'CAPTURED', 'DEMO-ELIF-F4-0001', NOW() - INTERVAL 4 DAY + INTERVAL 1 MINUTE);

-- ------------------------------------------------------------- Vendors
INSERT INTO Vendors (manager_id, legal_name, tax_number, category, license_expiry, hygiene_cert_expiry, status) VALUES
 (@vm1, 'Anadolu Lezzetleri Gida Ltd.',  '1234567890', 'FOOD',     CURDATE() + INTERVAL 400 DAY, CURDATE() + INTERVAL 200 DAY, 'ACTIVE'),
 (@vm1, 'Kahve Duragi Icecek A.S.',      '2345678901', 'BEVERAGE', CURDATE() + INTERVAL 300 DAY, CURDATE() + INTERVAL 150 DAY, 'ACTIVE'),
 (@vm2, 'Retro Merch Tekstil',           '3456789012', 'MERCH',    CURDATE() + INTERVAL 500 DAY, NULL,                        'ACTIVE'),
 (@vm2, 'Gece Atistirmalik Gida',        '4567890123', 'FOOD',     CURDATE() + INTERVAL 365 DAY, CURDATE() + INTERVAL 20 DAY,  'ACTIVE'),
 (@vm2, 'Festival Power Services',       '5678901234', 'SERVICE',  CURDATE() + INTERVAL 200 DAY, NULL,                        'PENDING_REVIEW');

SET @v1 = (SELECT vendor_id FROM Vendors WHERE tax_number = '1234567890');
SET @v2 = (SELECT vendor_id FROM Vendors WHERE tax_number = '2345678901');
SET @v3 = (SELECT vendor_id FROM Vendors WHERE tax_number = '3456789012');
SET @v4 = (SELECT vendor_id FROM Vendors WHERE tax_number = '4567890123');

-- -------------------------------------------------------------- Stalls
INSERT INTO Stalls (festival_id, stall_code, zone, size_m2, has_power, base_fee) VALUES
 (@f1, 'F-01', 'FOOD_COURT', 12.00, TRUE,  15000.00),
 (@f1, 'F-02', 'FOOD_COURT', 12.00, TRUE,  15000.00),
 (@f1, 'F-03', 'FOOD_COURT', 9.00,  TRUE,  12000.00),
 (@f1, 'F-04', 'FOOD_COURT', 9.00,  FALSE, 9000.00),
 (@f1, 'F-05', 'FOOD_COURT', 16.00, TRUE,  19000.00),
 (@f1, 'F-06', 'FOOD_COURT', 16.00, TRUE,  19000.00),
 (@f1, 'M-01', 'MAIN_STAGE', 8.00,  TRUE,  22000.00),
 (@f1, 'M-02', 'MAIN_STAGE', 8.00,  TRUE,  22000.00),
 (@f1, 'M-03', 'MAIN_STAGE', 6.00,  FALSE, 16000.00),
 (@f1, 'C-01', 'CAMPING',    10.00, FALSE, 7000.00),
 (@f1, 'C-02', 'CAMPING',    10.00, TRUE,  8500.00),
 (@f1, 'E-01', 'ENTRANCE',   6.00,  TRUE,  11000.00),
 (@f2, 'F-01', 'FOOD_COURT', 12.00, TRUE,  14000.00),
 (@f2, 'F-02', 'FOOD_COURT', 12.00, TRUE,  14000.00),
 (@f2, 'M-01', 'MAIN_STAGE', 8.00,  TRUE,  20000.00),
 (@f3, 'F-01', 'FOOD_COURT', 10.00, TRUE,  9000.00),
 (@f3, 'F-02', 'FOOD_COURT', 10.00, FALSE, 7000.00),
 (@f3, 'E-01', 'ENTRANCE',   6.00,  TRUE,  6500.00),
 (@f5, 'F-01', 'FOOD_COURT', 12.00, TRUE,  13000.00),
 (@f5, 'C-01', 'CAMPING',    10.00, FALSE, 6000.00);

-- ---------------------------------------------------- Stall allocations
-- Approved + paid (Anadolu Lezzetleri on F-01, Istanbul Sound Festival)
INSERT INTO StallAllocations (vendor_id, stall_id, agreed_fee, applied_at)
VALUES (@v1, (SELECT stall_id FROM Stalls WHERE festival_id = @f1 AND stall_code = 'F-01'), 14000.00, NOW() - INTERVAL 12 DAY);
SET @a1 = LAST_INSERT_ID();
UPDATE StallAllocations SET status = 'APPROVED', approved_at = NOW() - INTERVAL 10 DAY, reviewed_by = @org WHERE allocation_id = @a1;
INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@a1, 'CHARGE', 14000.00, 'BANK_TRANSFER', 'CAPTURED', 'DEMO-STALL-0001', NOW() - INTERVAL 8 DAY);

-- Approved, fee still due (Kahve Duragi on F-02): 7-day deadline running (rule 11)
INSERT INTO StallAllocations (vendor_id, stall_id, agreed_fee, applied_at)
VALUES (@v2, (SELECT stall_id FROM Stalls WHERE festival_id = @f1 AND stall_code = 'F-02'), 15000.00, NOW() - INTERVAL 4 DAY);
SET @a2 = LAST_INSERT_ID();
UPDATE StallAllocations SET status = 'APPROVED', approved_at = NOW() - INTERVAL 2 DAY, reviewed_by = @org WHERE allocation_id = @a2;

-- Pending applications waiting for the organizer
INSERT INTO StallAllocations (vendor_id, stall_id, agreed_fee, applied_at) VALUES
 (@v3, (SELECT stall_id FROM Stalls WHERE festival_id = @f1 AND stall_code = 'M-01'), 22000.00, NOW() - INTERVAL 1 DAY),
 (@v3, (SELECT stall_id FROM Stalls WHERE festival_id = @f1 AND stall_code = 'F-02'), 15000.00, NOW() - INTERVAL 1 DAY),
 (@v4, (SELECT stall_id FROM Stalls WHERE festival_id = @f3 AND stall_code = 'F-01'), 9000.00,  NOW() - INTERVAL 2 DAY);

-- Rejected application (history)
INSERT INTO StallAllocations (vendor_id, stall_id, agreed_fee, applied_at)
VALUES (@v3, (SELECT stall_id FROM Stalls WHERE festival_id = @f1 AND stall_code = 'E-01'), 11000.00, NOW() - INTERVAL 9 DAY);
UPDATE StallAllocations SET status = 'REJECTED', reviewed_by = @org WHERE allocation_id = LAST_INSERT_ID();

-- Bosphorus Beats (live): approved + paid
INSERT INTO StallAllocations (vendor_id, stall_id, agreed_fee, applied_at)
VALUES (@v1, (SELECT stall_id FROM Stalls WHERE festival_id = @f2 AND stall_code = 'F-01'), 14000.00, NOW() - INTERVAL 40 DAY);
SET @a3 = LAST_INSERT_ID();
UPDATE StallAllocations SET status = 'APPROVED', approved_at = NOW() - INTERVAL 38 DAY, reviewed_by = @org WHERE allocation_id = @a3;
INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@a3, 'CHARGE', 14000.00, 'CARD', 'CAPTURED', 'DEMO-STALL-0002', NOW() - INTERVAL 35 DAY);

INSERT INTO StallAllocations (vendor_id, stall_id, agreed_fee, applied_at)
VALUES (@v3, (SELECT stall_id FROM Stalls WHERE festival_id = @f2 AND stall_code = 'M-01'), 18000.00, NOW() - INTERVAL 40 DAY);
SET @a4 = LAST_INSERT_ID();
UPDATE StallAllocations SET status = 'APPROVED', approved_at = NOW() - INTERVAL 37 DAY, reviewed_by = @org WHERE allocation_id = @a4;
INSERT INTO Payments (allocation_id, payment_type, amount, method, status, provider_ref, processed_at)
VALUES (@a4, 'CHARGE', 18000.00, 'BANK_TRANSFER', 'CAPTURED', 'DEMO-STALL-0003', NOW() - INTERVAL 33 DAY);

-- ------------------------------------------- Festival lifecycle moves
-- Bosphorus Beats is running now; Ankara Rock Nights already finished.
UPDATE Festivals SET status = 'LIVE' WHERE festival_id IN (@f2, @f6);

-- Gate scans for the completed festival (historical) and the live one
INSERT INTO GateScans (ticket_id, staff_id, gate_code, direction, result, scanned_at)
SELECT tk.ticket_id, @gate, ELT(1 + (CRC32(tk.ticket_id) MOD 3), 'NORTH-1', 'NORTH-2', 'SOUTH-1'), 'IN', 'ACCEPTED',
       TIMESTAMP(f.start_date) + INTERVAL (16 * 60 + (CRC32(tk.ticket_id) MOD 300)) MINUTE
  FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id JOIN Festivals f ON f.festival_id = t.festival_id
 WHERE t.festival_id = @f6 AND (CRC32(tk.ticket_id) MOD 10) < 9;
UPDATE Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id
   SET tk.status = 'CHECKED_IN'
 WHERE t.festival_id = @f6 AND tk.ticket_id IN (SELECT ticket_id FROM GateScans);
UPDATE Festivals SET status = 'COMPLETED' WHERE festival_id = @f6;

-- Live festival: ~half the crowd is in; a few went out again; one duplicate attempt
INSERT INTO GateScans (ticket_id, staff_id, gate_code, direction, result, scanned_at)
SELECT tk.ticket_id, @gate, ELT(1 + (CRC32(tk.ticket_id) MOD 3), 'NORTH-1', 'NORTH-2', 'SOUTH-1'), 'IN', 'ACCEPTED',
       NOW() - INTERVAL (30 + (CRC32(tk.ticket_id) MOD 600)) MINUTE
  FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id
 WHERE t.festival_id = @f2 AND tk.order_id NOT IN (@o4) AND (CRC32(tk.ticket_id) MOD 2) = 0;
UPDATE Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id
   SET tk.status = 'CHECKED_IN'
 WHERE t.festival_id = @f2 AND tk.ticket_id IN (SELECT ticket_id FROM GateScans);
INSERT INTO GateScans (ticket_id, staff_id, gate_code, direction, result, scanned_at)
SELECT gs.ticket_id, @gate, 'SOUTH-1', 'OUT', 'ACCEPTED', gs.scanned_at + INTERVAL 20 MINUTE
  FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
 WHERE t.festival_id = @f2 AND (CRC32(gs.ticket_id) MOD 7) = 0;
INSERT INTO GateScans (ticket_id, staff_id, gate_code, direction, result, scanned_at)
SELECT gs.ticket_id, @gate, 'NORTH-2', 'IN', 'REJECTED_DUPLICATE', gs.scanned_at + INTERVAL 3 SECOND
  FROM GateScans gs JOIN Tickets tk ON tk.ticket_id = gs.ticket_id JOIN TicketTiers t ON t.tier_id = tk.tier_id
 WHERE t.festival_id = @f2 AND gs.direction = 'IN' AND (CRC32(gs.ticket_id) MOD 11) = 0;
