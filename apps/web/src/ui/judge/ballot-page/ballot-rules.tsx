'use client';
import { judgingPolicy } from '@daisy/protocol/judging-policy';
import { type RoundWaitingOn } from '@daisy/protocol/round-view';
import { ballotRuleLines } from '../../../features/judge/ballot-rules';
import type { BallotPlan } from '../../../features/judge/ballot-plan';
import { judgingClockOf } from '../../../features/round-runtime/judging-window';
import { RoundClock } from '../../debate-room/round-clock';
import { useServerAnchoredNow } from './ballot-opens';
import {
  ballotHeadingClass,
  ballotSectionClass,
} from '../../ballot/ballot-class';

const windowMinutes = judgingPolicy.humanBallotWindowMs / 60_000;

/**
 * How the Round's ballot works, from its definition, said once on the page that owns it, before
 * the judge starts: the decision, the scores, who reads what, the limits and
 * the window, with its time left while it runs.
 */
export function BallotRules({
  plan,
  waitingOn,
  renderedAtMs,
}: {
  readonly plan: BallotPlan;
  readonly waitingOn: RoundWaitingOn | null;
  readonly renderedAtMs: number;
}) {
  const nowMs = useServerAnchoredNow(
    renderedAtMs,
    (at) => (judgingClockOf(waitingOn, at)?.remainingMs ?? 0) > 0,
  );
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
        {ballotRuleLines(plan.definition).map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>
          {`You have ${windowMinutes} minutes from when your ballot opens to submit. Once submitted, a ballot can’t be changed.`}
        </li>
      </ul>
    </section>
  );
}
