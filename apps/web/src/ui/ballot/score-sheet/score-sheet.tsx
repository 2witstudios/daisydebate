'use client';

import type { BallotPoints } from '../../../features/judge/ballot';
import type { BallotSubject } from '../../../features/judge/ballot-plan';
import {
  anchorsSummary,
  sheetGroupsOf,
  sheetMax,
  sheetTotal,
  type SheetScores,
} from '../../../features/judge/ballot-sheet';
import { cn } from '../../cn';
import { Icon } from '../../components/icon/icon';
import {
  ballotColumns,
  ballotEyebrowClass,
  ballotGridClass,
  ballotLabelCellClass,
  ballotSideCellClass,
  sideControlClass,
  sideTextClass,
} from '../ballot-class';
import { firstName } from '../ballot-labels';

const rowClass = 'border-t border-border px-5 max-narrow:px-3';

export type { SheetScores };

/**
 * The scores the Round's ballot definition asks for: one row per criterion
 * (or one holistic row), a slider on the definition's scale for each scored
 * subject, and each subject's total. Every slider is a named range
 * input the browser owns (`defaultValue`), so the sheet posts without
 * JavaScript and a form reset after a refusal restores what was posted; the
 * disclosure under each category opens what a 1, a 3 and a 5 look like. The numbers beside
 * the sliders and the totals follow the sliders only with script running,
 * so without it they are left out rather than shown stale.
 */
export function ScoreSheet({
  points,
  subjects,
  initial,
  scores,
  live,
  onScore,
}: {
  readonly points: BallotPoints;
  /** Who is scored, in column order. */
  readonly subjects: readonly BallotSubject[];
  /** The scores to render with: the last posted ones, or the start value. */
  readonly initial: SheetScores;
  /** The scores as the sliders now stand. */
  readonly scores: SheetScores;
  /** Whether script is running, so the read-outs can follow the sliders. */
  readonly live: boolean;
  readonly onScore: (subject: string, row: string, score: number) => void;
}) {
  const max = sheetMax(points);
  const columns = ballotColumns(subjects.length);
  const grid = ballotGridClass(subjects.length);
  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-background">
      <div
        className={cn(
          `hidden ${columns.head} items-center gap-x-4 bg-surface px-5 py-3 @ballot-sheet:grid`,
          ballotEyebrowClass,
        )}
      >
        <span className={ballotLabelCellClass}>
          {points.criteria.kind === 'grid' ? 'Category' : 'Score'}
        </span>
        {subjects.map((subject) => (
          <span
            key={subject.key}
            className={cn(ballotSideCellClass, sideTextClass(subject.tone))}
          >
            {`${firstName(subject.name)} · ${subject.short}`}
          </span>
        ))}
      </div>
      {sheetGroupsOf(points).map((group) => (
        <div key={group.id} role="group" aria-label={group.name ?? 'Score'}>
          {group.name ? (
            <p className={cn(rowClass, 'pt-4 pb-1', ballotEyebrowClass)}>
              {group.name}
            </p>
          ) : null}
          {group.rows.map((category, index) => (
            <div
              key={category.id}
              className={cn(
                grid,
                'px-5 py-3 max-narrow:px-3',
                index > 0 && 'border-t border-border',
              )}
            >
              <div className={ballotLabelCellClass}>
                <p className="font-strong text-ink">{category.name}</p>
                {category.rewards ? (
                  <p className="text-sm text-ink-muted">{category.rewards}</p>
                ) : null}
                {category.anchors.length > 0 ? (
                  <details className="group">
                    <summary className="inline-flex min-h-room-target w-fit cursor-pointer list-none items-center gap-1 text-sm font-strong text-ink underline underline-offset-2">
                      {anchorsSummary(category)}
                      <span className="sr-only">{` in ${category.name}`}</span>
                      <Icon
                        name="chevron-down"
                        size={14}
                        className="shrink-0 transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <dl className="mt-1 flex flex-col gap-1 text-sm text-ink-muted">
                      {category.anchors.map((anchor) => (
                        <div key={anchor.level} className="flex gap-2">
                          <dt className="w-4 shrink-0 font-bold text-ink tabular-nums">
                            {anchor.level}
                          </dt>
                          <dd>{anchor.text}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </div>
              {subjects.map((subject) => {
                const side = subject.key;
                const value = scores[side]?.[category.id];
                return (
                  <label
                    key={side}
                    className={cn(
                      ballotSideCellClass,
                      'flex flex-wrap items-center gap-x-3 @ballot-sheet:flex-nowrap',
                    )}
                  >
                    <span className="sr-only">
                      {`${category.name}, ${subject.name}`}
                    </span>
                    {/* Narrow: the name and the number share a line above a
                        full-width slider. Wide: the slider, then its number. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'min-w-0 flex-1 break-words @ballot-sheet:hidden',
                        ballotEyebrowClass,
                        sideTextClass(subject.tone),
                      )}
                    >
                      {firstName(subject.name)}
                    </span>
                    {live ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'w-4 text-right font-bold tabular-nums',
                          sideTextClass(subject.tone),
                        )}
                      >
                        {value}
                      </span>
                    ) : null}
                    <input
                      type="range"
                      name={category.field(side)}
                      min={points.scale.min}
                      max={points.scale.max}
                      step={points.scale.step}
                      defaultValue={initial[side]?.[category.id]}
                      onChange={(event) =>
                        onScore(side, category.id, Number(event.target.value))
                      }
                      className={cn(
                        'h-6 min-w-0 basis-full cursor-pointer @ballot-sheet:order-first @ballot-sheet:flex-1 @ballot-sheet:basis-auto',
                        sideControlClass(subject.tone),
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
            grid,
            'border-t border-border-strong bg-surface px-5 py-4 max-narrow:px-3',
          )}
        >
          <span className={cn(ballotLabelCellClass, 'font-bold text-ink')}>
            Speaker score
          </span>
          {subjects.map((subject) => (
            <p
              key={subject.key}
              className={cn(
                ballotSideCellClass,
                'flex flex-wrap items-baseline gap-x-1',
              )}
            >
              <span
                className={cn(
                  ballotEyebrowClass,
                  'min-w-0 basis-full wrap-anywhere @ballot-sheet:hidden',
                  sideTextClass(subject.tone),
                )}
                aria-hidden="true"
              >
                {firstName(subject.name)}
              </span>
              <span className="sr-only">{`${subject.name}: `}</span>
              <span
                className={cn(
                  'font-display text-2xl leading-tight font-bold tabular-nums',
                  sideTextClass(subject.tone),
                )}
              >
                {sheetTotal(scores[subject.key])}
              </span>
              <span className="text-sm text-ink-faint">{`/ ${max}`}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
