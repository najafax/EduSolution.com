import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import MarketingLayout from './MarketingLayout';

export default function MarketingTestimonials() {
  const [testimonials, setTestimonials] = useState(null);

  useEffect(() => {
    api.public
      .getSiteContent()
      .then((data) => setTestimonials(data.testimonials || []))
      .catch(() => setTestimonials([]));
  }, []);

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <span className="font-display inline-flex items-center gap-2 rounded-full bg-lagoon-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
          Testimonials
        </span>
        <h1 className="font-display mt-5 text-4xl font-extrabold text-slate-900 dark:text-white">What partners across the Maldives say</h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">A few words from the schools and businesses we work with every day.</p>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        {testimonials === null ? (
          <div className="grid gap-5 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
            ))}
          </div>
        ) : testimonials.length === 0 ? (
          <p className="text-center text-slate-500 dark:text-slate-400">No testimonials published yet — check back soon.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-3">
            {testimonials.map((t) => (
              <div key={t.id} className="flex flex-col gap-4 rounded-2xl bg-slate-50 p-7 dark:bg-slate-900">
                {t.category && (
                  <span className="font-display w-fit rounded-full bg-lagoon-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                    {t.category}
                  </span>
                )}
                <p className="flex-1 text-base italic leading-relaxed text-slate-800 dark:text-slate-200">&ldquo;{t.quote}&rdquo;</p>
                {(t.author_name || t.author_role) && (
                  <p className="font-display text-xs font-bold text-slate-600 dark:text-slate-400">
                    — {[t.author_name, t.author_role].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-lagoon-950 px-4 py-16 text-center sm:px-6 lg:px-8">
        <h2 className="font-display mx-auto max-w-lg text-3xl font-bold text-white">Want to be the next story here?</h2>
        <p className="mx-auto mt-3 max-w-md text-slate-300">
          Book a short walkthrough and we'll show you exactly how EduPage or the Business Suite would fit your team.
        </p>
        <a href="/#contact" className="mt-6 inline-block min-h-11 rounded-lg bg-white px-6 py-3 text-sm font-bold text-lagoon-900 hover:bg-lagoon-50">
          Book a walkthrough
        </a>
      </div>
    </MarketingLayout>
  );
}
