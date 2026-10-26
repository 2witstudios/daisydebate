import type { RoundBallotRead } from '@daisy/protocol';
import { ballotDebaters } from '../../features/round-ballots/presentation';
import { BallotSummary } from './ballot-summary/ballot-summary';
import { StoredBallotScores } from './stored-ballot-scores';
/** Completion releases submitted records, without exposing any judge identity or inventing a companion. */
export function RoundBallotResults({
  view,
}: {
  readonly view: RoundBallotRead;
}) {
  if (view.round.status !== 'completed' || !view.ballots.length) return null;
  const debaters = ballotDebaters(view);
  return (
    <section aria-label="Recorded ballots" className="flex flex-col gap-6 p-4">
      <h2 className="text-lg font-strong">Recorded ballots</h2>
      {view.ballots.map((entry, index) => (
        <section
          key={index}
          aria-label={`Ballot ${index + 1}`}
          className="flex min-w-0 flex-col gap-4"
        >
          {entry.status === 'voided' ? <p>This ballot is voided.</p> : null}
          <BallotSummary
            title={`Ballot ${index + 1}`}
            ballot={entry.ballot}
            debaters={debaters}
          />
          <StoredBallotScores
            title={`Ballot ${index + 1} scores`}
            ballot={entry.ballot}
            debaters={debaters}
          />
        </section>
      ))}
    </section>
  );
}
