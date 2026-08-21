import { Link } from 'react-router-dom';

// Shared shell for the four unauthenticated portal auth pages (login,
// accept-invite, forgot/reset password) — a plain centered card, not the
// full marketing hero pages/Login.jsx uses for staff, since a client
// landing here came from a direct invite/reset link with one specific task
// to do, not browsing the app's front door.
export default function PortalAuthCard({ title, subtitle, children }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mb-6 flex items-center justify-center gap-2">
        <img src="/logo-symbol.png" alt="" className="h-7 w-7" />
        <span className="text-lg font-bold text-slate-900 dark:text-white">
          EduSolution<span className="text-lagoon-600">.com</span>
        </span>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8 dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
        {children}
      </div>
      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        <Link to="/portal/login" className="font-medium text-lagoon-600 hover:text-lagoon-500">
          Back to client portal log in
        </Link>
      </p>
    </div>
  );
}
