'use client';
import type { RoundView } from '@daisy/protocol';
import { systemClock } from '@daisy/clock';
import { useEffect, useState } from 'react';
import { formatClock } from '../../../features/debate-room/clock';
import {
  attendanceSettlesAtMs,
  ballotOpensInMs,
} from '../../../features/round-ballots/settling';

/**
 * How long until the open ballot can be submitted, counted down once a
 * second from the server's render instant and stopping at zero; null when
 * there is nothing to wait for or no ballot is open.
 */
export function useBallotOpensIn(
  round: Pick<RoundView, 'rules' | 'segments'>,
  renderedAtMs: number,
  open: boolean,
): number | null {
  const [now, setNow] = useState(renderedAtMs);
  const opensInMs = open ? ballotOpensInMs(round, now) : null;
  const waiting = opensInMs !== null;
  useEffect(() => {
    if (!waiting) return;
    const tick = window.setInterval(
      () => setNow(Date.parse(systemClock.now())),
      1000,
    );
    return () => window.clearInterval(tick);
  }, [waiting]);
  return opensInMs;
}

/**
 * The judge may fill in the ballot while attendance for the last speeches
 * settles; this says when submitting opens. The sentence names the clock
 * time and the wait as rendered, so it holds without script and is not
 * re-announced every second; only the visual countdown ticks.
 */
export function BallotOpensNotice({
  round,
  opensInMs,
  renderedAtMs,
}: {
  readonly round: Pick<RoundView, 'rules' | 'segments'>;
  readonly opensInMs: number | null;
  readonly renderedAtMs: number;
}) {
  const at = attendanceSettlesAtMs(round);
  if (opensInMs === null || at === null) return null;
  const seconds = Math.ceil((at - renderedAtMs) / 1000);
  return (
    <div
      role="status"
      className="flex items-center gap-4 rounded-lg border border-border bg-hue-sky-soft px-5 py-4 max-narrow:px-4"
    >
      <span
        aria-hidden="true"
        className="font-display text-2xl font-bold text-hue-sky tabular-nums"
      >
        {formatClock(opensInMs)}
      </span>
      <p className="text-base text-ink">
        <span className="font-strong">{`Submitting opens in about ${seconds} seconds.`}</span>{' '}
        {`Attendance for the last speeches is still being confirmed, until ${new Date(at).toISOString().slice(11, 19)} UTC. Fill in your ballot now; nothing you enter is lost.`}
      </p>
    </div>
  );
}
