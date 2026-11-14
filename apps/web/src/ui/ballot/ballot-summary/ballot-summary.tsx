import type { Ballot } from '@daisy/protocol';
import {
  subjectOf,
  type BallotPlan,
} from '../../../features/judge/ballot-plan';
import { Avatar } from '../../components/avatar/avatar';
import { ballotEyebrowClass, ballotHeadingClass } from '../ballot-class';

/** What a ballot decided, in a line: who it voted for, or the order it placed them in. */
export const ballotVerdict = (plan: BallotPlan, ballot: Ballot): string => {
  const name = (key: string) => subjectOf(plan, key)?.name ?? key;
  if (ballot.ranking)
    return `Ranked ${ballot.ranking.map((place) => place.map(name).join(' and ')).join(', then ')}`;
  switch (ballot.decision ?? 'win') {
    case 'win':
      return `Voted ${ballot.winner ? name(ballot.winner) : 'no winner'}`;
    case 'tie':
      return 'Voted a tie';
    case 'double_loss':
      return 'Voted a double loss';
  }
};

/**
 * One judge's written ballot: what they decided, the reason the debaters
 * see, and the feedback each was given (on a released ballot, only the
 * reader's own).
 */
export function BallotSummary({
  title,
  ballot,
  plan,
  feedbackTitle = 'Feedback',
}: {
  readonly title: string;
  readonly ballot: Ballot;
  readonly plan: BallotPlan;
  readonly feedbackTitle?: string;
}) {
  const feedback = plan.decided.flatMap((subject) => {
    const text = ballot.feedback[subject.key];
    return text === undefined ? [] : [{ subject, text }];
  });
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 className={ballotHeadingClass}>{title}</h3>
        <p className="text-sm text-ink-muted">{ballotVerdict(plan, ballot)}</p>
      </div>
      <p className="text-base text-ink">{ballot.reason}</p>
      {feedback.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h4 className={ballotEyebrowClass}>{feedbackTitle}</h4>
          <ul className="flex flex-col gap-3">
            {feedback.map(({ subject, text }) => (
              <li key={subject.key} className="flex items-start gap-3">
                <Avatar
                  name={subject.name}
                  src={subject.avatarSrc}
                  size="sm"
                  nameVisible
                />
                <p className="min-w-0 text-base text-ink">
                  <span className="block text-sm font-strong">
                    {subject.name}
                  </span>
                  {text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
