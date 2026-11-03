import type { ProductEvent } from '../../features/analytics/events';
import {
  initialPlaybackQuality,
  nextPlaybackQuality,
  playbackReport,
  type PlaybackEvent,
} from './playback-quality';

type PlaybackSurface = 'broadcast_playback' | 'recording_playback';

/**
 * One viewing's measurements, from the player's own events to the one analytics
 * event it reports when it ends: at a page leaving or the player going, once per
 * thing watched. Holds nothing about who or what is watched. Returns the stop.
 */
export const watchPlayback = (input: {
  readonly element: EventTarget & { readonly videoHeight: number };
  readonly page: EventTarget;
  readonly engine: 'hlsjs' | 'native';
  readonly surface: () => PlaybackSurface;
  readonly nowMs: () => number;
  readonly report: (event: ProductEvent) => void;
  readonly onEnded: () => void;
}): (() => void) => {
  const { element, page, engine, nowMs } = input;
  let quality = initialPlaybackQuality;
  const note = (event: PlaybackEvent) => {
    quality = nextPlaybackQuality(quality, event);
  };
  const listeners: readonly (readonly [string, () => void])[] = [
    ['play', () => note({ type: 'requested', atMs: nowMs() })],
    ['playing', () => note({ type: 'playing', atMs: nowMs() })],
    ['waiting', () => note({ type: 'stalled', atMs: nowMs() })],
    ['pause', () => note({ type: 'paused', atMs: nowMs() })],
    ['resize', () => note({ type: 'height', height: element.videoHeight })],
    ['ended', input.onEnded],
  ];
  for (const [name, listener] of listeners)
    element.addEventListener(name, listener);
  const send = () => {
    const measured = playbackReport(quality, nowMs());
    if (measured === null) return;
    quality = initialPlaybackQuality;
    input.report({
      event: input.surface(),
      properties: { engine, ...measured },
    });
  };
  page.addEventListener('pagehide', send);
  return () => {
    send();
    page.removeEventListener('pagehide', send);
    for (const [name, listener] of listeners)
      element.removeEventListener(name, listener);
  };
};
