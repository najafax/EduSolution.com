import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import Pagination from '../../components/Pagination';
import EmptyState from '../../components/EmptyState';
import CampaignComposeModal from '../../components/CampaignComposeModal';
import Modal from '../../components/Modal';
import { MegaphoneIcon, PlusIcon, TrendUpIcon } from '../../components/icons';

// The default starting draft for the "Email cancelled clients" campaign
// below — CampaignComposeModal's defaultSubject/defaultMessage props (see
// that component's own doc comment) just pre-fill these into the form,
// still fully editable before sending. {{license_url}} is filled in per
// recipient from the recipientData built in openCancelledLicensesCampaign
// (blank for a client whose license never had one on file — the sentence
// still reads fine either way). Moved here from Licenses.jsx, along with
// the two buttons/handlers below, on explicit request — this is the same
// kind of one-to-many client email a campaign already is, just with a
// preset recipient list and starting copy Licenses.jsx knows how to build.
const CANCELLED_LICENSE_EMAIL_SUBJECT = 'Confirming Your License Status';
const CANCELLED_LICENSE_EMAIL_MESSAGE = `Dear Sir/Madam,

We noticed that your license with us is currently showing as cancelled. We wanted to reach out to confirm whether this is still accurate, or whether you'd like to reactivate it.

If you still require the license, please let us know and we'll be happy to get it reactivated for you right away. If you no longer need it, no action is needed on your part.

You can review your license details here: {{license_url}}

Please don't hesitate to reach out if you have any questions or need any assistance.`;

// The default starting draft for the "Notify price increase" campaign
// below — same defaultSubject/defaultMessage mechanism as the
// cancelled-license draft above, just a different starting copy for a
// different recipient set (every client with an email, except those whose
// license is currently cancelled — see openPriceIncreaseCampaign).
const PRICE_INCREASE_EMAIL_SUBJECT = 'Important Update: Pricing Adjustment for EduPage Licenses';
const PRICE_INCREASE_EMAIL_MESSAGE = `Dear Sir/Madam,

We hope this email finds you well.

We are writing to inform you of an upcoming adjustment to the pricing of your EduPage license, which will take effect from your next invoice.

This change is due to the increasing difficulty and cost of acquiring US Dollars for our international payments. As an authorized distributor of EduPage, we are required to make our license payments to the provider in USD. While client payments to us are made in MVR, the ongoing rise in USD exchange rates — along with the added difficulty in sourcing foreign currency — has significantly increased our cost of doing business, even as your payments to us remain in local currency.

To continue providing uninterrupted access to your EduPage license and maintain the quality of service you rely on, we must adjust our pricing to reflect these rising costs.

We understand that pricing changes are never entirely welcome news, and we want to assure you that this decision was not made lightly. We remain fully committed to supporting your school and ensuring a smooth transition.

Should you have any questions about this change or your upcoming invoice, please don't hesitate to reach out to us — we're happy to discuss this further.

Thank you for your continued trust and partnership with Edu Solutions.

Warm regards,
Edu Solutions Pvt Ltd`;

