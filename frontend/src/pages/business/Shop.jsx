import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import StatusFilterChips from '../../components/StatusFilterChips';
import ProductsTab from './shop/ProductsTab';
import OrdersTab from './shop/OrdersTab';
import PromotionsTab from './shop/PromotionsTab';
import CategoriesTab from './shop/CategoriesTab';
import SettingsTab from './shop/SettingsTab';

const SHOP_URL = 'https://shop.edusolutionsmv.com';

// Staff admin for the retail shop on shop.edusolutionsmv.com: catalogue and
// pictures, orders, flash banners (shop + main site + email), categories and
// shop settings. All under the `shop` permission.
export default function Shop() {
  const { token, can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'products';
  const [stats, setStats] = useState(null);
  const [categories, setCategories] = useState([]);
  const canManage = can('shop', 'manage');

  const refreshStats = useCallback(() => { api.shop.stats(token).then(setStats).catch(() => {}); }, [token]);
  const loadCats = useCallback(() => { api.shop.categories(token).then((r) => setCategories(r.categories)).catch(() => {}); }, [token]);
  useEffect(() => { if (can('shop', 'view')) { refreshStats(); loadCats(); } }, [can, refreshStats, loadCats]);

  if (!can('shop', 'view')) return <div className="px-4 py-10 text-slate-600">You don't have permission to view the shop.</div>;

  const tabs = [
    { value: 'products', label: 'Products' },
    { value: 'orders', label: stats?.newOrders ? `Orders (${stats.newOrders} new)` : 'Orders' },
    { value: 'promotions', label: 'Flash banners' },
    { value: 'categories', label: 'Categories' },
    { value: 'settings', label: 'Settings' },
  ];

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Shop</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Your retail store at <a className="font-semibold text-lagoon-700 underline dark:text-lagoon-300" href={SHOP_URL} target="_blank" rel="noreferrer">shop.edusolutionsmv.com</a>.</p>
        </div>
        {stats && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span><b className="text-slate-900 dark:text-white">{stats.visible}</b> live products</span>
            <span><b className="text-slate-900 dark:text-white">{stats.onSale}</b> on sale</span>
            <span><b className={stats.withoutPicture ? 'text-amber-600' : 'text-slate-900 dark:text-white'}>{stats.withoutPicture}</b> without picture</span>
            <span><b className="text-slate-900 dark:text-white">{stats.openOrders}</b> open orders</span>
          </div>
        )}
      </div>
      <div className="mt-5 overflow-x-auto"><StatusFilterChips options={tabs} value={tab} onChange={(v) => setSp({ tab: v })} /></div>
      <div className="mt-5">
        {tab === 'products' && <ProductsTab token={token} canManage={canManage} categories={categories} refreshStats={refreshStats} />}
        {tab === 'orders' && <OrdersTab token={token} canManage={canManage} canInvoice={can('invoices', 'manage') && can('clients', 'manage')} refreshStats={refreshStats} />}
        {tab === 'promotions' && <PromotionsTab token={token} canManage={canManage} />}
        {tab === 'categories' && <CategoriesTab token={token} canManage={canManage} categories={categories} reload={loadCats} />}
        {tab === 'settings' && <SettingsTab token={token} canManage={canManage} />}
      </div>
    </div>
  );
}
