'use client';
import type { BroadcastStream, SpectatorTimeline } from '@daisy/protocol';
import { useEffect, useRef, useState } from 'react';
import { trackClient } from '../../features/analytics/client-adapter';
import { broadcastDocumentStale } from '../../features/spectating/browser-policy';
import { browserDocument } from '../round-media/browser-document';
import {
  initialPlaybackQuality,
  nextPlaybackQuality,
  playbackReport,
  type PlaybackEvent,
} from './playback-quality';
import { sideLabel } from './spectator-timeline-copy';
import {
  attachStream,
  browserHlsSupport,
  chooseStreamEngine,
} from './stream-source';

export type BroadcastPlayerProps = {
  readonly stream: BroadcastStream;
  /** Ranked only (DEC-301): the snapshot carries none on any other Round. */
  readonly captions: SpectatorTimeline['captions'];
  readonly onFinished: () => void;
  readonly onFailed: () => void;
};

/**
 * The accessible player: the browser's own controls, which every keyboard and
 * screen reader already knows, on whichever engine this browser needs. Captions
 * are the released snapshot's latest line, beneath the video where they cover nothing. It holds no
 * connection to the debate and asks for no device.
 */
export function BroadcastPlayer({
  stream,
  captions,
  onFinished,
  onFailed,
}: BroadcastPlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  // The viewer keys this player by its stream, so one instance plays one stream.
  const [source] = useState(stream);
  const [showCaptions, setShowCaptions] = useState(true);
  const handlers = useRef({ onFinished, onFailed });
  useEffect(() => {
    handlers.current = { onFinished, onFailed };
  });
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (
      broadcastDocumentStale(browserDocument().url, window.location.pathname)
    ) {
      window.location.reload();
      return;
    }
    const engine = chooseStreamEngine(browserHlsSupport(element));
    if (engine === null) {
      handlers.current.onFailed();
      return;
    }
    let quality = initialPlaybackQuality;
    const note = (event: PlaybackEvent) => {
      quality = nextPlaybackQuality(quality, event);
    };
    const at = () => Math.round(performance.now());
    const listeners: readonly (readonly [string, () => void])[] = [
      ['play', () => note({ type: 'requested', atMs: at() })],
      ['playing', () => note({ type: 'playing', atMs: at() })],
      ['waiting', () => note({ type: 'stalled', atMs: at() })],
      ['pause', () => note({ type: 'paused', atMs: at() })],
      ['resize', () => note({ type: 'height', height: element.videoHeight })],
      ['ended', () => handlers.current.onFinished()],
    ];
    for (const [name, listener] of listeners)
      element.addEventListener(name, listener);
    const report = () => {
      const measured = playbackReport(quality, at());
      if (measured === null) return;
      quality = initialPlaybackQuality;
      trackClient({
        event: 'broadcast_playback',
        properties: { engine, ...measured },
      });
    };
    window.addEventListener('pagehide', report);
    const detach = attachStream(element, source, engine, {
      // A refused autoplay leaves the controls for the viewer to press.
      onReady: () => void element.play().catch(() => undefined),
      onFailed: () => handlers.current.onFailed(),
    });
    return () => {
      report();
      window.removeEventListener('pagehide', report);
      for (const [name, listener] of listeners)
        element.removeEventListener(name, listener);
      detach();
    };
  }, [source]);
  const caption = captions.at(-1);
  return (
    <div className="flex flex-col gap-2">
      <video
        ref={video}
        controls
        playsInline
        aria-label="Broadcast of this debate"
        className="aspect-video w-full rounded-xl bg-surface-stage shadow-2"
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
