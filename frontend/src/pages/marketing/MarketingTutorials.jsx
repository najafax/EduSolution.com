import { useEffect, useState } from 'react';
import MarketingLayout from './MarketingLayout';
import VideoThumbnail from '../../components/VideoThumbnail';
import { api } from '../../lib/api';

export default function MarketingTutorials() {
  const [videos, setVideos] = useState(null);

  useEffect(() => {
    api.public
      .getSiteContent()
      .then((data) => setVideos(data.videos || []))
      .catch(() => setVideos([]));
  }, []);

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <span className="font-display inline-flex items-center gap-2 rounded-full bg-lagoon-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
          Tutorials
        </span>
        <h1 className="font-display mt-5 text-4xl font-extrabold text-slate-900 dark:text-white">Watch &amp; learn</h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Walkthroughs for EduPage — tap a video to open it.
        </p>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        {videos === null ? (
          <div className="grid gap-5 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="aspect-video animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <p className="text-center text-slate-500 dark:text-slate-400">No tutorials published yet — check back soon.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-3">
            {videos.map((video) => (
              <div key={video.id}>
                <VideoThumbnail video={video} />
                <div className="mt-3">
                  {video.category && (
                    <span className="font-display text-xs font-bold uppercase tracking-wide text-lagoon-600 dark:text-lagoon-400">
                      {video.category}
                    </span>
                  )}
                  <h2 className="font-display mt-1 text-base font-bold leading-snug text-slate-900 dark:text-white">{video.title}</h2>
                  {video.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{video.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MarketingLayout>
  );
}
