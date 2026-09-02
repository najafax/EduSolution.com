import { Navigate } from 'react-router-dom';
import { usePortalAuth } from '../context/PortalAuthContext';

// The client-portal counterpart to ProtectedRoute.jsx — same loading/token
// check, but reads PortalAuthContext. Redirects to the shared "/login" —
// there's no portal-specific login page anymore, see pages/Login.jsx —
// which sends the visitor straight back to "/portal/dashboard" once they
// sign in with their portal credentials.
export default function PortalProtectedRoute({ children }) {
  const { token, loading } = usePortalAuth();

  if (loading) {
    return <div className="flex justify-center py-24 text-slate-500 dark:text-slate-400">Loading…</div>;
  }
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
