/** One viewing's measurements, in integer milliseconds. */
export type PlaybackQuality = {
  /** When the viewer asked to play; null until they, or autoplay, did. */
  readonly requestedAtMs: number | null;
  readonly startupMs: number | null;
  /** When the current stall began; null while playing or before the start. */
  readonly stalledAtMs: number | null;
  readonly rebufferMs: number;
  /** When the current stretch of watching began; null when not watching. */
  readonly watchingSinceMs: number | null;
  readonly watchedMs: number;
  readonly height: number;
};

export type PlaybackEvent =
  | { readonly type: 'requested'; readonly atMs: number }
  | { readonly type: 'playing'; readonly atMs: number }
  | { readonly type: 'stalled'; readonly atMs: number }
  | { readonly type: 'paused'; readonly atMs: number }
  | { readonly type: 'height'; readonly height: number };

export const initialPlaybackQuality: PlaybackQuality = {
  requestedAtMs: null,
  startupMs: null,
  stalledAtMs: null,
  rebufferMs: 0,
  watchingSinceMs: null,
  watchedMs: 0,
  height: 0,
};

const closeWatching = (
  state: PlaybackQuality,
  atMs: number,
): PlaybackQuality =>
  state.watchingSinceMs === null
    ? state
    : {
        ...state,
        watchedMs: state.watchedMs + (atMs - state.watchingSinceMs),
        watchingSinceMs: null,
      };

const closeStall = (state: PlaybackQuality, atMs: number): PlaybackQuality =>
  state.stalledAtMs === null
    ? state
    : {
        ...state,
        rebufferMs: state.rebufferMs + (atMs - state.stalledAtMs),
        stalledAtMs: null,
      };

/** A viewing's measurements after one player event. Pure and total. */
export const nextPlaybackQuality = (
  state: PlaybackQuality,
  event: PlaybackEvent,
): PlaybackQuality => {
  switch (event.type) {
    case 'requested':
      return state.requestedAtMs === null || state.startupMs === null
        ? { ...state, requestedAtMs: event.atMs }
        : state;
    case 'playing': {
      const startupMs =
        state.startupMs ??
        (state.requestedAtMs === null ? 0 : event.atMs - state.requestedAtMs);
      return {
        ...closeStall(state, event.atMs),
        startupMs,
        watchingSinceMs: state.watchingSinceMs ?? event.atMs,
      };
    }
    case 'stalled':
      // A stall before the first frame is startup, already measured.
      return state.startupMs === null
        ? state
        : {
            ...closeWatching(state, event.atMs),
            stalledAtMs: state.stalledAtMs ?? event.atMs,
          };
    case 'paused':
      return closeStall(closeWatching(state, event.atMs), event.atMs);
    case 'height':
      return { ...state, height: Math.max(state.height, event.height) };
  }
};

/** What leaves for the WATCH-3 targets when a viewing ends; null if nothing played. */
export const playbackReport = (state: PlaybackQuality, atMs: number) => {
  const closed = closeStall(closeWatching(state, atMs), atMs);
  return closed.startupMs === null
    ? null
    : {
        startup_ms: Math.round(closed.startupMs),
        rebuffer_ms: Math.round(closed.rebufferMs),
        watched_ms: Math.round(closed.watchedMs),
        height: closed.height,
      };
};
