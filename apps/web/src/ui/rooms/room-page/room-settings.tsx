import { leadSeatOf, sideOfSeat, type RoomView } from '@daisy/protocol';
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

/**
 * The saved speech order at a glance, each speech as wide as its share of
 * the clock. Decorative: the Speech order list below carries the words.
 */
function SpeechBar({ view }: { readonly view: RoomView }) {
  return (
    <ol aria-hidden="true" className="flex gap-1">
      {view.rules.segments.map((segment) => (
        <li
          key={segment.key}
          title={`${speechName(segment)} · ${clockDuration(segment.durationMs)}`}
          className={`flex min-w-0 basis-0 justify-center rounded-sm py-2 text-xs font-strong ${speechGrow(segment.durationMs)} ${speechTone(view, segment)}`}
        >
          <span className="truncate">{segment.key}</span>
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
      <details className="text-sm">
        <summary className="flex min-h-room-target cursor-pointer items-center font-strong">
          Speech order
        </summary>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-ink-muted">
          {view.rules.segments.map((segment) => (
            <li key={segment.key}>
              <span className="text-ink">{speechName(segment)}</span> ·{' '}
              {segmentSeatLabel(view.rules.sides, segment.speak)} ·{' '}
              <span className="tabular-nums">
                {clockDuration(segment.durationMs)}
              </span>
            </li>
          ))}
        </ol>
      </details>
      <dl
        aria-label="Saved round settings"
        className="flex flex-col gap-2 text-sm"
      >
        {settingRows(view).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