// Bulk/promotional emails — newsletters, announcements, service updates —
// sent to every client or a hand-picked subset. Distinct from every other
// client-facing email in this app (quote/invoice send, reminders, receipts,
// portal invites): those are all transactional, one-recipient, and tied to
// a specific document; a campaign has no document behind it and is
// inherently one-to-many, so it gets its own module/permission and its own
// history feed (this page) rather than folding into Email Center's sent
// log (though every individual send still lands in that same email_log
// table under type "campaign" — see routes/campaigns.js).
export default function Campaigns() {
  const { token, can } = useAuth();
  const { toast } = useToast();
  const canManage = can('campaigns', 'manage');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // null = closed; {} = open blank ("New campaign"); a populated object
  // (presetClientIds/defaultSubject/defaultMessage/title) = open pre-filled,
  // e.g. by "Resend to failed recipients" below — same shared modal either way.
  const [compose, setCompose] = useState(null);
  const [failuresTarget, setFailuresTarget] = useState(null); // the campaign row whose failures modal is open
  const [failures, setFailures] = useState(null); // null while loading, [] once loaded
  const [failuresError, setFailuresError] = useState('');
  const [campaignLoading, setCampaignLoading] = useState(false); // busy state for the two license-campaign shortcut buttons below

  // Every distinct client with at least one cancelled license, gathered
  // fresh from the licenses table — backs the "Email cancelled clients"
  // header button below. Also builds the per-client {{license_url}} merge
  // data CampaignComposeModal sends along — a client with more than one
  // cancelled license just gets the first one found, since a single merge
  // tag can only carry one value.
  async function openCancelledLicensesCampaign() {
    setError('');
    setCampaignLoading(true);
    try {
      const { licenses: cancelledLicenses } = await api.licenses.list(token, { status: 'cancelled' });
      const clientIds = [...new Set(cancelledLicenses.map((l) => l.client_id))];
      if (clientIds.length === 0) {
        setError('No clients currently have a cancelled license.');
        return;
      }
      const recipientData = {};
      cancelledLicenses.forEach((l) => {
        if (!recipientData[l.client_id]) {
          recipientData[l.client_id] = { license_url: l.url || '', license_name: l.name || '' };
        }
      });
      setCompose({
        presetClientIds: clientIds,
        title: 'Email clients with a cancelled license',
        presetNote: 'Pre-filled with every client who currently has a cancelled license — review the list below before sending.',
        mergeFields: [{ key: 'license_url', label: "Client's license URL" }],
        recipientData,
        defaultSubject: CANCELLED_LICENSE_EMAIL_SUBJECT,
        defaultMessage: CANCELLED_LICENSE_EMAIL_MESSAGE,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setCampaignLoading(false);
    }
  }

  // Every client with an email on file, minus every client who currently
  // has a cancelled license — backs the "Notify price increase" header
  // button below. Fetches the full client list fresh (this page doesn't
  // otherwise keep one in state) alongside the cancelled-license lookup.
  async function openPriceIncreaseCampaign() {
    setError('');
    setCampaignLoading(true);
    try {
      const [{ clients }, { licenses: cancelledLicenses }] = await Promise.all([
        api.clients.list(token),
        api.licenses.list(token, { status: 'cancelled' }),
      ]);
      const cancelledClientIds = new Set(cancelledLicenses.map((l) => l.client_id));
      const clientIds = clients.filter((c) => c.email && c.email.trim() && !cancelledClientIds.has(c.id)).map((c) => c.id);
      if (clientIds.length === 0) {
        setError('No clients to notify — every client either has no email on file or currently has a cancelled license.');
        return;
      }
      setCompose({
        presetClientIds: clientIds,
        title: 'Notify clients of a license price increase',
        presetNote:
          'Pre-filled with every client who has an email on file, except those whose license is currently cancelled — review the list below before sending.',
        defaultSubject: PRICE_INCREASE_EMAIL_SUBJECT,
        defaultMessage: PRICE_INCREASE_EMAIL_MESSAGE,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setCampaignLoading(false);
    }
  }

  // Which specific recipients failed and why — see routes/campaigns.js's
  // campaign_failures note. Fetched fresh on open, not prefetched for
  // every row up front, same "fetch on open" convention Licenses.jsx's own
  // renewal-history modal already uses.
  function openFailures(campaign) {
    setFailuresTarget(campaign);
    setFailures(null);
    setFailuresError('');
    api.campaigns
      .failures(campaign.id, token)
      .then(({ failures }) => setFailures(failures))
      .catch((err) => setFailuresError(err.message));
  }

  // Re-opens the compose modal pre-selected to just the recipients who
  // failed on a prior send, with that campaign's own subject/message as
  // the starting draft (still fully editable, same defaultSubject/
  // defaultMessage mechanism CampaignComposeModal already offers — see
  // that component's own doc comment). Backend re-resolves the ids
  // against the live clients table (routes/campaigns.js's
  // resolveRecipients), so a client deleted since the original send is
  // silently dropped rather than erroring.
  function resendToFailed() {
    const ids = failures.map((f) => f.client_id).filter((id) => id != null);
    setCompose({
      presetClientIds: ids,
      title: `Resend to failed recipients — "${failuresTarget.subject}"`,
      presetNote: 'Pre-filled with the clients this campaign failed to reach last time — review the list below before sending.',
      defaultSubject: failuresTarget.subject,
      defaultMessage: failuresTarget.message,
    });
    setFailuresTarget(null);
  }

  function load() {
    if (!data) setLoading(true);
    api.campaigns
      .list(token, page)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token, page]);

  function handleSent(result) {
    const { sentCount, failedCount } = result;
    if (failedCount > 0) {
      toast(`Campaign sent to ${sentCount} client${sentCount === 1 ? '' : 's'}, ${failedCount} failed.`, { type: 'error' });
    } else {
      toast(`Campaign sent to ${sentCount} client${sentCount === 1 ? '' : 's'}.`, { type: 'success' });
    }
    setPage(1);
    load();
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Send a newsletter or promotional email to your clients.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={openCancelledLicensesCampaign}
              disabled={campaignLoading}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <MegaphoneIcon width={16} height={16} />
              {campaignLoading ? 'Loading…' : 'Email cancelled clients'}
            </button>
            <button
              onClick={openPriceIncreaseCampaign}
              disabled={campaignLoading}
              className="flex min-h-11 items-center gap-1.5 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <TrendUpIcon width={16} height={16} />
              {campaignLoading ? 'Loading…' : 'Notify price increase'}
            </button>
            <button
              onClick={() => setCompose({})}
              className="flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
            >
              <PlusIcon width={16} height={16} />
              New campaign
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {!error && loading ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : !error && (!data || data.campaigns.length === 0) ? (
          <EmptyState
            icon={<MegaphoneIcon />}
            title="No campaigns sent yet."
            message={canManage ? 'Send your first newsletter or announcement to your clients.' : undefined}
            action={canManage ? { label: 'New campaign', onClick: () => setCompose({}) } : undefined}
          />
        ) : !error ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.campaigns.map((c) => (
              <li key={c.id} className="px-4 py-3 text-sm sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white">{c.subject}</p>
                    <p className="mt-0.5 line-clamp-2 text-slate-500 dark:text-slate-400">{c.message}</p>
                  </div>
                  <span className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
                    {new Date(c.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {c.recipient_type === 'all' ? 'All clients' : 'Selected clients'} — sent to {c.sent_count} of {c.recipient_count}
                  {c.failed_count > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {' '}
                      ({c.failed_count} failed —{' '}
                      <button type="button" onClick={() => openFailures(c)} className="underline hover:no-underline">
                        view
                      </button>
                      )
                    </span>
                  )}
                  {c.sent_by_name ? ` — sent by ${c.sent_by_name}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {data && data.totalPages > 1 && (
          <div className="px-4 pb-4 sm:px-6">
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      {canManage && (
        <CampaignComposeModal
          open={!!compose}
          onClose={() => setCompose(null)}
          token={token}
          presetClientIds={compose?.presetClientIds}
          title={compose?.title}
          presetNote={compose?.presetNote}
          mergeFields={compose?.mergeFields}
          recipientData={compose?.recipientData}
          defaultSubject={compose?.defaultSubject}
          defaultMessage={compose?.defaultMessage}
          onSent={handleSent}
        />
      )}

      <Modal
        open={!!failuresTarget}
        onClose={() => setFailuresTarget(null)}
        title={failuresTarget ? `Failed recipients — "${failuresTarget.subject}"` : ''}
      >
        {failuresError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{failuresError}</p>
        ) : failures === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : failures.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No failure detail was recorded for this send.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {failures.map((f, i) => (
                <li key={i} className="py-2 text-sm">
                  <p className="font-medium text-slate-900 dark:text-white">
                    {f.client_name} {f.client_email && <span className="font-normal text-slate-500 dark:text-slate-400">({f.client_email})</span>}
                  </p>
                  <p className="mt-0.5 text-red-600 dark:text-red-400">{f.error}</p>
                </li>
              ))}
            </ul>
            {canManage && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={resendToFailed}
                  className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
                >
                  Resend to these {failures.length} recipient{failures.length === 1 ? '' : 's'}
                </button>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
