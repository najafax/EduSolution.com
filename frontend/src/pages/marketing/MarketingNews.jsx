import { useEffect, useState } from 'react';
import MarketingLayout from './MarketingLayout';
import { api } from '../../lib/api';

export default function MarketingNews() {
  const [posts, setPosts] = useState(null);

  useEffect(() => {
    api.public
      .getSiteContent()
      .then((data) => setPosts(data.posts || []))
      .catch(() => setPosts([]));
  }, []);

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <span className="font-display inline-flex items-center gap-2 rounded-full bg-lagoon-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
          News
        </span>
        <h1 className="font-display mt-5 text-4xl font-extrabold text-slate-900 dark:text-white">From Edu Solutions</h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">Updates on EduPage, the Business Suite, and our team.</p>
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-20 sm:px-6 lg:px-8">
        {posts === null ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <p className="text-center text-slate-500 dark:text-slate-400">No posts published yet — check back soon.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {posts.map((post) => (
              <article key={post.id} className="rounded-2xl bg-slate-50 p-7 dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-3">
                  {post.category && (
                    <span className="font-display text-xs font-bold uppercase tracking-wide text-lagoon-600 dark:text-lagoon-400">{post.category}</span>
                  )}
                  {post.published_at && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">{post.published_at.slice(0, 10)}</span>
                  )}
                </div>
                <h2 className="font-display mt-2 text-xl font-bold text-slate-900 dark:text-white">{post.title}</h2>
                {post.body && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-400">{post.body}</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </MarketingLayout>
  );
}
