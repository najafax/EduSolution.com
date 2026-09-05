import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import MODReport from './pages/MODReport';
import PublicMODReport from './pages/PublicMODReport';

function Protected({ children }) {
  const { token, user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>;
  if (!token || !user) return <Navigate to="/login" replace />;
  return children;
}

function TopBar() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
      <span className="text-sm font-semibold text-slate-900 dark:text-white">MOD Report</span>
      <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
        <span>{user.name}</span>
        <button onClick={logout} className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          Sign out
        </button>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/mod/:token" element={<PublicMODReport />} />
        <Route
          path="/"
          element={
            <Protected>
              <TopBar />
              <MODReport />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
