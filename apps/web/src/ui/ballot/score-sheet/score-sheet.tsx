'use client';

import {
  ballotRubric,
  ballotScoreMax,
  speakerTotal,
  type BallotCategory,
} from '@daisy/protocol';
import type { Side } from '../../../features/debates/turns';
import type { BallotDebaters } from '../../../features/judge/ballot';
import { scoreField } from '../../../features/judge/ballot';
import { cn } from '../../cn';
import {
  ballotEyebrowClass,
  ballotGridClass,
  ballotLabelCellClass,
  ballotSideCellClass,
  sideControlClass,
  sideTextClass,
} from '../ballot-class';
import { firstName, sideShort } from '../ballot-labels';

const sides = ['affirmative', 'negative'] as const satisfies readonly Side[];
const anchorLevels = [1, 3, 5] as const;
const rowClass = 'border-t border-border px-5 max-narrow:px-4';

export type SheetScores = Readonly<
  Record<Side, Readonly<Record<BallotCategory, number>>>
>;

/**
 * The speaker scores: one row per rubric category, a 1–5 slider for each
 * debater, and each side's total out of 50. Every slider is a named range
 * input, so the sheet posts without JavaScript; the category name opens
 * what a 1, a 3 and a 5 look like.
 */
export function ScoreSheet({
  debaters,
  scores,
  onScore,
}: {
  readonly debaters: BallotDebaters;
  readonly scores: SheetScores;
  readonly onScore: (
    side: Side,
    category: BallotCategory,
    score: number,
  ) => void;
}) {
  const max = ballotRubric.reduce(
    (sum, group) => sum + group.categories.length * ballotScoreMax,
    0,
  );
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div
        className={cn(
          ballotGridClass,
          'bg-surface px-5 py-3 max-narrow:hidden',
          ballotEyebrowClass,
        )}
      >
        <span className={ballotLabelCellClass}>Category</span>
        {sides.map((side) => (
          <span
            key={side}
            className={cn(ballotSideCellClass, sideTextClass(side))}
          >
            {`${firstName(debaters[side].name)} · ${sideShort[side]}`}
          </span>
        ))}
      </div>
      {ballotRubric.map((group) => (
        <div key={group.id} role="group" aria-label={group.name}>
          <p className={cn(rowClass, 'pt-4 pb-1', ballotEyebrowClass)}>
            {group.name}
          </p>
          {group.categories.map((category, index) => (
            <div
              key={category.id}
              className={cn(
                ballotGridClass,
                'px-5 py-3 max-narrow:px-4',
                index > 0 && 'border-t border-border',
              )}
            >
              <details className={ballotLabelCellClass}>
                <summary className="w-fit cursor-pointer list-none font-strong text-ink">
                  {category.name}
                  <span className="block text-sm font-book text-ink-muted">
                    {category.rewards}
                  </span>
                </summary>
                <dl className="mt-2 flex flex-col gap-1 text-sm text-ink-muted">
                  {category.anchors.map((anchor, index) => (
                    <div key={anchorLevels[index]} className="flex gap-2">
                      <dt className="w-4 shrink-0 font-bold text-ink tabular-nums">
                        {anchorLevels[index]}
                      </dt>
                      <dd>{anchor}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              {sides.map((side) => {
                const value = scores[side][category.id];
                return (
                  <label
                    key={side}
                    className={cn(
                      ballotSideCellClass,
                      'flex items-center gap-3 max-narrow:pt-2',
                    )}
                  >
                    <span className="sr-only">
                      {`${category.name}, ${debaters[side].name}`}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'hidden max-narrow:inline',
                        ballotEyebrowClass,
                        sideTextClass(side),
                      )}
                    >
                      {firstName(debaters[side].name)}
                    </span>
                    <input
                      type="range"
                      name={scoreField(side, category.id)}
                      min={1}
                      max={ballotScoreMax}
                      step={1}
                      value={value}
                      onChange={(event) =>
                        onScore(side, category.id, Number(event.target.value))
                      }
                      className={cn(
                        'h-6 min-w-0 flex-1 cursor-pointer',
                        sideControlClass(side),
                      )}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'w-4 text-right font-bold tabular-nums',
                        sideTextClass(side),
                      )}
                    >
                      {value}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      <div
        className={cn(
          ballotGridClass,
          'border-t border-border-strong bg-surface px-5 py-4 max-narrow:px-4',
        )}
      >
        <span className={cn(ballotLabelCellClass, 'font-bold text-ink')}>
          Speaker score
        </span>
        {sides.map((side) => (
          <span
            key={side}
            className={cn(
              ballotSideCellClass,
              'flex items-baseline gap-1 max-narrow:pt-2',
            )}
            aria-label={`${debaters[side].name}, ${speakerTotal(scores[side])} of ${max}`}
          >
            <span
              className={cn(
                'font-display text-2xl leading-tight font-bold tabular-nums',
                sideTextClass(side),
              )}
            >
              {speakerTotal(scores[side])}
            </span>
            <span className="text-sm text-ink-faint">{`/ ${max}`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
