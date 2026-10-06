import {
  ballotRubric,
  speakerTotal,
  type Ballot,
  type BallotCategory,
} from '@daisy/protocol';
import type { Side } from '../../../features/debates/turns';
import type { BallotDebaters } from '../../../features/judge/ballot';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import { ballotEyebrowClass, sideTextClass } from '../ballot-class';
import { firstName } from '../ballot-labels';

const sides = ['affirmative', 'negative'] as const satisfies readonly Side[];
/** A category the two judges scored this far apart, for either side, is marked. */
const splitGap = 2;

const cellClass = 'border-t border-border px-4 py-3 text-center';
const scoreClass = 'font-bold tabular-nums';

const isSplit = (
  judge: Ballot,
  ai: Ballot,
  category: BallotCategory,
): boolean =>
  sides.some(
    (side) =>
      Math.abs(judge.scores[side][category] - ai.scores[side][category]) >=
      splitGap,
  );

function Citations({
  ai,
  category,
  debaters,
}: {
  readonly ai: Ballot;
  readonly category: BallotCategory;
  readonly debaters: BallotDebaters;
}) {
  const cited = sides.flatMap((side) => {
    const citation = ai.citations?.[side]?.[category];
    return citation === undefined ? [] : [{ side, citation }];
  });
  if (cited.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm font-book text-ink-muted">
      {cited.map(({ side, citation }) => (
        <li key={side}>
          <span className={cn('font-strong', sideTextClass(side))}>
            {`${firstName(debaters[side].name)} · ${citation.turn}`}
          </span>{' '}
          {citation.note}
        </li>
      ))}
    </ul>
  );
}

/**
 * A finished round's scores, the judge's beside the AI judge's: one row per
 * rubric category and each side's speaker score. A category the two scored
 * apart is marked Split; a category name opens the turns the AI judge cited.
 */
export function ScoreComparison({
  debaters,
  judge,
  ai,
}: {
  readonly debaters: BallotDebaters;
  readonly judge: Ballot;
  readonly ai: Ballot;
}) {
  const ballots = [judge, ai] as const;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full border-collapse text-base">
        <thead className="bg-surface">
          <tr>
            <th scope="col" className="px-4 pt-3 text-left">
              <span className="sr-only">Category</span>
            </th>
            <th
              scope="colgroup"
              colSpan={2}
              className={cn('px-4 pt-3', ballotEyebrowClass)}
            >
              Judge
            </th>
            <th
              scope="colgroup"
              colSpan={2}
              className={cn('px-4 pt-3', ballotEyebrowClass)}
            >
              AI judge
            </th>
          </tr>
          <tr>
            <th scope="col" className="px-4 pb-3" />
            {ballots.flatMap((_, at) =>
              sides.map((side) => (
                <th
                  key={`${at}-${side}`}
                  scope="col"
                  className={cn(
                    'px-4 pb-3 text-sm font-strong',
                    sideTextClass(side),
                  )}
                >
                  {firstName(debaters[side].name)}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {ballotRubric.flatMap((group) => [
            <tr key={group.id}>
              <th
                scope="colgroup"
                colSpan={5}
                className={cn(
                  'border-t border-border px-4 pt-4 pb-1 text-left',
                  ballotEyebrowClass,
                )}
              >
                {group.name}
              </th>
            </tr>,
            ...group.categories.map((category) => (
              <tr key={category.id}>
                <th
                  scope="row"
                  className="px-4 py-3 text-left align-top font-strong text-ink"
                >
                  <details>
                    <summary className="w-fit cursor-pointer list-none">
                      {category.name}
                      {isSplit(judge, ai, category.id) ? (
                        <span className="ml-2 align-middle">
                          <Badge tone="clay">Split</Badge>
                        </span>
                      ) : null}
                    </summary>
                    <Citations
                      ai={ai}
                      category={category.id}
                      debaters={debaters}
                    />
                  </details>
                </th>
                {ballots.flatMap((ballot, at) =>
                  sides.map((side) => (
                    <td
                      key={`${at}-${side}`}
                      className={cn(
                        'px-4 py-3 text-center align-top',
                        scoreClass,
                        sideTextClass(side),
                      )}
                    >
                      {ballot.scores[side][category.id]}
                    </td>
                  )),
                )}
              </tr>
            )),
          ])}
          <tr className="bg-surface">
            <th
              scope="row"
              className={cn(
                cellClass,
                'border-border-strong text-left font-bold text-ink',
              )}
            >
              Speaker score
            </th>
            {ballots.flatMap((ballot, at) =>
              sides.map((side) => (
                <td
                  key={`${at}-${side}`}
                  className={cn(
                    cellClass,
                    'border-border-strong font-display text-xl',
                    scoreClass,
                    sideTextClass(side),
                  )}
                >
                  {speakerTotal(ballot.scores[side])}
                </td>
              )),
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
