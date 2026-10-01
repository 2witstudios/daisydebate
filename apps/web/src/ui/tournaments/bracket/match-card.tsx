import type { Match, Slot } from '../../../features/tournaments/bracket';
import { Icon } from '../../components/icon/icon';
import { StatusLine } from '../../components/status-line/status-line';
import { cn } from '../../cn';

function Side({
  slot,
  won,
  viewerHandle,
}: {
  readonly slot: Slot;
  readonly won: boolean;
  readonly viewerHandle: string | null;
}) {
  if (slot === null)
    return (
      <p className="px-3 py-2 text-base text-ink-faint italic">To be decided</p>
    );
  const you = slot.handle === viewerHandle;
  return (
    <p
      className={cn(
        'flex items-center gap-2 px-3 py-2 text-base',
        won ? 'font-strong text-ink' : 'text-ink-muted',
      )}
    >
      <span className="w-4 text-xs text-ink-faint tabular-nums">
        {slot.seed}
      </span>
      <span className="min-w-0 flex-1 truncate">{`@${slot.handle}`}</span>
      {you ? (
        <span className="text-xs font-bold text-accent uppercase">You</span>
      ) : null}
      {won ? (
        <span className="text-accent">
          <Icon name="check" size={14} label="Won" />
        </span>
      ) : null}
    </p>
  );
}

const stateLabel = (match: Match): string =>
  match.state === 'done' ? `${match.label}, done` : match.label;

/** One match: both seats, the winner marked, the judge and the status. */
export function MatchCard({
  match,
  viewerHandle,
}: {
  readonly match: Match;
  readonly viewerHandle: string | null;
}) {
  const mine = [match.a, match.b].some((slot) => slot?.handle === viewerHandle);
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-surface shadow-1',
        mine ? 'border-accent' : 'border-border',
      )}
    >
      <p className="border-b border-border px-3 py-2 text-xs font-bold tracking-wider text-ink-faint uppercase">
        {match.state === 'live' ? (
          <StatusLine tone="live">{`Live, ${match.watching} watching`}</StatusLine>
        ) : match.state === 'pending' && match.note ? (
          `${match.label}, ${match.note}`
        ) : (
          stateLabel(match)
        )}
      </p>
      <Side
        slot={match.a}
        won={match.winner === 'a'}
        viewerHandle={viewerHandle}
      />
      <div className="h-px bg-border" />
      <Side
        slot={match.b}
        won={match.winner === 'b'}
        viewerHandle={viewerHandle}
      />
      {match.judge ? (
        <p className="border-t border-border px-3 py-2 text-xs text-ink-faint">
          {`Judge @${match.judge}`}
        </p>
      ) : null}
    </div>
  );
}
