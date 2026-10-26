import { statusDotClass } from '../components/status-line/status-line-class';
import { MediaPageLink } from '../round-media/media-page-link';

/** The viewer's one active Room , as the shell, Lobby and Home show it. */
export type ActiveRoomSummary = {
  readonly title: string;
  readonly phase: 'assembling' | 'ready' | 'live';
  /** The page that holds the member: the Room, or its live Round's room. */
  readonly href: string;
};

const phaseLabels: Readonly<Record<ActiveRoomSummary['phase'], string>> = {
  assembling: 'Gathering',
  ready: 'Ready to start',
  live: 'Live',
};

export const activeRoomPhaseLabel = (
  phase: ActiveRoomSummary['phase'],
): string => phaseLabels[phase];

/** The Room's state as a dot: red while its Round is live. */
export const activeRoomDotClass = (phase: ActiveRoomSummary['phase']) =>
  statusDotClass(phase === 'live' ? 'live' : 'online');

/** Yolk on the forest stage: the one bright control on a stage card. */
export const stageActionClass =
  'inline-flex items-center justify-center rounded-sm bg-yolk px-5 py-3 text-base leading-tight font-strong text-forest no-underline hover:bg-butter hover:no-underline';

/**
 * The viewer's own Room pinned above everything else, with one way back:
 * the Lobby's first row and the member's Home hero.
 */
export function YourRoom({ room }: { readonly room: ActiveRoomSummary }) {
  return (
    <section
      aria-label="Your room"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg bg-surface-stage px-5 py-4 text-stage-ink"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-center gap-2 text-xs font-heavy tracking-wider text-stage-ink-muted uppercase">
          <span className={activeRoomDotClass(room.phase)} aria-hidden="true" />
          You&rsquo;re in · {activeRoomPhaseLabel(room.phase)}
        </p>
        <p className="truncate text-lg font-strong">{room.title}</p>
      </div>
      <MediaPageLink href={room.href} className={stageActionClass}>
        Return to room
      </MediaPageLink>
    </section>
  );
}
