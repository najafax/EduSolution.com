import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { todayStr } from '../../lib/date';
import StatusBadge from '../../components/StatusBadge';
import Accordion from '../../components/Accordion';
import EmailPreviewModal from '../../components/EmailPreviewModal';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import { PencilIcon, DownloadIcon, SendIcon, BellIcon, DuplicateIcon, XIcon, TrashIcon, PlusIcon } from '../../components/icons';
import { useConfirm } from '../../lib/useConfirm';

const METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'other'];

export default function InvoiceDetail() {
  const { token, can } = useAuth();
  const canManage = can('invoices', 'manage');
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [payment, setPayment] = useState({ amount: '', method: 'bank_transfer', reference: '', notes: '', paid_at: todayStr() });
  // { type: 'send' } | { type: 'remind' } | { type: 'receipt', paymentId } | null —
  // one EmailPreviewModal instance shared by all three send-email triggers
  // on this page, since only one can be open at a time.
  const [emailModal, setEmailModal] = useState(null);
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    api.invoices
      .get(id, token)
      .then(setData)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [id, token]);
  useEffect(() => {
    api.settings.get(token).then(({ settings }) => setSettings(settings)).catch(() => {});
  }, [token]);

  async function handleDownload() {
    setError('');
    try {
      await api.invoices.openPdf(id, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete() {
    if (!(await confirm({ title: 'Delete this invoice?', confirmLabel: 'Delete' }))) return;
    try {
      await api.invoices.remove(id, token);
      navigate('/invoices');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDuplicate() {
    if (
      !(await confirm({
        title: 'Duplicate this invoice?',
        message: 'Creates a new draft copy with a fresh number and due date. You can edit it before sending.',
        confirmLabel: 'Duplicate',
        danger: false,
      }))
    )
      return;
    setError('');
    setBusy(true);
    try {
      const { invoice } = await api.invoices.duplicate(id, token);
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Opening the form pre-fills Amount with the invoice's current balance
  // due — the common case is paying it off in full, and it's still a
  // plain editable number for a partial payment. Only set on open (not
  // close), so toggling the form shut and back open always re-syncs to
  // the current balance rather than keeping whatever was last typed.
  function togglePaymentForm() {
    setShowPayment((v) => {
      const opening = !v;
      if (opening) setPayment((p) => ({ ...p, amount: invoice.balance_due.toFixed(2) }));
      return opening;
    });
  }

  async function handleRecordPayment(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api.invoices.recordPayment(id, { ...payment, amount: Number(payment.amount) }, token);
      setShowPayment(false);
      setPayment({ amount: '', method: 'bank_transfer', reference: '', notes: '', paid_at: todayStr() });
      const autoRenewed = result.autoRenewedLicenses || [];
      const renewedNames = autoRenewed.filter((l) => !l.reactivated).map((l) => l.name);
      const reactivatedNames = autoRenewed.filter((l) => l.reactivated).map((l) => l.name);
      const notices = ['Payment recorded.'];
      if (renewedNames.length > 0) notices.push(`Also renewed: ${renewedNames.join(', ')}.`);
      if (reactivatedNames.length > 0) notices.push(`Also reactivated and renewed: ${reactivatedNames.join(', ')}.`);
      setNotice(notices.join(' '));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadReceipt(paymentId) {
    setError('');
    try {
      await api.invoices.openReceiptPdf(id, paymentId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleVoid() {
    if (
      !(await confirm({
        title: 'Void this invoice?',
        message: 'It will be excluded from financial totals and can no longer be sent, edited, or paid.',
        confirmLabel: 'Void',
      }))
    )
      return;
    setError('');
    setBusy(true);
    try {
      await api.invoices.void(id, token);
      setNotice('Invoice voided.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6">{error}</div>;
  if (!data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6">Loading…</div>;

  const { invoice, items, client, payments } = data;
  const symbol = settings?.currency_symbol || '$';
  const isLocked = invoice.status === 'sent' || invoice.status === 'paid';
  // Mirrors the backend's POST /:id/void guard (routes/invoices.js) so the
  // button never shows for a case that would just 409 — void is reachable
  // from draft or sent (unlike Edit, which locks once sent), but not once
  // paid, already void, or partially paid (amount_paid > 0 would silently
  // orphan a recorded payment on a "this doesn't count" invoice).
  const canVoid = (invoice.status === 'draft' || invoice.status === 'sent') && invoice.amount_paid === 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{invoice.number}</h1>
          <div className="mt-1">
            <StatusBadge status={invoice.is_overdue ? 'overdue' : invoice.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && !isLocked && (
            <Link to={`/invoices/${id}/edit`} className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              <PencilIcon width={16} height={16} />
              Edit
            </Link>
          )}
          <button onClick={handleDownload} className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            <DownloadIcon width={16} height={16} />
            Download PDF
          </button>
          {canManage && invoice.status !== 'void' && (
            <button onClick={() => setEmailModal({ type: 'send' })} disabled={busy} className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-3 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60">
              <SendIcon width={16} height={16} />
              Email to client
            </button>
          )}
          {canManage && invoice.status !== 'void' && invoice.balance_due > 0 && (
            <button onClick={() => setEmailModal({ type: 'remind' })} disabled={busy} className="flex min-h-11 items-center gap-1.5 rounded-md border border-amber-300 px-3 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950">
              <BellIcon width={16} height={16} />
              Send reminder
            </button>
          )}
          {canManage && (
            <button onClick={handleDuplicate} disabled={busy} className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              <DuplicateIcon width={16} height={16} />
              Duplicate
            </button>
          )}
          {canManage && canVoid && (
            <button onClick={handleVoid} disabled={busy} className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              <XIcon width={16} height={16} />
              Void
            </button>
          )}
          {canManage && (
            <button onClick={handleDelete} className="flex min-h-11 items-center gap-1.5 rounded-md border border-red-300 px-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
              <TrashIcon width={16} height={16} />
              Delete
            </button>
          )}
        </div>
      </div>

      {notice && <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {isLocked && (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          This invoice has been {invoice.status === 'paid' ? 'paid' : 'sent to the client'} and can no longer be
          edited.
        </p>
      )}
      {invoice.status === 'void' && (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          This invoice has been voided and is excluded from financial totals and reports.
        </p>
      )}
      {invoice.last_reminder_sent_at && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Last reminder sent {invoice.last_reminder_sent_at}</p>
      )}

      {/* Mobile-only summary hero — desktop already shows Total/Balance due
          via the "Details" card below, this just surfaces it before the
          fold on a phone, with a paid-vs-total progress bar the desktop
          layout has no equivalent for. */}
      <div className="mt-6 rounded-2xl bg-gradient-to-br from-lagoon-600 to-lagoon-700 p-5 text-white shadow-lg shadow-lagoon-900/20 sm:hidden">
        <p className="text-[11px] font-bold uppercase tracking-wide text-lagoon-100">Total due</p>
        <p className="font-display text-3xl font-extrabold tabular-nums">{symbol}{invoice.total.toFixed(2)}</p>
        <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-white"
            style={{ width: `${Math.min(100, Math.max(0, (invoice.amount_paid / invoice.total) * 100 || 0))}%` }}
          />
        </div>
        <div className="mt-2.5 flex justify-between text-sm">
          <div>
            <span className="block text-[10.5px] text-lagoon-100">Paid</span>
            <b className="tabular-nums">{symbol}{invoice.amount_paid.toFixed(2)}</b>
          </div>
          <div className="text-right">
            <span className="block text-[10.5px] text-lagoon-100">Balance</span>
            <b className="tabular-nums">{symbol}{invoice.balance_due.toFixed(2)}</b>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <Accordion title="Bill to">
          <p className="font-medium text-slate-900 dark:text-white">{client.name}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{client.email}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{client.address}</p>
        </Accordion>
        <Accordion title="Details">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Issue date</dt><dd className="text-slate-900 dark:text-white">{invoice.issue_date}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Due date</dt><dd className="text-slate-900 dark:text-white">{invoice.due_date}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Balance due</dt><dd className="text-slate-900 dark:text-white">{symbol}{invoice.balance_due.toFixed(2)}</dd></div>
          </dl>
        </Accordion>
      </div>

      <div className="mt-6">
        <Accordion title="Items">
          <div className="-mx-6">
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-6 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Unit price</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-6 py-3 dark:text-white">{item.description}</td>
                      <td className="px-4 py-3 text-right dark:text-white">{item.quantity}</td>
                      <td className="px-4 py-3 text-right dark:text-white">{symbol}{item.unit_price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right dark:text-white">{symbol}{item.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* No accordion here — a line item already shows everything
                (description, qty × rate, amount), nothing to expand into,
                so mobile just gets a stacked card per item instead. */}
            <div className="divide-y divide-slate-100 text-sm sm:hidden dark:divide-slate-800">
              {items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <p className="text-slate-900 dark:text-white">{item.description}</p>
                    <p className="text-slate-500 dark:text-slate-400">{item.quantity} × {symbol}{item.unit_price.toFixed(2)}</p>
                  </div>
                  <p className="shrink-0 font-medium text-slate-900 dark:text-white">{symbol}{item.amount.toFixed(2)}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 px-6 py-3 text-sm dark:border-slate-700">
              {/* Each row is its own flex pair (label left, amount right)
                  rather than one right-aligned line of "Label: amount" text
                  — that older layout let the amount's horizontal position
                  drift with each label's length ("Subtotal" vs "Paid"), so
                  the figures never actually lined up in a column. */}
              <div className="ml-auto flex w-full max-w-xs flex-col gap-1">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600 dark:text-slate-400">Subtotal</dt>
                  <dd className="text-slate-600 dark:text-slate-400">{symbol}{invoice.subtotal.toFixed(2)}</dd>
                </div>
                {invoice.discount_amount > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600 dark:text-slate-400">
                      Discount {invoice.discount_type === 'percentage' ? `(${invoice.discount_value}%)` : ''}
                    </dt>
                    <dd className="text-slate-600 dark:text-slate-400">-{symbol}{invoice.discount_amount.toFixed(2)}</dd>
                  </div>
                )}
                {invoice.tax_rate > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600 dark:text-slate-400">Tax ({invoice.tax_rate}%)</dt>
                    <dd className="text-slate-600 dark:text-slate-400">{symbol}{invoice.tax_amount.toFixed(2)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600 dark:text-slate-400">Total</dt>
                  <dd className="text-slate-600 dark:text-slate-400">{symbol}{invoice.total.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600 dark:text-slate-400">Paid</dt>
                  <dd className="text-slate-600 dark:text-slate-400">{symbol}{invoice.amount_paid.toFixed(2)}</dd>
                </div>
                <div className="mt-1 flex justify-between gap-4 text-base font-semibold text-slate-900 dark:text-white">
                  <dt>Balance due</dt>
                  <dd>{symbol}{invoice.balance_due.toFixed(2)}</dd>
                </div>
              </div>
            </div>
          </div>
        </Accordion>
      </div>

      <div className="mt-6">
        <Accordion
          title="Payments"
          action={
            canManage &&
            invoice.status !== 'void' &&
            invoice.balance_due > 0 && (
              <button
                onClick={togglePaymentForm}
                className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-3 text-sm font-medium text-white hover:bg-lagoon-500"
              >
                <PlusIcon width={16} height={16} />
                Record payment
              </button>
            )
          }
        >
          {showPayment && (
            <form onSubmit={handleRecordPayment} className="-mx-6 -mt-4 mb-4 grid gap-4 border-b border-slate-200 px-6 pb-4 sm:grid-cols-2 dark:border-slate-700">
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</span>
                <input
                  type="number"
                  min="0.01"
                  max={invoice.balance_due}
                  step="0.01"
                  required
                  value={payment.amount}
                  onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Method</span>
                <select
                  value={payment.method}
                  onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Date</span>
                <div className="mt-1 flex h-11 w-full items-center overflow-hidden rounded-md border border-slate-300 px-3 focus-within:border-lagoon-500 dark:border-slate-600">
                  <input
                    type="date"
                    required
                    value={payment.paid_at}
                    onChange={(e) => setPayment((p) => ({ ...p, paid_at: e.target.value }))}
                    className="h-full w-full appearance-none border-0 bg-transparent p-0 text-base focus:outline-none dark:text-white"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Reference</span>
                <input
                  type="text"
                  value={payment.reference}
                  onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
                >
                  {busy ? 'Recording…' : 'Record payment'}
                </button>
              </div>
            </form>
          )}

          {payments.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No payments recorded yet.</p>
          ) : (
            <>
              <div className="-mx-6 hidden overflow-x-auto sm:block">
                <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                  <thead>
                    <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                      <th className="px-6 py-3">Receipt</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Method</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap px-6 py-3 font-medium text-slate-900 dark:text-white">{p.receipt_number}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{p.paid_at}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{p.method.replace('_', ' ')}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-slate-900 dark:text-white">{symbol}{p.amount.toFixed(2)}</td>
                        <td className="whitespace-nowrap px-6 py-3">
                          <div className="flex justify-end gap-1.5">
                            <IconActionButton
                              icon={DownloadIcon}
                              tone="lagoon"
                              onClick={() => handleDownloadReceipt(p.id)}
                              title="Download receipt"
                            />
                            {canManage && (
                              <IconActionButton
                                icon={SendIcon}
                                tone="lagoon"
                                onClick={() => setEmailModal({ type: 'receipt', paymentId: p.id })}
                                title="Email receipt"
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2.5 sm:hidden">
                {payments.map((p) => (
                  <MobileListAccordion
                    key={p.id}
                    name="invoice-payments"
                    summary={
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-white">{p.receipt_number}</p>
                          <p className="text-slate-500 dark:text-slate-400">{p.paid_at}</p>
                        </div>
                        <p className="shrink-0 text-slate-900 dark:text-white">{symbol}{p.amount.toFixed(2)}</p>
                      </div>
                    }
                  >
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Method</dt>
                      <dd className="text-slate-900 dark:text-white">{p.method.replace('_', ' ')}</dd>
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <IconActionButton icon={DownloadIcon} tone="lagoon" onClick={() => handleDownloadReceipt(p.id)} title="Download receipt" />
                      {canManage && (
                        <IconActionButton
                          icon={SendIcon}
                          tone="lagoon"
                          onClick={() => setEmailModal({ type: 'receipt', paymentId: p.id })}
                          title="Email receipt"
                        />
                      )}
                    </div>
                  </MobileListAccordion>
                ))}
              </div>
            </>
          )}
        </Accordion>
      </div>

      {invoice.notes && (
        <div className="mt-6">
          <Accordion title="Notes">
            <p className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">{invoice.notes}</p>
          </Accordion>
        </div>
      )}

      <EmailPreviewModal
        open={emailModal !== null}
        onClose={() => setEmailModal(null)}
        title={
          emailModal?.type === 'remind'
            ? 'Review reminder before sending'
            : emailModal?.type === 'receipt'
              ? 'Review receipt email before sending'
              : 'Review email before sending'
        }
        loadPreview={() => {
          if (emailModal?.type === 'remind') return api.invoices.remindPreview(id, token);
          if (emailModal?.type === 'receipt') return api.invoices.receiptPreview(id, emailModal.paymentId, token);
          return api.invoices.sendPreview(id, token);
        }}
        onSend={async ({ subject, message }) => {
          if (emailModal?.type === 'remind') {
            await api.invoices.remind(id, { subject, message }, token);
            setNotice('Reminder emailed to client.');
          } else if (emailModal?.type === 'receipt') {
            await api.invoices.sendReceipt(id, emailModal.paymentId, { subject, message }, token);
            setNotice('Receipt emailed to client.');
          } else {
            await api.invoices.send(id, { subject, message }, token);
            setNotice('Invoice emailed to client.');
          }
          load();
        }}
      />

      {confirmDialog}
    </div>
  );
}
