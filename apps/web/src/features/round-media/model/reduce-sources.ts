import type { PlannedEffect } from './media-step';
import type { LiveConnection, Source, SourceState } from './media-state';
import { SOURCES } from './media-state';

/** LiveKit's permission outranks a reply crossing it; unknown, the server's grant decides. */
export const desiredSources = (live: LiveConnection): readonly Source[] =>
  live.permission ?? live.grants;

/** A seat that publishes anything keeps its microphone warm between turns. */
const warmable = (source: Source, desired: readonly Source[]) =>
  source === 'microphone' && desired.length > 0 && !desired.includes(source);

type SourceStep = {
  readonly source: SourceState;
  readonly effects: readonly PlannedEffect[];
};
const stay = (source: SourceState): SourceStep => ({ source, effects: [] });

/** Moves one source toward what the seat may publish. Only idle phases can move. */
function convergeSource(input: {
  readonly name: Source;
  readonly state: SourceState;
  readonly desired: readonly Source[];
  readonly connection: number;
  readonly useDefaults: boolean;
  readonly atMs: number;
}): SourceStep {
  const { name: source, state, desired, connection, useDefaults } = input;
  const wanted = desired.includes(source);
  const warm = warmable(source, desired);
  const capture = (): SourceStep => ({
    source: { phase: 'capturing', waiting: false },
    effects: [{ type: 'capture', connection, source, useDefaults }],
  });
  switch (state.phase) {
    case 'off':
      return wanted || warm ? capture() : stay(state);
    case 'warm':
      if (wanted) return capture();
      return warm
        ? stay(state)
        : {
            source: { phase: 'off' },
            effects: [{ type: 'release-track', connection, source }],
          };
    case 'published':
      return wanted
        ? stay(state)
        : {
            source: {
              phase: 'unpublishing',
              sinceMs: input.atMs,
              keepWarm: warm,
              stuck: false,
            },
            effects: [
              ...(warm
                ? []
                : [{ type: 'release-track', connection, source } as const]),
              { type: 'unpublish', connection, source },
            ],
          };
    case 'failed':
    case 'missing':
    case 'capturing':
    case 'publishing':
    case 'unpublishing':
    case 'stale-publication':
      return stay(state);
  }
}

/** A newly wanted source starts over; what stopped mattering leaves the bar. */
function reconsiderFailure(input: {
  readonly name: Source;
  readonly state: SourceState;
  readonly wasWanted: boolean;
  readonly desired: readonly Source[];
}): SourceState {
  const { name, state, wasWanted, desired } = input;
  if (state.phase === 'failed' && state.removingSinceMs !== null) return state;
  if (
    state.phase !== 'failed' &&
    state.phase !== 'missing' &&
    state.phase !== 'stale-publication'
  )
    return state;
  if (desired.includes(name)) return wasWanted ? state : { phase: 'off' };
  if (state.phase === 'stale-publication' || warmable(name, desired))
    return state;
  return { phase: 'off' };
}

/** Applies what the seat may publish to both sources. */
export function convergeSources(
  live: LiveConnection,
  previouslyDesired: readonly Source[],
  useDefaults: boolean,
  atMs: number,
): {
  readonly live: LiveConnection;
  readonly effects: readonly PlannedEffect[];
} {
  const desired = desiredSources(live);
  const effects: PlannedEffect[] = [];
  const next: Record<Source, SourceState> = { ...live.sources };
  for (const name of SOURCES) {
    const reconsidered = reconsiderFailure({
      name,
      state: next[name],
      wasWanted: previouslyDesired.includes(name),
      desired,
    });
    const step = convergeSource({
      name,
      state: reconsidered,
      desired,
      connection: live.connection,
      useDefaults,
      atMs,
    });
    next[name] = step.source;
    effects.push(...step.effects);
  }
  const same = SOURCES.every((name) => next[name] === live.sources[name]);
  return { live: same ? live : { ...live, sources: next }, effects };
}

/** A capture answered: publish it, keep it warm, or let it go. */
export function settleCaptured(input: {
  readonly name: Source;
  readonly desired: readonly Source[];
  readonly connection: number;
  readonly muted: boolean;
  readonly atMs: number;
}): SourceStep {
  const { name: source, desired, connection } = input;
  if (desired.includes(source))
    return {
      source: { phase: 'publishing', sinceMs: input.atMs, stuck: false },
      effects: [{ type: 'publish', connection, source, muted: input.muted }],
    };
  if (warmable(source, desired)) return stay({ phase: 'warm' });
  // The capture outlived the grant it was asked for.
  return {
    source: { phase: 'off' },
    effects: [{ type: 'release-track', connection, source }],
  };
}

/** Whether an answer still has to wait for this source. Past patience a prompt does not hold it. */
export const holdsAnswer = (state: SourceState) =>
  state.phase === 'publishing' ||
  state.phase === 'unpublishing' ||
  (state.phase === 'capturing' && !state.waiting);

/** What a rebuild would cost: a source published, or anything heard or seen from others. */
export const hasLiveMedia = (live: LiveConnection) =>
  SOURCES.some((name) => live.sources[name].phase === 'published') ||
  live.tracks.some((track) => !track.local);

/** SDK work past the budget that holds later answers, as a wake weighs a rebuild. */
export const hasStuckAnswerWork = (
  live: LiveConnection,
  atMs: number,
  budgetMs: number,
) =>
  SOURCES.some((name) => {
    const state = live.sources[name];
    return (
      (state.phase === 'publishing' || state.phase === 'unpublishing') &&
      atMs - state.sinceMs >= budgetMs
    );
  });

/** Names what is past the budget, so the bar can say which source is not responding. */
export const nameStuckSources = (
  live: LiveConnection,
  atMs: number,
  budgetMs: number,
): LiveConnection => {
  const sources = { ...live.sources };
  for (const name of SOURCES) {
    const state = sources[name];
    if (
      (state.phase === 'publishing' || state.phase === 'unpublishing') &&
      atMs - state.sinceMs >= budgetMs
    )
      sources[name] = { ...state, stuck: true };
  }
  return { ...live, sources };
};

/** Any SDK call past the budget, a failed source's removal too: Retry rebuilds for these. */
export const hasStuckWork = (
  live: LiveConnection,
  atMs: number,
  budgetMs: number,
) =>
  SOURCES.some((name) => {
    const state = live.sources[name];
    const sinceMs =
      state.phase === 'publishing' || state.phase === 'unpublishing'
        ? state.sinceMs
        : state.phase === 'failed'
          ? state.removingSinceMs
          : null;
    return sinceMs !== null && atMs - sinceMs >= budgetMs;
  });
