import type {
  Bracket as Read,
  BracketSide,
  BracketStage,
} from '../../../features/tab/results';
import { cn } from '../../cn';
import { ActionLink } from '../action-control/action-control';
import { eyebrowClass } from '../list-card/list-card';

/** A stage's heading: its name, and that it is live or when it starts. */
export const stageHeading = (stage: BracketStage): string =>
  stage.state === 'live'
    ? `${stage.name} · live`
    : stage.time === null
      ? stage.name
      : `${stage.name} · ${stage.time}`;

/** One side of a fixture, with its ballots against the other's once decided. */
function Side({
  side,
  score,
}: {
  readonly side: BracketSide;
  readonly score: { readonly own: number; readonly other: number } | null;
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-3 px-3 py-2 text-sm',
        score !== null &&
          (score.own > score.other ? 'font-strong' : 'text-ink-muted'),
      )}
    >
      <span>
        <span className="tabular-nums">{side.seed}</span> {side.name}
      </span>
      {score === null ? null : (
        <span className="tabular-nums">
          {score.own}-{score.other}
        </span>
      )}
    </div>
  );
}

/** The elimination tree: one column a stage, each fixture a pair of entries. */
export function Bracket({ bracket }: { readonly bracket: Read }) {
  return (
    <section
      aria-label="Bracket"
      className="flex gap-4 overflow-x-auto rounded-lg border border-border bg-surface-raised p-4"
    >
      {bracket.stages.map((stage) => (
        <div
          key={stage.name}
          className="flex w-tab-stage shrink-0 flex-col gap-3"
        >
          <h2 className={eyebrowClass}>{stageHeading(stage)}</h2>
          <ul className="flex flex-1 flex-col justify-around gap-3">
            {stage.ties.map((tie) => (
              <li
                key={tie.top.name}
                className={cn(
                  'rounded-sm border bg-surface-raised',
                  stage.state === 'live' ? 'border-ink' : 'border-border',
                )}
              >
                <Side
                  side={tie.top}
                  score={
                    tie.result === null
                      ? null
                      : { own: tie.result.top, other: tie.result.bottom }
                  }
                />
                <div className="border-t border-border">
                  <Side
                    side={tie.bottom}
                    score={
                      tie.result === null
                        ? null
                        : { own: tie.result.bottom, other: tie.result.top }
                    }
                  />
                </div>
                {tie.room === null ? null : (
                  <p className="flex justify-between gap-3 border-t border-border px-3 py-2 text-sm text-ink-muted">
                    {tie.room}
                    {tie.watch === null ? null : (
                      <ActionLink
                        action={tie.watch}
                        about={`${tie.top.name} v ${tie.bottom.name}`}
                      />
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {stage.note === null ? null : (
            <p className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink-muted">
              {stage.note}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
