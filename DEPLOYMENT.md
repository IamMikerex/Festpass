# Deploying FestPass

FestPass runs as three parts that share one MySQL database:

```
                 ┌──────────────────────────── one public port ───────────────────────────┐
Browser ──HTTPS──► Caddy or nginx ──► Express API :4000 ──/api──────────────► MySQL 8 :3306
                  (TLS, gzip)          ├─ serves the React build (client/dist)      ▲
                                       └─ /analytics/* ──► FastAPI :8000 (read-only) ┘
```

- **Express** serves the built React app and `/api`, runs the scheduled jobs, and forwards `/analytics/*` to FastAPI. Browsers only ever talk to one origin.
- **FastAPI** is read-only and is never exposed to the internet.
- **MySQL** is never exposed either. Each service connects with its own least-privilege account.

There are two ways to deploy:

| | Docker Compose (recommended) | Bare metal |
|---|---|---|
| What you install | Docker | Node 20, Python 3.10+, MySQL 8, nginx |
| Files | `Dockerfile`, `reports/Dockerfile`, `docker-compose.prod.yml`, `.env.production.example`, `deploy/Caddyfile` | `deploy/nginx.conf`, `deploy/festpass-api.service`, `deploy/festpass-analytics.service`, `database/mysql/production.cnf` |
| HTTPS | Built in (`--profile https`, Let's Encrypt) | certbot + nginx |

The development setup is unchanged: `docker-compose.yml` (local MySQL) and `npm run dev:api | dev:analytics | dev:client` work as before.

---

## Option A: Docker Compose

Any Linux server with Docker works, for example a small cloud VM with 2 GB RAM.

```bash
git clone https://github.com/IamMikerex/festpass.git && cd festpass
cp .env.production.example .env.production
nano .env.production                # set every CHANGE value (see the reference below)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

On first start:

1. `mysql` starts with `database/mysql/production.cnf` and creates three accounts (`database/mysql/init-users.sh`).
2. `migrate` waits for MySQL and loads `schema.sql` into the empty database. With `SEED_DEMO=true` it also loads the demo data and demo scenarios. It never drops existing data: on later starts it prints "nothing to do" and exits.
3. `analytics` and `api` start once the migration has finished. The site is at `http://HTTP_BIND:HTTP_PORT` (by default `http://127.0.0.1:8080`).

### HTTPS with your own domain

Point the domain's DNS A record at the server, then in `.env.production` set:

```bash
DOMAIN=festpass.example.com
PUBLIC_URL=https://festpass.example.com
```

Then start with Caddy, which gets and renews the certificate automatically:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production --profile https up -d
```

Caddy listens on ports 80 and 443, redirects HTTP to HTTPS and adds HSTS.

### For a class demo on a laptop or classroom network

Set `SEED_DEMO=true`, `HTTP_BIND=0.0.0.0` and `PUBLIC_URL=http://<laptop-ip>:8080`, then start the stack. Phones on the same Wi-Fi can open the site at that address. Browsers only allow the camera on HTTPS or `localhost`, so for camera scanning from phones, use the HTTPS profile or type the codes.

### Day-to-day commands

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C ps                                   # status and health of every service
$C logs -f api analytics                # JSON logs (one line per request, with request_id)
$C pull && $C up -d --build             # deploy a new version (schema is left untouched)
$C run --rm migrate npm run demo:reset  # demo server only: wipe and reload the demo data
$C run --rm migrate npm run demo:qr     # gate scanner test codes
$C down                                 # stop (data stays in the mysql-data volume)
```

### Backups

```bash
# nightly dump (add to cron); --single-transaction gives a consistent InnoDB snapshot without locking
$C exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers festpass' | gzip > festpass-$(date +%F).sql.gz
# restore
gunzip -c festpass-2026-11-22.sql.gz | $C exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" festpass'
```

Binary logs are kept for 7 days (`binlog_expire_logs_seconds`), which allows point-in-time recovery between dumps.

---

## Option B: Bare metal (Ubuntu, systemd, nginx)

```bash
# 1. Packages
sudo apt install -y mysql-server nginx python3-venv
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs

# 2. MySQL settings and accounts
sudo cp database/mysql/production.cnf /etc/mysql/mysql.conf.d/festpass.cnf && sudo systemctl restart mysql
sudo MYSQL_ROOT_PASSWORD='' DB_MIGRATE_PASSWORD=... DB_APP_PASSWORD=... DB_ANALYTICS_PASSWORD=... \
     bash database/mysql/init-users.sh        # on Ubuntu, root uses socket auth, so an empty password works under sudo

# 3. Code in /opt/festpass, owned by a service user
sudo useradd --system --home /opt/festpass festpass
sudo git clone https://github.com/IamMikerex/festpass.git /opt/festpass && cd /opt/festpass
sudo npm --prefix server ci --omit=dev && sudo npm --prefix client ci && sudo npm run build
sudo python3 -m venv reports/.venv && sudo reports/.venv/bin/pip install -r reports/requirements-prod.txt
sudo chown -R festpass: /opt/festpass

# 4. Environment files (see the reference below), readable only by the service user
sudo mkdir -p /etc/festpass && sudo nano /etc/festpass/api.env /etc/festpass/analytics.env
sudo chown festpass: /etc/festpass/*.env && sudo chmod 600 /etc/festpass/*.env

# 5. Schema (as the migration account; add --seed for demo data)
cd /opt/festpass/server && sudo -u festpass bash -c 'set -a; . /etc/festpass/api.env; DB_USER=festpass_migrate DB_PASSWORD=YOUR_MIGRATE_PASSWORD node scripts/migrate.js'

# 6. Services and web server
sudo cp deploy/festpass-*.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now festpass-analytics festpass-api
sudo cp deploy/nginx.conf /etc/nginx/sites-available/festpass && sudo ln -s ../sites-available/festpass /etc/nginx/sites-enabled/
sudo certbot --nginx -d festpass.example.com && sudo systemctl reload nginx
```

Logs go to `journalctl -u festpass-api -f` and `journalctl -u festpass-analytics -f`.

---

## Environment variable reference

### Docker Compose (`.env.production`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PUBLIC_URL` | yes | – | Public address of the site, used as the allowed CORS origin. Comma-separate several. |
| `MYSQL_ROOT_PASSWORD` | yes | – | MySQL root password (used only by the MySQL container and backups). |
| `DB_MIGRATE_PASSWORD` | yes | – | Password of `festpass_migrate` (schema owner, used by `migrate` and `demo:reset`). |
| `DB_APP_PASSWORD` | yes | – | Password of `festpass_app` (Express: SELECT/INSERT/UPDATE/DELETE, no DDL). |
| `DB_ANALYTICS_PASSWORD` | yes | – | Password of `festpass_analytics` (FastAPI: SELECT only). |
| `JWT_SECRET` | yes | – | Signs sign-in tokens. Shared by Express and FastAPI. At least 32 random characters: `openssl rand -hex 32`. |
| `PAYMENT_WEBHOOK_SECRET` | yes | – | HMAC secret for the payment gateway webhook. At least 32 random characters. |
| `DB_TIMEZONE` | no | `+03:00` | Festival local time used by `NOW()`/`CURDATE()` in rules. |
| `JWT_EXPIRES_IN` | no | `8h` | Session length. |
| `HTTP_BIND` / `HTTP_PORT` | no | `127.0.0.1` / `8080` | Where the API container is published when Caddy is not used. |
| `DOMAIN` | with `--profile https` | – | Domain name Caddy requests a certificate for. |
| `SEED_DEMO` | no | `false` | `true` loads demo festivals and accounts on the first start (class demos only). |
| `DB_CONNECTION_LIMIT` | no | `15` | Express MySQL pool size. |
| `ANALYTICS_WORKERS` | no | `2` | Uvicorn worker processes. |
| `JOBS_INTERVAL_MS` | no | `30000` | How often the scheduled jobs run (rules 3, 11, 12). |
| `LOG_LEVEL` | no | `info` | `error`, `warn`, `info` or `debug`. |
| `ANALYTICS_DOCS` | no | `true` | `false` hides `/analytics/docs`. |

### Express API (`server/.env`, or `/etc/festpass/api.env` on bare metal)

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` turns on JSON logs and the secret checks (the API refuses to start with weak secrets). |
| `PORT` | `4000` | HTTP port. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `127.0.0.1`, `3306`, `festpass`, `festpass`, `festpass` | Database connection. In production, use `festpass_app`. |
| `DB_TIMEZONE` | `+03:00` | Session time zone for every connection. |
| `DB_CONNECTION_LIMIT` | `15` | Pool size. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | dev value, `8h` | Token signing (required in production). |
| `PAYMENT_WEBHOOK_SECRET` | dev value | Webhook HMAC (required in production). |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origins (required in production). |
| `ANALYTICS_URL` | `http://127.0.0.1:8000` | Where `/analytics/*` is forwarded. |
| `SERVE_CLIENT` | `true` | Serve `client/dist`. Set `false` if a CDN or nginx serves the static files. |
| `JOBS_ENABLED` | `true` | Run the scheduled jobs here. With several API replicas, enable them on exactly one. |
| `JOBS_INTERVAL_MS` | `30000` | Job interval. |
| `LOG_LEVEL`, `LOG_FORMAT` | `info`, `json` in production / `pretty` otherwise | Logging. |
| `DB_MIGRATE_USER`, `DB_MIGRATE_PASSWORD` | `DB_USER`/`DB_PASSWORD` | Account used by `npm run db:migrate`. |
| `SEED_DEMO` | `false` | `db:migrate` also loads demo data. |

### FastAPI (`reports/.env`, or `/etc/festpass/analytics.env`)

| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | `production` turns on JSON logs and the secret check. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_TIMEZONE` | as Express | In production, use the read-only `festpass_analytics`. |
| `JWT_SECRET` | dev value | Must be identical to the Express value. |
| `CORS_ORIGIN` | `http://localhost:5173` | Only matters if browsers call FastAPI directly. |
| `LOG_LEVEL`, `LOG_FORMAT` | `INFO`, `json` in production / `text` otherwise | Logging. |
| `ANALYTICS_DOCS` | `true` | Interactive docs at `/analytics/docs`. |

In development, FastAPI falls back to `server/.env` for anything `reports/.env` does not set.

---

## What production mode adds

| Area | Behavior |
|---|---|
| Frontend build | `vite build` with hashed file names. Assets are cached for a year (`immutable`); `index.html` is always revalidated. React's error boundary shows a recovery screen instead of a blank page, and network failures show a clear message. |
| Configuration checks | Both services refuse to start in production with missing, short or example secrets. |
| Logging | One JSON line per request: `time`, `level`, `request_id`, `method`, `path`, `status`, `ms`, `user_id`. Errors include the stack. The same `X-Request-Id` follows a request from the proxy through Express to FastAPI and is returned to the browser. |
| Errors | Users never see stack traces. Business-rule violations return 409 with the rule's message. Database outages return 503 ("temporarily unavailable"), FastAPI being down returns 502, and unexpected errors return 500 with a `request_id` that points to the log line. |
| Health checks | `GET /api/health` and `GET /analytics/health` return 200 only when the database answers, 503 otherwise. Docker uses them to report container health. |
| Shutdown | On SIGTERM the API stops accepting connections, finishes in-flight requests, stops the jobs and closes the DB pool (forced exit after 10 s). |
| Database | Three accounts with least privilege. Strict durability (`innodb_flush_log_at_trx_commit=1`, `sync_binlog=1`), utf8mb4, festival time zone, slow-query log, 7-day binary logs, `local_infile` off. MySQL is not published outside Docker. |
| Migrations | `npm run db:migrate` only creates the schema in an empty database. `db:init` and `demo:reset`, which drop data, are for development and demo servers only. |

## Checking a deployment

```bash
curl -s https://festpass.example.com/api/health        # {"ok":true,...}
curl -s https://festpass.example.com/analytics/health  # {"ok":true,...}
```

Then sign in. With `SEED_DEMO=true`, use the demo accounts in [DEMO_GUIDE.md](DEMO_GUIDE.md).
