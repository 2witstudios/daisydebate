import type { UiState } from '../../../features/ai-debate/context';

// A segment's countdown and its live time share one controller, so the AI
// can prepare its words while the countdown runs.
export const keyOf = (state: UiState) => {
  if (state.phase === 'live' || state.phase === 'countdown')
    return `segment-${state.segmentIndex}`;
  if (state.phase === 'prep') return `prep-${state.segmentIndex}`;
  return state.phase;
};

export const hasSegment = (
  state: UiState,
): state is Extract<UiState, { phase: 'live' | 'countdown' }> =>
  state.phase === 'live' || state.phase === 'countdown';

type SegmentTurn = {
  readonly key: string;
  readonly controller: AbortController | null;
  readonly goLive: () => void;
  /** Controller cleanup, including the AI's persisted playback cutoff. */
  readonly done: Promise<void>;
  wentLive: boolean;
  /** Wraps the segment up early, when its controller registered how. */
  finish: (() => Promise<void>) | null;
};

export const idle = (key: string): SegmentTurn => ({
  key,
  controller: null,
  goLive: () => undefined,
  done: Promise.resolve(),
  wentLive: false,
  finish: null,
});
