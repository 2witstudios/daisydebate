import type { MediaEffect } from './media-effects';
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
  readonly effects: readonly MediaEffect[];
};
const stay = (source: SourceState): SourceStep => ({ source, effects: [] });

/** Moves one source toward what the seat may publish. Only idle phases can move. */
export function convergeSource(input: {
  readonly name: Source;
  readonly state: SourceState;
  readonly desired: readonly Source[];
  readonly connection: number;
  readonly atMs: number;
}): SourceStep {
  const { name: source, state, desired, connection } = input;
  const wanted = desired.includes(source);
  const warm = warmable(source, desired);
  const capture = (): SourceStep => ({
    source: { phase: 'capturing', waiting: false },
    effects: [{ type: 'capture', connection, source }],
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
            },
            effects: [
              ...(warm
                ? []
                : [{ type: 'release-track', connection, source } as const]),
              { type: 'unpublish', connection, source },
            ],
          };
    default:
      return stay(state);
  }
}

/** A newly wanted source starts over; what stopped mattering leaves the bar. */
export function reconsiderFailure(input: {
  readonly name: Source;
  readonly state: SourceState;
  readonly wasWanted: boolean;
  readonly desired: readonly Source[];
}): SourceState {
  const { name, state, wasWanted, desired } = input;
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

/** Applies a change of what the seat may publish to both sources. */
export function convergeSources(
  live: LiveConnection,
  previouslyDesired: readonly Source[],
  atMs: number,
): { readonly live: LiveConnection; readonly effects: readonly MediaEffect[] } {
  const desired = desiredSources(live);
  const effects: MediaEffect[] = [];
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
      atMs,
    });
    next[name] = step.source;
    effects.push(...step.effects);
  }
  const same = SOURCES.every((name) => next[name] === live.sources[name]);
  return { live: same ? live : { ...live, sources: next }, effects };
}

/** What a source's own work reporting back does to it. Null when it is not expected. */
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
      source: { phase: 'publishing', sinceMs: input.atMs },
      effects: [{ type: 'publish', connection, source, muted: input.muted }],
    };
  if (warmable(source, desired)) return stay({ phase: 'warm' });
  // The capture outlived the grant it was asked for.
  return {
    source: { phase: 'off' },
    effects: [{ type: 'release-track', connection, source }],
  };
}

export const isOccupied = (state: SourceState, patienceExpired: boolean) =>
  state.phase === 'publishing' ||
  state.phase === 'unpublishing' ||
  (state.phase === 'capturing' && !patienceExpired);

/** A stuck SDK call holds every later answer, so only a new connection escapes it. */
export const hasStuckWork = (
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
