const db = require('../db');
const { todayStr } = require('./businessDate');

// Accounts-receivable aging: what clients still owe on SENT invoices (draft
// and void are not receivables), bucketed by how many days past due_date the
// invoice is as of `asOf`. An invoice not yet due is "current". Partially
// paid invoices count at their remaining balance.
const BUCKETS = [
  { key: 'current', label: 'Current', min: -Infinity, max: 0 },
  { key: 'd1_30', label: '1–30 days', min: 1, max: 30 },
  { key: 'd31_60', label: '31–60 days', min: 31, max: 60 },
  { key: 'd61_90', label: '61–90 days', min: 61, max: 90 },
  { key: 'd90plus', label: '90+ days', min: 91, max: Infinity },
];

const round2 = (n) => Math.round(n * 100) / 100;
const dayNumber = (dateStr) => Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 86400000);

function bucketFor(daysOverdue) {
  return BUCKETS.find((b) => daysOverdue >= b.min && daysOverdue <= b.max);
}

function computeAging(asOf = todayStr()) {
  const asOfDay = dayNumber(asOf);
  const rows = db
    .prepare(
      `SELECT invoices.id, invoices.number, invoices.issue_date, invoices.due_date, invoices.total, invoices.amount_paid,
              invoices.client_id, clients.name AS client_name
       FROM invoices JOIN clients ON clients.id = invoices.client_id
       WHERE invoices.status = 'sent' AND invoices.issue_date <= ?
       ORDER BY clients.name COLLATE NOCASE, invoices.due_date`,
    )
    .all(asOf);

  const totals = Object.fromEntries(BUCKETS.map((b) => [b.key, { amount: 0, count: 0 }]));
  const clientMap = new Map();
  let weightedDays = 0;
  let overdueBalance = 0;

  for (const inv of rows) {
    const balance = round2(inv.total - inv.amount_paid);
    if (balance <= 0) continue;
    const daysOverdue = asOfDay - dayNumber(inv.due_date);
    const bucket = bucketFor(daysOverdue);
    totals[bucket.key].amount += balance;
    totals[bucket.key].count += 1;
    if (daysOverdue > 0) {
      weightedDays += daysOverdue * balance;
      overdueBalance += balance;
    }
    if (!clientMap.has(inv.client_id)) {
      clientMap.set(inv.client_id, {
        client_id: inv.client_id,
        client_name: inv.client_name,
        ...Object.fromEntries(BUCKETS.map((b) => [b.key, 0])),
        total: 0,
        invoices: [],
      });
    }
    const c = clientMap.get(inv.client_id);
    c[bucket.key] = round2(c[bucket.key] + balance);
    c.total = round2(c.total + balance);
    c.invoices.push({
      id: inv.id,
      number: inv.number,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      total: inv.total,
      amount_paid: inv.amount_paid,
      balance,
      days_overdue: Math.max(daysOverdue, 0),
      bucket: bucket.key,
    });
  }

  const clients = [...clientMap.values()].sort((a, b) => b.total - a.total);
  const total = round2(Object.values(totals).reduce((s, t) => s + t.amount, 0));
  return {
    asOf,
    buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label, amount: round2(totals[b.key].amount), count: totals[b.key].count })),
    total,
    overdueTotal: round2(overdueBalance),
    // Balance-weighted average age of what's overdue (days); null when nothing is.
    avgDaysOverdue: overdueBalance > 0 ? Math.round(weightedDays / overdueBalance) : null,
    invoiceCount: clients.reduce((s, c) => s + c.invoices.length, 0),
    clients,
  };
}

module.exports = { computeAging, BUCKETS };
