import type { BroadcastStream, SpectatorTimeline } from '@daisy/protocol';

/** A shown notice beside a playing video. */
type PlayerNotice = 'slate' | 'interrupted' | null;

/** What the viewer's main area shows: a player, or the honest state instead of one. */
export type ViewerScreen =
  | {
      readonly kind: 'player';
      readonly stream: BroadcastStream;
      readonly notice: PlayerNotice;
    }
  | { readonly kind: 'upcoming' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'unplayable' }
  | { readonly kind: 'no-broadcast' }
  | {
      readonly kind: 'ended';
      readonly recording: SpectatorTimeline['recording'];
      readonly preparation?: SpectatorTimeline['recordingPreparation'];
    };

export type ViewerPlayback = {
  /** The stream this viewing is on, kept so its final seconds play out. */
  readonly stream: BroadcastStream | null;
  /** The video reached the stream's end. */
  readonly finished: boolean;
  /** The engine gave up, or this browser has none. */
  readonly failed: boolean;
};

/**
 * One rule from the released snapshot and this viewing to the screen. A stop
 * or a refusal ends playback at once; a normal end lets the viewer finish the
 * seconds they are behind by, since nothing past release can reach them.
 */
export const viewerScreenOf = (
  timeline: SpectatorTimeline,
  playback: ViewerPlayback,
): ViewerScreen => {
  const { broadcast, stage, recording, recordingPreparation } = timeline;
  const ended = {
    kind: 'ended',
    recording,
    ...(recordingPreparation ? { preparation: recordingPreparation } : {}),
  } as const;
  switch (broadcast.state) {
    case 'stopped':
      return { kind: 'stopped' };
    case 'failed':
      return { kind: 'failed' };
    case 'none':
      return stage.kind === 'ended' ? ended : { kind: 'no-broadcast' };
    case 'starting':
      return stage.kind === 'upcoming'
        ? { kind: 'upcoming' }
        : { kind: 'starting' };
    case 'ended':
      return playback.stream && !playback.finished && !playback.failed
        ? { kind: 'player', stream: playback.stream, notice: null }
        : ended;
    case 'on_air':
    case 'interrupted': {
      if (stage.kind === 'upcoming') return { kind: 'upcoming' };
      if (broadcast.stream === null) return { kind: 'interrupted' };
      if (playback.failed) return { kind: 'unplayable' };
      const notice =
        broadcast.state === 'interrupted'
          ? 'interrupted'
          : stage.kind === 'slate'
            ? 'slate'
            : null;
      return { kind: 'player', stream: broadcast.stream, notice };
    }
  }
};

/**
 * The feed a streamer may carry now: the one this audience plays. It goes when a
 * stop or the end takes the stream from the snapshot, so it has no rule of its own.
 */
export const streamableFeedOf = (
  timeline: SpectatorTimeline,
): string | null => {
  const { broadcast, stage } = timeline;
  if (stage.kind === 'upcoming') return null;
  return broadcast.state === 'on_air' || broadcast.state === 'interrupted'
    ? (broadcast.stream?.manifestUrl ?? null)
    : null;
};

/** Polling ends once nothing about this Round can change for its audience. */
export const viewerSettled = (timeline: SpectatorTimeline): boolean =>
  (timeline.broadcast.state === 'stopped' ||
    timeline.broadcast.state === 'failed' ||
    timeline.broadcast.state === 'ended' ||
    timeline.broadcast.state === 'none') &&
  timeline.stage.kind === 'ended' &&
  timeline.recording !== 'processing';

/**
 * The worker stopped publishing: the object stands still, so what it says about the
 * present no longer holds. Late is honest; a viewer is told, never shown a stale
 * "on air". The clock is the tab's own, so no two machines have to agree.
 */
export const PUBLISHING_STALE_AFTER_MS = 30_000;
export const timelineAsOf = (
  timeline: SpectatorTimeline,
  sinceMovedMs: number,
): SpectatorTimeline =>
  sinceMovedMs > PUBLISHING_STALE_AFTER_MS &&
  timeline.broadcast.state === 'on_air'
    ? {
        ...timeline,
        broadcast: { state: 'interrupted', stream: timeline.broadcast.stream },
      }
    : timeline;
