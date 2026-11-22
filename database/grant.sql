-- Lets the app user drop/re-create the festpass database (npm run db:init) and create triggers.
CREATE USER IF NOT EXISTS 'festpass'@'%' IDENTIFIED BY 'festpass';
GRANT ALL PRIVILEGES ON festpass.* TO 'festpass'@'%';
GRANT CREATE, DROP ON *.* TO 'festpass'@'%';
SET GLOBAL log_bin_trust_function_creators = 1;
FLUSH PRIVILEGES;
