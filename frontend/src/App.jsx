import { Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import BottomNav from './components/BottomNav';
import ProtectedRoute from './components/ProtectedRoute';
import IdleTimeoutMonitor from './components/IdleTimeoutMonitor';
import CommandPalette from './components/CommandPalette';
import { useAuth } from './context/AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import PublicQuote from './pages/PublicQuote';
import PublicInvoice from './pages/PublicInvoice';
import Dashboard from './pages/Dashboard';
import Clients from './pages/business/Clients';
import Products from './pages/business/Products';
import Expenses from './pages/business/Expenses';
import CapitalContributions from './pages/business/CapitalContributions';
import Settings from './pages/business/Settings';
import Quotes from './pages/business/Quotes';
import QuoteForm from './pages/business/QuoteForm';
import QuoteDetail from './pages/business/QuoteDetail';
import QuoteAnalytics from './pages/business/QuoteAnalytics';
import Invoices from './pages/business/Invoices';
import InvoiceForm from './pages/business/InvoiceForm';
import InvoiceDetail from './pages/business/InvoiceDetail';
import InvoiceAnalytics from './pages/business/InvoiceAnalytics';
import RecurringInvoices from './pages/business/RecurringInvoices';
import Licenses from './pages/business/Licenses';
import LicenseAnalytics from './pages/business/LicenseAnalytics';
import Financials from './pages/business/Financials';
import Reports from './pages/business/Reports';
import ActivityLog from './pages/business/ActivityLog';
import Import from './pages/business/Import';
import Users from './pages/Users';
import MyAccount from './pages/MyAccount';
import EmailCenter from './pages/EmailCenter';

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
          <Routes>
            <Route path="/" element={<Landing />} />
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
