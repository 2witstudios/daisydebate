import { attendanceTimingPolicy, type RoundView } from '@daisy/protocol';

type SettlingRound = Pick<RoundView, 'rules' | 'segments'>;

/**
 * When every non-final speech's attendance can first be settled: its start
 * plus the grace period and the finalization buffer, the earliest instant
 * the server's settlement check can pass (ADR 0067). The final speech is
 * not awaited, as on the server. Null when no such speech has started. It
 * is an estimate for the judge's screen only; the server's refusal stays
 * authoritative, and a late adjudication can still refuse after it.
 */
export function attendanceSettlesAtMs(round: SettlingRound): number | null {
  const finalKey = round.rules.segments
    .filter((rule) => rule.type === 'speech')
    .at(-1)?.key;
  const starts = round.segments
    .filter(
      (segment) =>
        segment.type === 'speech' && segment.rulesSegmentKey !== finalKey,
    )
    .map((segment) => Date.parse(segment.startedAt));
  if (starts.length === 0) return null;
  const { graceMs, finalizationBufferMs } = attendanceTimingPolicy;
  return Math.max(...starts) + graceMs + finalizationBufferMs;
}

/** How long until submitting can succeed; null once nothing is left to wait for. */
export function ballotOpensInMs(
  round: SettlingRound,
  nowMs: number,
): number | null {
  const settles = attendanceSettlesAtMs(round);
  return settles === null || settles <= nowMs ? null : settles - nowMs;
}

/** One reading of the device's wall clock and its monotonic clock. */
type DeviceInstant = { readonly wallMs: number; readonly monotonicMs: number };

/**
 * The countdown's present: the server's render instant advanced by the time
 * elapsed on the device since mount, never the device's absolute time, so a
 * device clock that is off by any amount still counts down correctly. The
 * larger of the two elapsed readings is taken: the wall clock keeps running
 * while a device sleeps, and the monotonic clock never jumps backwards.
 */
export const countdownNowMs = ({
  renderedAtMs,
  mounted,
  current,
}: {
  readonly renderedAtMs: number;
  readonly mounted: DeviceInstant;
  readonly current: DeviceInstant;
}): number =>
  renderedAtMs +
  Math.max(
    0,
    current.wallMs - mounted.wallMs,
    current.monotonicMs - mounted.monotonicMs,
  );
