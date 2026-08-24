// Minimal hand-rolled outline icons (no icon-library dependency) — 20x20,
// 1.5px stroke, currentColor. Used inside KpiCard's tinted circle, so the
// icon inherits its tone color rather than carrying its own.
const base = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };

export function InvoiceIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3h10v14l-2.5-1.5L10 17l-2.5-1.5L5 17V3Z" strokeLinejoin="round" />
      <path d="M7.5 7h5M7.5 10h5" strokeLinecap="round" />
    </svg>
  );
}

export function CheckCircleIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="m7 10 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertTriangleIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3.5 17.5 16h-15L10 3.5Z" strokeLinejoin="round" />
      <path d="M10 8.5v3.25" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ExpenseIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h12l-1 9.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 15.5L4 6Z" strokeLinejoin="round" />
      <path d="M7 6a3 3 0 0 1 6 0" strokeLinecap="round" />
    </svg>
  );
}

export function TrendUpIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 13.5 8 9l3 3 5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6.5h3.5V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendDownIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 6.5 8 11l3-3 5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 13.5h3.5V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UsersIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M2.5 16c0-2.5 2-4 5-4s5 1.5 5 4" strokeLinecap="round" />
      <path d="M12.5 5a2.5 2.5 0 0 1 0 5" strokeLinecap="round" />
      <path d="M14.5 12.3c1.8.4 3 1.6 3 3.7" strokeLinecap="round" />
    </svg>
  );
}

// A half-open inbox tray — used by EmptyState for "nothing here yet".
export function InboxIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 11.5 5 4h10l2 7.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M3 11.5h4.2l.9 2h3.8l.9-2H17V15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15v-3.5Z" strokeLinejoin="round" />
    </svg>
  );
}

// A document with a small bar-chart mark — used on Reports.jsx's report
// cards (sales/tax/P&L/expense reports are all "a document with numbers
// in it", distinct from InvoiceIcon's folded-corner receipt shape).
export function ReportIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3h7l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M12 3v3h3" strokeLinejoin="round" />
      <path d="M7 14.5v-2M10 14.5v-4M13 14.5v-1.5" strokeLinecap="round" />
    </svg>
  );
}

// Bottom-nav "Home" tab (components/BottomNav.jsx).
export function HomeIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 9.5 10 3l7.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 8.5V16a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A folded-flag document — distinct silhouette from InvoiceIcon so a quote
// (not yet billed) reads differently from an invoice at a glance in the
// bottom nav / dashboard activity feed.
export function QuoteIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M11 2.5H6a1 1 0 0 0-1 1V16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5L11 2.5Z" strokeLinejoin="round" />
      <path d="M11 2.5V6a.5.5 0 0 0 .5.5H15" strokeLinejoin="round" />
      <path d="M7.5 10.5 9 12l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Bottom-nav "More" tab: three dots, opens components/BottomSheet.jsx.
export function MoreIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="4.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronRightIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="m7.5 4.5 5.5 5.5-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="9" r="6" />
      <path d="m17 17-3-3" strokeLinecap="round" />
    </svg>
  );
}

export function XIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
    </svg>
  );
}

// A shield with a checkmark — used for the Licenses module (nav link,
// dashboard shortcut, KpiCard icons, EmptyState) since a license is
// fundamentally "this client is currently authorized/covered."
export function LicenseIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 2.5 4 5v5c0 4 2.6 6.7 6 7.5 3.4-.8 6-3.5 6-7.5V5l-6-2.5Z" strokeLinejoin="round" />
      <path d="M7.2 9.8 9.3 12l3.5-4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A classic bank/columns pictogram — used for the Financials/Dashboard
// "Bank balance" KPI card (see routes/financials.js's bankBalance).
export function BankIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8 10 3.5 17 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 8.5h12v7H4Z" strokeLinejoin="round" />
      <path d="M7 8.5v7M13 8.5v7M3 17h14" strokeLinecap="round" />
    </svg>
  );
}

// A graduation cap — used once on Login.jsx for the EduPage partner
// mention, since none of the CRM/billing icons above (Invoice, Quote,
// Bank, etc.) fit "a school platform" and this is a distinct enough
// concept to earn its own icon rather than borrowing one already carrying
// a different meaning elsewhere (e.g. UsersIcon's "Clients").
export function GraduationCapIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3.5 18 7l-8 3.5L2 7l8-3.5Z" strokeLinejoin="round" />
      <path d="M5.5 8.7v3.8c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V8.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 7v4.5" strokeLinecap="round" />
    </svg>
  );
}

// Two mirrored arc+arrowhead pairs forming a full circle — "renew/sync"
// (Licenses.jsx's Renew action button).
export function RefreshIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 10a5.5 5.5 0 0 1 9.5-3.8l1 1" strokeLinecap="round" />
      <path d="M13.5 4.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 10a5.5 5.5 0 0 1-9.5 3.8l-1-1" strokeLinecap="round" />
      <path d="M6.5 15.5v-3h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A notification bell — "remind" (Licenses.jsx's Remind action button;
// distinct from SendIcon's paper-plane, which reads as the send action
// itself rather than the reminder concept).
export function BellIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3.5a4 4 0 0 0-4 4v2.3c0 .8-.3 1.6-.9 2.2L4 13h12l-1.1-1.1a3 3 0 0 1-.9-2.2V7.5a4 4 0 0 0-4-4Z" strokeLinejoin="round" />
      <path d="M8.3 15.5a1.8 1.8 0 0 0 3.4 0" strokeLinecap="round" />
    </svg>
  );
}

