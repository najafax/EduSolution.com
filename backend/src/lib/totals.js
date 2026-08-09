// Validates a raw line-items payload and computes subtotal/tax/total.
// Shared by quotes and invoices, which have identical item/tax shapes.
function computeTotals(rawItems, taxRate) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('At least one line item is required');
  }

  const items = rawItems.map((item, index) => {
    const description = String(item.description || '').trim();
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);

    if (!description) throw new Error(`Item ${index + 1}: description is required`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Item ${index + 1}: quantity must be a positive number`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Item ${index + 1}: unit price must be a non-negative number`);

    const amount = Math.round(quantity * unitPrice * 100) / 100;
    return { description, quantity, unit_price: unitPrice, amount, sort_order: index };
  });

  const rate = Number(taxRate) || 0;
  if (rate < 0 || rate > 100) throw new Error('Tax rate must be between 0 and 100');

  const subtotal = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  const taxAmount = Math.round(subtotal * (rate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  return { items, taxRate: rate, subtotal, taxAmount, total };
}

module.exports = { computeTotals };
