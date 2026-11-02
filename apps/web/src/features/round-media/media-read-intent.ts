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
const validVersion = (version: number) =>
  Number.isSafeInteger(version) && version >= 0;

/** Rejected events preserve identity, including every event after disposal. */
export function decideMediaRead(
  intent: MediaReadIntent,
  event: MediaReadEvent | { readonly kind: 'dispose' },
): {
  readonly intent: MediaReadIntent;
  readonly action: 'ignore' | 'wake' | 'supersede';
} {
  const ignore = { intent, action: 'ignore' as const };
  if (intent.disposed) return ignore;
  if (event.kind === 'wake') return { intent, action: 'wake' };
  if (event.kind === 'dispose')
    return {
      intent: { ...intent, disposed: true, generation: intent.generation + 1 },
      action: 'supersede',
    };
  if (!validVersion(event.roundViewVersion)) return ignore;
  if (event.kind === 'view')
    return event.roundViewVersion > intent.roundViewVersion
      ? {
          intent: {
            ...intent,
            roundViewVersion: event.roundViewVersion,
            deadlineMs: null,
            generation: intent.generation + 1,
          },
          action: 'supersede',
        }
      : ignore;
  if (
    event.roundViewVersion !== intent.roundViewVersion ||
    !Number.isSafeInteger(event.deadlineMs) ||
    (intent.deadlineMs !== null && event.deadlineMs <= intent.deadlineMs)
  )
    return ignore;
  return {
    intent: {
      ...intent,
      deadlineMs: event.deadlineMs,
      generation: intent.generation + 1,
    },
    action: 'supersede',
  };
}
