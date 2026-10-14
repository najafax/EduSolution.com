import { useLocation, useNavigate } from 'react-router-dom';

// Click handler for a nav link that should act as a toggle: the first click
// opens `to`, a second click while already on it closes it by going back
// (or to the dashboard if there is no in-app history to return to).
export function useToggleLink(to) {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  return (e) => {
    if (pathname !== to) return;
    e.preventDefault();
    if (key !== 'default') navigate(-1);
    else navigate('/dashboard');
  };
}
