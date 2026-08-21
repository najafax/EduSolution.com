import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import BottomNav from './components/BottomNav';
import ProtectedRoute from './components/ProtectedRoute';
import IdleTimeoutMonitor from './components/IdleTimeoutMonitor';
import CommandPalette from './components/CommandPalette';
import { useAuth } from './context/AuthContext';

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
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Clients = lazy(() => import('./pages/business/Clients'));
const Products = lazy(() => import('./pages/business/Products'));
const Expenses = lazy(() => import('./pages/business/Expenses'));
const CapitalContributions = lazy(() => import('./pages/business/CapitalContributions'));
const Settings = lazy(() => import('./pages/business/Settings'));
const Quotes = lazy(() => import('./pages/business/Quotes'));
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
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-950">
      <Navbar />
      <IdleTimeoutMonitor />
      <CommandPalette />
      {/* flex-1 + flex-col here (rather than on the outer div) is what pins
          Footer to the bottom of the viewport on short pages (e.g. Login)
          while letting it flow naturally below content on tall ones —
          the standard sticky-footer pattern. BottomNav is phone-only
          (sm:hidden) and fixed, so logged-in pages still need the bottom
          padding on phones or the tab bar covers Footer/the page's last
          content — see BottomNav.jsx. */}
      <div className={`flex flex-1 flex-col ${user ? 'pb-16 sm:pb-0' : ''}`}>
        <div className="flex-1">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Login is also the app's landing page — see pages/Login.jsx's
                  own comment for why there's no separate Landing component
                  anymore. Both paths render the same element so a bookmarked
                  or shared "/login" link keeps working unchanged. */}
              <Route path="/" element={<Login />} />
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/q/:token" element={<PublicQuote />} />
              <Route path="/i/:token" element={<PublicInvoice />} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />

              <Route path="/clients" element={<Protected><Clients /></Protected>} />
              <Route path="/products" element={<Protected><Products /></Protected>} />
              <Route path="/expenses" element={<Protected><Expenses /></Protected>} />
              <Route path="/capital-contributions" element={<Protected><CapitalContributions /></Protected>} />
              <Route path="/settings" element={<Protected><Settings /></Protected>} />
              <Route path="/import" element={<Protected><Import /></Protected>} />

              <Route path="/quotes" element={<Protected><Quotes /></Protected>} />
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
              <Route path="/account" element={<Protected><MyAccount /></Protected>} />
            </Routes>
          </Suspense>
        </div>
        {/* Hidden on phones while logged in: BottomNav + each page's own
            FloatingActionButton (fixed, sm:hidden) already own that screen
            real estate there, and the FAB's fixed bottom offset lands right
            in Footer's band on short-content pages (e.g. an empty list),
            overlapping its copyright text — see FloatingActionButton.jsx.
            Logged-out mobile pages (Login, Landing, public quote/invoice
            links) have neither, so Footer stays visible there. */}
        <Footer className={user ? 'hidden sm:block' : ''} />
      </div>
      {user && <BottomNav />}
    </div>
  );
}
