import { Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
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
import Settings from './pages/business/Settings';
import Quotes from './pages/business/Quotes';
import QuoteForm from './pages/business/QuoteForm';
import QuoteDetail from './pages/business/QuoteDetail';
import Invoices from './pages/business/Invoices';
import InvoiceForm from './pages/business/InvoiceForm';
import InvoiceDetail from './pages/business/InvoiceDetail';
import RecurringInvoices from './pages/business/RecurringInvoices';
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
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <Navbar />
      <IdleTimeoutMonitor />
      <CommandPalette />
      {/* BottomNav is phone-only (sm:hidden) and fixed, so logged-in pages
          need bottom padding on phones or the tab bar covers their last
          content/action buttons — see BottomNav.jsx. */}
      <div className={user ? 'pb-16 sm:pb-0' : undefined}>
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
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="/import" element={<Protected><Import /></Protected>} />

          <Route path="/quotes" element={<Protected><Quotes /></Protected>} />
          <Route path="/quotes/new" element={<Protected><QuoteForm /></Protected>} />
          <Route path="/quotes/:id" element={<Protected><QuoteDetail /></Protected>} />
          <Route path="/quotes/:id/edit" element={<Protected><QuoteForm /></Protected>} />

          <Route path="/invoices" element={<Protected><Invoices /></Protected>} />
          <Route path="/invoices/new" element={<Protected><InvoiceForm /></Protected>} />
          <Route path="/invoices/:id" element={<Protected><InvoiceDetail /></Protected>} />
          <Route path="/invoices/:id/edit" element={<Protected><InvoiceForm /></Protected>} />

          <Route path="/recurring-invoices" element={<Protected><RecurringInvoices /></Protected>} />

          <Route path="/financials" element={<Protected><Financials /></Protected>} />
          <Route path="/reports" element={<Protected><Reports /></Protected>} />
          <Route path="/activity" element={<Protected><ActivityLog /></Protected>} />
          <Route path="/users" element={<Protected><Users /></Protected>} />
          <Route path="/email-center" element={<Protected><EmailCenter /></Protected>} />
          <Route path="/account" element={<Protected><MyAccount /></Protected>} />
        </Routes>
      </div>
      {user && <BottomNav />}
    </div>
  );
}
