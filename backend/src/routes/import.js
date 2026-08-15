const crypto = require('crypto');
const { Router } = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { parseCsv } = require('../lib/csv');
const { computeTotals } = require('../lib/totals');
const { invoiceNumberForYear, receiptNumberForYear } = require('../lib/numbering');
const { logActivity } = require('../lib/activity');

const router = Router();
router.use(requireAuth);
router.use(requirePermission('import', 'manage'));

const MAX_ROWS = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXPENSE_CATEGORIES = ['rent', 'utilities', 'supplies', 'salaries', 'marketing', 'software', 'travel', 'other'];
const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'];

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Tolerates values copied out of a spreadsheet: strips thousands-separator
// commas and a leading currency symbol before parsing, so "2,500" or
// "$2,500.00" parse the same as "2500" instead of failing as NaN.
function parseNumber(value) {
  if (value == null) return NaN;
  return Number(String(value).trim().replace(/[$,]/g, ''));
}

// Hands out sequential per-year numbers within a single import batch without
// re-querying the DB per row. Seeded once per year from the real "next"
// number (invoiceNumberForYear/receiptNumberForYear), then advanced purely
// in-memory — this stays correct in preview mode too, where nothing is
// actually written between rows and the DB count never moves.
function makeSequencer(nextForYear, prefix) {
  const seeded = new Map(); // year -> next sequence int
  return (year) => {
    if (!seeded.has(year)) {
      const seedStr = nextForYear(year); // e.g. "INV-2023-0007"
      seeded.set(year, parseInt(seedStr.split('-').pop(), 10));
    }
    const seq = seeded.get(year);
    seeded.set(year, seq + 1);
    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
  };
}

// ---- Clients ----------------------------------------------------------------

function validateClientRow(row, seenEmails, existingEmails) {
  const name = (row.name || '').trim();
  const email = (row.email || '').trim().toLowerCase();
  if (!name) return { ok: false, message: 'name is required' };
  if (!email || !EMAIL_RE.test(email)) return { ok: false, message: 'a valid email is required' };
  if (existingEmails.has(email) || seenEmails.has(email)) {
    return { ok: false, message: `duplicate: a client with email "${email}" already exists or appears earlier in this file` };
  }
  return {
    ok: true,
    values: {
      name,
      email,
      phone: (row.phone || '').trim(),
      address: (row.address || '').trim(),
      notes: (row.notes || '').trim(),
    },
  };
}

function processClients(rows, commit) {
  const existingEmails = new Set(db.prepare('SELECT email FROM clients').all().map((r) => r.email.toLowerCase()));
  const seenEmails = new Set();
  const results = [];
  let imported = 0;

  const insert = db.prepare('INSERT INTO clients (name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?)');

  rows.forEach((row, index) => {
    const outcome = validateClientRow(row, seenEmails, existingEmails);
    const rowNumber = index + 2; // +1 for 0-index, +1 for the header row
    if (!outcome.ok) {
      results.push({ row: rowNumber, status: 'error', message: outcome.message, preview: row.name || row.email || '' });
      return;
    }
    seenEmails.add(outcome.values.email);
    const v = outcome.values;
    if (commit) {
      const result = insert.run(v.name, v.email, v.phone, v.address, v.notes);
      imported += 1;
      results.push({ row: rowNumber, status: 'ok', message: 'imported', preview: v.name, id: result.lastInsertRowid });
    } else {
      results.push({ row: rowNumber, status: 'ok', message: 'ready to import', preview: v.name });
    }
  });

  return { results, imported };
}

// ---- Expenses -----------------------------------------------------------------

function validateExpenseRow(row) {
  const description = (row.description || '').trim();
  const category = (row.category || 'other').trim() || 'other';
  const amount = parseNumber(row.amount);
  const expense_date = (row.expense_date || '').trim();

  if (!description) return { ok: false, message: 'description is required' };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: 'amount must be a positive number' };
  if (!DATE_RE.test(expense_date)) return { ok: false, message: 'expense_date must be in YYYY-MM-DD format' };
  if (!EXPENSE_CATEGORIES.includes(category)) {
    return { ok: false, message: `category must be one of: ${EXPENSE_CATEGORIES.join(', ')}` };
  }
  return { ok: true, values: { category, description, amount, expense_date, notes: (row.notes || '').trim() } };
}

function processExpenses(rows, commit) {
  const results = [];
  let imported = 0;
  const insert = db.prepare(
    'INSERT INTO expenses (category, description, amount, expense_date, notes) VALUES (?, ?, ?, ?, ?)',
  );

  rows.forEach((row, index) => {
    const outcome = validateExpenseRow(row);
    const rowNumber = index + 2;
    if (!outcome.ok) {
      results.push({ row: rowNumber, status: 'error', message: outcome.message, preview: row.description || '' });
      return;
    }
    const v = outcome.values;
    if (commit) {
      const result = insert.run(v.category, v.description, v.amount, v.expense_date, v.notes);
      imported += 1;
      results.push({ row: rowNumber, status: 'ok', message: 'imported', preview: v.description, id: result.lastInsertRowid });
    } else {
      results.push({ row: rowNumber, status: 'ok', message: 'ready to import', preview: v.description });
    }
  });

  return { results, imported };
}

