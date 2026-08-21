import { Navigate } from 'react-router-dom';
import { usePortalAuth } from '../context/PortalAuthContext';

// The client-portal counterpart to ProtectedRoute.jsx — same loading/token
// check, but reads PortalAuthContext and redirects to the portal's own
// login route rather than the staff one.
export default function PortalProtectedRoute({ children }) {
  const { token, loading } = usePortalAuth();

  if (loading) {
    return <div className="flex justify-center py-24 text-slate-500 dark:text-slate-400">Loading…</div>;
  }
  if (!token) {
    return <Navigate to="/portal/login" replace />;
  }
  return children;
}
