'use client';
import {
  ballotLimits,
  ballotRubric,
  ballotScoreMax,
  judgingPolicy,
  type RoundWaitingOn,
} from '@daisy/protocol';
import { useEffect, useState } from 'react';
import { judgingClockOf } from '../../../features/debate-room/judging';
import { RoundClock } from '../../debate-room/round-clock';
import {
  ballotHeadingClass,
  ballotSectionClass,
} from '../../ballot/ballot-class';

const windowMinutes = judgingPolicy.humanBallotWindowMs / 60_000;
const categoryCount = ballotRubric.reduce(
  (sum, group) => sum + group.categories.length,
  0,
);

/**
 * The judging window's time left, counted from the server's render instant
 * by the time elapsed on this device, so a device clock that is off does not
 * move the deadline.
 */
function useWindowNow(renderedAtMs: number, running: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const mounted = performance.now();
    const tick = window.setInterval(
      () => setElapsedMs(performance.now() - mounted),
      1000,
    );
    return () => window.clearInterval(tick);
  }, [renderedAtMs, running]);
  return renderedAtMs + elapsedMs;
}

/**
 * How Daisy's one ballot works, said once on the page that owns it, before
 * the judge starts: the decision, the scores, who reads what, the limits and
 * the window, with its time left while it runs.
 */
export function BallotRules({
  waitingOn,
  renderedAtMs,
}: {
  readonly waitingOn: RoundWaitingOn | null;
  readonly renderedAtMs: number;
}) {
  const running = waitingOn?.state === 'human_window';
  const nowMs = useWindowNow(renderedAtMs, running);
  const clock = judgingClockOf(waitingOn, nowMs);
  return (
    <section aria-labelledby="ballot-rules" className={ballotSectionClass}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 id="ballot-rules" className={ballotHeadingClass}>
          How this ballot works
        </h2>
        {clock ? (
          <RoundClock
            label="Time left to submit"
            remainingMs={clock.remainingMs}
            size="medium"
            className="flex flex-col items-end leading-tight"
          />
        ) : null}
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-base">
        <li>Pick one winner. There are no draws.</li>
        <li>
          {`Score each debater from 1 to ${ballotScoreMax} in all ${categoryCount} categories. Open a category to see what a 1, 3 and 5 look like.`}
        </li>
        <li>
          A win on fewer speaker points is allowed; you confirm it before
          submitting.
        </li>
        <li>
          {`Your reason for decision is required and both debaters read it (up to ${ballotLimits.reason} characters).`}
        </li>
        <li>
          {`Feedback is optional, and each debater reads only their own (up to ${ballotLimits.feedback} characters).`}
        </li>
        <li>
          {`You have ${windowMinutes} minutes from the end of the speeches to submit. Once submitted, a ballot can’t be changed.`}
        </li>
      </ul>
    </section>
  );
}
