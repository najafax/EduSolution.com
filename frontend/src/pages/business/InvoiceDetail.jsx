import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { timeAgo } from '../../lib/date';
import StatusBadge from '../../components/StatusBadge';
import Accordion from '../../components/Accordion';
import Modal from '../../components/Modal';
import EmailPreviewModal from '../../components/EmailPreviewModal';
import MobileListAccordion from '../../components/MobileListAccordion';
import IconActionButton from '../../components/IconActionButton';
import VoidReasonModal from '../../components/VoidReasonModal';
import RecordPaymentModal from '../../components/RecordPaymentModal';
import { PencilIcon, DownloadIcon, SendIcon, BellIcon, XIcon, TrashIcon, PlusIcon, LinkIcon, CheckCircleIcon } from '../../components/icons';
import { useConfirm } from '../../lib/useConfirm';

export default function InvoiceDetail() {
  const { token, can } = useAuth();
  const canManage = can('invoices', 'manage');
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  // { type: 'send' } | { type: 'remind' } | { type: 'receipt', paymentId } | null —
  // one EmailPreviewModal instance shared by all three send-email triggers
  // on this page, since only one can be open at a time.
  const [emailModal, setEmailModal] = useState(null);
  // The id of the proof currently being rejected, or null — opens a small
  // Modal to collect the required note (a plain confirm() can't capture
  // text input, same reasoning QuoteRequests.jsx's own decline flow uses
  // a Modal instead of a bare confirm() for its note).
  const [rejectingProofId, setRejectingProofId] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidError, setVoidError] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  function load() {
    api.invoices
      .get(id, token)
      .then(setData)
      .catch((err) => setError(err.message));
  }

  useEffect(load, [id, token]);
  useEffect(() => {
    // .finally flips settingsLoaded whether the fetch succeeds or fails —
    // the loading gate below waits on this too, so this page's money
    // figures never flash '$' before the real currency symbol arrives
    // (see Dashboard.jsx's own note on this race for the full story).
    api.settings
      .get(token)
      .then(({ settings }) => setSettings(settings))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, [token]);

  async function handleDownload() {
    setError('');
    try {
      await api.invoices.openPdf(id, token);
    } catch (err) {
      setError(err.message);
    }
  }

  // Same domain the browser is actually running this page on — always
  // correct for whichever environment the person copying the link is in
  // (local dev, staging, production), unlike trusting the backend's own
  // CLIENT_ORIGIN to match what's really being served.
  async function handleCopyLink() {
    setError('');
    setNotice('');
    const url = `${window.location.origin}/i/${invoice.public_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Public link copied to clipboard.');
    } catch {
      setError('Could not copy the link — your browser may be blocking clipboard access.');
    }
  }

  function handlePaymentRecorded(result) {
    setShowPayment(false);
    const autoRenewed = result.autoRenewedLicenses || [];
    const renewedNames = autoRenewed.filter((l) => !l.reactivated).map((l) => l.name);
    const reactivatedNames = autoRenewed.filter((l) => l.reactivated).map((l) => l.name);
    const notices = ['Payment recorded.'];
    if (renewedNames.length > 0) notices.push(`Also renewed: ${renewedNames.join(', ')}.`);
    if (reactivatedNames.length > 0) notices.push(`Also reactivated and renewed: ${reactivatedNames.join(', ')}.`);
    setNotice(notices.join(' '));
    load();
  }

  async function handleDownloadReceipt(paymentId) {
    setError('');
    try {
      await api.invoices.openReceiptPdf(id, paymentId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleViewPaymentProof(proofId) {
    setError('');
    try {
      await api.invoices.openPaymentProofFile(id, proofId, token);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleReviewPaymentProof(proofId) {
    setError('');
    try {
      await api.invoices.reviewPaymentProof(id, proofId, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function openRejectProof(proofId) {
    setRejectingProofId(proofId);
    setRejectNote('');
    setError('');
  }

  async function handleRejectPaymentProof(e) {
    e.preventDefault();
    setError('');
    setRejecting(true);
    try {
      await api.invoices.rejectPaymentProof(id, rejectingProofId, { note: rejectNote }, token);
      setRejectingProofId(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRejecting(false);
    }
  }

  async function handleDeletePaymentProof(proofId) {
    if (!(await confirm({ title: 'Delete this payment proof?', confirmLabel: 'Delete' }))) return;
    setError('');
    try {
      await api.invoices.deletePaymentProof(id, proofId, token);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleVoid(reason) {
    setVoidError('');
    try {
      await api.invoices.void(id, reason, token);
      setVoidModalOpen(false);
      setNotice('Invoice voided.');
      load();
    } catch (err) {
      setVoidError(err.message);
      throw err;
    }
  }

  if (error && !data) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-red-600 dark:text-red-400 sm:px-6">{error}</div>;
  if (!data || !settingsLoaded) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6">Loading…</div>;

  const { invoice, items, client, payments, paymentProofs } = data;
  const pendingProofCount = paymentProofs.filter((p) => p.status === 'pending').length;
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
          <button onClick={handleCopyLink} className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            <LinkIcon width={16} height={16} />
            Copy public link
          </button>
          {canManage && invoice.status !== 'void' && (
            <button onClick={() => setEmailModal({ type: 'send' })} className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-3 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60">
              <SendIcon width={16} height={16} />
              Email to client
            </button>
          )}
          {canManage && invoice.status !== 'void' && invoice.balance_due > 0 && (
            <button onClick={() => setEmailModal({ type: 'remind' })} className="flex min-h-11 items-center gap-1.5 rounded-md border border-amber-300 px-3 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950">
              <BellIcon width={16} height={16} />
              Send reminder
            </button>
          )}
          {canManage && canVoid && (
            <button onClick={() => { setVoidError(''); setVoidModalOpen(true); }} className="flex min-h-11 items-center gap-1.5 rounded-md border border-red-300 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
              <XIcon width={16} height={16} />
              Void
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
          {invoice.void_reason && <> Reason: {invoice.void_reason}</>}
        </p>
      )}
      {invoice.last_reminder_sent_at && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Last reminder sent {invoice.last_reminder_sent_at}</p>
      )}
      {invoice.client_viewed_at && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Viewed by client {timeAgo(invoice.client_viewed_at)}</p>
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
            {invoice.po_number && (
              <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">PO number</dt><dd className="text-slate-900 dark:text-white">{invoice.po_number}</dd></div>
            )}
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
            // Mirrors POST /:id/payments' own 400 guard exactly (see
            // routes/invoices.js) — that route rejects a draft invoice
            // too, not just void/fully-paid, so 'sent' is the one status
            // this button is ever actually allowed to act on.
            canManage &&
            invoice.status === 'sent' &&
            invoice.balance_due > 0 && (
              <button
                onClick={() => setShowPayment(true)}
                className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-3 text-sm font-medium text-white hover:bg-lagoon-500"
              >
                <PlusIcon width={16} height={16} />
                Record payment
              </button>
            )
          }
        >
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

      {paymentProofs.length > 0 && (
        <div className="mt-6">
          {/* Evidence a client uploaded from the portal (a bank slip,
              payment advice, receipt photo) — never an automatic payment
              record, see db/index.js's own note on payment_proofs. A
              pending badge on the accordion title itself (not just per-row)
              so "something needs a look" is visible even collapsed. */}
          <Accordion
            title={
              <span className="flex items-center gap-2">
                Payment proofs
                {pendingProofCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                    {pendingProofCount} pending
                  </span>
                )}
              </span>
            }
          >
            <div className="-mx-6 hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    <th className="px-6 py-3">File</th>
                    <th className="px-4 py-3">Uploaded</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paymentProofs.map((p) => (
                    <tr key={p.id}>
                      <td className="px-6 py-3 dark:text-white">
                        {p.file_name}
                        {p.note && <p className="text-xs text-slate-500 dark:text-slate-400">{p.note}</p>}
                        {p.status === 'rejected' && p.review_note && (
                          <p className="text-xs text-red-600 dark:text-red-400">Rejected: {p.review_note}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400">{p.uploaded_at.slice(0, 10)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <div className="flex justify-end gap-1.5">
                          <IconActionButton icon={DownloadIcon} tone="lagoon" onClick={() => handleViewPaymentProof(p.id)} title="View file" />
                          {canManage && p.status === 'pending' && (
                            <IconActionButton
                              icon={CheckCircleIcon}
                              tone="emerald"
                              onClick={() => handleReviewPaymentProof(p.id)}
                              title="Mark reviewed"
                            />
                          )}
                          {canManage && p.status === 'pending' && (
                            <IconActionButton icon={XIcon} tone="red" onClick={() => openRejectProof(p.id)} title="Reject" />
                          )}
                          {canManage && (
                            <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDeletePaymentProof(p.id)} title="Delete" />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2.5 sm:hidden">
              {paymentProofs.map((p) => (
                <MobileListAccordion
                  key={p.id}
                  name="invoice-payment-proofs"
                  summary={
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900 dark:text-white">{p.file_name}</p>
                        <p className="text-slate-500 dark:text-slate-400">{p.uploaded_at.slice(0, 10)}</p>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  }
                >
                  {p.note && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Note</dt>
                      <dd className="text-right text-slate-900 dark:text-white">{p.note}</dd>
                    </div>
                  )}
                  {p.status === 'rejected' && p.review_note && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Rejected</dt>
                      <dd className="text-right text-red-600 dark:text-red-400">{p.review_note}</dd>
                    </div>
                  )}
                  <div className="flex gap-1.5 pt-1">
                    <IconActionButton icon={DownloadIcon} tone="lagoon" onClick={() => handleViewPaymentProof(p.id)} title="View file" />
                    {canManage && p.status === 'pending' && (
                      <IconActionButton icon={CheckCircleIcon} tone="emerald" onClick={() => handleReviewPaymentProof(p.id)} title="Mark reviewed" />
                    )}
                    {canManage && p.status === 'pending' && (
                      <IconActionButton icon={XIcon} tone="red" onClick={() => openRejectProof(p.id)} title="Reject" />
                    )}
                    {canManage && <IconActionButton icon={TrashIcon} tone="red" onClick={() => handleDeletePaymentProof(p.id)} title="Delete" />}
                  </div>
                </MobileListAccordion>
              ))}
            </div>
          </Accordion>
        </div>
      )}

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

      <Modal open={rejectingProofId !== null} onClose={() => setRejectingProofId(null)} title="Reject this payment proof" maxWidthClass="max-w-md">
        <form onSubmit={handleRejectPaymentProof} className="flex flex-col gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Why is it being rejected?</span>
            <textarea
              required
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              placeholder="e.g. amount doesn't match, wrong invoice, unreadable image"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">The client will see this note on their own copy.</span>
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectingProofId(null)}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={rejecting}
              className="min-h-11 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              {rejecting ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </form>
      </Modal>

      <VoidReasonModal
        open={voidModalOpen}
        onClose={() => setVoidModalOpen(false)}
        onVoid={handleVoid}
        title="Void this invoice?"
        error={voidError}
      />

      <RecordPaymentModal
        open={showPayment}
        onClose={() => setShowPayment(false)}
        invoice={invoice}
        token={token}
        onRecorded={handlePaymentRecorded}
      />

      {confirmDialog}
    </div>
  );
}
