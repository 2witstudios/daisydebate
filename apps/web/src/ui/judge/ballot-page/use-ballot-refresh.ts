'use client';
import { useResource } from '../../edge/use-driver';
import { browserScheduler } from '../../edge/browser-time';
import { nowMs, systemClock } from '@daisy/clock';
import type { RoundBallotRead } from '@daisy/protocol/round-ballot-read';
import { useMemo, useRef } from 'react';
import {
  ballotRefresh,
  ballotWaitSince,
  type BallotRefresh,
  type BallotWait,
} from '../../../features/round-ballots/ballot-refresh';
import { countdownNowMs } from '../../../features/round-ballots/settling';

/** The browser, as the refresh schedule uses it. */
export type RefreshEdges = {
  /** Runs `run` once after `inMs`; returns how to cancel it. */
  readonly after: (run: () => void, inMs: number) => () => void;
  /** Whether the judge can see the page. */
  readonly visible: () => boolean;
  /** Calls `run` whenever the page is shown or hidden; returns how to stop. */
  readonly onVisibilityChange: (run: () => void) => () => void;
};

/**
 * Follows what `next` names at each present. `in`: refreshes when that delay
 * has passed and asks again, since a deadline passes and a wait grows longer
 * with no new props. `once`: refreshes now and schedules nothing, so the
 * render that refresh brings decides afresh and a deadline the server never
 * moves past is not asked about in a loop. `none`: stops. A hidden page holds
 * no timer and refreshes nothing; shown again it asks `next` at once, since
 * what it shows may be long out of date. Returns how to stop it early.
 */
export function refreshOnSchedule({
  next,
  nowMs,
  refresh,
  edges,
}: {
  readonly next: (nowMs: number) => BallotRefresh;
  readonly nowMs: () => number;
  readonly refresh: () => void;
  readonly edges: RefreshEdges;
}): () => void {
  let cancel: (() => void) | null = null;
  const disarm = () => {
    cancel?.();
    cancel = null;
  };
  const arm = (inMs: number) => {
    cancel = edges.after(() => {
      cancel = null;
      refreshIfDue();
    }, inMs);
  };
  const refreshIfDue = () => {
    disarm();
    const due = next(nowMs());
    if (due.kind === 'none') return;
    refresh();
    if (due.kind === 'in') arm(due.ms);
  };
  const unsubscribe = edges.onVisibilityChange(() => {
    if (edges.visible()) refreshIfDue();
    else disarm();
  });
  if (edges.visible()) {
    const first = next(nowMs());
    if (first.kind === 'once') refresh();
    if (first.kind === 'in') arm(first.ms);
  }
  return () => {
    disarm();
    unsubscribe();
  };
}

const deviceInstant = () => ({
  wallMs: nowMs(systemClock),
  monotonicMs: performance.now(),
});

const browserEdges: RefreshEdges = {
  after: browserScheduler.after,
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
 * long the Round has waited on the same thing is carried across them. The
 * render instant is also how a passed deadline is asked about once: the
 * refresh it earns is rendered after it.
 */
export function useBallotRefresh(
  view: RoundBallotRead,
  held: boolean,
  renderedAtMs: number,
  router: { readonly refresh: () => void },
): void {
  const { status, waitingOn } = view.round;
  const wait = useRef<BallotWait | null>(null);
  // Each new render instant, view or hold decides the schedule afresh.
  const schedule = useMemo(
    () => ({ status, waitingOn, held, renderedAtMs, router }),
    [status, waitingOn, held, renderedAtMs, router],
  );
  useResource(schedule, (now) => {
    const mounted = deviceInstant();
    const { sinceMs } = (wait.current = ballotWaitSince(
      wait.current,
      now.waitingOn,
      now.renderedAtMs,
    ));
    return {
      dispose: refreshOnSchedule({
        next: (nowMs) =>
          ballotRefresh(
            { round: { status: now.status, waitingOn: now.waitingOn } },
            now.held,
            { nowMs, renderedAtMs: now.renderedAtMs, waitingSinceMs: sinceMs },
          ),
        nowMs: () =>
          countdownNowMs({
            renderedAtMs: now.renderedAtMs,
            mounted,
            current: deviceInstant(),
          }),
        refresh: () => now.router.refresh(),
        edges: browserEdges,
      }),
    };
  });
}
