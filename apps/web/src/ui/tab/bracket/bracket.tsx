import type {
  Bracket as Read,
  BracketSide,
  BracketStage,
} from '../../../features/tab/results';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { ActionButton } from '../action-control/action-control';
import { eyebrowClass } from '../list-card/list-card';

/** A stage's heading: its name, and that it is live or when it starts. */
export const stageHeading = (stage: BracketStage): string =>
  stage.state === 'live'
    ? `${stage.name} · live`
    : stage.time === null
      ? stage.name
      : `${stage.name} · ${stage.time}`;

/** One actual entry; two-entry fixtures retain the familiar ballot comparison. */
function Side({
  side,
  other,
}: {
  readonly side: BracketSide;
  readonly other: BracketSide | null;
}) {
  const score = side.outcome;
  return (
    <div
      className={cn(
        'flex justify-between gap-3 px-3 py-2 text-sm',
        score?.won === true ? 'font-strong' : score ? 'text-ink-muted' : '',
      )}
    >
      <span>
        {side.seed === null ? null : (
          <span className="tabular-nums">{side.seed} </span>
        )}
        {side.name}
      </span>
      {score === null ? null : (
        <span className="tabular-nums">
          {other &&
          score.ballotsWon !== null &&
          other.outcome?.ballotsWon !== null &&
          other.outcome?.ballotsWon !== undefined
            ? `${score.ballotsWon}-${other.outcome.ballotsWon}`
            : score.rank !== null
              ? `Rank ${score.rank}`
              : score.won === true
                ? 'Won'
                : score.won === false
                  ? 'Lost'
                  : score.ballotsWon === null
                    ? null
                    : `${score.ballotsWon} ballots`}
        </span>
      )}
    </div>
  );
}

/** The elimination tree: one column a stage, each fixture a pair of entries. */
function BracketRounds({ bracket }: { readonly bracket: Read }) {
  return (
    <section
      aria-label="Bracket"
      className="flex gap-4 overflow-x-auto rounded-lg border border-border bg-surface-raised p-4"
    >
      {bracket.stages.map((stage) => (
        <div
          key={stage.id}
          className="flex w-tab-stage shrink-0 flex-col gap-3"
        >
          <h2 className={eyebrowClass}>{stageHeading(stage)}</h2>
          <ul className="flex flex-1 flex-col justify-around gap-3">
            {stage.fixtures.map((tie) => (
              <li
                key={tie.fixtureId}
                className={cn(
                  'rounded-sm border bg-surface-raised',
                  stage.state === 'live' ? 'border-ink' : 'border-border',
                )}
              >
                {tie.entries.map((entry, index) => (
                  <div
                    key={entry.entryId}
                    className={
                      index === 0 ? undefined : 'border-t border-border'
                    }
                  >
                    <Side
                      side={entry}
                      other={
                        tie.entries.length === 2
                          ? (tie.entries[1 - index] ?? null)
                          : null
                      }
                    />
                  </div>
                ))}
                {tie.room === null ? null : (
                  <p className="flex justify-between gap-3 border-t border-border px-3 py-2 text-sm text-ink-muted">
                    {tie.room}
                    {tie.watch === null ? null : (
                      <ActionButton
                        size="small"
                        action={tie.watch}
                        about={tie.entries
                          .map((entry) => entry.name)
                          .join(' v ')}
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

/** Start at the live round; completed rounds remain available in one disclosure. */
export function Bracket({ bracket }: { readonly bracket: Read }) {
  const live = bracket.stages.findIndex((stage) => stage.state !== 'done');
  const from = Math.max(
    0,
    Math.min(
      live === -1 ? bracket.stages.length : live,
      bracket.stages.length - 3,
    ),
  );
  if (from === 0) return <BracketRounds bracket={bracket} />;
  return (
    <div className="flex flex-col gap-3">
      <details>
        <summary className={buttonClass('secondary')}>
          Show earlier rounds ·{' '}
          {bracket.stages
            .slice(0, from)
            .map((stage) => stage.name)
            .join(', ')}
        </summary>
        <BracketRounds bracket={{ stages: bracket.stages.slice(0, from) }} />
      </details>
      <BracketRounds bracket={{ stages: bracket.stages.slice(from) }} />
    </div>
  );
}
