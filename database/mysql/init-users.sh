#!/bin/bash
# Creates the three FestPass database accounts on first start of the MySQL container
# (run once by the official image from /docker-entrypoint-initdb.d). Least privilege:
#   festpass_migrate   - owns the schema: creates tables, triggers, views (db:migrate, demo:reset)
#   festpass_app       - Express API: read/write data, no DDL
#   festpass_analytics - FastAPI: read-only
# Passwords come from the container environment; use letters and digits only.
set -euo pipefail
mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'festpass_migrate'@'%' IDENTIFIED BY '${DB_MIGRATE_PASSWORD}';
GRANT ALL PRIVILEGES ON festpass.* TO 'festpass_migrate'@'%';
CREATE USER IF NOT EXISTS 'festpass_app'@'%' IDENTIFIED BY '${DB_APP_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, SHOW VIEW ON festpass.* TO 'festpass_app'@'%';
CREATE USER IF NOT EXISTS 'festpass_analytics'@'%' IDENTIFIED BY '${DB_ANALYTICS_PASSWORD}';
GRANT SELECT, SHOW VIEW ON festpass.* TO 'festpass_analytics'@'%';
FLUSH PRIVILEGES;
SQL
echo "FestPass database users created"
