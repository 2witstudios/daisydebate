import Link from 'next/link';
import type { SearchScreen } from '../../../features/ranked/drive-match';
import { Icon } from '../../components/icon/icon';
import { AutoAdvance } from '../auto-advance/auto-advance';
import { ElapsedClock } from '../match-progress/elapsed-clock';
import { linkButtonClass } from '../ranked-card/link-button-class';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';
import { cn } from '../../cn';

/**
 * Searching: a pulsing ring and a timer. Never a list of players, and nobody
 * sees you searching.
 */
export function MatchSearch({ screen }: { readonly screen: SearchScreen }) {
  return (
    <RankedCard>
      <AutoAdvance advance={screen.advance} />
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        <div className="relative size-16" aria-hidden="true">
          <span className="absolute inset-0 animate-live-pulse rounded-full border-2 border-accent motion-reduce:animate-none" />
          <span className="absolute inset-0 flex items-center justify-center rounded-full border border-accent bg-accent-soft text-accent">
            <Icon name="swords" size={26} />
          </span>
        </div>
        <h1 className={cn(cardTitleClass, 'text-2xl')}>Finding a match</h1>
        <p className="text-md text-ink-muted">Ranked · standard rules</p>
        <ElapsedClock />
      </div>
      <Link
        href={screen.cancelHref}
        className={linkButtonClass('secondary', 'w-full')}
      >
        Cancel search
      </Link>
    </RankedCard>
  );
}
