// Shapes rows for the unauthenticated public links and the client portal.
// Those routes read whole rows (SELECT *), so every internal column on them
// would otherwise reach the client. Anything staff-only is removed here, in
// one place, rather than trusted to each route.
const INTERNAL = {
  client: ['notes'],
  invoice: [
    'void_reason',
    'void_previous_status',
    'reminder_hold_until',
    'reminder_hold_note',
    'last_reminder_sent_at',
    'created_by_name',
  ],
  quote: ['void_reason', 'void_previous_status', 'created_by_name'],
};

function omit(row, keys) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  for (const k of keys) delete copy[k];
  return copy;
}

const clientForClient = (row) => omit(row, INTERNAL.client);
const invoiceForClient = (row) => omit(row, INTERNAL.invoice);
const quoteForClient = (row) => omit(row, INTERNAL.quote);

module.exports = { INTERNAL, clientForClient, invoiceForClient, quoteForClient };
