import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import Accordion from './Accordion';
import BasisPill from './BasisPill';

// "Profit on this sale" for one client invoice: revenue before tax, the real
// supplier cost (from linked supplier invoices, estimated for the rest) and
// the result. Only rendered for users who can view financials, and only for
// sent/paid invoices (a draft or void invoice has no sale to measure).
export default function SaleProfitCard({ invoice, symbol }) {
  const { token, can } = useAuth();
  const [sale, setSale] = useState(null);
  const allowed = can('financials', 'view') && (invoice.status === 'sent' || invoice.status === 'paid');

  useEffect(() => {
    if (!allowed) return;
    api.supplierCosts.profit(token, { invoice: invoice.id }).then((d) => setSale(d.sales[0] || null)).catch(() => {});
  }, [allowed, token, invoice.id, invoice.status]);

  if (!allowed || !sale) return null;
  const money = (n) => `${symbol}${Math.abs(n).toFixed(2)}`;
  const negative = sale.profit < 0;
  return (
    <div className="mt-6">
      <Accordion title="Profit on this sale" action={<BasisPill basis={sale.basis} />}>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Revenue (before tax)</dt><dd className="text-slate-900 dark:text-white">{money(sale.revenue)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Supplier cost</dt><dd className="text-slate-900 dark:text-white">−{money(sale.costMvr)}</dd></div>
          {sale.estimatedCostMvr > 0 && sale.linkedCostMvr > 0 && (
            <div className="flex justify-between text-xs"><dt className="text-slate-400">of which estimated</dt><dd className="text-slate-500 dark:text-slate-400">{money(sale.estimatedCostMvr)}</dd></div>
          )}
          <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold dark:border-slate-800">
            <dt className="text-slate-700 dark:text-slate-200">{negative ? 'Loss' : 'Profit'}</dt>
            <dd className={negative ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>
              {money(sale.profit)}
              {sale.marginPct !== null && <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{sale.marginPct.toFixed(1)}%</span>}
            </dd>
          </div>
        </dl>
        {(sale.basis === 'estimated' || sale.basis === 'partly') && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Part of the cost is an estimate from product cost prices. Link this sale to its supplier invoice on USD &amp; suppliers to make it exact.
          </p>
        )}
      </Accordion>
    </div>
  );
}
