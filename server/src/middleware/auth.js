const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../utils/errors');

/** Verifies the Bearer JWT and loads the (still active) user. */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Session expired, please sign in again');
    }
    const user = await db.one(
      'SELECT user_id, email, full_name, phone, date_of_birth, role, account_status FROM Users WHERE user_id = ?',
      [payload.sub],
    );
    if (!user || user.account_status !== 'ACTIVE') throw unauthorized('Account is not active');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Optional auth: attaches req.user when a valid token is present, otherwise continues anonymously. */
async function optionalAuth(req, res, next) {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, (err) => next(err && err.status === 401 ? undefined : err));
}

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  return next();
};

const signToken = (user) =>
  jwt.sign({ sub: String(user.user_id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

module.exports = { authenticate, optionalAuth, requireRole, signToken };