// ---- Invoices (with optional payment history) ----------------------------------

function validateInvoiceRow(row, clientsByEmail, clientsByName) {
  const clientEmail = (row.client_email || '').trim().toLowerCase();
  const clientName = (row.client_name || '').trim();
  if (!clientEmail && !clientName) {
    return { ok: false, message: 'client_email or client_name is required' };
  }
  // Matched by email first (the primary, unambiguous key), falling back to
  // an exact client_name match — some historical data identifies a client
  // by a name/reference code rather than a real email address (e.g. "email"
  // holding a school code), so a client_email that doesn't resolve isn't
  // necessarily a missing client, just the wrong key for this row.
  const client = (clientEmail && clientsByEmail.get(clientEmail)) || (clientName && clientsByName.get(clientName.toLowerCase()));
  if (!client) {
    // The single most common cause of this error is previewing the clients
    // CSV (which reports every valid row as "ready to import") without
    // then clicking "Confirm import" — preview never writes to the
    // database, so the client genuinely doesn't exist yet. Say so
    // explicitly when there are zero clients on file at all, since that's
    // the tell-tale sign.
    const identifier = clientEmail || clientName;
    const hint =
      clientsByEmail.size === 0
        ? 'no clients exist yet — if you already ran the Clients import, make sure you clicked "Confirm import" and not just "Preview"'
        : 'import clients first (and click "Confirm import", not just "Preview"), or check for a typo/mismatch against the client\'s saved name or email';
    return { ok: false, message: `no client found matching "${identifier}" — ${hint}` };
  }

  const issueDate = (row.issue_date || '').trim();
  if (!DATE_RE.test(issueDate)) return { ok: false, message: 'issue_date must be in YYYY-MM-DD format' };

  const dueDate = (row.due_date || '').trim() || addDays(issueDate, 14);
  if (!DATE_RE.test(dueDate)) return { ok: false, message: 'due_date must be in YYYY-MM-DD format' };

  const amount = parseNumber(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: 'amount must be a positive number' };

  const taxRate = row.tax_rate ? parseNumber(row.tax_rate) : 0;
  if (!Number.isFinite(taxRate)) return { ok: false, message: 'tax_rate must be a number' };

  let totals;
  try {
    totals = computeTotals(
      [{ description: (row.description || '').trim() || 'Imported services', quantity: 1, unit_price: amount }],
      taxRate,
      'percentage',
      0,
    );
  } catch (err) {
    return { ok: false, message: err.message };
  }

  let status = (row.status || '').trim().toLowerCase();
  if (status && !INVOICE_STATUSES.includes(status)) {
    return { ok: false, message: `status must be one of: ${INVOICE_STATUSES.join(', ')} (got "${(row.status || '').trim()}")` };
  }

  // "paid" with no amount_paid given means paid in full — the common case
  // for a historical export that only records final status, not a
  // separate payment amount that would just repeat the invoice total.
  const amountPaidGiven = (row.amount_paid || '').trim() !== '';
  const amountPaid = amountPaidGiven ? parseNumber(row.amount_paid) : status === 'paid' ? totals.total : 0;
  if (!Number.isFinite(amountPaid) || amountPaid < 0) return { ok: false, message: 'amount_paid must be a non-negative number' };
  if (amountPaid > totals.total) {
    return { ok: false, message: `amount_paid (${amountPaid}) cannot exceed the invoice total (${totals.total})` };
  }

  const paidDate = (row.paid_date || '').trim();
  if (amountPaid > 0) {
    if (!paidDate) return { ok: false, message: 'paid_date is required when amount_paid is greater than 0' };
    if (!DATE_RE.test(paidDate)) return { ok: false, message: 'paid_date must be in YYYY-MM-DD format' };
  }

  const paymentMethod = (row.payment_method || 'bank_transfer').trim() || 'bank_transfer';
  if (amountPaid > 0 && !PAYMENT_METHODS.includes(paymentMethod)) {
    return { ok: false, message: `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}` };
  }

  if (!status) status = amountPaid >= totals.total ? 'paid' : 'sent';

  if (status === 'paid' && amountPaid < totals.total) {
    return { ok: false, message: `status is "paid" but amount_paid (${amountPaid}) is less than the invoice total (${totals.total})` };
  }
  if ((status === 'void' || status === 'draft') && amountPaid > 0) {
    return { ok: false, message: `status is "${status}" but amount_paid (${amountPaid}) is greater than 0` };
  }

  return {
    ok: true,
    values: {
      explicitNumber: (row.number || '').trim(),
      clientId: client.id,
      issueDate,
      dueDate,
      notes: (row.notes || '').trim(),
      totals,
      amountPaid,
      paidDate,
      paymentMethod,
      status,
    },
  };
}

