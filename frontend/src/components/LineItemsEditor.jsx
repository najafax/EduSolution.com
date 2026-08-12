import { useEffect, useMemo, useRef, useState } from 'react';

// A type-to-filter combobox for picking a product to add as a new line item.
// Unlike SearchableSelect it never "holds" a selected value — every pick
// immediately appends a row and resets back to an empty search box, the
// same one-shot behavior the old plain <select> had (reset via
// `e.target.value = ''` after each choice).
function ProductPicker({ products, currencySymbol, onPick, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.description || ''}`.toLowerCase().includes(q));
  }, [products, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function pick(product) {
    onPick(product);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) pick(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="min-h-11 w-full min-w-56 rounded-md border border-slate-300 px-3 py-2 text-base text-slate-700 focus:border-indigo-500 focus:outline-none"
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full min-w-56 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No matches.</li>
          ) : (
            filtered.map((product, index) => (
              <li key={product.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(product);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm ${
                    index === highlighted ? 'bg-indigo-50' : ''
                  }`}
                >
                  <span className="text-slate-900">
                    {product.name} — {currencySymbol}
                    {product.unit_price.toFixed(2)}
                  </span>
                  {product.description && <span className="text-xs text-slate-500">{product.description}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// A catalog-sourced item carries the id of the product it was picked from,
// so its tax rate can be recovered even if that product is later renamed.
// Items saved before product_id was tracked fall back to matching by
// description (the old behavior) — that only breaks if the product has
// since been renamed, same as before this fix, rather than for every item.
function taxRateForItem(item, products) {
  if (item.product_id != null) {
    const byId = products.find((p) => p.id === item.product_id);
    if (byId) return byId.tax_rate || 0;
  }
  const product = products.find((p) => p.name === item.description);
  return product ? product.tax_rate || 0 : 0;
}

// The document's single tax-rate field is a weighted average of every line
// item's originating product tax rate (weighted by that item's amount), so
// it stays accurate as items are added, removed, or their qty/price edited
// — not just a snapshot of whichever product was picked last.
function weightedTaxRate(items, products) {
  const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0);
  if (subtotal <= 0) return 0;
  const weighted = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0) * taxRateForItem(item, products),
    0,
  );
  return Math.round((weighted / subtotal) * 100) / 100;
}

export default function LineItemsEditor({
  items,
  onChange,
  currencySymbol = '$',
  products = [],
  catalogOnly = false,
  onProductTaxRate,
}) {
  function applyChange(nextItems) {
    onChange(nextItems);
    onProductTaxRate?.(weightedTaxRate(nextItems, products));
  }

  function updateItem(index, patch) {
    applyChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addItem() {
    applyChange([...items, { description: '', quantity: 1, unit_price: 0 }]);
  }

  function addProductItem(product) {
    applyChange([...items, { description: product.name, quantity: 1, unit_price: product.unit_price, product_id: product.id }]);
  }

  function removeItem(index) {
    applyChange(items.filter((_, i) => i !== index));
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
              readOnly={catalogOnly}
              value={item.description}
              onChange={(e) => updateItem(index, { description: e.target.value })}
              className={`col-span-12 min-h-11 rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none sm:col-span-6 ${
                catalogOnly ? 'bg-slate-50' : ''
              }`}
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!catalogOnly && (
          <button
            type="button"
            onClick={addItem}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            + Add item
          </button>
        )}
        {products.length > 0 && (
          <ProductPicker
            products={products}
            currencySymbol={currencySymbol}
            onPick={addProductItem}
            placeholder={catalogOnly ? 'Search product catalog…' : '+ Add from product catalog…'}
          />
        )}
        {catalogOnly && products.length === 0 && (
          <p className="text-sm text-slate-500">
            No products in the catalog yet — add one on the Products page first.
          </p>
        )}
      </div>

      <p className="mt-3 text-right text-sm text-slate-600">
        Subtotal: <span className="font-medium text-slate-900">{currencySymbol}{subtotal.toFixed(2)}</span>
      </p>
    </div>
  );
}
