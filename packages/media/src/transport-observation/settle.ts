import { sample } from './sample';
type Sample = Extract<ReturnType<typeof sample>, { kind: 'sample' }>;
const clockRefusal = (start: number, end: number | null) => {
  if (
    end === null ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start
  )
    return 'clock' as const;
  return end - start >= 1000 ? ('deadline' as const) : null;
};
const backwards = (previous: Sample, next: Sample) =>
  (Object.keys(next.counters) as (keyof Sample['counters'])[]).some(
    (key) => BigInt(next.counters[key]) < BigInt(previous.counters[key]),
  );
/** Pure metadata settlement; no observation bridges missing/reset data or replaces original identity. */
export function settle(
  input: {
    readonly startedAtMs: number;
    readonly endedAtMs: number | null;
    readonly originalIdentity: string | null;
    readonly previous: Sample | null;
  },
  reply: unknown,
) {
  const refusal = clockRefusal(input.startedAtMs, input.endedAtMs);
  if (refusal || input.endedAtMs === null)
    return { kind: 'unknown', reason: refusal ?? 'clock' } as const;
  const value = sample(reply);
  if (value.kind === 'unknown') return value;
  if (
    input.originalIdentity !== null &&
    value.identity !== input.originalIdentity
  )
    return { kind: 'replaced' } as const;
  if (input.previous && backwards(input.previous, value))
    return { kind: 'unknown', reason: 'reset' } as const;
  return {
    kind: 'accepted',
    sample: value,
    endedAtMs: input.endedAtMs,
    baseline: input.previous === null,
  } as const;
}
