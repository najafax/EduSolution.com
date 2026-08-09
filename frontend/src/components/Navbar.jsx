import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <header
      className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/" className="shrink-0 text-base font-semibold text-slate-900 sm:text-lg">
          EduSolution<span className="text-indigo-600">.com</span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-4">
          {user ? (
            <>
              <Link
                to="/dashboard"
                className="flex min-h-11 items-center px-2 text-sm font-medium text-slate-700 hover:text-slate-900 sm:px-0"
              >
                Dashboard
              </Link>
              <button
                onClick={handleLogout}
                className="min-h-11 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700 sm:px-4"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="min-h-11 flex items-center px-2 text-sm font-medium text-slate-700 hover:text-slate-900 sm:px-0"
              >
                Log in
              </Link>
              <Link
                to="/signup"
                className="flex min-h-11 items-center rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 sm:px-4"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
