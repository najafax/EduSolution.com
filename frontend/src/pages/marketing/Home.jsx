import { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import MarketingLayout from './MarketingLayout';
import { CheckCircleIcon, GraduationCapIcon, ProductIcon } from '../../components/icons';

// The public marketing site's front page — replaces the old behavior where
// '/' rendered the same Login component as '/login' (see pages/Login.jsx's
// own history note). Login itself is unchanged and still lives at '/login'
// only; this is genuinely new, real marketing content, not a repurposed
// login screen.
export default function Home() {
  const { token, loading } = useAuth();
  const [content, setContent] = useState(null);

  useEffect(() => {
    api.public
      .getSiteContent()
      .then(setContent)
      .catch(() => {});
  }, []);

  // Same "already signed in, nothing left to do here" redirect Login.jsx
  // itself used to apply at this exact path.
  if (!loading && token) return <Navigate to="/dashboard" replace />;

  const posts = content?.posts?.slice(0, 3) || [];
  const testimonials = content?.testimonials?.slice(0, 2) || [];

  return (
    <MarketingLayout>
      {/* HERO */}
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-24">
        <div className="flex flex-col gap-6">
          <span className="font-display inline-flex w-fit items-center gap-2 rounded-full bg-lagoon-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
            Technology for the Maldives
          </span>
          <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            Run your school or business without the paperwork
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-slate-600 dark:text-slate-400">
            Edu Solutions pairs EduPage's school management platform with our own Business Suite for quotes, invoicing and
            payments — one local partner, two proven platforms.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="#contact"
              className="min-h-11 rounded-lg bg-lagoon-600 px-6 py-3 text-sm font-bold text-white hover:bg-lagoon-500"
            >
              Talk to our team
            </a>
            <Link
              to="/services"
              className="min-h-11 rounded-lg border border-slate-300 px-6 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              See what we do
            </Link>
          </div>
          <div className="flex items-center gap-2 pt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
            <CheckCircleIcon width={16} height={16} className="text-lagoon-600 dark:text-lagoon-400" />
            Authorized EduPage distributor in the Maldives
          </div>
        </div>

        <div className="relative overflow-hidden rounded-3xl bg-lagoon-950 p-6 shadow-xl sm:p-8">
          <div className="rounded-2xl bg-white/95 p-5 shadow-lg dark:bg-slate-900/95">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Invoiced</p>
                <p className="font-display text-base font-extrabold text-lagoon-700 dark:text-lagoon-400">MVR 84.2k</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Collected</p>
                <p className="font-display text-base font-extrabold text-slate-900 dark:text-white">MVR 71.1k</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Outstanding</p>
                <p className="font-display text-base font-extrabold text-red-600 dark:text-red-400">MVR 13.2k</p>
              </div>
            </div>
            <div className="mt-3 flex h-24 items-end gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              {[40, 62, 48, 80, 58, 70].map((h, i) => (
                <div key={i} className="w-full rounded bg-lagoon-500" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/95 px-4 py-3 text-sm font-bold text-lagoon-900 shadow dark:bg-slate-900/95 dark:text-lagoon-200">
            <GraduationCapIcon width={18} height={18} className="text-lagoon-600 dark:text-lagoon-400" />
            EduPage Certified Partner
          </div>
        </div>
      </div>

      {/* TWO WAYS WE HELP */}
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="font-display max-w-lg text-3xl font-bold text-slate-900 dark:text-white">Two ways we help</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-7 dark:bg-slate-900">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lagoon-600">
              <GraduationCapIcon width={22} height={22} className="text-white" />
            </div>
            <h3 className="font-display mt-4 text-lg font-bold text-slate-900 dark:text-white">EduPage for Schools</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Timetabling, attendance, digital class registers, homework and e-learning — supported locally.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-7 dark:bg-slate-900">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lagoon-600">
              <ProductIcon width={22} height={22} className="text-white" />
            </div>
            <h3 className="font-display mt-4 text-lg font-bold text-slate-900 dark:text-white">Edu Solutions Business Suite</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Quotes, invoices, payments, recurring billing and financial reporting, built for how Maldivian businesses get
              paid.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-7 dark:bg-slate-900">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lagoon-600">
              <CheckCircleIcon width={22} height={22} className="text-white" />
            </div>
            <h3 className="font-display mt-4 text-lg font-bold text-slate-900 dark:text-white">Support &amp; Onboarding</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Setup, staff training and ongoing local support, included rather than billed as an extra.
            </p>
          </div>
        </div>
      </div>

      {/* NEWS — only once there's something published */}
      {posts.length > 0 && (
        <div className="border-y border-slate-200 bg-slate-50 py-16 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">From Edu Solutions</h2>
              <Link to="/news" className="font-display text-sm font-bold text-lagoon-600 hover:text-lagoon-500 dark:text-lagoon-400">
                View all →
              </Link>
            </div>
            <div className="mt-8 grid gap-5 sm:grid-cols-3">
              {posts.map((post) => (
                <div key={post.id} className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-900">
                  <div className="h-24 bg-gradient-to-br from-lagoon-500 to-lagoon-700" />
                  <div className="p-5">
                    {post.category && (
                      <span className="font-display text-xs font-bold uppercase tracking-wide text-lagoon-600 dark:text-lagoon-400">
                        {post.category}
                      </span>
                    )}
                    <h3 className="font-display mt-1.5 text-base font-bold leading-snug text-slate-900 dark:text-white">{post.title}</h3>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TESTIMONIALS — only once there's something published */}
      {testimonials.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">What partners say</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {testimonials.map((t) => (
              <div key={t.id} className="rounded-2xl bg-lagoon-50 p-8 dark:bg-lagoon-950/40">
                <p className="text-lg italic leading-relaxed text-slate-800 dark:text-slate-200">&ldquo;{t.quote}&rdquo;</p>
                {(t.author_name || t.author_role) && (
                  <p className="font-display mt-4 text-sm font-bold text-slate-600 dark:text-slate-400">
                    — {[t.author_name, t.author_role].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div id="contact" className="bg-lagoon-950 px-4 py-16 text-center sm:px-6 lg:px-8">
        <h2 className="font-display mx-auto max-w-lg text-3xl font-bold text-white">Ready to see it for yourself?</h2>
        <p className="mx-auto mt-3 max-w-md text-slate-300">
          Book a short walkthrough and we'll show you exactly how EduPage or the Business Suite would fit your team.
        </p>
        {content?.settings?.email ? (
          <a
            href={`mailto:${content.settings.email}`}
            className="mt-6 inline-block min-h-11 rounded-lg bg-white px-6 py-3 text-sm font-bold text-lagoon-900 hover:bg-lagoon-50"
          >
            Book a walkthrough
          </a>
        ) : (
          <p className="mt-6 text-sm text-lagoon-200">{content?.settings?.phone || ''}</p>
        )}
      </div>
    </MarketingLayout>
  );
}
