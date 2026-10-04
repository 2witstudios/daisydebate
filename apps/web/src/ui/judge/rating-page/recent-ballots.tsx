import {
  daysAgoLabel,
  decisionLabel,
  deltaLabel,
  deltaTone,
  feedbackLabel,
  type DeltaTone,
  type RecentBallot,
} from '../../../features/judge/rating';

export type RecentBallotsProps = {
  readonly ballots: readonly RecentBallot[];
};

const toneClass: Readonly<Record<DeltaTone, string>> = {
  up: 'text-online',
  down: 'text-live',
  flat: 'text-ink-faint',
};

/** The judge's latest ballots with the feedback and review on each. */
export function RecentBallots({ ballots }: RecentBallotsProps) {
  return (
    <section
      aria-label="Your recent ballots"
      className="overflow-hidden rounded-xl bg-surface shadow-1"
    >
      <h2 className="px-5 pt-5 pb-3 text-xs font-bold tracking-widest text-ink-muted uppercase">
        Your recent ballots
      </h2>
      <ul>
        {ballots.map((ballot) => (
          <li
            key={ballot.id}
            className="flex items-start gap-4 border-t border-border px-5 py-4"
          >
            <div className="flex min-w-0 grow flex-col gap-1">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-md font-strong">
                  {`${ballot.debateLabel} · ${decisionLabel(ballot.decision)}`}
                </span>
                <span className="text-sm text-ink-faint">
                  {daysAgoLabel(ballot.daysAgo)}
                </span>
              </p>
              <p className="text-base text-ink-muted">
                {`Debater feedback: ${feedbackLabel(ballot)}`}
              </p>
              {ballot.comment ? (
                <p className="text-base leading-normal italic">
                  {`“${ballot.comment}”`}
                </p>
              ) : null}
              {ballot.review ? (
                <p className="text-sm text-gold">{ballot.review}</p>
              ) : null}
            </div>
            <span
              className={`shrink-0 text-md font-bold tabular-nums ${toneClass[deltaTone(ballot.delta)]}`}
            >
              {deltaLabel(ballot.delta)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
