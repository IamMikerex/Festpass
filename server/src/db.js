const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.dbConnectionLimit,
  connectTimeout: 10000,
  enableKeepAlive: true,
  dateStrings: true, // DATE/DATETIME come back as strings: no timezone drift
  decimalNumbers: true,
  timezone: config.db.timezone,
});

// Every connection uses the festival's local time zone so NOW()/CURDATE()
// in triggers and views match the dates organisers type in.
pool.on('connection', (conn) => {
  conn.query(`SET time_zone = '${config.db.timezone.replace(/[^0-9:+-]/g, '')}'`);
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/** Run fn(conn) inside a transaction; commits on success, rolls back on error. */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const helpers = {
      conn,
      query: async (sql, params = []) => (await conn.query(sql, params))[0],
      one: async (sql, params = []) => (await conn.query(sql, params))[0][0] || null,
    };
    const result = await fn(helpers);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, one, tx };
