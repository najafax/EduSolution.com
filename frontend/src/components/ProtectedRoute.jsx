import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();

  if (loading) {
    return <div className="flex justify-center py-24 text-slate-500 dark:text-slate-400">Loading…</div>;
  }
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
