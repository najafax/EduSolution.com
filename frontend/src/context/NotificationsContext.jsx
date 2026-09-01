import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../lib/api';

const NotificationsContext = createContext(null);

// The single fetch behind components/NotificationCenter.jsx's bell — pulled
// out into a shared context because that component is rendered twice at
// once (Navbar.jsx's header, hidden via `xl:hidden`, and TopBar.jsx's,
// hidden via `hidden ... xl:flex` — CSS decides which is *visible*, but
// both are always mounted in the tree regardless of viewport width, per
// App.jsx's own `{!isPortalRoute && <Navbar />}` / `{!isPortalRoute &&
// <TopBar />}`). Before this, each instance ran its own independent
// `useEffect` fetch on mount, so every page load fired the same three
// list requests (overdue invoices, expiring licenses, pending quote
// requests) twice — pure waste, doubled again on window resize past `xl:`
// swapping which header is visible without ever unmounting the other one.
// One provider, mounted once in App.jsx above both headers, means exactly
// one fetch per grant regardless of how many `<NotificationCenter>`
// instances are currently rendered.
export function NotificationsProvider({ children }) {
  const { token, can } = useAuth();
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [expiringLicenses, setExpiringLicenses] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);

  const canViewInvoices = can('invoices', 'view');
  const canViewLicenses = can('licenses', 'view');
  const canViewQuotes = can('quotes', 'view');

  const refresh = useCallback(() => {
    if (canViewInvoices) {
      api.invoices
        .list(token, { status: 'sent' })
        .then(({ invoices }) =>
          setOverdueInvoices(invoices.filter((inv) => inv.is_overdue).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))),
        )
        .catch(() => {});
    }
    if (canViewLicenses) {
      api.licenses
        .list(token, { status: 'expiring_soon' })
        .then(({ licenses }) => setExpiringLicenses([...licenses].sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1))))
        .catch(() => {});
    }
    if (canViewQuotes) {
      api.quoteRequests
        .list(token, { status: 'pending' })
        .then(({ requests }) => setPendingRequests(requests))
        .catch(() => {});
    }
  }, [token, canViewInvoices, canViewLicenses, canViewQuotes]);

  useEffect(refresh, [refresh]);

  return (
    <NotificationsContext.Provider
      value={{
        overdueInvoices,
        expiringLicenses,
        pendingRequests,
        refresh,
        canViewInvoices,
        canViewLicenses,
        canViewQuotes,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
