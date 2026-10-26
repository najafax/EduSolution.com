import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import StatusFilterChips from '../../components/StatusFilterChips';
import { PostsSection } from './website/PostsSection';
import { TestimonialsSection } from './website/TestimonialsSection';
import { ServicesSection } from './website/ServicesSection';
import { TeamSection } from './website/TeamSection';
import { GallerySection } from './website/GallerySection';
import { VideosSection } from './website/VideosSection';

// The staff-side CMS behind the public marketing site (routes/website.js /
// GET /api/public/site) — six small resources, switched by tab rather than
// six separate routed pages, since together they're one cohesive area
// ("what shows on the website") rather than six independent business
// records the way Clients/Products/Expenses etc. are. None of the lists
// below paginate or search — a marketing site's own content is inherently
// small (see routes/website.js's own top-of-file note), so the added
// machinery every other business list page carries (SearchInput,
// useDebouncedValue, Pagination) isn't worth it here.
const TABS = [
  { value: 'posts', label: 'News & announcements' },
  { value: 'testimonials', label: 'Testimonials' },
  { value: 'services', label: 'Services' },
  { value: 'team', label: 'Team' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'videos', label: 'Videos' },
];

// The fixed set of icons a service card can show on the public Services
// page (see pages/marketing/MarketingServices.jsx's own SERVICE_ICONS map,
// which must stay in sync with these keys).

export default function Website() {
  const { token, can } = useAuth();
  const canView = can('website', 'view');
  const canManage = can('website', 'manage');
  const [tab, setTab] = useState('posts');

  if (!canView) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8 xl:py-6">
        <p className="text-sm text-slate-600 dark:text-slate-400">You don't have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-10 pb-24 sm:px-6 lg:px-8">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Website content</h1>
      </div>

      <div className="mt-4">
        <StatusFilterChips options={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'posts' && <PostsSection token={token} canManage={canManage} />}
      {tab === 'testimonials' && <TestimonialsSection token={token} canManage={canManage} />}
      {tab === 'services' && <ServicesSection token={token} canManage={canManage} />}
      {tab === 'team' && <TeamSection token={token} canManage={canManage} />}
      {tab === 'gallery' && <GallerySection token={token} canManage={canManage} />}
      {tab === 'videos' && <VideosSection token={token} canManage={canManage} />}
    </div>
  );
}
