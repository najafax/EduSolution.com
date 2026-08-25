import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../context/PortalAuthContext';
import StatusBadge from '../../components/StatusBadge';
import { ChevronRightIcon, DownloadIcon } from '../../components/icons';

// The portal counterpart to pages/PublicInvoice.jsx — same read-only
// layout, plus a Payments section (routes/clientPortal.js's GET
// /invoices/:id already returns `payments`, unlike the public-token view,
// which doesn't need it since a one-off document link has no ongoing
// relationship to show payment history against).
export default function PortalInvoiceDetail() {
  const { id } = useParams();
  const { token } = usePortalAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.portal.invoices
      .get(id, token)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [id, token]);

  async function handleViewPdf() {
    setError('');
    try {
      await api.portal.invoices.openPdf(id, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleViewReceipt(paymentId) {
    setError('');
    try {
      await api.portal.invoices.openReceiptPdf(id, paymentId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-red-600 dark:text-red-400 sm:px-6">{error}</div>
    );
  }
  if (!data) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400 sm:px-6">Loading…</div>;
  }

  const { invoice, items, client, payments, settings } = data;
  const symbol = settings?.currency_symbol || '$';

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link to="/portal/invoices" className="inline-flex items-center text-sm font-medium text-lagoon-600 hover:text-lagoon-500">
        <ChevronRightIcon width={16} height={16} className="rotate-180" />
        Back to invoices
      </Link>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{settings?.business_name}</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Invoice {invoice.number}</h1>
          </div>
          <StatusBadge status={invoice.is_overdue ? 'overdue' : invoice.status} />
        </div>

        <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium text-slate-500 dark:text-slate-400">Billed to</p>
            <p className="text-slate-900 dark:text-white">{client.name}</p>
          </div>
          <div>
            <p className="font-medium text-slate-500 dark:text-slate-400">Issue date</p>
            <p className="text-slate-900 dark:text-white">{invoice.issue_date}</p>
            <p className="mt-2 font-medium text-slate-500 dark:text-slate-400">Due date</p>
            <p className="text-slate-900 dark:text-white">{invoice.due_date}</p>
          </div>
        </div>

        <div className="mt-6 -mx-6 sm:-mx-8">
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-6 py-3 sm:px-8">Description</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit price</th>
                  <th className="px-4 py-3 text-right sm:pr-8">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-6 py-3 sm:px-8 dark:text-white">{item.description}</td>
                    <td className="px-4 py-3 text-right dark:text-white">{item.quantity}</td>
                    <td className="px-4 py-3 text-right dark:text-white">
                      {symbol}
                      {item.unit_price.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right sm:pr-8 dark:text-white">
                      {symbol}
                      {item.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-100 text-sm sm:hidden dark:divide-slate-800">
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 px-6 py-3">
                <div className="min-w-0">
                  <p className="text-slate-900 dark:text-white">{item.description}</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    {item.quantity} × {symbol}
                    {item.unit_price.toFixed(2)}
                  </p>
                </div>
                <p className="shrink-0 font-medium text-slate-900 dark:text-white">
                  {symbol}
                  {item.amount.toFixed(2)}
                </p>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 px-6 py-3 text-sm sm:px-8 dark:border-slate-700">
            <div className="ml-auto flex w-full max-w-xs flex-col gap-1">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600 dark:text-slate-400">Subtotal</dt>
                <dd className="text-slate-600 dark:text-slate-400">
                  {symbol}
                  {invoice.subtotal.toFixed(2)}
                </dd>
              </div>
              {invoice.discount_amount > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600 dark:text-slate-400">
                    Discount {invoice.discount_type === 'percentage' ? `(${invoice.discount_value}%)` : ''}
                  </dt>
                  <dd className="text-slate-600 dark:text-slate-400">
                    -{symbol}
                    {invoice.discount_amount.toFixed(2)}
                  </dd>
                </div>
              )}
              {invoice.tax_rate > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600 dark:text-slate-400">Tax ({invoice.tax_rate}%)</dt>
                  <dd className="text-slate-600 dark:text-slate-400">
                    {symbol}
                    {invoice.tax_amount.toFixed(2)}
                  </dd>
                </div>
              )}
              <div className="mt-1 flex justify-between gap-4 text-base font-semibold text-slate-900 dark:text-white">
                <dt>Total</dt>
                <dd>
                  {symbol}
                  {invoice.total.toFixed(2)}
                </dd>
              </div>
              {invoice.amount_paid > 0 && (
                <>
                  <div className="mt-1 flex justify-between gap-4">
                    <dt className="text-slate-600 dark:text-slate-400">Paid</dt>
                    <dd className="text-slate-600 dark:text-slate-400">
                      {symbol}
                      {invoice.amount_paid.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 font-semibold text-slate-900 dark:text-white">
                    <dt>Balance due</dt>
                    <dd>
                      {symbol}
                      {invoice.balance_due.toFixed(2)}
                    </dd>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Surfaces the business's bank/payment details directly here when
            there's still a balance due, instead of requiring a PDF
            download just to find out how to pay — the same
            settings.bank_details every quote/invoice PDF already prints,
            not a new field. Hidden once balance_due hits 0 (nothing left
            to pay) and when the business hasn't filled bank_details in at
            all, same "only show the exception case" convention the rest
            of this app already follows. */}
        {invoice.balance_due > 0 && settings?.bank_details && (
          <div className="mt-6 rounded-lg border border-lagoon-100 bg-lagoon-50/60 p-4 text-sm dark:border-lagoon-900 dark:bg-lagoon-950/40">
            <p className="font-medium text-slate-700 dark:text-slate-200">How to pay</p>
            <p className="mt-1 whitespace-pre-line text-slate-600 dark:text-slate-400">{settings.bank_details}</p>
          </div>
        )}

        {invoice.notes && (
          <div className="mt-6 border-t border-slate-200 pt-4 text-sm dark:border-slate-700">
            <p className="font-medium text-slate-500 dark:text-slate-400">Notes</p>
            <p className="mt-1 whitespace-pre-line text-slate-600 dark:text-slate-400">{invoice.notes}</p>
          </div>
        )}

        {payments.length > 0 && (
          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Payments</p>
            <div className="mt-2 flex flex-col gap-2">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white">{payment.receipt_number}</p>
                    <p className="text-slate-500 dark:text-slate-400">{payment.paid_at}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-medium text-slate-900 dark:text-white">
                      {symbol}
                      {payment.amount.toFixed(2)}
                    </span>
                    <button
                      onClick={() => handleViewReceipt(payment.id)}
                      title="Download receipt"
                      aria-label={`Download receipt ${payment.receipt_number}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      <DownloadIcon width={15} height={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-8">
          <button
            onClick={handleViewPdf}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
