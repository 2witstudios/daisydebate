'use client';

import {
  DurationField,
  PreparationFields,
  InteractionFields,
} from './assembly-settings-controls';

import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { type FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyEditForm, AssemblyEditFeedback } from './assembly-edit-form';
import { DrawFields } from './assembly-draw-fields';
import { seatLabel } from './assembly-controls';
import { speechName } from '../../../features/debate-room/vocabulary';
import { openOnInvalid } from './room-setup-modal';

type Props = {
  readonly view: RoomView;
  readonly commandId: string;
  readonly state: MockFormState;
  readonly pending: boolean;
};
export function AssemblySettingsFields({
  view,
  commandId,
  state,
  pending,
}: Props) {
  const disabled = pending || !view.capabilities.canEdit;
  return (
    <>
      <input
        type="hidden"
        name="expectedVersion"
        value={state.values.expectedVersion ?? String(view.version)}
      />
      <input
        type="hidden"
        name="commandId"
        value={state.values.commandId ?? commandId}
      />
      <PreparationFields view={view} state={state} disabled={disabled} />
      <details
        open={state.error ? true : undefined}
        onInvalidCapture={openOnInvalid}
        className="border-t border-border pt-2"
      >
        <summary className="flex min-h-room-target cursor-pointer flex-col justify-center">
          <span className="font-strong">Customize speeches and rules</span>
          <span className="text-xs text-ink-muted">
            Speech times, countdown, cross-examination, interruptions and ending
            early. The format’s defaults suit most rounds.
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-6">
          <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-1 text-sm font-strong">Speech times</legend>
            {view.rules.segments.map((segment) => {
              const bounds =
                view.definition.configurable.timing.segmentDurationMs[
                  segment.key
                ];
              if (!bounds)
                throw new Error('Missing authoritative segment timing bounds');
              return (
                <DurationField
                  key={segment.key}
                  name={`segment.${segment.key}`}
                  label={speechName(segment)}
                  hint={seatLabel(segment.side, segment.slot)}
                  ms={segment.durationMs}
                  min={bounds.min}
                  max={bounds.max}
                  state={state}
                  disabled={disabled}
                  required
                />
              );
            })}
          </fieldset>
          <DurationField
            name="countdown"
            label="Countdown before each speech"
            hint="A short get-ready before the clock starts."
            ms={view.config.speechTiming.countdownMs}
            min={view.definition.configurable.timing.countdownMs.min}
            max={view.definition.configurable.timing.countdownMs.max}
            state={state}
            disabled={disabled}
            required
          />
          <InteractionFields view={view} state={state} disabled={disabled} />
          <DrawFields view={view} state={state} disabled={disabled} />
        </div>
      </details>
      <AssemblyEditFeedback state={state} roomId={view.id} />
      {view.capabilities.canEdit ? (
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          Save round settings
        </button>
      ) : (
        <p>Only the host can change round settings.</p>
      )}
    </>
  );
}
export function AssemblySettingsForm({
  view,
  commandId,
  action,
  onSaved,
}: {
  readonly view: RoomView;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
  readonly onSaved?: () => void;
}) {
  return (
    <AssemblyEditForm action={action} label="Round settings" onSaved={onSaved}>
      {(state, pending) => (
        <AssemblySettingsFields
          view={view}
          commandId={commandId}
          state={state}
          pending={pending}
        />
      )}
    </AssemblyEditForm>
  );
}
