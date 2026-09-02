import { Navigate, Route, Routes } from 'react-router-dom';
import { PortalAuthProvider } from '../../context/PortalAuthContext';
import PortalProtectedRoute from '../../components/PortalProtectedRoute';
import PortalLayout from './PortalLayout';
import PortalAcceptInvite from './PortalAcceptInvite';
import PortalForgotPassword from './PortalForgotPassword';
import PortalResetPassword from './PortalResetPassword';
import PortalDashboard from './PortalDashboard';
import PortalQuotes from './PortalQuotes';
import PortalQuoteDetail from './PortalQuoteDetail';
import PortalInvoices from './PortalInvoices';
import PortalInvoiceDetail from './PortalInvoiceDetail';
import PortalLicenses from './PortalLicenses';
import PortalLicenseDetail from './PortalLicenseDetail';
import PortalMyAccount from './PortalMyAccount';

function Protected({ children }) {
  return (
    <PortalProtectedRoute>
      <PortalLayout>{children}</PortalLayout>
    </PortalProtectedRoute>
  );
}

// A self-contained sub-app, mounted once at App.jsx's `/portal/*` route —
// its own auth provider, its own routing, its own layout (PortalLayout),
// entirely independent of the staff app's Navbar/AuthContext/ProtectedRoute
// above it. App.jsx itself hides the staff Navbar/Footer/BottomNav whenever
// the current path starts with `/portal`, so this component owns 100% of
// what renders on screen for a portal visit.
export default function PortalApp() {
  return (
    <PortalAuthProvider>
      <Routes>
        {/* There's no portal-specific login page anymore — pages/Login.jsx
            (route "/login") signs in either a staff account or a client
            portal account from the same form, so PortalProtectedRoute.jsx
            and every other in-app link/redirect that used to point at
            "/portal/login" now points straight at "/login" instead. This
            route only exists to catch a stale bookmark/emailed link still
            pointing at the old path. */}
        <Route path="login" element={<Navigate to="/login" replace />} />
        <Route path="accept-invite" element={<PortalAcceptInvite />} />
        <Route path="forgot-password" element={<PortalForgotPassword />} />
        <Route path="reset-password" element={<PortalResetPassword />} />
        <Route path="dashboard" element={<Protected><PortalDashboard /></Protected>} />
        <Route path="quotes" element={<Protected><PortalQuotes /></Protected>} />
        <Route path="quotes/:id" element={<Protected><PortalQuoteDetail /></Protected>} />
        <Route path="invoices" element={<Protected><PortalInvoices /></Protected>} />
        <Route path="invoices/:id" element={<Protected><PortalInvoiceDetail /></Protected>} />
        <Route path="licenses" element={<Protected><PortalLicenses /></Protected>} />
        <Route path="licenses/:id" element={<Protected><PortalLicenseDetail /></Protected>} />
        <Route path="account" element={<Protected><PortalMyAccount /></Protected>} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </PortalAuthProvider>
  );
}
