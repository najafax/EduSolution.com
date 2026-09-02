import { useState } from 'react';
import { driveThumbnailUrl } from '../lib/googleDrive';
import { PlayCircleIcon, VideoIcon } from './icons';

// The click-to-preview-then-open card behind every video tutorial — a
// thumbnail derived from the video's own Google Drive file id (see
// lib/googleDrive.js) with a play-button overlay; clicking opens the real
// Drive link in a new tab, where Drive's own player takes over playback.
// There's no JS control into Drive's embed (it's a cross-origin iframe with
// no exposed player API), so a genuine auto-playing few-second preview isn't
// achievable from a Drive link alone — this is deliberately a styled link to
// a still thumbnail, not a video element.
export default function VideoThumbnail({ video, className = '' }) {
  const [broken, setBroken] = useState(false);
  const thumb = driveThumbnailUrl(video.video_url);

  return (
    <a
      href={video.video_url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group relative block aspect-video overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-800 ${className}`}
    >
      {thumb && !broken ? (
        <img
          src={thumb}
          alt=""
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-400 dark:text-slate-600">
          <VideoIcon width={32} height={32} />
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25">
        <PlayCircleIcon width={52} height={52} className="text-white drop-shadow" />
      </div>
    </a>
  );
}
