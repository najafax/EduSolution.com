const COLORS = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent: 'bg-lagoon-100 text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  declined: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  void: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  // Licenses only (pages/business/Licenses.jsx) — 'expired' above is reused
  // as-is (same amber "lapsed" meaning as a quote's own expired status).
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  expiring_soon: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  cancelled: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  // Quote requests only (pages/business/QuoteRequests.jsx,
  // pages/portal/PortalQuotes.jsx) — 'approved'/'declined' reuse the exact
  // same emerald/red as 'accepted'/'declined' above (same meaning, a
  // different entity), 'pending' is its own amber "awaiting a decision"
  // color, distinct from 'expiring_soon's lapsing-soon warning.
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  // Payment proofs only (InvoiceDetail.jsx/PortalInvoiceDetail.jsx) —
  // 'pending'/'reviewed' (the latter falls back to the default slate)
  // already existed; 'rejected' reuses the same red as 'declined'/'void'
  // above, same "a staff member said no" meaning.
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  // Website content only (pages/business/Website.jsx) — a post/testimonial
  // that's live on the public site, the same emerald "this is real and
  // visible" meaning 'active'/'paid' already carry; 'draft' above already
  // covers the not-yet-visible state.
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
};

export default function StatusBadge({ status }) {
  const classes = COLORS[status] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${classes}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
