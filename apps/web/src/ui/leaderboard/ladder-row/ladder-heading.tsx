import { cn } from '../../cn';
import { ladderColumnClass, ladderGridClass } from './ladder-row-class';

/** The column heads over the ladder rows; the phone lists have none. */
export function LadderHeading({ closed }: { readonly closed: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        ladderGridClass,
        'px-5 py-3 text-2xs font-bold tracking-wider text-ink-faint uppercase max-compact:hidden',
      )}
    >
      <span className={ladderColumnClass('rank')}>Rank</span>
      <span className={ladderColumnClass('name')}>Debater</span>
      <span className={ladderColumnClass('rating')}>Rating</span>
      <span className={ladderColumnClass('record')}>W–L</span>
      <span className={ladderColumnClass('move')}>
        {closed ? 'Season' : '7 days'}
      </span>
    </div>
  );
}
