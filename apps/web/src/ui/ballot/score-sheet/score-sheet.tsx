'use client';

import {
  ballotRubric,
  ballotScoreMax,
  debateSides,
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

const anchorLevels = [1, 3, 5] as const;
const rowClass = 'border-t border-border px-5 max-narrow:px-3';

export type SheetScores = Readonly<
  Record<Side, Readonly<Record<BallotCategory, number>>>
>;

/**
 * The speaker scores: one row per rubric category, a 1–5 slider for each
 * debater, and each side's total out of 50. Every slider is a named range
 * input the browser owns (`defaultValue`), so the sheet posts without
 * JavaScript and a form reset after a refusal restores what was posted; the
 * category name opens what a 1, a 3 and a 5 look like. The numbers beside
 * the sliders and the totals follow the sliders only with script running,
 * so without it they are left out rather than shown stale.
 */
export function ScoreSheet({
  debaters,
  initial,
  scores,
  live,
  onScore,
}: {
  readonly debaters: BallotDebaters;
  /** The scores to render with: the last posted ones, or the start value. */
  readonly initial: SheetScores;
  /** The scores as the sliders now stand. */
  readonly scores: SheetScores;
  /** Whether script is running, so the read-outs can follow the sliders. */
  readonly live: boolean;
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
    <div className="@container overflow-hidden rounded-lg border border-border bg-background">
      <div
        className={cn(
          'hidden grid-cols-4 items-center gap-x-4 bg-surface px-5 py-3 @ballot-sheet:grid',
          ballotEyebrowClass,
        )}
      >
        <span className={ballotLabelCellClass}>Category</span>
        {debateSides.map((side) => (
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
                'px-5 py-3 max-narrow:px-3',
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
              {debateSides.map((side) => {
                const value = scores[side][category.id];
                return (
                  <label
                    key={side}
                    className={cn(
                      ballotSideCellClass,
                      'flex flex-wrap items-center gap-x-3 @ballot-sheet:flex-nowrap',
                    )}
                  >
                    <span className="sr-only">
                      {`${category.name}, ${debaters[side].name}`}
                    </span>
                    {/* Narrow: the name and the number share a line above a
                        full-width slider. Wide: the slider, then its number. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'min-w-0 flex-1 break-words @ballot-sheet:hidden',
                        ballotEyebrowClass,
                        sideTextClass(side),
                      )}
                    >
                      {firstName(debaters[side].name)}
                    </span>
                    {live ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'w-4 text-right font-bold tabular-nums',
                          sideTextClass(side),
                        )}
                      >
                        {value}
                      </span>
                    ) : null}
                    <input
                      type="range"
                      name={scoreField(side, category.id)}
                      min={1}
                      max={ballotScoreMax}
                      step={1}
                      defaultValue={initial[side][category.id]}
                      onChange={(event) =>
                        onScore(side, category.id, Number(event.target.value))
                      }
                      className={cn(
                        'h-6 min-w-0 basis-full cursor-pointer @ballot-sheet:order-first @ballot-sheet:flex-1 @ballot-sheet:basis-auto',
                        sideControlClass(side),
                      )}
                    />
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      {live ? (
        <div
          className={cn(
            ballotGridClass,
            'border-t border-border-strong bg-surface px-5 py-4 max-narrow:px-3',
          )}
        >
          <span className={cn(ballotLabelCellClass, 'font-bold text-ink')}>
            Speaker score
          </span>
          {debateSides.map((side) => (
            <p
              key={side}
              className={cn(
                ballotSideCellClass,
                'flex flex-wrap items-baseline gap-x-1',
              )}
            >
              <span
                className={cn(
                  ballotEyebrowClass,
                  'basis-full break-words @ballot-sheet:hidden',
                  sideTextClass(side),
                )}
                aria-hidden="true"
              >
                {firstName(debaters[side].name)}
              </span>
              <span className="sr-only">{`${debaters[side].name}: `}</span>
              <span
                className={cn(
                  'font-display text-2xl leading-tight font-bold tabular-nums',
                  sideTextClass(side),
                )}
              >
                {speakerTotal(scores[side])}
              </span>
              <span className="text-sm text-ink-faint">{`/ ${max}`}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
