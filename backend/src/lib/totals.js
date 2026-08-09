// Validates a raw line-items payload and computes subtotal/discount/tax/total.
// Shared by quotes and invoices, which have identical item/tax/discount shapes.
// Order: subtotal -> discount -> tax (tax applies to the post-discount amount).
function computeTotals(rawItems, taxRate, discountType = 'percentage', discountValue = 0) {
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

  if (!['percentage', 'fixed'].includes(discountType)) {
    throw new Error('discount_type must be "percentage" or "fixed"');
  }
  const rawDiscount = Number(discountValue) || 0;
  if (rawDiscount < 0) throw new Error('Discount cannot be negative');
  if (discountType === 'percentage' && rawDiscount > 100) {
    throw new Error('Percentage discount cannot exceed 100');
  }

  const subtotal = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

  const discountAmount =
    discountType === 'percentage'
      ? Math.round(subtotal * (rawDiscount / 100) * 100) / 100
      : Math.round(Math.min(rawDiscount, subtotal) * 100) / 100;
  if (discountType === 'fixed' && rawDiscount > subtotal) {
    throw new Error('Discount cannot exceed the subtotal');
  }

  const taxableAmount = Math.round((subtotal - discountAmount) * 100) / 100;
  const taxAmount = Math.round(taxableAmount * (rate / 100) * 100) / 100;
  const total = Math.round((taxableAmount + taxAmount) * 100) / 100;

  return {
    items,
    taxRate: rate,
    discountType,
    discountValue: rawDiscount,
    subtotal,
    discountAmount,
    taxAmount,
    total,
  };
}

module.exports = { computeTotals };
