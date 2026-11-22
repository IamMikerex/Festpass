class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (m, d) => new HttpError(400, m, d);
const unauthorized = (m = 'Authentication required') => new HttpError(401, m);
const forbidden = (m = 'You do not have permission to do this') => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);
const conflict = (m, d) => new HttpError(409, m, d);

/** Translate MySQL errors (trigger SIGNALs, constraint violations) into HTTP errors. */
function fromDbError(err) {
  if (err instanceof HttpError) return err;
  if (err && err.sqlState === '45000') return conflict(err.sqlMessage || err.message);
  switch (err && err.code) {
    case 'ER_DUP_ENTRY': {
      const m = /for key '([^']+)'/.exec(err.sqlMessage || '');
      const key = m ? m[1] : '';
      const friendly = {
        'Users.uq_users_email': 'An account with this email already exists',
        'Users.uq_users_phone': 'This phone number is already registered',
        'Festivals.uq_festivals_name_start': 'A festival with this name and start date already exists',
        'TicketTiers.uq_tiers_festival_name': 'This festival already has a tier with that name',
        'TicketTransfers.uq_transfers_ticket': 'This ticket has already been transferred once (rule 5)',
        'Payments.uq_payments_provider_ref': 'This payment was already processed (duplicate provider reference)',
        'Vendors.uq_vendors_tax': 'A vendor with this tax number is already registered',
        'Stalls.uq_stalls_code': 'This festival already has a stall with that code',
        'StallAllocations.uq_alloc_one_approved': 'This stall already has an approved vendor (rule 10)',
      }[key];
      return conflict(friendly || 'Duplicate value');
    }
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return badRequest(`Constraint violated: ${err.sqlMessage}`);
    case 'ER_ROW_IS_REFERENCED_2':
    case 'ER_ROW_IS_REFERENCED':
      return conflict('This record is referenced by other records and cannot be deleted');
    case 'ER_NO_REFERENCED_ROW_2':
      return badRequest('A referenced record does not exist');
    case 'ER_LOCK_DEADLOCK':
    case 'ER_LOCK_WAIT_TIMEOUT':
      return new HttpError(503, 'The system is busy, please try again');
    default:
      return null;
  }
}

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, fromDbError };
