import Link from 'next/link';
import type { EnteringScreen } from '../../../features/ranked/drive-match';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import { AutoAdvance } from '../auto-advance/auto-advance';
import { linkButtonClass } from '../ranked-card/link-button-class';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';

/** The room is open: enter now, or it opens by itself in a moment. */
export function MatchEntering({ screen }: { readonly screen: EnteringScreen }) {
  const handle = `@${screen.opponent.handle}`;
  return (
    <RankedCard>
      <AutoAdvance advance={screen.advance} />
      <div>
        <Badge tone="accent">Room open</Badge>
      </div>
      <h1 className={cn(cardTitleClass, 'text-2xl')}>Your room is ready</h1>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4">
        <p className="text-base text-ink-muted">
          Ranked · standard rules · sides are Aff and Neg
        </p>
        <p className="flex flex-wrap items-center gap-3 font-strong">
          <Avatar name="You" size="sm" nameVisible />
          <span>You</span>
          <span className="text-ink-faint">vs</span>
          <Avatar name={screen.opponent.handle} size="sm" nameVisible />
          <span>{handle}</span>
        </p>
      </div>
      <Link
        href={screen.enterHref}
        className={linkButtonClass('primary', 'min-h-16 w-full text-lg')}
      >
        Enter room
      </Link>
      <p className="text-center text-sm text-ink-muted">
        Entering automatically in a moment.
      </p>
    </RankedCard>
  );
}
