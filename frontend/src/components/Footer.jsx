// Global, minimal footer — mounted once in App.jsx alongside Navbar, so it
// appears at the bottom of every page (public and authenticated alike).
// Deliberately slim: this is an internal business app, not a marketing
// site, so it's one quiet closing line rather than a multi-column link
// directory — Login.jsx's own richer closing section (wordmark + link)
// stays as that page's own content, this renders right below it there too.
// `className` (default '') lets App.jsx hide this on phones once a user is
// logged in — see App.jsx's own comment on why, next to where it's passed.
export default function Footer({ className = '' }) {
  const year = new Date().getFullYear();

  return (
    <footer
      className={`border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 ${className}`}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-6 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left lg:px-8">
        <div className="flex items-center gap-2">
          <img src="/logo-symbol.png" alt="" className="h-5 w-5" />
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            EduSolution<span className="text-lagoon-600">.com</span>
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          &copy; {year}{' '}
          <a
            href="https://www.edusolutionsmv.com"
            target="_blank"
            rel="noreferrer"
            className="font-medium hover:text-lagoon-600 dark:hover:text-lagoon-400"
          >
            Edu Solutions Pvt Ltd
          </a>
          . All rights reserved.
        </p>
      </div>
    </footer>
  );
}
