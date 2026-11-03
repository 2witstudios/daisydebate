import type { RoundMediaState } from '@daisy/protocol';
import type {
  LiveConnection,
  MediaState,
  PendingAnswer,
  RecoveryPace,
} from './media-state';
import { SOURCES } from './media-state';
import {
  cancel,
  prepend,
  schedule,
  withLive,
  withoutTimer,
  type Decision,
  type StepContext,
} from './media-step';
import { startNextRead } from './read-start';
import { convergeSources, desiredSources, holdsAnswer } from './reduce-sources';

/** A seat's answer is current again: anything waiting to wake is settled too. */
const answered = (
  live: LiveConnection,
  answer: RoundMediaState,
): LiveConnection => ({
  ...live,
  establishment: {
    stage: 'established',
    media: answer,
    freshness: { status: 'current' },
  },
  reads: { ...live.reads, supersededSinceAnswer: 0 },
});

const heldSince = (recovery: RecoveryPace, atMs: number): RecoveryPace => ({
  ...recovery,
  heldSinceMs: recovery.heldSinceMs ?? atMs,
});

/** Starts applying an answer; the sources move toward what it grants. */
export const beginApply = (
  state: MediaState,
  live: LiveConnection,
  pending: PendingAnswer,
  ctx: StepContext,
): Decision => {
  const converged = convergeSources(
    {
      ...live,
      grants: pending.answer.grants.publish,
      apply: { ...pending, next: null },
    },
    desiredSources(live),
    state.devices === 'defaults',
    ctx.atMs,
  );
  return prepend(converged.effects, settleApply(state, converged.live, ctx));
};

/** The answer applies once no source holds it. Only one still current announces. */
export const settleApply = (
  state: MediaState,
  live: LiveConnection,
  ctx: StepContext,
): Decision => {
  const running = live.apply;
  if (!running) return startNextRead(state, live, ctx.atMs);
  if (SOURCES.some((name) => holdsAnswer(live.sources[name]))) {
    // Any prompt holding an answer has a patience, however it came to open.
    const owed =
      state.timers['capture-patience'] === undefined &&
      SOURCES.some(
        (name) =>
          holdsAnswer(live.sources[name]) &&
          live.sources[name].phase === 'capturing',
      );
    return {
      state: withLive(state, live),
      effects: [
        ...(owed
          ? [schedule('capture-patience', ctx.policy.capturePatienceMs)]
          : []),
        // However it began, SDK work holding an answer ends in saying so.
        ...(state.timers['read-budget'] === undefined
          ? [schedule('read-budget', ctx.policy.readBudgetMs)]
          : []),
      ],
    };
  }
  const finished: LiveConnection = { ...live, apply: null };
  const current = running.generation === state.intent.generation;
  const base: MediaState = {
    ...state,
    timers: withoutTimer(state.timers, 'capture-patience'),
    recovery: current ? heldSince(state.recovery, ctx.atMs) : state.recovery,
  };
  const next = current ? answered(finished, running.answer) : finished;
  const effects = [
    cancel('capture-patience'),
    ...(current ? [cancel('read-budget'), cancel('recovery')] : []),
  ];
  // A supersession already dropped any older answer waiting here.
  return prepend(
    effects,
    running.next
      ? beginApply(base, next, running.next, ctx)
      : startNextRead(base, next, ctx.atMs),
  );
};

/** Past patience an open prompt no longer holds the answer. */
export const patienceExpired = (
  state: MediaState,
  live: LiveConnection,
  ctx: StepContext,
): Decision => {
  const sources = { ...live.sources };
  for (const name of SOURCES)
    if (sources[name].phase === 'capturing')
      sources[name] = { phase: 'capturing', waiting: true };
  return settleApply(state, { ...live, sources }, ctx);
};
