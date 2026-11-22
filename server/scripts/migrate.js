/**
 * Production-safe database setup. Unlike initDb.js it never drops existing data:
 *  - festpass database missing or empty  -> load schema.sql (and, with --seed or SEED_DEMO=true,
 *                                           seed.sql plus the demo scenarios)
 *  - schema already present               -> do nothing
 * Run it with an account that may create tables, triggers and views (DB_MIGRATE_USER /
 * DB_MIGRATE_PASSWORD, falling back to DB_USER / DB_PASSWORD).
 * Usage: npm run db:migrate [-- --seed]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const { splitSql } = require('./initDb');

const user = process.env.DB_MIGRATE_USER || config.db.user;
const password = process.env.DB_MIGRATE_PASSWORD || config.db.password;
const seed = process.argv.includes('--seed') || process.env.SEED_DEMO === 'true';

async function connectWithRetry(attempts = 30) {
  for (let i = 1; ; i += 1) {
    try {
      return await mysql.createConnection({ host: config.db.host, port: config.db.port, user, password, multipleStatements: false });
    } catch (e) {
      if (i >= attempts) throw e;
      console.log(`Waiting for MySQL (${e.code || e.message})... ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function load(conn, file) {
  const stmts = splitSql(fs.readFileSync(path.join(__dirname, '..', '..', 'database', file), 'utf8'));
  process.stdout.write(`Loading ${file} (${stmts.length} statements)... `);
  for (const s of stmts) await conn.query(s);
  console.log('done');
}

async function run() {
  const conn = await connectWithRetry();
  await conn.query(`SET time_zone = '${config.db.timezone.replace(/[^0-9:+-]/g, '')}'`);
  const [[row]] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = 'Users'", [config.db.database],
  );
  if (row.n > 0) {
    console.log(`Database "${config.db.database}" already has the FestPass schema; nothing to do.`);
    await conn.end();
    return;
  }
  if (config.db.database !== 'festpass') throw new Error('schema.sql creates a database named "festpass"; set DB_NAME=festpass');
  await load(conn, 'schema.sql');
  if (seed) {
    await load(conn, 'seed.sql');
    await conn.end();
    // The demo scenarios go through the real API so every business rule applies.
    execFileSync(process.execPath, [path.join(__dirname, 'demoScenarios.js')], {
      stdio: 'inherit', env: { ...process.env, DB_USER: user, DB_PASSWORD: password, NODE_ENV: 'test' },
    });
  } else {
    await conn.end();
  }
  console.log('Database ready.');
}

run().catch((e) => { console.error(`Migration failed: ${e.message}`); process.exit(1); });
