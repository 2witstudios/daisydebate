'use client';
import { systemClock } from '@daisy/clock';
import type { RoundBallotRead } from '@daisy/protocol';
import { useEffect, useRef } from 'react';
import {
  ballotRefreshInMs,
  ballotWaitSince,
  type BallotWait,
} from '../../../features/round-ballots/ballot-refresh';
import { countdownNowMs } from '../../../features/round-ballots/settling';

/** The browser, as the refresh schedule uses it. */
export type RefreshEdges = {
  readonly setTimeout: (run: () => void, inMs: number) => number;
  readonly clearTimeout: (timer: number) => void;
  /** Whether the judge can see the page. */
  readonly visible: () => boolean;
  /** Calls `run` whenever the page is shown or hidden; returns how to stop. */
  readonly onVisibilityChange: (run: () => void) => () => void;
};

/**
 * Refreshes each time the delay `nextInMs` names has passed, and asks again
 * after every one: a deadline passes and a wait grows longer with no new
 * props. It stops by itself the first time there is no next refresh. A hidden
 * page is not refreshed at all; shown again, it refreshes at once, since what
 * it shows may be long out of date. Returns how to stop it early.
 */
export function refreshOnSchedule({
  nextInMs,
  nowMs,
  refresh,
  edges,
}: {
  readonly nextInMs: (nowMs: number) => number | null;
  readonly nowMs: () => number;
  readonly refresh: () => void;
  readonly edges: RefreshEdges;
}): () => void {
  let timer: number | null = null;
  const disarm = () => {
    if (timer !== null) edges.clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    const inMs = edges.visible() ? nextInMs(nowMs()) : null;
    if (inMs === null) return;
    timer = edges.setTimeout(() => {
      timer = null;
      refreshIfDue();
    }, inMs);
  };
  const refreshIfDue = () => {
    if (nextInMs(nowMs()) === null) return;
    refresh();
    arm();
  };
  const unsubscribe = edges.onVisibilityChange(() => {
    if (edges.visible()) refreshIfDue();
    else disarm();
  });
  arm();
  return () => {
    disarm();
    unsubscribe();
  };
}

const deviceInstant = () => ({
  wallMs: Date.parse(systemClock.now()),
  monotonicMs: performance.now(),
});

const browserEdges: RefreshEdges = {
  setTimeout: (run, inMs) => window.setTimeout(run, inMs),
  clearTimeout: (timer) => window.clearTimeout(timer),
  visible: () => document.visibilityState === 'visible',
  onVisibilityChange: (run) => {
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  },
};

/**
 * Keeps the judge's page current without a manual refresh, on the present
 * counted from the server's render instant (countdownNowMs). Every refresh
 * brings a new render instant and a new view, which decide afresh; only how
 * long the Round has waited on the same thing is carried across them.
 */
export function useBallotRefresh(
  view: RoundBallotRead,
  held: boolean,
  renderedAtMs: number,
  router: { readonly refresh: () => void },
): void {
  const { status, waitingOn } = view.round;
  const wait = useRef<BallotWait | null>(null);
  useEffect(() => {
    const mounted = deviceInstant();
    const { sinceMs } = (wait.current = ballotWaitSince(
      wait.current,
      waitingOn,
      renderedAtMs,
    ));
    return refreshOnSchedule({
      nextInMs: (nowMs) =>
        ballotRefreshInMs({ round: { status, waitingOn } }, held, {
          nowMs,
          waitingSinceMs: sinceMs,
        }),
      nowMs: () =>
        countdownNowMs({ renderedAtMs, mounted, current: deviceInstant() }),
      refresh: () => router.refresh(),
      edges: browserEdges,
    });
  }, [status, waitingOn, held, renderedAtMs, router]);
}
