import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../../context/PortalAuthContext';
import { api } from '../../lib/api';
import { AlertTriangleIcon, LicenseIcon, QuoteIcon, BellIcon } from '../icons';

// How many days out counts as "due soon" for an invoice that isn't overdue
// yet — a client-facing analog of routes/licenses.js's own
// EXPIRY_WARNING_DAYS, but a shorter window: a license renewal is worth
// flagging two weeks out, a bill due in two weeks isn't urgent yet the way
// one due in a few days is.
const DUE_SOON_DAYS = 7;
const LIMIT_PER_TYPE = 5;

// The portal's own counterpart to components/NotificationCenter.jsx —
// same shape (a live, computed view refetched on open, no persistence or
// read/unread state), but scoped to the logged-in client's own
// already-fetched, already-scoped list endpoints instead of the staff
// app's permission-gated global ones. Kept as its own component rather
// than a generalized shared one, same "different auth context, different
// data source, different nav targets" reasoning every other portal/staff
// pair in this app is duplicated for (withComputedInvoice,
// publicSettings, markViewed between routes/public.js and
// routes/clientPortal.js). A 5th category, rejected payment proofs, hits
// its own dedicated GET /portal/payment-proofs/rejected rather than one
// of the three list endpoints above — see routes/clientPortal.js for why.
export default function PortalNotificationCenter() {
  const { token } = usePortalAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pendingQuotes, setPendingQuotes] = useState([]);
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [dueSoonInvoices, setDueSoonInvoices] = useState([]);
  const [expiringLicenses, setExpiringLicenses] = useState([]);
  const [rejectedProofs, setRejectedProofs] = useState([]);
  const boxRef = useRef(null);

  function load() {
    api.portal.quotes
      .list(token)
      .then(({ quotes }) => setPendingQuotes(quotes.filter((q) => q.status === 'sent')))
      .catch(() => {});
    api.portal.invoices
      .list(token)
      .then(({ invoices }) => {
        const soonCutoff = new Date(Date.now() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        setOverdueInvoices(invoices.filter((i) => i.is_overdue).sort((a, b) => (a.due_date < b.due_date ? -1 : 1)));
        setDueSoonInvoices(
          invoices
            .filter((i) => !i.is_overdue && i.balance_due > 0 && i.due_date <= soonCutoff)
            .sort((a, b) => (a.due_date < b.due_date ? -1 : 1)),
        );
      })
      .catch(() => {});
    api.portal.licenses
      .list(token)
      .then(({ licenses }) =>
        setExpiringLicenses(licenses.filter((l) => l.display_status === 'expiring_soon').sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1))),
      )
      .catch(() => {});
    api.portal
      .rejectedPaymentProofs(token)
      .then(({ proofs }) => setRejectedProofs(proofs))
      .catch(() => {});
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const total = pendingQuotes.length + overdueInvoices.length + dueSoonInvoices.length + expiringLicenses.length + rejectedProofs.length;

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${total > 0 ? ` (${total})` : ''}`}
        aria-expanded={open}
        title="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <BellIcon width={18} height={18} />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-white">
            Notifications
          </p>
          {total === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">You're all caught up.</p>
          ) : (
            <div className="py-1">
              {overdueInvoices.length > 0 && (
                <div>
                  <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Overdue invoices</p>
                  {overdueInvoices.slice(0, LIMIT_PER_TYPE).map((inv) => (
                    <button
                      key={`inv-${inv.id}`}
                      type="button"
                      onClick={() => go(`/portal/invoices/${inv.id}`)}
                      className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{inv.number}</span>
                        <span className="block text-xs text-red-600 dark:text-red-400">Overdue since {inv.due_date}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {rejectedProofs.length > 0 && (
                <div>
                  <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Payment proof rejected</p>
                  {rejectedProofs.slice(0, LIMIT_PER_TYPE).map((proof) => (
                    <button
                      key={`proof-${proof.id}`}
                      type="button"
                      onClick={() => go(`/portal/invoices/${proof.invoice_id}`)}
                      className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{proof.invoice_number}</span>
                        <span className="block truncate text-xs text-red-600 dark:text-red-400">
                          {proof.review_note || 'Rejected — please re-upload proof of payment.'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {dueSoonInvoices.length > 0 && (
                <div>
                  <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Due soon</p>
                  {dueSoonInvoices.slice(0, LIMIT_PER_TYPE).map((inv) => (
                    <button
                      key={`due-${inv.id}`}
                      type="button"
                      onClick={() => go(`/portal/invoices/${inv.id}`)}
                      className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{inv.number}</span>
                        <span className="block text-xs text-amber-600 dark:text-amber-400">Due {inv.due_date}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {expiringLicenses.length > 0 && (
                <div>
                  <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Expiring licenses</p>
                  {expiringLicenses.slice(0, LIMIT_PER_TYPE).map((lic) => (
                    <button
                      key={`lic-${lic.id}`}
                      type="button"
                      onClick={() => go(`/portal/licenses/${lic.id}`)}
                      className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <LicenseIcon width={16} height={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{lic.name}</span>
                        <span className="block text-xs text-amber-600 dark:text-amber-400">Expires {lic.expiry_date}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {pendingQuotes.length > 0 && (
                <div className="pb-2">
                  <p className="px-4 pt-2 text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Awaiting your response</p>
                  {pendingQuotes.slice(0, LIMIT_PER_TYPE).map((q) => (
                    <button
                      key={`quote-${q.id}`}
                      type="button"
                      onClick={() => go(`/portal/quotes/${q.id}`)}
                      className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <QuoteIcon width={16} height={16} className="mt-0.5 shrink-0 text-lagoon-600 dark:text-lagoon-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{q.number}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">Issued {q.issue_date}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
