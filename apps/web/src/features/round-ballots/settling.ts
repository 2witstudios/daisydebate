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
