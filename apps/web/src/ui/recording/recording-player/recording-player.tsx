'use client';
import { useRef, useState } from 'react';
import { recordingDocumentStale } from '../../../features/recording/browser-policy';
import type { RecordingMediaPanel } from '../../../features/recording/history';
import { StateCard } from '../../watch/state-card/state-card';
import { StreamVideo } from '../../spectating/stream-video';
import {
  clockTime,
  gapCopy,
  privateCopy,
  RECORDING_SPEEDS,
  unrecordedCopy,
} from './recording-player-copy';

type Watchable = Extract<RecordingMediaPanel, { state: 'watch' }>;

/**
 * A Recording on the one player, with what a replay adds: speed, a speech timeline
 * that seeks, and a plain statement of any debate the video does not hold, apart
 * from what is kept private by design. The slate between speeches is not listed.
 * Seeking and volume are the browser's own controls.
 */
export function RecordingPlayer({ media }: { readonly media: Watchable }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const seek = (ms: number) => {
    if (video.current) video.current.currentTime = ms / 1000;
  };
  if (failed)
    return <StateCard icon="alert" title="This video could not be played" />;
  const { lost, keptPrivate: kept } = media;
  return (
    <div className="flex flex-col gap-3">
      <StreamVideo
        key={media.playlistHref}
        videoRef={video}
        stream={{ path: 'owned_hls', manifestUrl: media.playlistHref }}
        label="Recording of this debate"
        surface="recording_playback"
        autoPlay={false}
        documentStale={recordingDocumentStale}
        onFailed={() => setFailed(true)}
      />
      <label className="flex items-center gap-2 self-start text-sm text-ink-muted">
        Speed
        <select
          defaultValue="1"
          onChange={(event) => {
            if (video.current)
              video.current.playbackRate = Number(event.target.value);
          }}
          className="rounded-md border border-border bg-surface px-2 py-1 text-ink"
        >
          {RECORDING_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {`${speed}x`}
            </option>
          ))}
        </select>
      </label>
      {lost.length > 0 || media.unrecorded.length > 0 ? (
        <section
          aria-label="Missing from this recording"
          className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm"
        >
          <span className="font-strong text-ink">
            Parts of this debate were not recorded
          </span>
          <ul className="text-ink-muted">
            {media.unrecorded.map((part) => (
              <li key={part.part}>{unrecordedCopy(part)}</li>
            ))}
            {lost.map((gap) => (
              <li key={gap.startMs}>{gapCopy(gap)}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {kept.length > 0 ? (
        <p className="text-sm text-ink-muted">{privateCopy(kept)}</p>
      ) : null}
      {media.speeches.length > 0 ? (
        <nav aria-label="Speech timeline">
          <ol className="flex flex-col divide-y divide-border">
            {media.speeches.map((speech) => (
              <li key={`${speech.startMs}-${speech.speaker}`}>
                <button
                  type="button"
                  onClick={() => seek(speech.startMs)}
                  className="flex w-full justify-between gap-3 py-2 text-left text-sm text-ink"
                >
                  <span>{speech.speaker}</span>
                  <span className="text-ink-muted tabular-nums">
                    {`${clockTime(speech.startMs)} to ${clockTime(speech.endMs)}`}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
    </div>
  );
}
