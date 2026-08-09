import { Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Clients from './pages/business/Clients';
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

function Protected({ children }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />

        <Route path="/clients" element={<Protected><Clients /></Protected>} />
        <Route path="/expenses" element={<Protected><Expenses /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />

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
      </Routes>
    </div>
  );
}