function processInvoices(rows, commit) {
  const clients = db.prepare('SELECT id, name, email FROM clients').all();
  const clientsByEmail = new Map(clients.map((c) => [c.email.toLowerCase(), c]));
  const clientsByName = new Map(clients.map((c) => [c.name.trim().toLowerCase(), c]));
  const existingNumbers = new Set(db.prepare('SELECT number FROM invoices').all().map((r) => r.number));
  const usedInBatch = new Set();
  const nextInvoiceNumber = makeSequencer(invoiceNumberForYear, 'INV');
  const nextReceiptNumber = makeSequencer(receiptNumberForYear, 'R');

  const results = [];
  let imported = 0;
  let paymentsImported = 0;

  const insertInvoice = db.prepare(
    `INSERT INTO invoices (number, client_id, status, issue_date, due_date, notes, discount_type, discount_value,
       subtotal, discount_amount, tax_rate, tax_amount, total, amount_paid, public_token)
     VALUES (?, ?, ?, ?, ?, ?, 'percentage', 0, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertPayment = db.prepare(
    'INSERT INTO payments (receipt_number, invoice_id, amount, method, reference, notes, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const outcome = validateInvoiceRow(row, clientsByEmail, clientsByName);
    if (!outcome.ok) {
      results.push({ row: rowNumber, status: 'error', message: outcome.message, preview: row.number || row.client_email || row.client_name || '' });
      return;
    }
    const v = outcome.values;

    let number = v.explicitNumber;
    if (number) {
      if (existingNumbers.has(number) || usedInBatch.has(number)) {
        results.push({ row: rowNumber, status: 'error', message: `duplicate invoice number "${number}"`, preview: number });
        return;
      }
    } else {
      const year = v.issueDate.slice(0, 4);
      do {
        number = nextInvoiceNumber(year);
      } while (existingNumbers.has(number) || usedInBatch.has(number));
    }
    usedInBatch.add(number);

    if (commit) {
      const publicToken = crypto.randomBytes(16).toString('hex');
      const result = insertInvoice.run(
        number,
        v.clientId,
        v.status,
        v.issueDate,
        v.dueDate,
        v.notes,
        v.totals.subtotal,
        v.totals.discountAmount,
        v.totals.taxRate,
        v.totals.taxAmount,
        v.totals.total,
        v.amountPaid,
        publicToken,
      );
      const invoiceId = result.lastInsertRowid;
      v.totals.items.forEach((item) => {
        insertItem.run(invoiceId, item.description, item.quantity, item.unit_price, item.amount, item.sort_order);
      });

      let paymentMessage = '';
      if (v.amountPaid > 0) {
        const receiptNumber = nextReceiptNumber(v.paidDate.slice(0, 4));
        insertPayment.run(receiptNumber, invoiceId, v.amountPaid, v.paymentMethod, '', 'Imported historical payment', v.paidDate);
        paymentsImported += 1;
        paymentMessage = `, payment ${receiptNumber} recorded`;
      }

      imported += 1;
      results.push({ row: rowNumber, status: 'ok', message: `imported as ${number}${paymentMessage}`, preview: number, id: invoiceId });
    } else {
      const paymentMessage = v.amountPaid > 0 ? `, payment of ${v.amountPaid} on ${v.paidDate}` : '';
      results.push({ row: rowNumber, status: 'ok', message: `ready to import as ${number}${paymentMessage}`, preview: number });
    }
  });

  return { results, imported, paymentsImported };
}

// ---- Route --------------------------------------------------------------------

const HANDLERS = { clients: processClients, expenses: processExpenses, invoices: processInvoices };

router.post('/:type', (req, res) => {
  const { type } = req.params;
  const handler = HANDLERS[type];
  if (!handler) {
    return res.status(400).json({ error: `Unknown import type "${type}". Must be one of: clients, expenses, invoices.` });
  }

  const { csv, commit = false } = req.body || {};
  if (typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'csv text is required' });
  }

  let rows;
  try {
    rows = parseCsv(csv);
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No data rows found — check the file has a header row plus at least one data row' });
  }
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows (${rows.length}). Split into batches of ${MAX_ROWS} or fewer.` });
  }

  const runImport = () => handler(rows, Boolean(commit));
  // Invoice writes span three tables (invoice + items + optional payment)
  // per row; wrap a commit in one transaction so a mid-batch failure can't
  // leave a partially-inserted invoice behind.
  const outcome = commit ? db.transaction(runImport)() : runImport();

  const errorCount = outcome.results.filter((r) => r.status === 'error').length;

  if (commit && outcome.imported > 0) {
    const label =
      type === 'invoices' && outcome.paymentsImported > 0
        ? `${outcome.imported} invoices (${outcome.paymentsImported} with payment history)`
        : `${outcome.imported} ${type}`;
    logActivity({
      userName: req.user.name,
      action: 'bulk imported',
      entityType: type,
      entityId: null,
      entityLabel: `${label} from CSV`,
    });
  }

  res.json({
    total: rows.length,
    validCount: rows.length - errorCount,
    errorCount,
    imported: commit ? outcome.imported : undefined,
    results: outcome.results,
  });
});

module.exports = router;
