import {
  ballotRubric,
  debateSides,
  speakerTotal,
  type Ballot,
} from '@daisy/protocol';
import type { BallotDebaters } from '../../features/judge/ballot';
/** Stored values only: every ballot has the same two authoritative sides and rubric. */
export function StoredBallotScores({
  title,
  ballot,
  debaters,
}: {
  readonly title: string;
  readonly ballot: Ballot;
  readonly debaters: BallotDebaters;
}) {
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="pb-3 text-left font-strong">{title}</caption>
      <thead>
        <tr>
          <th scope="col" className="p-2 text-left">
            Category
          </th>
          {debateSides.map((side) => (
            <th key={side} scope="col" className="p-2 text-left wrap-anywhere">
              {debaters[side].name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ballotRubric.flatMap((group) =>
          group.categories.map((category) => (
            <tr key={category.id} className="border-t border-border">
              <th scope="row" className="p-2 text-left font-book wrap-anywhere">
                {category.name}
              </th>
              {debateSides.map((side) => (
                <td key={side} className="p-2 tabular-nums">
                  {ballot.scores[side][category.id]}
                </td>
              ))}
            </tr>
          )),
        )}
        <tr className="border-t border-border font-strong">
          <th scope="row" className="p-2 text-left">
            Total
          </th>
          {debateSides.map((side) => (
            <td key={side} className="p-2 tabular-nums">
              {speakerTotal(ballot.scores[side])} / 50
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
