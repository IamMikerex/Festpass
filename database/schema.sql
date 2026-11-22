-- =====================================================================
-- FestPass: Music Festival Ticketing & Vendor Management System
-- MySQL 8.0 (InnoDB, utf8mb4) schema: 11 tables, triggers and views.
--
-- Load with the MySQL CLI:   mysql -u root -p < database/schema.sql
-- or with the Node helper:   cd server && npm run db:init
--
-- No calculated values (order totals, tickets sold, remaining quota,
-- attendee age, refund eligibility...) are stored; they come from the
-- views at the bottom of this file.
-- =====================================================================

DROP DATABASE IF EXISTS festpass;
CREATE DATABASE festpass CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE festpass;

-- ---------------------------------------------------------------------
-- Entity 1) Users
-- ---------------------------------------------------------------------
CREATE TABLE Users (
  user_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email           VARCHAR(150)    NOT NULL,
  password_hash   CHAR(60)        NOT NULL,
  full_name       VARCHAR(100)    NOT NULL,
  phone           VARCHAR(20)     NULL,
  date_of_birth   DATE            NOT NULL,
  role            ENUM('ATTENDEE','ORGANIZER','VENDOR_MANAGER','GATE_STAFF','AUDITOR') NOT NULL DEFAULT 'ATTENDEE',
  account_status  ENUM('ACTIVE','SUSPENDED','DELETED') NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_phone UNIQUE (phone),
  CONSTRAINT chk_users_dob CHECK (date_of_birth > '1900-01-01')
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 2) Festivals
-- ---------------------------------------------------------------------
CREATE TABLE Festivals (
  festival_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organizer_id    BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(120)    NOT NULL,
  venue_name      VARCHAR(120)    NOT NULL,
  city            VARCHAR(60)     NOT NULL,
  start_date      DATE            NOT NULL,
  end_date        DATE            NOT NULL,
  daily_capacity  INT UNSIGNED    NOT NULL,
  min_age         TINYINT UNSIGNED NOT NULL DEFAULT 16,
  status          ENUM('DRAFT','ON_SALE','LIVE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  PRIMARY KEY (festival_id),
  CONSTRAINT uq_festivals_name_start UNIQUE (name, start_date),
  CONSTRAINT fk_festivals_organizer FOREIGN KEY (organizer_id)
    REFERENCES Users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_festivals_dates    CHECK (end_date >= start_date),
  CONSTRAINT chk_festivals_capacity CHECK (daily_capacity > 0),
  CONSTRAINT chk_festivals_min_age  CHECK (min_age BETWEEN 0 AND 21)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 3) TicketTiers
-- ---------------------------------------------------------------------
CREATE TABLE TicketTiers (
  tier_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  festival_id     BIGINT UNSIGNED NOT NULL,
  tier_name       VARCHAR(60)     NOT NULL,
  price           DECIMAL(10,2)   NOT NULL,
  quota           INT UNSIGNED    NOT NULL,
  max_per_order   TINYINT UNSIGNED NOT NULL DEFAULT 6,
  sale_start      DATETIME        NOT NULL,
  sale_end        DATETIME        NOT NULL,
  PRIMARY KEY (tier_id),
  CONSTRAINT uq_tiers_festival_name UNIQUE (festival_id, tier_name),
  CONSTRAINT fk_tiers_festival FOREIGN KEY (festival_id)
    REFERENCES Festivals(festival_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_tiers_price  CHECK (price >= 0),
  CONSTRAINT chk_tiers_quota  CHECK (quota > 0),
  CONSTRAINT chk_tiers_max    CHECK (max_per_order BETWEEN 1 AND 10),
  CONSTRAINT chk_tiers_window CHECK (sale_end > sale_start)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 4) Orders  (checkout hold: PENDING -> PAID/EXPIRED/CANCELLED/REFUNDED)
-- ---------------------------------------------------------------------
CREATE TABLE Orders (
  order_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  buyer_id        BIGINT UNSIGNED NOT NULL,
  festival_id     BIGINT UNSIGNED NOT NULL,
  status          ENUM('PENDING','PAID','EXPIRED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME        NOT NULL,
  paid_at         DATETIME        NULL,
  PRIMARY KEY (order_id),
  KEY idx_orders_buyer_festival (buyer_id, festival_id, status),
  KEY idx_orders_status_expires (status, expires_at),
  CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_id)
    REFERENCES Users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_orders_festival FOREIGN KEY (festival_id)
    REFERENCES Festivals(festival_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_orders_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_orders_paid   CHECK (paid_at IS NULL OR paid_at >= created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 5) Tickets  (UUID primary key so ticket numbers cannot be guessed)
-- ---------------------------------------------------------------------
CREATE TABLE Tickets (
  ticket_id       CHAR(36)        NOT NULL DEFAULT (UUID()),
  order_id        BIGINT UNSIGNED NOT NULL,
  tier_id         BIGINT UNSIGNED NOT NULL,
  holder_id       BIGINT UNSIGNED NOT NULL,
  qr_token        CHAR(64)        NOT NULL,
  status          ENUM('VALID','CHECKED_IN','REFUNDED','VOID') NOT NULL DEFAULT 'VALID',
  issued_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id),
  CONSTRAINT uq_tickets_qr UNIQUE (qr_token),
  KEY idx_tickets_tier_status (tier_id, status),
  KEY idx_tickets_holder (holder_id),
  CONSTRAINT fk_tickets_order FOREIGN KEY (order_id)
    REFERENCES Orders(order_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tickets_tier FOREIGN KEY (tier_id)
    REFERENCES TicketTiers(tier_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_tickets_holder FOREIGN KEY (holder_id)
    REFERENCES Users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 6) TicketTransfers  (UNIQUE(ticket_id) = at most one transfer)
-- MySQL forbids referential actions on columns used in a CHECK, so the
-- user FKs here use ON UPDATE RESTRICT (surrogate keys never change).
-- ---------------------------------------------------------------------
CREATE TABLE TicketTransfers (
  transfer_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id       CHAR(36)        NOT NULL,
  from_user_id    BIGINT UNSIGNED NOT NULL,
  to_user_id      BIGINT UNSIGNED NOT NULL,
  transferred_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (transfer_id),
  CONSTRAINT uq_transfers_ticket UNIQUE (ticket_id),
  CONSTRAINT fk_transfers_ticket FOREIGN KEY (ticket_id)
    REFERENCES Tickets(ticket_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_transfers_from FOREIGN KEY (from_user_id)
    REFERENCES Users(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_transfers_to FOREIGN KEY (to_user_id)
    REFERENCES Users(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_transfers_users CHECK (to_user_id <> from_user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 8) Vendors
-- ---------------------------------------------------------------------
CREATE TABLE Vendors (
  vendor_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  manager_id           BIGINT UNSIGNED NOT NULL,
  legal_name           VARCHAR(150)    NOT NULL,
  tax_number           CHAR(10)        NOT NULL,
  category             ENUM('FOOD','BEVERAGE','MERCH','SERVICE') NOT NULL,
  license_expiry       DATE            NOT NULL,
  hygiene_cert_expiry  DATE            NULL,
  status               ENUM('PENDING_REVIEW','ACTIVE','BLACKLISTED') NOT NULL DEFAULT 'PENDING_REVIEW',
  PRIMARY KEY (vendor_id),
  CONSTRAINT uq_vendors_tax UNIQUE (tax_number),
  CONSTRAINT fk_vendors_manager FOREIGN KEY (manager_id)
    REFERENCES Users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_vendors_tax CHECK (REGEXP_LIKE(tax_number, '^[0-9]{10}$')),
  CONSTRAINT chk_vendors_hygiene CHECK (category NOT IN ('FOOD','BEVERAGE') OR hygiene_cert_expiry IS NOT NULL)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 9) Stalls
-- ---------------------------------------------------------------------
CREATE TABLE Stalls (
  stall_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  festival_id     BIGINT UNSIGNED NOT NULL,
  stall_code      VARCHAR(10)     NOT NULL,
  zone            ENUM('FOOD_COURT','MAIN_STAGE','CAMPING','ENTRANCE') NOT NULL,
  size_m2         DECIMAL(5,2)    NOT NULL,
  has_power       BOOLEAN         NOT NULL DEFAULT FALSE,
  base_fee        DECIMAL(10,2)   NOT NULL,
  PRIMARY KEY (stall_id),
  CONSTRAINT uq_stalls_code UNIQUE (festival_id, stall_code),
  CONSTRAINT fk_stalls_festival FOREIGN KEY (festival_id)
    REFERENCES Festivals(festival_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_stalls_size CHECK (size_m2 > 0),
  CONSTRAINT chk_stalls_fee  CHECK (base_fee >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 10) StallAllocations  (M:N junction Vendors <-> Stalls)
-- ---------------------------------------------------------------------
CREATE TABLE StallAllocations (
  allocation_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vendor_id       BIGINT UNSIGNED NOT NULL,
  stall_id        BIGINT UNSIGNED NOT NULL,
  status          ENUM('APPLIED','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'APPLIED',
  agreed_fee      DECIMAL(10,2)   NOT NULL,
  applied_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at     DATETIME        NULL,
  reviewed_by     BIGINT UNSIGNED NULL,
  approved_marker TINYINT GENERATED ALWAYS AS (IF(status = 'APPROVED', 1, NULL)) STORED,
  PRIMARY KEY (allocation_id),
  CONSTRAINT uq_alloc_one_approved UNIQUE (stall_id, approved_marker),
  KEY idx_alloc_vendor (vendor_id, status),
  CONSTRAINT fk_alloc_vendor FOREIGN KEY (vendor_id)
    REFERENCES Vendors(vendor_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_alloc_stall FOREIGN KEY (stall_id)
    REFERENCES Stalls(stall_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_alloc_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES Users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_alloc_fee      CHECK (agreed_fee >= 0),
  CONSTRAINT chk_alloc_approved CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 7) Payments  (exclusive arc: exactly one of order / allocation)
-- MySQL forbids referential actions on columns used in a CHECK, so these
-- FKs use ON UPDATE RESTRICT (surrogate keys never change).
-- ---------------------------------------------------------------------
CREATE TABLE Payments (
  payment_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id        BIGINT UNSIGNED NULL,
  allocation_id   BIGINT UNSIGNED NULL,
  payment_type    ENUM('CHARGE','REFUND') NOT NULL,
  amount          DECIMAL(10,2)   NOT NULL,
  currency        CHAR(3)         NOT NULL DEFAULT 'TRY',
  method          ENUM('CARD','BANK_TRANSFER','WALLET') NOT NULL,
  status          ENUM('AUTHORIZED','CAPTURED','FAILED') NOT NULL,
  provider_ref    VARCHAR(64)     NOT NULL,
  processed_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_id),
  CONSTRAINT uq_payments_provider_ref UNIQUE (provider_ref),
  KEY idx_payments_processed (processed_at),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id)
    REFERENCES Orders(order_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_payments_allocation FOREIGN KEY (allocation_id)
    REFERENCES StallAllocations(allocation_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_payments_amount CHECK (amount > 0),
  CONSTRAINT chk_payments_arc    CHECK ((order_id IS NULL) <> (allocation_id IS NULL))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Entity 11) GateScans
-- ---------------------------------------------------------------------
CREATE TABLE GateScans (
  scan_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id       CHAR(36)        NOT NULL,
  staff_id        BIGINT UNSIGNED NOT NULL,
  gate_code       VARCHAR(10)     NOT NULL,
  direction       ENUM('IN','OUT') NOT NULL,
  result          ENUM('ACCEPTED','REJECTED_DUPLICATE','REJECTED_INVALID','REJECTED_NOT_LIVE') NOT NULL,
  scanned_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (scan_id),
  KEY idx_scans_ticket_time (ticket_id, scanned_at),
  CONSTRAINT fk_scans_ticket FOREIGN KEY (ticket_id)
    REFERENCES Tickets(ticket_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_scans_staff FOREIGN KEY (staff_id)
    REFERENCES Users(user_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- TRIGGERS (rules that span several rows / tables)
-- =====================================================================
DELIMITER $$

-- Festivals.organizer_id must be an ORGANIZER
CREATE TRIGGER trg_festivals_bi BEFORE INSERT ON Festivals
FOR EACH ROW
BEGIN
  IF (SELECT role FROM Users WHERE user_id = NEW.organizer_id) <> 'ORGANIZER' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Festival organizer must have the ORGANIZER role';
  END IF;
  IF NEW.status <> 'DRAFT' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A new festival must start in DRAFT status (rule 12)';
  END IF;
END$$

-- Rule 12: DRAFT -> ON_SALE -> LIVE -> COMPLETED; anything but COMPLETED -> CANCELLED
CREATE TRIGGER trg_festivals_bu BEFORE UPDATE ON Festivals
FOR EACH ROW
BEGIN
  DECLARE v_quota_sum BIGINT DEFAULT 0;
  DECLARE v_tiers INT DEFAULT 0;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'DRAFT'   AND NEW.status = 'ON_SALE')
      OR (OLD.status = 'ON_SALE' AND NEW.status = 'LIVE')
      OR (OLD.status = 'LIVE'    AND NEW.status = 'COMPLETED')
      OR (OLD.status <> 'COMPLETED' AND OLD.status <> 'CANCELLED' AND NEW.status = 'CANCELLED')
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Illegal festival status transition (rule 12)';
    END IF;
    IF NEW.status = 'ON_SALE' THEN
      SELECT COUNT(*) INTO v_tiers FROM TicketTiers WHERE festival_id = NEW.festival_id;
      IF v_tiers = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A festival needs at least one ticket tier before going ON_SALE';
      END IF;
    END IF;
  END IF;
  IF NEW.daily_capacity <> OLD.daily_capacity THEN
    SELECT COALESCE(SUM(quota), 0) INTO v_quota_sum FROM TicketTiers WHERE festival_id = NEW.festival_id;
    IF v_quota_sum > NEW.daily_capacity THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Daily capacity cannot be lower than the sum of tier quotas (rule 2)';
    END IF;
  END IF;
END$$

-- Rule 2: total quotas must fit in daily_capacity
CREATE TRIGGER trg_tiers_bi BEFORE INSERT ON TicketTiers
FOR EACH ROW
BEGIN
  DECLARE v_cap INT UNSIGNED;
  DECLARE v_sum BIGINT DEFAULT 0;
  SELECT daily_capacity INTO v_cap FROM Festivals WHERE festival_id = NEW.festival_id;
  SELECT COALESCE(SUM(quota), 0) INTO v_sum FROM TicketTiers WHERE festival_id = NEW.festival_id;
  IF v_sum + NEW.quota > v_cap THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Total tier quotas would exceed the festival daily capacity (rule 2)';
  END IF;
END$$

-- Rule 12 price freeze + rule 2 capacity
CREATE TRIGGER trg_tiers_bu BEFORE UPDATE ON TicketTiers
FOR EACH ROW
BEGIN
  DECLARE v_cap INT UNSIGNED;
  DECLARE v_sum BIGINT DEFAULT 0;
  DECLARE v_sold BIGINT DEFAULT 0;
  IF NEW.price <> OLD.price AND EXISTS (SELECT 1 FROM Tickets WHERE tier_id = OLD.tier_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tier price is frozen once its first ticket is sold (rule 12)';
  END IF;
  IF NEW.quota <> OLD.quota THEN
    SELECT daily_capacity INTO v_cap FROM Festivals WHERE festival_id = NEW.festival_id;
    SELECT COALESCE(SUM(quota), 0) INTO v_sum FROM TicketTiers
      WHERE festival_id = NEW.festival_id AND tier_id <> OLD.tier_id;
    IF v_sum + NEW.quota > v_cap THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Total tier quotas would exceed the festival daily capacity (rule 2)';
    END IF;
    SELECT COUNT(*) INTO v_sold FROM Tickets WHERE tier_id = OLD.tier_id AND status IN ('VALID','CHECKED_IN');
    IF NEW.quota < v_sold THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quota cannot be lower than the number of tickets already issued (rule 2)';
    END IF;
  END IF;
END$$

-- Rules 12, 4 and 1 at ticket issue time
CREATE TRIGGER trg_tickets_bi BEFORE INSERT ON Tickets
FOR EACH ROW
BEGIN
  DECLARE v_fest_status VARCHAR(20);
  DECLARE v_start DATE;
  DECLARE v_min_age TINYINT UNSIGNED;
  DECLARE v_tier_fest BIGINT UNSIGNED;
  DECLARE v_order_fest BIGINT UNSIGNED;
  DECLARE v_buyer BIGINT UNSIGNED;
  DECLARE v_dob DATE;
  DECLARE v_holder_status VARCHAR(20);
  DECLARE v_held INT DEFAULT 0;

  SELECT f.status, f.start_date, f.min_age, f.festival_id
    INTO v_fest_status, v_start, v_min_age, v_tier_fest
    FROM TicketTiers t JOIN Festivals f ON f.festival_id = t.festival_id
   WHERE t.tier_id = NEW.tier_id;

  SELECT festival_id, buyer_id INTO v_order_fest, v_buyer FROM Orders WHERE order_id = NEW.order_id;

  IF v_order_fest <> v_tier_fest THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ticket tier does not belong to the order festival';
  END IF;
  IF v_fest_status <> 'ON_SALE' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tickets can only be sold while the festival is ON_SALE (rule 12)';
  END IF;

  SELECT date_of_birth, account_status INTO v_dob, v_holder_status FROM Users WHERE user_id = NEW.holder_id;
  IF v_holder_status <> 'ACTIVE' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ticket holder account is not active';
  END IF;
  IF TIMESTAMPDIFF(YEAR, v_dob, v_start) < v_min_age THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ticket holder is under the festival minimum age (rule 4)';
  END IF;

  SELECT COUNT(*) INTO v_held
    FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
   WHERE o.buyer_id = v_buyer AND o.festival_id = v_order_fest
     AND o.status IN ('PENDING','PAID') AND tk.status IN ('VALID','CHECKED_IN');
  IF v_held >= 10 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A buyer may hold at most 10 tickets per festival (rule 1)';
  END IF;
END$$

-- Rule 4 on holder change, and terminal ticket states
CREATE TRIGGER trg_tickets_bu BEFORE UPDATE ON Tickets
FOR EACH ROW
BEGIN
  DECLARE v_start DATE;
  DECLARE v_min_age TINYINT UNSIGNED;
  DECLARE v_dob DATE;
  DECLARE v_holder_status VARCHAR(20);
  IF OLD.status IN ('REFUNDED','VOID') AND NEW.status <> OLD.status THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Refunded or void tickets cannot change status';
  END IF;
  IF NEW.holder_id <> OLD.holder_id THEN
    SELECT f.start_date, f.min_age INTO v_start, v_min_age
      FROM TicketTiers t JOIN Festivals f ON f.festival_id = t.festival_id
     WHERE t.tier_id = NEW.tier_id;
    SELECT date_of_birth, account_status INTO v_dob, v_holder_status FROM Users WHERE user_id = NEW.holder_id;
    IF v_holder_status <> 'ACTIVE' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'New ticket holder account is not active';
    END IF;
    IF TIMESTAMPDIFF(YEAR, v_dob, v_start) < v_min_age THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'New ticket holder is under the festival minimum age (rule 4)';
    END IF;
    IF NEW.qr_token = OLD.qr_token THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The QR token must be regenerated when the holder changes (rule 5)';
    END IF;
  END IF;
END$$

-- Rule 5: VALID, PAID, current holder, and not later than 48 h before start
CREATE TRIGGER trg_transfers_bi BEFORE INSERT ON TicketTransfers
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  DECLARE v_holder BIGINT UNSIGNED;
  DECLARE v_start DATE;
  DECLARE v_order_status VARCHAR(20);
  SELECT tk.status, tk.holder_id, f.start_date, o.status
    INTO v_status, v_holder, v_start, v_order_status
    FROM Tickets tk
    JOIN TicketTiers t ON t.tier_id = tk.tier_id
    JOIN Festivals f   ON f.festival_id = t.festival_id
    JOIN Orders o      ON o.order_id = tk.order_id
   WHERE tk.ticket_id = NEW.ticket_id;
  IF v_status <> 'VALID' OR v_order_status <> 'PAID' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only VALID tickets of a PAID order can be transferred (rule 5)';
  END IF;
  IF v_holder <> NEW.from_user_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only the current holder can transfer a ticket';
  END IF;
  IF NOW() > TIMESTAMP(v_start) - INTERVAL 48 HOUR THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfers close 48 hours before the festival starts (rule 5)';
  END IF;
END$$

-- Vendors.manager_id must be a VENDOR_MANAGER
CREATE TRIGGER trg_vendors_bi BEFORE INSERT ON Vendors
FOR EACH ROW
BEGIN
  IF (SELECT role FROM Users WHERE user_id = NEW.manager_id) <> 'VENDOR_MANAGER' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vendor manager must have the VENDOR_MANAGER role';
  END IF;
END$$

-- Rule 9 at application time
CREATE TRIGGER trg_alloc_bi BEFORE INSERT ON StallAllocations
FOR EACH ROW
BEGIN
  DECLARE v_vstatus VARCHAR(20);
  DECLARE v_cat VARCHAR(20);
  DECLARE v_lic DATE;
  DECLARE v_hyg DATE;
  DECLARE v_end DATE;
  DECLARE v_fstatus VARCHAR(20);
  SELECT status, category, license_expiry, hygiene_cert_expiry
    INTO v_vstatus, v_cat, v_lic, v_hyg FROM Vendors WHERE vendor_id = NEW.vendor_id;
  SELECT f.end_date, f.status INTO v_end, v_fstatus
    FROM Stalls s JOIN Festivals f ON f.festival_id = s.festival_id WHERE s.stall_id = NEW.stall_id;
  IF NEW.status <> 'APPLIED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A new stall allocation must start as APPLIED';
  END IF;
  IF v_fstatus IN ('COMPLETED','CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This festival no longer accepts stall applications';
  END IF;
  IF v_vstatus <> 'ACTIVE' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only ACTIVE vendors can apply for stalls (rule 9)';
  END IF;
  IF v_lic < v_end THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Business license expires before the festival ends (rule 9)';
  END IF;
  IF v_cat IN ('FOOD','BEVERAGE') AND (v_hyg IS NULL OR v_hyg < v_end) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hygiene certificate must be valid through the festival end date (rule 9)';
  END IF;
END$$

-- Rules 9, 10, 11 at review time + lifecycle
CREATE TRIGGER trg_alloc_bu BEFORE UPDATE ON StallAllocations
FOR EACH ROW
BEGIN
  DECLARE v_vstatus VARCHAR(20);
  DECLARE v_cat VARCHAR(20);
  DECLARE v_lic DATE;
  DECLARE v_hyg DATE;
  DECLARE v_end DATE;
  DECLARE v_fest BIGINT UNSIGNED;
  DECLARE v_approved INT DEFAULT 0;
  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'APPLIED'  AND NEW.status IN ('APPROVED','REJECTED','CANCELLED'))
      OR (OLD.status = 'APPROVED' AND NEW.status = 'CANCELLED')
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Illegal stall allocation status transition';
    END IF;
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN
    SELECT status, category, license_expiry, hygiene_cert_expiry
      INTO v_vstatus, v_cat, v_lic, v_hyg FROM Vendors WHERE vendor_id = NEW.vendor_id;
    SELECT f.end_date, f.festival_id INTO v_end, v_fest
      FROM Stalls s JOIN Festivals f ON f.festival_id = s.festival_id WHERE s.stall_id = NEW.stall_id;
    IF v_vstatus <> 'ACTIVE' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vendor is not ACTIVE (rule 9)';
    END IF;
    IF v_lic < v_end THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Business license expires before the festival ends (rule 9)';
    END IF;
    IF v_cat IN ('FOOD','BEVERAGE') AND (v_hyg IS NULL OR v_hyg < v_end) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hygiene certificate must be valid through the festival end date (rule 9)';
    END IF;
    SELECT COUNT(*) INTO v_approved
      FROM StallAllocations a JOIN Stalls s ON s.stall_id = a.stall_id
     WHERE a.vendor_id = NEW.vendor_id AND s.festival_id = v_fest
       AND a.status = 'APPROVED' AND a.allocation_id <> NEW.allocation_id;
    IF v_approved >= 2 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A vendor can have at most 2 approved stalls per festival (rule 10)';
    END IF;
    IF NEW.approved_at IS NULL THEN
      SET NEW.approved_at = NOW();
    END IF;
  END IF;
END$$

-- Rule 13: refunds can never exceed captured charges
CREATE TRIGGER trg_payments_bi BEFORE INSERT ON Payments
FOR EACH ROW
BEGIN
  DECLARE v_charged DECIMAL(12,2) DEFAULT 0;
  DECLARE v_refunded DECIMAL(12,2) DEFAULT 0;
  IF NEW.payment_type = 'REFUND' AND NEW.status = 'CAPTURED' THEN
    IF NEW.order_id IS NOT NULL THEN
      SELECT COALESCE(SUM(CASE WHEN payment_type = 'CHARGE' THEN amount END), 0),
             COALESCE(SUM(CASE WHEN payment_type = 'REFUND' THEN amount END), 0)
        INTO v_charged, v_refunded
        FROM Payments WHERE order_id = NEW.order_id AND status = 'CAPTURED';
    ELSE
      SELECT COALESCE(SUM(CASE WHEN payment_type = 'CHARGE' THEN amount END), 0),
             COALESCE(SUM(CASE WHEN payment_type = 'REFUND' THEN amount END), 0)
        INTO v_charged, v_refunded
        FROM Payments WHERE allocation_id = NEW.allocation_id AND status = 'CAPTURED';
    END IF;
    IF v_refunded + NEW.amount > v_charged THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Total refunds may never exceed total captured charges (rule 13)';
    END IF;
  END IF;
END$$

-- Gate scans must be performed by GATE_STAFF
CREATE TRIGGER trg_scans_bi BEFORE INSERT ON GateScans
FOR EACH ROW
BEGIN
  IF (SELECT role FROM Users WHERE user_id = NEW.staff_id) <> 'GATE_STAFF' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only GATE_STAFF users can record gate scans';
  END IF;
END$$

DELIMITER ;

-- =====================================================================
-- VIEWS (all calculated values live here, never in tables)
-- =====================================================================

-- Tickets sold and remaining quota per tier (rule 2)
CREATE VIEW v_tier_availability AS
SELECT t.tier_id, t.festival_id, t.tier_name, t.price, t.quota, t.max_per_order,
       t.sale_start, t.sale_end,
       COUNT(CASE WHEN tk.status IN ('VALID','CHECKED_IN') THEN 1 END) AS sold,
       t.quota - COUNT(CASE WHEN tk.status IN ('VALID','CHECKED_IN') THEN 1 END) AS remaining
  FROM TicketTiers t
  LEFT JOIN Tickets tk ON tk.tier_id = t.tier_id
 GROUP BY t.tier_id;

-- Order totals computed from tier prices and the payment ledger
CREATE VIEW v_order_totals AS
SELECT o.order_id, o.buyer_id, o.festival_id, o.status, o.created_at, o.expires_at, o.paid_at,
       (SELECT COUNT(*) FROM Tickets tk WHERE tk.order_id = o.order_id) AS ticket_count,
       (SELECT COALESCE(SUM(t.price), 0) FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id
         WHERE tk.order_id = o.order_id) AS total_amount,
       (SELECT COALESCE(SUM(p.amount), 0) FROM Payments p
         WHERE p.order_id = o.order_id AND p.payment_type = 'CHARGE' AND p.status = 'CAPTURED') AS captured_amount,
       (SELECT COALESCE(SUM(p.amount), 0) FROM Payments p
         WHERE p.order_id = o.order_id AND p.payment_type = 'REFUND' AND p.status = 'CAPTURED') AS refunded_amount
  FROM Orders o;

-- Rule 6 refund quote per ticket: 90% >= 30 days, 50% 7-29 days, 0% < 7 days
CREATE VIEW v_ticket_refund_quote AS
SELECT tk.ticket_id, tk.order_id, tk.status AS ticket_status, o.status AS order_status,
       f.festival_id, f.start_date, t.price,
       DATEDIFF(f.start_date, CURDATE()) AS days_before_start,
       CASE WHEN DATEDIFF(f.start_date, CURDATE()) >= 30 THEN 0.90
            WHEN DATEDIFF(f.start_date, CURDATE()) >= 7  THEN 0.50
            ELSE 0.00 END AS refund_rate,
       ROUND(t.price * CASE WHEN DATEDIFF(f.start_date, CURDATE()) >= 30 THEN 0.90
                            WHEN DATEDIFF(f.start_date, CURDATE()) >= 7  THEN 0.50
                            ELSE 0.00 END, 2) AS refund_amount,
       (tk.status = 'VALID' AND o.status = 'PAID'
          AND DATEDIFF(f.start_date, CURDATE()) >= 7) AS refundable
  FROM Tickets tk
  JOIN Orders o      ON o.order_id = tk.order_id
  JOIN TicketTiers t ON t.tier_id = tk.tier_id
  JOIN Festivals f   ON f.festival_id = t.festival_id;

-- Latest accepted scan per ticket (rule 8 anti-passback state)
CREATE VIEW v_ticket_last_scan AS
SELECT gs.ticket_id, gs.direction, gs.gate_code, gs.scanned_at
  FROM GateScans gs
 WHERE gs.result = 'ACCEPTED'
   AND gs.scan_id = (SELECT MAX(g2.scan_id) FROM GateScans g2
                      WHERE g2.ticket_id = gs.ticket_id AND g2.result = 'ACCEPTED');

-- Festival KPIs for dashboards
CREATE VIEW v_festival_stats AS
SELECT f.festival_id, f.name, f.status, f.start_date, f.end_date, f.daily_capacity, f.organizer_id,
       (SELECT COALESCE(SUM(quota), 0) FROM TicketTiers WHERE festival_id = f.festival_id) AS total_quota,
       (SELECT COUNT(*) FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id
         JOIN Orders o ON o.order_id = tk.order_id
         WHERE t.festival_id = f.festival_id AND o.status = 'PAID'
           AND tk.status IN ('VALID','CHECKED_IN')) AS tickets_sold,
       (SELECT COUNT(*) FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id
         WHERE t.festival_id = f.festival_id AND tk.status = 'CHECKED_IN') AS checked_in,
       (SELECT COALESCE(SUM(CASE WHEN p.payment_type = 'CHARGE' THEN p.amount ELSE -p.amount END), 0)
          FROM Payments p JOIN Orders o ON o.order_id = p.order_id
         WHERE o.festival_id = f.festival_id AND p.status = 'CAPTURED') AS ticket_revenue,
       (SELECT COALESCE(SUM(CASE WHEN p.payment_type = 'CHARGE' THEN p.amount ELSE -p.amount END), 0)
          FROM Payments p JOIN StallAllocations a ON a.allocation_id = p.allocation_id
          JOIN Stalls s ON s.stall_id = a.stall_id
         WHERE s.festival_id = f.festival_id AND p.status = 'CAPTURED') AS stall_revenue,
       (SELECT COUNT(*) FROM Stalls WHERE festival_id = f.festival_id) AS stall_count,
       (SELECT COUNT(*) FROM StallAllocations a JOIN Stalls s ON s.stall_id = a.stall_id
         WHERE s.festival_id = f.festival_id AND a.status = 'APPROVED') AS stalls_allocated
  FROM Festivals f;

-- Allocation fee balance (rule 11)
CREATE VIEW v_allocation_balance AS
SELECT a.allocation_id, a.vendor_id, a.stall_id, a.status, a.agreed_fee, a.approved_at,
       a.approved_at + INTERVAL 7 DAY AS fee_due_at,
       (SELECT COALESCE(SUM(p.amount), 0) FROM Payments p
         WHERE p.allocation_id = a.allocation_id AND p.payment_type = 'CHARGE' AND p.status = 'CAPTURED') AS paid_amount,
       (SELECT COALESCE(SUM(p.amount), 0) FROM Payments p
         WHERE p.allocation_id = a.allocation_id AND p.payment_type = 'REFUND' AND p.status = 'CAPTURED') AS refunded_amount
  FROM StallAllocations a;
