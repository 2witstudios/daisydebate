import { pointsTotal, type Ballot } from '@daisy/protocol/ballot-schema';
import {
  storedBallotPlan,
  type BallotPlan,
} from '../../features/judge/ballot-plan';
import { sheetGroupsOf, sheetMax } from '../../features/judge/ballot-sheet';

/** One stored score: a criterion's, or the subject's holistic score. */
const scoreIn = (
  score: number | Readonly<Record<string, number>> | undefined,
  row: string,
): number | undefined => (typeof score === 'number' ? score : score?.[row]);

/**
 * Stored values only: every scored subject the Round's ballot names, shown
 * on the definition revision the ballot was written on. A ballot that scores
 * nothing shows no table.
 */
export function StoredBallotScores({
  title,
  ballot,
  plan,
}: {
  readonly title: string;
  readonly ballot: Ballot;
  readonly plan: BallotPlan;
}) {
  const { points } = storedBallotPlan(plan, ballot).definition;
  const scores = ballot.scores;
  if (!points || !scores) return null;
  const rows = sheetGroupsOf(points).flatMap((group) => group.rows);
  const max = sheetMax(points);
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="pb-3 text-left font-strong">{title}</caption>
      <thead>
        <tr>
          <th scope="col" className="p-2 text-left">
            {points.criteria.kind === 'grid' ? 'Category' : 'Score'}
          </th>
          {plan.scored.map((subject) => (
            <th
              key={subject.key}
              scope="col"
              className="p-2 text-left wrap-anywhere"
            >
              {subject.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-border">
            <th scope="row" className="p-2 text-left font-book wrap-anywhere">
              {row.name}
            </th>
            {plan.scored.map((subject) => (
              <td key={subject.key} className="p-2 tabular-nums">
                {scoreIn(scores[subject.key], row.id)}
              </td>
            ))}
          </tr>
        ))}
        <tr className="border-t border-border font-strong">
          <th scope="row" className="p-2 text-left">
            Total
          </th>
          {plan.scored.map((subject) => (
            <td key={subject.key} className="p-2 tabular-nums">
              {pointsTotal(scores[subject.key] ?? 0)}
              {` / ${max}`}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