// A clock face with a counter-clockwise "back" arrow tail — "history"
// (Licenses.jsx's History action button). Deliberately distinct from the
// plain ClockIcon above, which already carries its own "time-sensitive/
// expiring soon" meaning elsewhere on the same page (its KPI card) — this
// one's extra arrow tail reads as "look back," not "time running out."
export function HistoryIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 5.5v4.5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 7A6 6 0 1 1 4 11" strokeLinecap="round" />
      <path d="M4.5 4v3h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A pencil — "edit" (Licenses.jsx's Edit action button).
export function PencilIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="m13.5 3.5 3 3L7 16H4v-3L13.5 3.5Z" strokeLinejoin="round" />
      <path d="m11.5 5.5 3 3" strokeLinecap="round" />
    </svg>
  );
}

// A key — "reset password" (Users.jsx's Reset password action button).
export function KeyIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="13" r="3.5" />
      <path d="M9.5 10.5 16 4M13.5 6 15.5 8M16 4l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A trash can — "delete" (Licenses.jsx's Delete action button).
export function TrashIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 6 6 16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-10" strokeLinejoin="round" />
      <path d="M8.5 9v5M11.5 9v5" strokeLinecap="round" />
    </svg>
  );
}

// A paper plane — "send" (QuoteDetail.jsx/InvoiceDetail.jsx's "Email to
// client" buttons, and the Payments table's per-receipt "Email" action),
// distinct from BellIcon's "remind" — this is the send action itself, not
// a reminder nudge.
export function SendIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M17 3 2.5 9.2l5.3 2.1M17 3l-5.3 13.5-3.9-5.2M17 3 8 11.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Two overlapping documents — "duplicate" (QuoteDetail.jsx/
// InvoiceDetail.jsx's Duplicate buttons).
export function DuplicateIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7.5 3.5h7A1.5 1.5 0 0 1 16 5v7a1.5 1.5 0 0 1-1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="7" width="9" height="10" rx="1.5" />
    </svg>
  );
}

// A downward arrow into a tray — "export/download" (Licenses.jsx's Export
// CSV/Excel buttons).
export function DownloadIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3v9.5M6.5 9 10 12.5 13.5 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A plus sign — "create new" (Licenses.jsx's "New license" header button).
// Distinct from FloatingActionButton.jsx's own private PlusIcon, which
// stays local to that component rather than importing this one, since the
// FAB's is unrelated to any header button and refactoring it isn't part of
// what introduced this shared icon.
export function PlusIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
    </svg>
  );
}

// A megaphone — "promotional/bulk email" (Clients.jsx's per-row "Send
// campaign email" action, the Campaigns page's header/history entries),
// deliberately distinct from SendIcon's paper plane, which this app already
// uses everywhere for a single transactional document send (a quote,
// invoice, receipt, or portal invite) — a campaign is a broadcast, not a
// document delivery, so it gets its own glyph rather than reusing SendIcon
// and reading as a duplicate action on the same row.
export function MegaphoneIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8.5v3a1 1 0 0 0 1 1h1.2L11 16v-11L5.2 7.5H4a1 1 0 0 0-1 1Z" strokeLinejoin="round" />
      <path d="M11 5v11a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3Z" strokeLinejoin="round" />
      <path d="M5.5 12.5 6 16a1 1 0 0 0 1 .9h1a1 1 0 0 0 1-1.1l-.3-2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A small stacked box — "product/catalog item" (Sidebar.jsx's Products nav
// link). No existing icon fit this: ExpenseIcon's silhouette already means
// "money spent" specifically, so reusing it here would misread as an
// expense-related link rather than the product catalog.
export function ProductIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 2.5 17 6v8l-7 3.5L3 14V6l7-3.5Z" strokeLinejoin="round" />
      <path d="M3 6l7 3.5L17 6M10 9.5V17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A gear — "settings" (Sidebar.jsx's Settings nav link). The one genuinely
// missing standard icon this app never needed before, since Settings only
// ever appeared as a plain text link in the old top nav.
export function SettingsIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 12.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" />
      <path d="M16.2 12.3a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37V17.7a1.8 1.8 0 1 1-3.6 0v-.08a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.05.05a1.8 1.8 0 1 1-2.55-2.55l.05-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H2.3a1.8 1.8 0 1 1 0-3.6h.08a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.05-.05A1.8 1.8 0 1 1 5.95 3.7l.05.05a1.5 1.5 0 0 0 1.65.3h.08a1.5 1.5 0 0 0 .9-1.37V2.3a1.8 1.8 0 1 1 3.6 0v.08a1.5 1.5 0 0 0 .9 1.37h.08a1.5 1.5 0 0 0 1.65-.3l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.08a1.5 1.5 0 0 0 1.37.9h.08a1.8 1.8 0 1 1 0 3.6h-.08a1.5 1.5 0 0 0-1.37.9Z" strokeLinejoin="round" />
    </svg>
  );
}

// The upload counterpart to DownloadIcon just above — same tray, arrow
// reversed to point up out of it. Used for "Import CSV" actions (see
// Products.jsx's bulk import button).
export function UploadIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 12.5V3M6.5 6.5 10 3l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LogoutIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 13.5 17 10l-4-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 10H7.5" strokeLinecap="round" />
    </svg>
  );
}
