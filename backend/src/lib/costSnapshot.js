const db = require('../db');

// Stamps each of an invoice's line items with the supplier cost (USD) in
// effect right now, so later edits to a product's cost_price don't
// retroactively change what a past month cost. Only a positive cost is
// stamped (0 = "no cost set"), leaving the item to resolve live later.
// Same product_id-then-description match routes/supplierCosts.js uses.
function stampItemCosts(invoiceId) {
  db.prepare(
    `UPDATE invoice_items
     SET cost_price = (
       SELECT cost_price FROM (
         SELECT p.cost_price AS cost_price, 1 AS pri FROM products p WHERE p.id = invoice_items.product_id
         UNION ALL
         SELECT p.cost_price, 2 FROM products p WHERE lower(trim(p.name)) = lower(trim(invoice_items.description))
         ORDER BY pri ASC
       ) WHERE cost_price > 0 LIMIT 1
     )
     WHERE invoice_id = ?`,
  ).run(invoiceId);
}

module.exports = { stampItemCosts };
