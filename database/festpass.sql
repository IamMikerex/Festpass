-- =====================================================================
-- FestPass: Music Festival Ticketing & Vendor Management System
-- MySQL 8.0 (InnoDB, utf8mb4). One file builds everything:
--   Part 1  schema: 11 tables, CHECK/UNIQUE/FK constraints
--   Part 2  12 triggers enforcing the business rules
--   Part 3  6 reporting views (no calculated value is ever stored)
--   Part 4  demo data, dated relative to the day you import it
--
-- Import as root (it drops and recreates the `festpass` database):
--   mysql -u root -p < database/festpass.sql
-- MySQL Workbench: File > Run SQL Script... > festpass.sql
-- Every demo account's password is:  Password123!
-- =====================================================================

-- =====================================================================
-- Part 1: tables
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
-- Part 2: triggers (rules that span several rows or tables)
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
-- Part 3: views (every calculated value lives here, never in a table)
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


-- =====================================================================
-- Part 4: demo data. Re-import this file at any time to reset the demo.
-- =====================================================================
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
