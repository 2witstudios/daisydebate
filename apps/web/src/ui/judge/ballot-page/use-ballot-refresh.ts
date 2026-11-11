'use client';
import { systemClock } from '@daisy/clock';
import type { RoundBallotRead } from '@daisy/protocol';
import { useEffect } from 'react';
import {
  ballotKeepsRefreshing,
  ballotRefreshEveryMs,
} from '../../../features/round-ballots/ballot-refresh';
import { countdownNowMs } from '../../../features/round-ballots/settling';

type RefreshTimers = {
  readonly setInterval: (run: () => void, everyMs: number) => number;
  readonly clearInterval: (timer: number) => void;
};

/**
 * Refreshes on every interval for as long as `keeps` holds for the present,
 * and stops by itself the first time it does not: a deadline passes with no
 * new props, so each tick asks again. Returns how to stop it early.
 */
export function refreshWhileKept({
  keeps,
  nowMs,
  refresh,
  timers,
}: {
  readonly keeps: (nowMs: number) => boolean;
  readonly nowMs: () => number;
  readonly refresh: () => void;
  readonly timers: RefreshTimers;
}): () => void {
  if (!keeps(nowMs())) return () => {};
  const timer = timers.setInterval(() => {
    if (keeps(nowMs())) refresh();
    else timers.clearInterval(timer);
  }, ballotRefreshEveryMs);
  return () => timers.clearInterval(timer);
}

const deviceInstant = () => ({
  wallMs: Date.parse(systemClock.now()),
  monotonicMs: performance.now(),
});

/**
 * Keeps the judge's page current without a manual refresh, on the present
 * counted from the server's render instant (countdownNowMs). Every refresh
 * brings a new render instant and a new view, which decide afresh.
 */
export function useBallotRefresh(
  view: RoundBallotRead,
  held: boolean,
  renderedAtMs: number,
  router: { readonly refresh: () => void },
): void {
  const { status, waitingOn } = view.round;
  const { freeze } = view;
  useEffect(() => {
    const mounted = deviceInstant();
    return refreshWhileKept({
      keeps: (nowMs) =>
        ballotKeepsRefreshing(
          { round: { status, waitingOn }, freeze },
          held,
          nowMs,
        ),
      nowMs: () =>
        countdownNowMs({ renderedAtMs, mounted, current: deviceInstant() }),
      refresh: () => router.refresh(),
      timers: window,
    });
  }, [status, waitingOn, freeze, held, renderedAtMs, router]);
}
