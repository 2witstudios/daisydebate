import type { ActiveRoom } from '@daisy/protocol';
import { roomStatusLabels } from '../../features/rooms/status-labels';
import { buttonClass } from '../components/button/button-class';
import { statusDotClass } from '../components/status-line/status-line-class';
import { MediaPageLink } from '../round-media/media-page-link';

/**
 * The viewer's one active Room (ADR 0070), as the shell, Lobby and Home show
 * it: `href` is the page that holds the member, the Room or its live Round's room.
 */
export type ActiveRoomSummary = Pick<
  ActiveRoom,
  'id' | 'title' | 'phase' | 'href'
>;

const phaseLabels: Readonly<Record<ActiveRoomSummary['phase'], string>> = {
  assembling: roomStatusLabels.assembling,
  ready: roomStatusLabels.ready,
  live: roomStatusLabels.started,
};

export const activeRoomPhaseLabel = (
  phase: ActiveRoomSummary['phase'],
): string => phaseLabels[phase];

/** The Room's state as a dot: red while its Round is live. */
export const activeRoomDotClass = (phase: ActiveRoomSummary['phase']) =>
  statusDotClass(phase === 'live' ? 'live' : 'online');

/**
 * The viewer's own Room pinned above everything else, with one way back:
 * the Lobby's first row and the member's Home hero.
 */
export function YourRoom({ room }: { readonly room: ActiveRoomSummary }) {
  return (
    <section
      aria-label="Your room"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-hue-teal-soft px-5 py-4 text-ink"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-center gap-2 text-xs font-heavy tracking-wider text-ink-muted uppercase">
          <span className={activeRoomDotClass(room.phase)} aria-hidden="true" />
          You&rsquo;re in · {activeRoomPhaseLabel(room.phase)}
        </p>
        <p className="truncate text-lg font-strong">{room.title}</p>
      </div>
      <MediaPageLink
        href={room.href}
        className={`${buttonClass('primary')} no-underline hover:no-underline`}
      >
        Return to room
      </MediaPageLink>
    </section>
  );
}
