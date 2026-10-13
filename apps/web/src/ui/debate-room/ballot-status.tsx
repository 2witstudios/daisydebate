import { ballotLines } from '../../features/debate-room/judging';
import { cn } from '../cn';
import type { RoundSnapshot } from './round';

/** The ballots the judging window waits on, below the round controls. */
export function BallotStatus({ round }: { readonly round: RoundSnapshot }) {
  if (round.phase !== 'judging' || round.ballots === null) return null;
  return (
    <section
      aria-label="Ballots"
      className="grid shrink-0 grid-cols-2 gap-3 p-4 max-narrow:grid-cols-1"
    >
      {ballotLines(round.ballots, round.competition).map((line) => (
        <div
          key={line.title}
          className="flex items-center gap-3 rounded-md border border-border bg-surface-raised p-4"
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2.5 shrink-0 rounded-round',
              line.ready ? 'bg-online' : 'bg-gold',
            )}
          />
          <div className="flex min-w-0 flex-col">
            <span className="font-strong">{line.title}</span>
            <span className="text-sm text-ink-muted">{line.status}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
