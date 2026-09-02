import { useEffect, useState } from 'react';
import MarketingLayout from './MarketingLayout';
import { api } from '../../lib/api';

export default function MarketingAbout() {
  const [team, setTeam] = useState(null);
  const [gallery, setGallery] = useState(null);

  useEffect(() => {
    api.public
      .getSiteContent()
      .then((data) => {
        setTeam(data.team || []);
        setGallery(data.gallery || []);
      })
      .catch(() => {
        setTeam([]);
        setGallery([]);
      });
  }, []);

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <span className="font-display inline-flex items-center gap-2 rounded-full bg-lagoon-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
          About us
        </span>
        <h1 className="font-display mt-5 text-4xl font-extrabold text-slate-900 dark:text-white">The people behind Edu Solutions</h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Based in the Maldives, supporting the schools and businesses we work with in person.
        </p>
      </div>

      {/* TEAM */}
      <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6 lg:px-8">
        {team === null ? (
          <div className="grid gap-5 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
            ))}
          </div>
        ) : team.length === 0 ? (
          <p className="text-center text-slate-500 dark:text-slate-400">Meet the team — coming soon.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-3">
            {team.map((m) => (
              <div key={m.id} className="flex flex-col items-center gap-3 rounded-2xl bg-slate-50 p-7 text-center dark:bg-slate-900">
                {m.photo ? (
                  <img src={m.photo} alt="" className="h-20 w-20 rounded-full object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-lagoon-600">
                    <span className="font-display text-xl font-bold text-white">{m.name.slice(0, 2).toUpperCase()}</span>
                  </div>
                )}
                <div>
                  <p className="font-display text-base font-bold text-slate-900 dark:text-white">{m.name}</p>
                  {m.role && <p className="text-sm text-slate-600 dark:text-slate-400">{m.role}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* GALLERY */}
      {gallery && gallery.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">Gallery</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {gallery.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                <img src={item.image} alt={item.caption} className="aspect-square w-full object-cover" />
                {item.caption && <p className="truncate px-2 py-1.5 text-xs text-slate-600 dark:text-slate-400">{item.caption}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-lagoon-950 px-4 py-16 text-center sm:px-6 lg:px-8">
        <h2 className="font-display mx-auto max-w-lg text-3xl font-bold text-white">Want to work with us?</h2>
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
