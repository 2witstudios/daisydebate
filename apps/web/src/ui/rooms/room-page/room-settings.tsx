import { leadSeatOf } from '@daisy/protocol/format-seating';
import { sideOfSeat } from '@daisy/protocol/seats';
import { type RoomView } from '@daisy/protocol/room-contract';
import { clockDuration } from '../../../features/rooms/duration-input';
import { speechName } from '../../../features/debate-room/vocabulary';
import { segmentSeatLabel } from './assembly-controls';
import { sideTone } from './side-tone';
import {
  formatLine,
  formatTitle,
  ROOM_SETUP_HREF,
  settingRows,
  speechGrow,
} from './room-labels';
import { ROOM_SETUP_HOME } from './room-setup-modal';

const neutralTone = 'bg-surface-sunken text-ink-muted';

/** A speech's tone is its speaker's side's; a cross-examination or an open floor is neutral. */
function speechTone(
  view: RoomView,
  segment: RoomView['rules']['segments'][number],
): string {
  if (segment.type !== 'speech') return neutralTone;
  const lead = leadSeatOf(segment.speak);
  const side = lead ? sideOfSeat(lead) : null;
  return side === null ? neutralTone : sideTone(view.rules.sides, side);
}

/** The saved speech order at a glance, each speech as wide as its share of the clock. */
function SpeechBar({ view }: { readonly view: RoomView }) {
  return (
    <ol aria-label="Speech order" className="flex gap-1">
      {view.rules.segments.map((segment) => (
        <li
          key={segment.key}
          title={`${speechName(segment)} · ${clockDuration(segment.durationMs)}`}
          className={`flex min-w-0 basis-0 justify-center rounded-sm py-2 text-xs font-strong ${speechGrow(segment.durationMs)} ${speechTone(view, segment)}`}
        >
          <span className="truncate">{segment.key}</span>
          <span className="sr-only">{`: ${speechName(segment)}, ${segmentSeatLabel(view.rules.sides, segment.speak)}, ${clockDuration(segment.durationMs)}`}</span>
        </li>
      ))}
    </ol>
  );
}

/** The saved round as a read-only preview; the host changes it in Edit settings. */
export function RoomSettings({ view }: { readonly view: RoomView }) {
  return (
    <section
      aria-labelledby="room-settings-title"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="room-settings-title" className="text-md font-semibold">
          Settings
        </h2>
        {view.capabilities.canEdit ? (
          <a
            href={ROOM_SETUP_HREF}
            {...{ [ROOM_SETUP_HOME]: '' }}
            className="inline-flex min-h-room-target items-center text-sm font-strong"
          >
            Edit settings
          </a>
        ) : null}
      </div>
      <p className="font-strong">
        {formatTitle(view.format)} · {formatLine(view)}
      </p>
      <SpeechBar view={view} />
      <dl aria-label="Saved round settings" className="flex flex-col text-sm">
        {settingRows(view).map(([label, value]) => (
          <div
            key={label}
            className="room-setting-row gap-3 border-t border-border py-2"
          >
            <dt className="text-ink-muted">{label}</dt>
            <dd className="min-w-0 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
