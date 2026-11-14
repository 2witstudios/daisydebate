import type { PinnedRoom as Read } from '../../../features/tab/tournament';
import { ActionButton } from '../action-control/action-control';
import { eyebrowClass } from '../list-card/list-card';

/** The viewer's own Room pinned above everything else, with one way in. */
export function PinnedRoom({
  room,
  label = 'Your room',
}: {
  readonly room: Read;
  readonly label?: string;
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-hue-teal-soft px-5 py-4 text-ink"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={eyebrowClass}>{room.eyebrow}</p>
        <p className="text-lg font-strong">{room.title}</p>
        <p className="text-sm text-ink-muted">{room.detail}</p>
      </div>
      <ActionButton action={room.action} className="max-narrow:w-full" />
    </section>
  );
}
