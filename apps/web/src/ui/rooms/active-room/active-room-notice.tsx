import Link from 'next/link';
import type { ActiveRoom } from '@daisy/protocol';

const phaseLabels = {
  assembling: 'getting ready',
  ready: 'ready to start',
  live: 'live now',
} as const;

/**
 * The member's one active Room (ADR 0070) and the way back to it. Minimal
 * on purpose: the lobby and shell designs own its final placement and look.
 */
export function ActiveRoomNotice({
  activeRoom,
}: {
  readonly activeRoom: ActiveRoom;
}) {
  return (
    <p
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm"
    >
      <span className="min-w-0 wrap-anywhere">
        You are in <strong>{activeRoom.title}</strong>,{' '}
        {phaseLabels[activeRoom.phase]}.
      </span>
      <Link href={activeRoom.href} className="font-strong text-accent">
        Return to room
      </Link>
    </p>
  );
}
