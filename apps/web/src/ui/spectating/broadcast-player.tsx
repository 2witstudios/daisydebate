'use client';
import type { BroadcastStream, SpectatorTimeline } from '@daisy/protocol';
import { useState } from 'react';
import { broadcastDocumentStale } from '../../features/spectating/browser-policy';
import { sideLabel } from './spectator-timeline-copy';
import { StreamVideo } from './stream-video';

export type BroadcastPlayerProps = {
  readonly stream: BroadcastStream;
  /** Ranked only (DEC-301): the snapshot carries none on any other Round. */
  readonly captions: SpectatorTimeline['captions'];
  readonly onFinished: () => void;
  readonly onFailed: () => void;
};

/**
 * A Broadcast on the one player. Captions are the released snapshot's latest line,
 * beneath the video where they cover nothing.
 */
export function BroadcastPlayer({
  stream,
  captions,
  onFinished,
  onFailed,
}: BroadcastPlayerProps) {
  const [showCaptions, setShowCaptions] = useState(true);
  const caption = captions.at(-1);
  return (
    <div className="flex flex-col gap-2">
      <StreamVideo
        stream={stream}
        label="Broadcast of this debate"
        surface="broadcast_playback"
        autoPlay
        documentStale={broadcastDocumentStale}
        onFinished={onFinished}
        onFailed={onFailed}
      />
      {showCaptions && caption ? (
        <p
          data-testid="broadcast-caption"
          aria-hidden="true"
          className="rounded-md bg-surface-stage px-3 py-2 text-center text-base text-ink-on-media"
        >
          {`${sideLabel[caption.side]}: ${caption.text}`}
        </p>
      ) : null}
      {captions.length > 0 ? (
        <button
          type="button"
          aria-pressed={showCaptions}
          onClick={() => setShowCaptions((shown) => !shown)}
          className="self-start text-sm font-strong"
        >
          Captions
        </button>
      ) : null}
    </div>
  );
}
