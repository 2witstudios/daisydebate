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

function Side({
  side,
  other,
}: {
  readonly side: BracketSide;
  readonly other: BracketSide;
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-3 px-3 py-2 text-sm',
        side.won && 'font-strong',
        side.ballots !== null && !side.won && 'text-ink-muted',
      )}
    >
      <span>
        <span className="tabular-nums">{side.seed}</span> {side.name}
      </span>
      {side.ballots === null || other.ballots === null ? null : (
        <span className="tabular-nums">
          {side.ballots}-{other.ballots}
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
                <Side side={tie.top} other={tie.bottom} />
                <div className="border-t border-border">
                  <Side side={tie.bottom} other={tie.top} />
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
