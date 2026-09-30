import Link from 'next/link';
import type { EndedScreen } from '../../../features/ranked/drive-match';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import { linkButtonClass } from '../ranked-card/link-button-class';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';

/**
 * One neutral message for every way a match can fall through. It never says
 * who declined, and it never touches the rating.
 */
export function MatchEnded({ screen }: { readonly screen: EndedScreen }) {
  return (
    <RankedCard>
      <div>
        <Badge>Search ended</Badge>
      </div>
      <h1 className={cn(cardTitleClass, 'text-2xl')}>
        The match did not go ahead
      </h1>
      <p className="text-md text-ink-muted">
        It was declined or timed out. Nothing changed on your rating.
      </p>
      <Link
        href={screen.restartHref}
        className={linkButtonClass('primary', 'w-full')}
      >
        Find a match
      </Link>
      <Link
        href={screen.backHref}
        className={linkButtonClass('secondary', 'w-full')}
      >
        Back to Ranked
      </Link>
    </RankedCard>
  );
}
