/**
 * Loads database/schema.sql (+ seed.sql unless --schema-only) through mysql2,
 * understanding the MySQL CLI's DELIMITER directive used for triggers/procedures.
 * Usage: npm run db:init     (drops and recreates the `festpass` database!)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

function splitSql(text) {
  const statements = [];
  let delimiter = ';';
  let buf = [];
  for (const line of text.split(/\r?\n/)) {
    const d = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (d) { delimiter = d[1]; continue; }
    buf.push(line);
    if (line.trimEnd().endsWith(delimiter)) {
      let stmt = buf.join('\n').trimEnd();
      stmt = stmt.slice(0, stmt.length - delimiter.length).trim();
      buf = [];
      const meaningful = stmt.split('\n').filter((l) => !/^\s*(--.*)?$/.test(l)).join('\n').trim();
      if (meaningful) statements.push(stmt);
    }
  }
  if (buf.join('').trim()) statements.push(buf.join('\n').trim());
  return statements;
}

async function run() {
  const schemaOnly = process.argv.includes('--schema-only');
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password,
  });
  await conn.query(`SET time_zone = '${config.db.timezone}'`);
  const files = ['schema.sql', ...(schemaOnly ? [] : ['seed.sql'])];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', f), 'utf8');
    const stmts = splitSql(sql);
    process.stdout.write(`Running ${f} (${stmts.length} statements)... `);
    for (const s of stmts) {
      try { await conn.query(s); } catch (e) {
        console.error(`\nFailed statement:\n${s.slice(0, 400)}\n`);
        throw e;
      }
    }
    console.log('done');
  }
  const [[c]] = await conn.query('SELECT (SELECT COUNT(*) FROM festpass.Users) AS users, (SELECT COUNT(*) FROM festpass.Tickets) AS tickets');
  console.log(`Database ready: ${c.users} users, ${c.tickets} tickets. Demo password for every account: Password123!`);
  await conn.end();
}

run().catch((e) => { console.error(e.message); process.exit(1); });
