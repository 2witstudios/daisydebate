import { join, release, teardownEffects } from './connection-lifecycle';
import type { PlannedEffect } from './media-step';
import type {
  LiveConnection,
  MediaState,
  Source,
  SourceState,
} from './media-state';
import { SOURCES } from './media-state';
import {
  cancel,
  moved,
  prepend,
  rejected,
  withLive,
  type Decision,
  type StepContext,
} from './media-step';
import { applyHoldsReads, startNextRead, wantRead } from './read-start';
import { clearOfEventFloor } from './recovery-pace';
import { showStale } from './reduce-reads';
import {
  convergeSources,
  desiredSources,
  hasHealthySource,
  hasStuckWork,
  nameStuckSources,
} from './reduce-sources';

/** A live connection whose stale answer has its read still to come. */
const wakeWaiting = (link: MediaState['link']): boolean =>
  link.phase === 'live' &&
  link.establishment.stage === 'established' &&
  link.establishment.freshness.status === 'stale' &&
  link.establishment.freshness.cause === 'transient' &&
  link.establishment.freshness.wakeArmed;

/** The pace elapsed, or an event moved it up: what was waiting now happens. */
export const attemptRecovery = (
  state: MediaState,
  ctx: StepContext,
): Decision => {
  const { link } = state;
  const recovery = { ...state.recovery, lastAttemptMs: ctx.atMs };
  if (link.phase === 'released' && link.why === 'transient')
    return join({ ...state, recovery }, true, ctx.atMs);
  if (
    !wakeWaiting(link) ||
    link.phase !== 'live' ||
    link.establishment.stage !== 'established'
  )
    return rejected(state);
  const stuck = hasStuckWork(link, ctx.atMs, ctx.policy.readBudgetMs);
  // Only a new connection escapes stuck SDK work, but it drops what is healthy. With
  // nothing healthy there is nothing to protect; otherwise Retry is the person's choice.
  if (stuck && !hasHealthySource(link))
    return prepend(
      teardownEffects(link),
      join({ ...state, recovery }, true, ctx.atMs),
    );
  const named = stuck
    ? nameStuckSources(link, ctx.atMs, ctx.policy.readBudgetMs)
    : link;
  // A read could not start: the wake stays owed, at the next step of the pace.
  if (applyHoldsReads(state, link)) {
    const armed = showStale(state, named, 'transient', ctx);
    return {
      state: withLive(armed.state, armed.live),
      effects: armed.effects,
    };
  }
  const fired: LiveConnection = {
    ...named,
    establishment: {
      ...link.establishment,
      freshness: { status: 'stale', cause: 'transient', wakeArmed: false },
    },
  };
  return prepend(
    [cancel('recovery')],
    startNextRead({ ...state, recovery }, wantRead(fired), ctx.atMs),
  );
};

export const reduceNudge = (state: MediaState, ctx: StepContext): Decision => {
  if (!clearOfEventFloor(state.recovery, ctx.atMs, ctx.policy))
    return rejected(state);
  const { link } = state;
  if (
    wakeWaiting(link) ||
    (link.phase === 'released' && link.why === 'transient')
  )
    return attemptRecovery(state, ctx);
  if (link.phase !== 'live' || link.establishment.stage !== 'established')
    return rejected(state);
  return startNextRead(
    { ...state, recovery: { ...state.recovery, lastAttemptMs: ctx.atMs } },
    wantRead(link),
    ctx.atMs,
  );
};

export const reduceRetry = (state: MediaState, ctx: StepContext): Decision => {
  const { link } = state;
  if (link.phase === 'released') {
    if (link.why === 'refused') return rejected(state);
    return prepend([{ type: 'refresh-view' }], join(state, true, ctx.atMs));
  }
  if (link.phase !== 'live') return rejected(state);
  const effects: PlannedEffect[] = [{ type: 'refresh-view' }];
  const forgotten: Source[] = [];
  let useDefaults = false;
  const sources: Record<Source, SourceState> = { ...link.sources };
  for (const name of SOURCES) {
    const source = sources[name];
    if (source.phase === 'missing') forgotten.push(name);
    if (source.phase === 'published' && source.swapped) {
      forgotten.push(name);
      sources[name] = { phase: 'published', swapped: false };
    }
    if (
      source.phase === 'failed' &&
      (source.kind === 'preference-unreadable' ||
        source.kind === 'preference-invalid')
    )
      useDefaults = true;
    if (
      (source.phase === 'failed' && source.removingSinceMs === null) ||
      source.phase === 'missing' ||
      source.phase === 'stale-publication'
    )
      sources[name] = { phase: 'off' };
  }
  if (useDefaults) effects.push({ type: 'clear-checked-devices' });
  if (forgotten.length > 0)
    effects.push({ type: 'forget-checked-devices', sources: forgotten });
  const base: MediaState = useDefaults
    ? { ...state, devices: 'defaults' }
    : state;
  if (
    link.establishment.stage === 'establishing' ||
    hasStuckWork(link, ctx.atMs, ctx.policy.readBudgetMs)
  )
    return prepend(
      [...effects, ...teardownEffects(link)],
      join(base, true, ctx.atMs),
    );
  const converged = convergeSources(
    { ...link, sources },
    desiredSources(link),
    base.devices === 'defaults',
    ctx.atMs,
  );
  return prepend(
    [...effects, ...converged.effects],
    startNextRead(base, wantRead(converged.live), ctx.atMs),
  );
};

/** The budget ran out: never live is released; live says it plainly and reads again. */
export const budgetExpired = (
  state: MediaState,
  ctx: StepContext,
): Decision => {
  const { link } = state;
  if (link.phase !== 'live') return rejected(state);
  if (link.establishment.stage === 'establishing')
    return release(state, 'transient', ctx);
  if (link.establishment.freshness.status === 'stale') return moved(state);
  const stale = showStale(state, link, 'transient', ctx);
  return { state: withLive(stale.state, stale.live), effects: stale.effects };
};
