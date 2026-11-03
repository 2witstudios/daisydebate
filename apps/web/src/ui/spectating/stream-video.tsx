'use client';
import type { BroadcastStream } from '@daisy/protocol';
import { useEffect, useRef, type RefObject } from 'react';
import { trackClient } from '../../features/analytics/client-adapter';
import { browserDocument } from '../round-media/browser-document';
import {
  initialPlaybackQuality,
  nextPlaybackQuality,
  playbackReport,
  type PlaybackEvent,
} from './playback-quality';
import {
  attachStream,
  browserHlsSupport,
  chooseStreamEngine,
} from './stream-source';

export type StreamVideoProps = {
  readonly stream: Pick<BroadcastStream, 'path' | 'manifestUrl'>;
  /** What this is, for a screen reader. */
  readonly label: string;
  /** The one analytics event this viewing reports under. */
  readonly surface: 'broadcast_playback' | 'recording_playback';
  /** A live stream starts itself; a replay waits to be asked. */
  readonly autoPlay: boolean;
  /** True when this document's browser policy cannot play this page's stream. */
  readonly documentStale: (
    documentUrl: string | undefined,
    path: string,
  ) => boolean;
  readonly videoRef?: RefObject<HTMLVideoElement | null>;
  readonly onFinished?: () => void;
  readonly onFailed: () => void;
  /** Playback crossed a stretch that was never published. */
  readonly onCaptureJump?: () => void;
};

/**
 * The one accessible player: the browser's own controls, which every keyboard and
 * screen reader already knows, on whichever engine this browser needs. It holds
 * no connection to the debate and asks for no device. A Broadcast and a replay
 * differ in what surrounds it, never in how it plays. Key it by its stream, so
 * one instance plays one stream.
 */
export function StreamVideo({
  stream,
  label,
  surface,
  autoPlay,
  documentStale,
  videoRef,
  onFinished,
  onFailed,
  onCaptureJump,
}: StreamVideoProps) {
  const own = useRef<HTMLVideoElement>(null);
  const video = videoRef ?? own;
  const latest = useRef({
    onFinished,
    onFailed,
    onCaptureJump,
    documentStale,
    surface,
  });
  useEffect(() => {
    latest.current = {
      onFinished,
      onFailed,
      onCaptureJump,
      documentStale,
      surface,
    };
  });
  const { path, manifestUrl } = stream;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (
      latest.current.documentStale(
        browserDocument().url,
        window.location.pathname,
      )
    ) {
      window.location.reload();
      return;
    }
    const engine = chooseStreamEngine(browserHlsSupport(element));
    if (engine === null) {
      latest.current.onFailed();
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
      ['ended', () => latest.current.onFinished?.()],
    ];
    for (const [name, listener] of listeners)
      element.addEventListener(name, listener);
    const report = () => {
      const measured = playbackReport(quality, at());
      if (measured === null) return;
      quality = initialPlaybackQuality;
      trackClient({
        event: latest.current.surface,
        properties: { engine, ...measured },
      });
    };
    window.addEventListener('pagehide', report);
    const detach = attachStream(element, { path, manifestUrl }, engine, {
      // A refused autoplay leaves the controls for the viewer to press.
      onReady: () => {
        if (autoPlay) void element.play().catch(() => undefined);
      },
      onFailed: () => latest.current.onFailed(),
      onCaptureJump: () => latest.current.onCaptureJump?.(),
    });
    return () => {
      report();
      window.removeEventListener('pagehide', report);
      for (const [name, listener] of listeners)
        element.removeEventListener(name, listener);
      detach();
    };
  }, [autoPlay, manifestUrl, path, video]);
  return (
    <video
      ref={video}
      controls
      playsInline
      aria-label={label}
      className="aspect-video w-full rounded-xl bg-surface-stage shadow-2"
    />
  );
}
