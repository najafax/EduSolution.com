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
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-lg font-semibold text-slate-900">
          EduSolution<span className="text-indigo-600">.com</span>
        </Link>

        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Link to="/dashboard" className="text-sm font-medium text-slate-700 hover:text-slate-900">
                Dashboard
              </Link>
              <button
                onClick={handleLogout}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium text-slate-700 hover:text-slate-900">
                Log in
              </Link>
              <Link
                to="/signup"
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
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
