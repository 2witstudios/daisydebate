import { debateSides, type Ballot } from '@daisy/protocol';
import type { BallotDebaters } from '../../../features/judge/ballot';
import { Avatar } from '../../components/avatar/avatar';
import { ballotEyebrowClass, ballotHeadingClass } from '../ballot-class';

/**
 * One judge's written ballot: who they voted for, the reason both debaters
 * see, and the feedback each debater was given (on a released ballot, only
 * the reader's own).
 */
export function BallotSummary({
  title,
  ballot,
  debaters,
  feedbackTitle = 'Feedback',
}: {
  readonly title: string;
  readonly ballot: Ballot;
  readonly debaters: BallotDebaters;
  readonly feedbackTitle?: string;
}) {
  const feedback = debateSides.flatMap((side) => {
    const text = ballot.feedback[side];
    return text === undefined ? [] : [{ side, text }];
  });
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 className={ballotHeadingClass}>{title}</h3>
        <p className="text-sm text-ink-muted">
          {`Voted ${debaters[ballot.winner].name}`}
        </p>
      </div>
      <p className="text-base text-ink">{ballot.reason}</p>
      {feedback.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h4 className={ballotEyebrowClass}>{feedbackTitle}</h4>
          <ul className="flex flex-col gap-3">
            {feedback.map(({ side, text }) => (
              <li key={side} className="flex items-start gap-3">
                <Avatar
                  name={debaters[side].name}
                  src={debaters[side].avatarSrc}
                  size="sm"
                  nameVisible
                />
                <p className="min-w-0 text-base text-ink">
                  <span className="block text-sm font-strong">
                    {debaters[side].name}
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
