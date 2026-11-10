'use client';
import type { RoundView } from '@daisy/protocol';
import { systemClock } from '@daisy/clock';
import { useEffect, useRef, useState } from 'react';
import { formatCountdown } from '../../../lib/clock-display';
import {
  attendanceSettlesAtMs,
  ballotOpensInMs,
  countdownMount,
  countdownNowMs,
} from '../../../features/round-ballots/settling';

const deviceInstant = () => ({
  wallMs: Date.parse(systemClock.now()),
  monotonicMs: performance.now(),
});

/**
 * The present, counted once a second from the server's render instant by the
 * time elapsed on this device (countdownNowMs, which survives a device that
 * sleeps), so a device clock that is off never moves a deadline. It ticks
 * only while `runsAt` holds for the present it has reached, so it stops by
 * itself once the count is done; a new render instant restarts it.
 */
export function useServerAnchoredNow(
  renderedAtMs: number,
  runsAt: (nowMs: number) => boolean,
): number {
  const [elapsed, setElapsed] = useState({
    base: renderedAtMs,
    nowMs: renderedAtMs,
  });
  const now = elapsed.base === renderedAtMs ? elapsed.nowMs : renderedAtMs;
  const running = runsAt(now);
  const mount = useRef<ReturnType<typeof countdownMount> | null>(null);
  useEffect(() => {
    if (!running) return;
    mount.current = countdownMount(mount.current, renderedAtMs, deviceInstant);
    const { mounted } = mount.current;
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
  }, [running, renderedAtMs]);
  return now;
}

/**
 * How long until the open ballot can be submitted, on the server-anchored
 * count; it stops at zero. Null when there is nothing to wait for or no
 * ballot is open.
 */
export function useBallotOpensIn(
  round: Pick<RoundView, 'rules' | 'segments'>,
  renderedAtMs: number,
  open: boolean,
): number | null {
  const now = useServerAnchoredNow(
    renderedAtMs,
    (nowMs) => open && ballotOpensInMs(round, nowMs) !== null,
  );
  return open ? ballotOpensInMs(round, now) : null;
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
