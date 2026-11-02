/** Accepted Round projections invalidate reads; these inputs never grant media. */
export type MediaReadEvent =
  | { readonly kind: 'view'; readonly roundViewVersion: number }
  | {
      readonly kind: 'boundary';
      readonly roundViewVersion: number;
      readonly deadlineMs: number;
    }
  | { readonly kind: 'wake' };
export type MediaReadIntent = {
  readonly roundViewVersion: number;
  readonly deadlineMs: number | null;
  readonly generation: number;
  readonly disposed: boolean;
};
type Decision = {
  readonly intent: MediaReadIntent;
  readonly action: 'ignore' | 'wake' | 'supersede';
};
type RoundEvent = Exclude<MediaReadEvent, { readonly kind: 'wake' }>;

const newerView = (intent: MediaReadIntent, version: number) =>
  Number.isSafeInteger(version) && version > intent.roundViewVersion;
const newBoundary = (
  intent: MediaReadIntent,
  event: Extract<RoundEvent, { readonly kind: 'boundary' }>,
) =>
  event.roundViewVersion === intent.roundViewVersion &&
  Number.isSafeInteger(event.deadlineMs) &&
  (intent.deadlineMs === null || event.deadlineMs > intent.deadlineMs);
const supersede = (next: MediaReadIntent): Decision => ({
  intent: { ...next, generation: next.generation + 1 },
  action: 'supersede',
});
const decideRoundEvent = (
  intent: MediaReadIntent,
  event: RoundEvent,
): Decision => {
  if (event.kind === 'view')
    return newerView(intent, event.roundViewVersion)
      ? supersede({
          ...intent,
          roundViewVersion: event.roundViewVersion,
          deadlineMs: null,
        })
      : { intent, action: 'ignore' };
  return newBoundary(intent, event)
    ? supersede({ ...intent, deadlineMs: event.deadlineMs })
    : { intent, action: 'ignore' };
};

/** Rejected events preserve identity, including every event after disposal. */
export function decideMediaRead(
  intent: MediaReadIntent,
  event: MediaReadEvent | { readonly kind: 'dispose' },
): Decision {
  if (intent.disposed) return { intent, action: 'ignore' };
  if (event.kind === 'wake') return { intent, action: 'wake' };
  if (event.kind === 'dispose') return supersede({ ...intent, disposed: true });
  return decideRoundEvent(intent, event);
}

/** A read younger than this may finish when it is not the first to be superseded. */
export const MEDIA_READ_LET_FINISH_MS = 2_000;

/**
 * What a superseding event does to the read in flight. The first since the last
 * answer aborts at once. In a burst, a young read finishes and its reply is fenced
 * like any other, so fewer reads overlap. This limits load; it does not shorten
 * the wait, which lasts at least the burst because a reply older than the current
 * intent never applies.
 */
export function decideSupersededRead(input: {
  readonly supersededSinceAnswer: number;
  readonly readAgeMs: number;
}): 'abort' | 'let-finish' {
  return input.supersededSinceAnswer > 0 &&
    input.readAgeMs < MEDIA_READ_LET_FINISH_MS
    ? 'let-finish'
    : 'abort';
}
