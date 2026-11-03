import type { MediaEffect, MediaTimer } from './media-effects';
import type { LiveConnection, MediaPolicy, MediaState } from './media-state';

/** An effect as a decision plans it: a schedule gets its identity when the step ends. */
export type PlannedEffect =
  | Exclude<MediaEffect, { readonly type: 'schedule' }>
  | Omit<Extract<MediaEffect, { readonly type: 'schedule' }>, 'id'>;
export type Decision = {
  readonly state: MediaState;
  readonly effects: readonly PlannedEffect[];
};
export type StepContext = {
  readonly atMs: number;
  readonly policy: MediaPolicy;
};

/** The event does not apply here: the same state object, and nothing asked. */
export const rejected = (state: MediaState): Decision => ({
  state,
  effects: [],
});
/** The state moved and nothing needs doing in the world. */
export const moved = (state: MediaState): Decision => ({ state, effects: [] });

export const withLive = (
  state: MediaState,
  live: LiveConnection,
): MediaState => ({ ...state, link: live });

export const schedule = (timer: MediaTimer, ms: number): PlannedEffect => ({
  type: 'schedule',
  timer,
  ms,
});
export const cancel = (timer: MediaTimer): PlannedEffect => ({
  type: 'cancel',
  timer,
});

export const withoutTimer = (
  timers: MediaState['timers'],
  timer: MediaTimer,
): MediaState['timers'] => {
  const kept = { ...timers };
  delete kept[timer];
  return kept;
};

export const prepend = (
  effects: readonly PlannedEffect[],
  step: Decision,
): Decision => ({ state: step.state, effects: [...effects, ...step.effects] });
