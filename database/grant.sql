-- Lets the app user build the festpass database (npm run db:init), the festpass_test copy used by pytest, and triggers.
CREATE USER IF NOT EXISTS 'festpass'@'%' IDENTIFIED BY 'festpass';
GRANT ALL PRIVILEGES ON festpass.* TO 'festpass'@'%';
GRANT ALL PRIVILEGES ON festpass_test.* TO 'festpass'@'%';  -- pytest's throwaway copy
GRANT CREATE, DROP ON *.* TO 'festpass'@'%';
SET GLOBAL log_bin_trust_function_creators = 1;
FLUSH PRIVILEGES;
