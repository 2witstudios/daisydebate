import type { MatchOpponent } from '../../../features/ranked/match-flow';
import { Avatar } from '../../components/avatar/avatar';

/** The opponent as an offer shows them: handle, status and rating. */
export function MatchOpponentCard({
  opponent,
}: {
  readonly opponent: MatchOpponent;
}) {
  const status =
    opponent.status === 'established' ? 'Established' : 'Provisional';
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-surface-raised p-4">
      <Avatar name={opponent.handle} size="lg" nameVisible />
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-lg font-bold">{`@${opponent.handle}`}</span>
        <span className="text-sm text-ink-muted">{status}</span>
      </div>
      <span className="text-xl font-bold tabular-nums">{opponent.rating}</span>
    </div>
  );
}
