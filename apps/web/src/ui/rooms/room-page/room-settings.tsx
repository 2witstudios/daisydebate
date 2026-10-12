import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import type { FormAction } from '../../form-action/form-action';
import { clockDuration } from '../../../features/rooms/duration-input';
import { seatLabel } from './assembly-controls';
import { settingRows, speechGrow } from './room-labels';
import { AssemblySettingsForm } from './assembly-settings-form';

/** The saved speech order, each speech as wide as its share of the clock. */
function SpeechBar({ view }: { readonly view: RoomView }) {
  return (
    <ol aria-label="Speeches" className="flex flex-wrap gap-1">
      {view.rules.segments.map((segment) => (
        <li
          key={segment.key}
          title={`${segment.label} · ${seatLabel(segment.side, segment.slot)}`}
          className={`flex min-w-12 basis-0 flex-col items-center rounded-sm px-1 py-2 text-xs ${speechGrow(segment.durationMs)} ${segment.type === 'cross_ex' ? 'bg-surface-sunken' : 'bg-accent-soft'}`}
        >
          <span className="font-semibold">{segment.key}</span>
          <span className="sr-only">
            {segment.label}, {seatLabel(segment.side, segment.slot)}
          </span>
          <span className="text-ink-muted tabular-nums">
            {clockDuration(segment.durationMs)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RoomSettings({
  view,
  commandId,
  action,
}: {
  readonly view: RoomView;
  readonly commandId: string;
  readonly action: FormAction<MockFormState>;
}) {
  return (
    <section
      aria-labelledby="room-settings-title"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <h2 id="room-settings-title" className="text-md font-semibold">
        Settings
      </h2>
      <SpeechBar view={view} />
      <dl
        aria-label="Saved round settings"
        className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm max-tiny:grid-cols-1"
      >
        {settingRows(view).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs wrap-anywhere text-ink-muted">
        {view.formatId} · revision {view.formatVersion}
        {view.presetVersion === null ? '' : ` · preset ${view.presetVersion}`}
      </p>
      {view.capabilities.canEdit ? (
        <AssemblySettingsForm
          view={view}
          commandId={commandId}
          action={action}
        />
      ) : null}
    </section>
  );
}
