import Link from 'next/link';
import type { HostScreen } from '../../../features/ranked/drive-host';
import { Badge } from '../../components/badge/badge';
import { cn } from '../../cn';
import { linkButtonClass } from '../ranked-card/link-button-class';
import { cardTitleClass, RankedCard } from '../ranked-card/ranked-card';

/** After posting: the table is in the lobby, waiting for an opponent. */
export function HostPosted({ screen }: { readonly screen: HostScreen }) {
  return (
    <RankedCard>
      <div>
        <Badge tone="accent">Table posted</Badge>
      </div>
      <h1 className={cn(cardTitleClass, 'text-2xl')}>
        Your table is in the lobby
      </h1>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-4">
        <p className="flex items-center gap-2">
          <Badge tone="accent">Ranked</Badge>
          <span className="text-base text-ink-muted">Standard rules</span>
        </p>
        <p className="text-md font-strong">{screen.seatText}</p>
        <p className="text-base text-ink-muted">
          Waiting for an opponent · you take your seat in the room
        </p>
      </div>
      <Link
        href={screen.lobbyHref}
        className={linkButtonClass('primary', 'w-full')}
      >
        View in the lobby
      </Link>
      <Link
        href={screen.closeHref}
        className={linkButtonClass('secondary', 'w-full')}
      >
        Close table
      </Link>
    </RankedCard>
  );
}
