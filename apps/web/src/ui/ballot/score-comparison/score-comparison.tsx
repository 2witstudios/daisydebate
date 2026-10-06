import {
  ballotRubric,
  debateSides,
  speakerTotal,
  type Ballot,
  type BallotCategory,
} from '@daisy/protocol';
import type { ReactNode } from 'react';
import type { BallotDebaters } from '../../../features/judge/ballot';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import { ballotEyebrowClass, sideTextClass } from '../ballot-class';
import { firstName } from '../ballot-labels';

/** A category the two judges scored this far apart, for either side, is marked. */
const splitGap = 2;

/**
 * Category, judge, AI judge, laid out by the comparison's own width
 * (`@container`), since the result column it sits in can be narrow at any
 * viewport. Wide, the three share a line; narrow, the category heads its
 * row and each judge's cell names the judge above its numbers.
 */
const rowClass =
  'grid grid-cols-2 items-start gap-x-3 gap-y-2 px-3 py-3 @ballot-compare:grid-cols-4 @ballot-compare:gap-x-4 @ballot-compare:gap-y-0 @ballot-compare:px-4';
const labelClass = 'col-span-2 min-w-0';
const cellClass = 'col-span-1 flex min-w-0 flex-col gap-1';
const judges = [
  { key: 'judge', title: 'Judge' },
  { key: 'ai', title: 'AI judge' },
] as const;

type Category = (typeof ballotRubric)[number]['categories'][number];

const isSplit = (
  judge: Ballot,
  ai: Ballot,
  category: BallotCategory,
): boolean =>
  debateSides.some(
    (side) =>
      Math.abs(judge.scores[side][category] - ai.scores[side][category]) >=
      splitGap,
  );

/** Both debaters' numbers, each in its side's colour and named for a screen reader. */
function Pair({
  debaters,
  values,
  className,
}: {
  readonly debaters: BallotDebaters;
  readonly values: (side: (typeof debateSides)[number]) => number;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        'flex gap-2 font-bold tabular-nums @ballot-compare:gap-3',
        className,
      )}
    >
      {debateSides.map((side) => (
        <span key={side} className={sideTextClass(side)}>
          <span className="sr-only">{`${debaters[side].name} `}</span>
          {values(side)}
        </span>
      ))}
    </span>
  );
}

/** The judge a cell belongs to, shown when narrow, where the head row is hidden. */
function CellLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn('@ballot-compare:hidden', ballotEyebrowClass)}
    >
      {children}
    </span>
  );
}

function CategoryName({
  ai,
  category,
  debaters,
  split,
}: {
  readonly ai: Ballot;
  readonly category: Category;
  readonly debaters: BallotDebaters;
  readonly split: boolean;
}) {
  const name = (
    <>
      {category.name}
      {split ? (
        <span className="ml-2 align-middle">
          <Badge tone="clay">Split</Badge>
        </span>
      ) : null}
    </>
  );
  const cited = debateSides.flatMap((side) => {
    const citation = ai.citations?.[side]?.[category.id];
    return citation === undefined ? [] : [{ side, citation }];
  });
  if (cited.length === 0) return name;
  return (
    <details>
      <summary className="w-fit cursor-pointer">{name}</summary>
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
    </details>
  );
}

/**
 * A finished round's scores, the judge's beside the AI judge's: one row per
 * rubric category and each side's speaker score, with both debaters' numbers
 * in their side's colour. A category the two scored apart is marked Split;
 * where the AI judge cited turns, the category name opens them.
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
  const ballots = { judge, ai } as const;
  return (
    <div className="@container flex flex-col gap-3">
      <p className="flex flex-wrap gap-x-4 text-sm font-strong">
        {debateSides.map((side) => (
          <span key={side} className={sideTextClass(side)}>
            {debaters[side].name}
          </span>
        ))}
      </p>
      <div
        role="table"
        aria-label="Speaker scores"
        className="overflow-hidden rounded-lg border border-border bg-background"
      >
        <div role="rowgroup">
          <div
            role="row"
            className={cn(
              rowClass,
              'sr-only bg-surface @ballot-compare:not-sr-only',
              ballotEyebrowClass,
            )}
          >
            <span role="columnheader" className={labelClass}>
              Category
            </span>
            {judges.map(({ key, title }) => (
              <span key={key} role="columnheader" className={cellClass}>
                {title}
              </span>
            ))}
          </div>
        </div>
        {ballotRubric.map((group) => (
          <div key={group.id} role="rowgroup" aria-label={group.name}>
            <p
              aria-hidden="true"
              className={cn(
                'border-t border-border px-3 pt-4 pb-1 @ballot-compare:px-4',
                ballotEyebrowClass,
              )}
            >
              {group.name}
            </p>
            {group.categories.map((category) => (
              <div key={category.id} role="row" className={rowClass}>
                <span
                  role="rowheader"
                  className={cn(labelClass, 'font-strong text-ink')}
                >
                  <CategoryName
                    ai={ai}
                    category={category}
                    debaters={debaters}
                    split={isSplit(judge, ai, category.id)}
                  />
                </span>
                {judges.map(({ key, title }) => (
                  <span key={key} role="cell" className={cellClass}>
                    <CellLabel>{title}</CellLabel>
                    <Pair
                      debaters={debaters}
                      values={(side) => ballots[key].scores[side][category.id]}
                    />
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
        <div role="rowgroup">
          <div
            role="row"
            className={cn(rowClass, 'border-t border-border-strong bg-surface')}
          >
            <span
              role="rowheader"
              className={cn(labelClass, 'font-bold text-ink')}
            >
              Speaker score
            </span>
            {judges.map(({ key, title }) => (
              <span key={key} role="cell" className={cellClass}>
                <CellLabel>{title}</CellLabel>
                <Pair
                  debaters={debaters}
                  values={(side) => speakerTotal(ballots[key].scores[side])}
                  className="font-display text-md @ballot-compare:text-xl"
                />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
