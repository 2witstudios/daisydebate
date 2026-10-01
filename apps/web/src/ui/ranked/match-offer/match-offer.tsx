import Link from 'next/link';
import type { OfferScreen } from '../../../features/ranked/drive-match';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import { AutoAdvance } from '../auto-advance/auto-advance';
import { MatchOpponentCard } from '../match-opponent/match-opponent';
import { Countdown } from '../match-progress/countdown';
import { linkButtonClass } from '../ranked-card/link-button-class';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';

/** A match was found: the opponent, a countdown, and Decline or Accept. */
export function MatchOffer({ screen }: { readonly screen: OfferScreen }) {
  return (
    <RankedCard>
      <AutoAdvance advance={screen.advance} />
      <div>
        <Badge tone="accent">Match found</Badge>
      </div>
      <h1 className={cn(cardTitleClass, 'text-2xl')}>Ready to debate?</h1>
      <MatchOpponentCard opponent={screen.opponent} />
      <Countdown seconds={screen.respondSeconds} />
      <div className="flex gap-3">
        <Link
          href={screen.declineHref}
          className={linkButtonClass('secondary', 'flex-1')}
        >
          Decline
        </Link>
        <Link
          href={screen.acceptHref}
          className={linkButtonClass('primary', 'flex-2')}
        >
          Accept
        </Link>
      </div>
    </RankedCard>
  );
}
