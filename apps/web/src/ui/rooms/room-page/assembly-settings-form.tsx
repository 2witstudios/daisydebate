'use client';

import {
  NumberField,
  PreparationFields,
  InteractionFields,
} from './assembly-settings-controls';

import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import { type FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyEditForm, AssemblyEditFeedback } from './assembly-edit-form';
import { seatLabel } from './assembly-controls';

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
      <h2 className="text-lg font-strong">Room settings</h2>
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
      {view.rules.segments.map((segment) => {
        const bounds =
          view.definition.configurable.timing.segmentDurationMs[segment.key];
        if (!bounds)
          throw new Error('Missing authoritative segment timing bounds');
        return (
          <NumberField
            key={segment.key}
            name={`seconds.${segment.key}`}
            label={`${segment.label} · ${seatLabel(segment.side, segment.slot)}`}
            ms={segment.durationMs}
            min={bounds.min}
            max={bounds.max}
            state={state}
            disabled={disabled}
            required
          />
        );
      })}
      <NumberField
        name="countdown"
        label="Countdown"
        ms={view.config.speechTiming.countdownMs}
        min={view.definition.configurable.timing.countdownMs.min}
        max={view.definition.configurable.timing.countdownMs.max}
        state={state}
        disabled={disabled}
        required
      />
      <PreparationFields view={view} state={state} disabled={disabled} />
      <InteractionFields view={view} state={state} disabled={disabled} />
      <AssemblyEditFeedback state={state} roomId={view.id} />
      {view.capabilities.canEdit ? (
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          Save settings
        </button>
      ) : (
        <p>Only the host can edit settings.</p>
      )}
    </>
  );
}
export function AssemblySettingsForm({
  view,
  commandId,
  action,
}: {
  readonly view: RoomView;
  readonly commandId: string;
  readonly action: FormAction<MockFormState>;
}) {
  return (
    <AssemblyEditForm action={action} label="Room settings">
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
