import Link from 'next/link';
import { lobbyHref, openRoomHref } from '../../../features/play/options';
import {
  activeRoomDotClass,
  activeRoomPhaseLabel,
  stageActionClass,
  type ActiveRoomSummary,
} from '../../active-room/your-room';
import { MediaPageLink } from '../../round-media/media-page-link';

const secondaryClass =
  'inline-flex items-center justify-center rounded-sm border border-stage-ink-muted px-5 py-3 text-base leading-tight font-strong text-stage-ink no-underline hover:border-stage-ink hover:no-underline';

/**
 * A member's Home hero: the way back into their Room while they hold one,
 * otherwise the way into the Lobby. Visitors get the waitlist hero instead.
 */
export function MemberHero({
  username,
  activeRoom,
}: {
  readonly username: string;
  readonly activeRoom: ActiveRoomSummary | null;
}) {
  return (
    <section className="flex flex-col gap-5 rounded-xl bg-surface-stage px-8 py-10 text-stage-ink max-compact:px-5 max-compact:py-8">
      {activeRoom ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-heavy tracking-wider text-stage-ink-muted uppercase">
            <span
              className={activeRoomDotClass(activeRoom.phase)}
              aria-hidden="true"
            />
            You&rsquo;re in a room · {activeRoomPhaseLabel(activeRoom.phase)}
          </p>
          <h1 className="font-display text-4xl font-bold text-balance max-compact:text-3xl">
            {activeRoom.title}
          </h1>
        </div>
      ) : (
        <h1 className="font-display text-4xl font-bold text-balance max-compact:text-3xl">
          Welcome back, {username}
        </h1>
      )}
      <div className="flex flex-wrap gap-3">
        {activeRoom ? (
          <>
            <MediaPageLink href={activeRoom.href} className={stageActionClass}>
              Return to room
            </MediaPageLink>
            <Link href={lobbyHref} className={secondaryClass}>
              Lobby
            </Link>
          </>
        ) : (
          <>
            <Link href={lobbyHref} className={stageActionClass}>
              Go to the Lobby
            </Link>
            <Link href={openRoomHref} className={secondaryClass}>
              New room
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
