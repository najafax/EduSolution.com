import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import Footer from './components/Footer';
import BottomNav from './components/BottomNav';
import ProtectedRoute from './components/ProtectedRoute';
import IdleTimeoutMonitor from './components/IdleTimeoutMonitor';
import CommandPalette from './components/CommandPalette';
import ErrorBoundary from './components/ErrorBoundary';
import { useAuth } from './context/AuthContext';
import { NotificationsProvider } from './context/NotificationsContext';

// Every routed page is loaded on demand rather than bundled into one
// eager chunk — Login previously had to wait on the entire app's JS
// (Reports, Email Center, every analytics page, etc.) before it could even
// render, and any single-line change to any one page invalidated that
// whole bundle for every user on their next visit. Splitting by route means
// the first load only pulls in what the current page actually needs, and a
// deploy only invalidates the chunk(s) that actually changed. The PWA
// service worker still precaches every chunk in the background after
// install (see vite.config.js), so this doesn't change what's eventually
// cached — it changes what has to arrive before the first paint.
const Login = lazy(() => import('./pages/Login'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const PublicQuote = lazy(() => import('./pages/PublicQuote'));
const PublicInvoice = lazy(() => import('./pages/PublicInvoice'));
const PublicMODReport = lazy(() => import('./pages/PublicMODReport'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Clients = lazy(() => import('./pages/business/Clients'));
const Products = lazy(() => import('./pages/business/Products'));
const Expenses = lazy(() => import('./pages/business/Expenses'));
const ExpenseAnalytics = lazy(() => import('./pages/business/ExpenseAnalytics'));
const CapitalContributions = lazy(() => import('./pages/business/CapitalContributions'));
const OwnerDraws = lazy(() => import('./pages/business/OwnerDraws'));
const Settings = lazy(() => import('./pages/business/Settings'));
const Quotes = lazy(() => import('./pages/business/Quotes'));
const QuoteRequests = lazy(() => import('./pages/business/QuoteRequests'));
const QuoteForm = lazy(() => import('./pages/business/QuoteForm'));
const QuoteDetail = lazy(() => import('./pages/business/QuoteDetail'));
const QuoteAnalytics = lazy(() => import('./pages/business/QuoteAnalytics'));
const Invoices = lazy(() => import('./pages/business/Invoices'));
const InvoiceForm = lazy(() => import('./pages/business/InvoiceForm'));
const InvoiceDetail = lazy(() => import('./pages/business/InvoiceDetail'));
const InvoiceAnalytics = lazy(() => import('./pages/business/InvoiceAnalytics'));
const RecurringInvoices = lazy(() => import('./pages/business/RecurringInvoices'));
const Licenses = lazy(() => import('./pages/business/Licenses'));
const LicenseAnalytics = lazy(() => import('./pages/business/LicenseAnalytics'));
const Financials = lazy(() => import('./pages/business/Financials'));
const Reports = lazy(() => import('./pages/business/Reports'));
const ActivityLog = lazy(() => import('./pages/business/ActivityLog'));
const Import = lazy(() => import('./pages/business/Import'));
const Users = lazy(() => import('./pages/Users'));
const MyAccount = lazy(() => import('./pages/MyAccount'));
const EmailCenter = lazy(() => import('./pages/EmailCenter'));
const MODReport = lazy(() => import('./pages/business/MODReport'));
const Campaigns = lazy(() => import('./pages/business/Campaigns'));
const PortalApp = lazy(() => import('./pages/portal/PortalApp'));
const Website = lazy(() => import('./pages/business/Website'));
const Home = lazy(() => import('./pages/marketing/Home'));
const MarketingServices = lazy(() => import('./pages/marketing/MarketingServices'));
const MarketingTestimonials = lazy(() => import('./pages/marketing/MarketingTestimonials'));
const MarketingNews = lazy(() => import('./pages/marketing/MarketingNews'));

// Same loading copy/markup ProtectedRoute already shows while resolving
// auth, so a lazy chunk still loading (usually a blip, longer on a slow
// connection) reads as the same kind of pause rather than a new pattern.
function RouteFallback() {
  return <div className="flex justify-center py-24 text-slate-500 dark:text-slate-400">Loading…</div>;
}

function Protected({ children }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

export default function App() {
  const { user } = useAuth();
  // The client portal (pages/portal/PortalApp.jsx) is a self-contained
  // sub-app with its own auth, routing, and layout (including its own top
  // bar) — it must never render inside the staff Navbar/BottomNav/Footer
  // shell below, which reads AuthContext/`can()` and would be both wrong
  // (a client isn't a staff user) and broken (those components assume a
  // staff `user`/`permissions` shape a portal account doesn't have).
  const location = useLocation();
  const isPortalRoute = location.pathname.startsWith('/portal');
  // The public marketing site (Home + its three sibling pages) is, like the
  // client portal, its own self-contained visitor-facing surface — it needs
  // no part of the internal Sidebar/Navbar/TopBar chrome, which lists
  // business-management modules (Clients, Invoices, Licenses, ...) that
  // mean nothing to an outside visitor and would be actively confusing to
  // show here. Fixed set, exact match — these are top-level pages, not a
  // route subtree the way /portal/* is, so a prefix check isn't right here.
  const MARKETING_ROUTES = new Set(['/', '/services', '/testimonials', '/news']);
  const isMarketingRoute = MARKETING_ROUTES.has(location.pathname);

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-950 xl:flex-row">
      {/* Sidebar (xl: and up, nav links only) pairs with TopBar (search/
          notifications/theme/account, xl: and up); Navbar (below xl,
          everything in one header) is the mutually-exclusive alternative
          to that pair — each of Navbar/TopBar hides itself at the other's
          breakpoint (see Navbar.jsx/TopBar.jsx), so exactly one of them
          ever renders. Sidebar sits as a row sibling of the "main column"
          below rather than inside it, since it spans the full page
          height, not just the routed content's height; TopBar renders
          inside that main column instead, alongside Navbar, since it only
          needs to span the content area next to Sidebar, not the page's
          full width. */}
      {!isPortalRoute && !isMarketingRoute && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* NotificationsProvider wraps Navbar+TopBar specifically (not the
            whole app) — see NotificationsContext.jsx's own top-of-file
            note: both headers are always mounted regardless of viewport
            (CSS breakpoints pick which is visible, not React), and each
            renders its own <NotificationCenter> bell, so without a shared
            provider the same three list requests fired twice on every
            page load. Skipped for the marketing routes the same way as the
            portal — those pages render their own MarketingLayout header. */}
        {!isPortalRoute && !isMarketingRoute && (
          <NotificationsProvider>
            <Navbar />
            <TopBar />
          </NotificationsProvider>
        )}
        {!isPortalRoute && !isMarketingRoute && <IdleTimeoutMonitor />}
        {!isPortalRoute && !isMarketingRoute && <CommandPalette />}
        {/* flex-1 + flex-col here (rather than on the outer div) is what pins
            Footer to the bottom of the viewport on short pages (e.g. Login)
            while letting it flow naturally below content on tall ones —
            the standard sticky-footer pattern. BottomNav is phone-only
            (sm:hidden) and fixed, so logged-in pages still need the bottom
            padding on phones or the tab bar covers Footer/the page's last
            content — see BottomNav.jsx. */}
        <div className={`flex flex-1 flex-col ${user && !isPortalRoute && !isMarketingRoute ? 'pb-16 sm:pb-0' : ''}`}>
          <div className="flex-1">
            {/* Keyed by pathname so a crash on one page doesn't linger once
                the user navigates elsewhere — remounting clears the
                boundary's caught-error state along with everything else.
                The same key also drives the page's own enter transition
                (a quick fade + slight rise, `.route-fade-in` in index.css)
                — no exit animation, same reasoning as before: avoiding a
                blank gap between pages on route change would need real
                complexity (react-router's own location prop threaded
                through something like AnimatePresence) for a subtle effect
                nobody would consciously notice missing. Plain CSS
                (`@keyframes` gated behind `prefers-reduced-motion:
                no-preference`) rather than the `motion` library used here
                deliberately — this div sits in App.jsx's own always-eager
                render tree, so a `motion/react` import here would pull the
                whole animation library into the initial bundle that has to
                load before ANY page (including Login) can render, the
                exact regression route-level code-splitting was built to
                avoid. `motion` itself is unaffected — Modal.jsx's and
                ConfirmDialog.jsx's own open/close animations still use it
                (each now wraps its own MotionConfig locally, see their own
                notes), and since neither is ever statically imported by
                App.jsx, the library stays lazy: only fetched the first
                time a modal actually opens, not on every page load. */}
            <ErrorBoundary key={location.pathname}>
            <div key={location.pathname} className="route-fade-in">
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                {/* '/' is the real public marketing site now (pages/marketing/
                    Home.jsx) — Login itself is unchanged and lives only at
                    '/login'; see Home.jsx's own note on the redirect that
                    replaces its old "already signed in" behavior at this
                    path. */}
                <Route path="/" element={<Home />} />
                <Route path="/services" element={<MarketingServices />} />
                <Route path="/testimonials" element={<MarketingTestimonials />} />
                <Route path="/news" element={<MarketingNews />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/q/:token" element={<PublicQuote />} />
                <Route path="/i/:token" element={<PublicInvoice />} />
                <Route path="/mod/:token" element={<PublicMODReport />} />
                <Route path="/portal/*" element={<PortalApp />} />
                <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />

                <Route path="/clients" element={<Protected><Clients /></Protected>} />
                <Route path="/campaigns" element={<Protected><Campaigns /></Protected>} />
                <Route path="/products" element={<Protected><Products /></Protected>} />
                <Route path="/expenses" element={<Protected><Expenses /></Protected>} />
                <Route path="/expenses/analytics" element={<Protected><ExpenseAnalytics /></Protected>} />
                <Route path="/capital-contributions" element={<Protected><CapitalContributions /></Protected>} />
                <Route path="/owner-draws" element={<Protected><OwnerDraws /></Protected>} />
                <Route path="/settings" element={<Protected><Settings /></Protected>} />
                <Route path="/import" element={<Protected><Import /></Protected>} />

                <Route path="/quotes" element={<Protected><Quotes /></Protected>} />
                <Route path="/quote-requests" element={<Protected><QuoteRequests /></Protected>} />
                <Route path="/quotes/analytics" element={<Protected><QuoteAnalytics /></Protected>} />
                <Route path="/quotes/new" element={<Protected><QuoteForm /></Protected>} />
                <Route path="/quotes/:id" element={<Protected><QuoteDetail /></Protected>} />
                <Route path="/quotes/:id/edit" element={<Protected><QuoteForm /></Protected>} />

                <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
                <Route path="/invoices/analytics" element={<Protected><InvoiceAnalytics /></Protected>} />
                <Route path="/invoices/new" element={<Protected><InvoiceForm /></Protected>} />
                <Route path="/invoices/:id" element={<Protected><InvoiceDetail /></Protected>} />
                <Route path="/invoices/:id/edit" element={<Protected><InvoiceForm /></Protected>} />

                <Route path="/recurring-invoices" element={<Protected><RecurringInvoices /></Protected>} />
                <Route path="/licenses" element={<Protected><Licenses /></Protected>} />
                <Route path="/licenses/analytics" element={<Protected><LicenseAnalytics /></Protected>} />

                <Route path="/financials" element={<Protected><Financials /></Protected>} />
                <Route path="/reports" element={<Protected><Reports /></Protected>} />
                <Route path="/activity" element={<Protected><ActivityLog /></Protected>} />
                <Route path="/users" element={<Protected><Users /></Protected>} />
                <Route path="/email-center" element={<Protected><EmailCenter /></Protected>} />
                <Route path="/website-content" element={<Protected><Website /></Protected>} />
                <Route path="/mod-reports" element={<Protected><MODReport /></Protected>} />
                <Route path="/account" element={<Protected><MyAccount /></Protected>} />
              </Routes>
              </Suspense>
            </div>
            </ErrorBoundary>
          </div>
          {/* Hidden on phones while logged in: BottomNav + each page's own
              FloatingActionButton (fixed, sm:hidden) already own that screen
              real estate there, and the FAB's fixed bottom offset lands right
              in Footer's band on short-content pages (e.g. an empty list),
              overlapping its copyright text — see FloatingActionButton.jsx.
              Logged-out mobile pages (Login, Landing, public quote/invoice
              links) have neither, so Footer stays visible there. */}
          {/* The portal renders its own Footer instance inside PortalLayout —
              skip the staff one entirely rather than showing it twice. */}
          {!isPortalRoute && <Footer className={user ? 'hidden sm:block' : ''} />}
        </div>
      </div>
      {!isPortalRoute && !isMarketingRoute && user && <BottomNav />}
    </div>
  );
}
