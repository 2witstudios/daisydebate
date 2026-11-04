import Link from 'next/link';
import { destinationHref } from '../../../features/destinations/destinations';
import { openRoomHref } from '../../../features/play/options';
import {
  activeRoomDotClass,
  activeRoomPhaseLabel,
  type ActiveRoomSummary,
} from '../../active-room/your-room';
import { cn } from '../../cn';
import { buttonClass } from '../../components/button/button-class';
import { HeroPhoto } from '../hero-banner/hero-photo';
import { MediaPageLink } from '../../round-media/media-page-link';

const primaryClass = `${buttonClass('primary')} no-underline hover:no-underline`;
const secondaryClass = `${buttonClass('on-media')} no-underline hover:no-underline`;

/**
 * A member's Home hero: the way back into their Room while they hold one,
 * otherwise the way into the Lobby. It keeps the Home photograph the visitor
 * hero shows. Visitors get the waitlist hero instead. On a phone the menu is
 * the way in, so the hero stays only while it holds the way back to a Room.
 */
export function MemberHero({
  username,
  activeRoom,
}: {
  readonly username: string;
  readonly activeRoom: ActiveRoomSummary | null;
}) {
  const hero = (
    <section
      className={cn(
        'relative isolate flex min-h-hero-min items-end overflow-hidden rounded-xl p-10 text-ink-on-media max-tiles:min-h-hero-min-compact max-tiles:p-6 max-tiny:min-h-hero-min-tiny max-tiny:p-5',
        activeRoom === null ? 'max-narrow:hidden' : '',
      )}
    >
      <HeroPhoto />
      <div className="relative flex max-w-hero-content flex-col items-start gap-5">
        {activeRoom ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm font-heavy tracking-wider text-ink-on-media/85 uppercase text-shadow-hero-sub">
              <span
                className={activeRoomDotClass(activeRoom.phase)}
                aria-hidden="true"
              />
              You&rsquo;re in a room · {activeRoomPhaseLabel(activeRoom.phase)}
            </p>
            <h1 className="font-display text-3xl font-bold text-balance text-shadow-hero-headline max-compact:text-2xl">
              {activeRoom.title}
            </h1>
          </div>
        ) : (
          <h1 className="font-display text-3xl font-bold text-balance text-shadow-hero-headline max-compact:text-2xl">
            Welcome back, {username}
          </h1>
        )}
        <div className="flex flex-wrap gap-3">
          {activeRoom ? (
            <>
              <MediaPageLink href={activeRoom.href} className={primaryClass}>
                Return to room
              </MediaPageLink>
              <Link href={destinationHref('lobby')} className={secondaryClass}>
                Lobby
              </Link>
            </>
          ) : (
            <>
              <Link href={destinationHref('lobby')} className={primaryClass}>
                Go to the Lobby
              </Link>
              <Link href={openRoomHref} className={secondaryClass}>
                New room
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
  if (activeRoom !== null) return hero;
  return (
    <>
      {/* The hero holds the page's heading, so a phone keeps one of its own. */}
      <h1 className="sr-only hidden max-narrow:block">
        Welcome back, {username}
      </h1>
      {hero}
    </>
  );
}
