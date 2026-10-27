'use client';
import type { RoundView } from '@daisy/protocol';
import { systemClock } from '@daisy/clock';
import { useEffect, useState } from 'react';
import { formatCountdown } from '../../../features/clock-display/clock-display';
import {
  attendanceSettlesAtMs,
  ballotOpensInMs,
  countdownNowMs,
} from '../../../features/round-ballots/settling';

const deviceInstant = () => ({
  wallMs: Date.parse(systemClock.now()),
  monotonicMs: performance.now(),
});

/**
 * How long until the open ballot can be submitted, counted down once a
 * second from the server's render instant by the time elapsed on this
 * device (countdownNowMs), so a device clock that is off never holds
 * Submit back; it stops at zero. Null when there is nothing to wait for or
 * no ballot is open. A new render instant restarts the count from it.
 */
export function useBallotOpensIn(
  round: Pick<RoundView, 'rules' | 'segments'>,
  renderedAtMs: number,
  open: boolean,
): number | null {
  const [elapsed, setElapsed] = useState({
    base: renderedAtMs,
    nowMs: renderedAtMs,
  });
  const now = elapsed.base === renderedAtMs ? elapsed.nowMs : renderedAtMs;
  const opensInMs = open ? ballotOpensInMs(round, now) : null;
  const waiting = opensInMs !== null;
  useEffect(() => {
    if (!waiting) return;
    const mounted = deviceInstant();
    const tick = window.setInterval(
      () =>
        setElapsed({
          base: renderedAtMs,
          nowMs: countdownNowMs({
            renderedAtMs,
            mounted,
            current: deviceInstant(),
          }),
        }),
      1000,
    );
    return () => window.clearInterval(tick);
  }, [waiting, renderedAtMs]);
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
        {formatCountdown(opensInMs)}
      </span>
      <p className="text-base text-ink">
        <span className="font-strong">{`Submitting opens in about ${seconds} seconds.`}</span>{' '}
        {`Attendance for the last speeches is still being confirmed, until ${new Date(at).toISOString().slice(11, 19)} UTC. Fill in your ballot now; nothing you enter is lost.`}
      </p>
    </div>
  );
}
