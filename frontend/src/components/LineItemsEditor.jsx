export default function LineItemsEditor({ items, onChange, currencySymbol = '$' }) {
  function updateItem(index, patch) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addItem() {
    onChange([...items, { description: '', quantity: 1, unit_price: 0 }]);
  }

  function removeItem(index) {
    onChange(items.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0);

  return (
    <div>
      <div className="flex flex-col gap-3">
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-12 items-start gap-2">
            <input
              type="text"
              placeholder="Description"
              required
              value={item.description}
              onChange={(e) => updateItem(index, { description: e.target.value })}
              className="col-span-12 min-h-11 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none sm:col-span-6"
            />
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Qty"
              required
              value={item.quantity}
              onChange={(e) => updateItem(index, { quantity: e.target.value })}
              className="col-span-4 min-h-11 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none sm:col-span-2"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Unit price"
              required
              value={item.unit_price}
              onChange={(e) => updateItem(index, { unit_price: e.target.value })}
              className="col-span-4 min-h-11 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none sm:col-span-3"
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              disabled={items.length === 1}
              className="col-span-4 min-h-11 rounded-md border border-slate-300 px-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 sm:col-span-1"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addItem}
        className="mt-3 min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        + Add item
      </button>

      <p className="mt-3 text-right text-sm text-slate-600">
        Subtotal: <span className="font-medium text-slate-900">{currencySymbol}{subtotal.toFixed(2)}</span>
      </p>
    </div>
  );
}
