import Link from 'next/link';
import type { HubScreen } from '../../../features/ranked/drive-match';
import { cn } from '../../cn';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';
import { linkButtonClass } from '../ranked-card/link-button-class';
import { RatingDisplay } from '../rating-display/rating-display';
import { RulesDrawer } from '../rules-drawer/rules-drawer';

/** Where you go to queue: your rating, one button, and the rules. */
export function RankedHub({ screen }: { readonly screen: HubScreen }) {
  return (
    <>
      <RankedCard>
        <h1 className={cn(cardTitleClass, 'text-3xl')}>Ranked</h1>
        <RatingDisplay standing={screen.standing} />
        <Link
          href={screen.findMatchHref}
          className={linkButtonClass('primary', 'min-h-16 w-full text-lg')}
        >
          Find a match
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-1">
          <Link
            href={screen.openRulesHref}
            className={linkButtonClass('ghost')}
          >
            Ranked rules
          </Link>
          <Link href={screen.hostHref} className={linkButtonClass('ghost')}>
            Host a ranked table
          </Link>
        </div>
      </RankedCard>
      {screen.rulesOpen ? (
        <RulesDrawer rules={screen.rules} closeHref={screen.closeRulesHref} />
      ) : null}
    </>
  );
}
