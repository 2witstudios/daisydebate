'use client';

import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { type FormAction } from '../../form-action/form-action';
import { FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyEditForm, AssemblyEditFeedback } from './assembly-edit-form';
import { AssemblyCommandFields } from './assembly-command-fields';

const visibilityChoices = [
  ['unlisted', 'Anyone with the link', 'only people you share the link with'],
  ['public', 'Listed in the lobby', 'anyone can find and join it'],
] as const;

/** Who can join, as words; private rooms return with an invite path (ISSUE-443). */
function VisibilityField({
  saved,
  disabled,
}: {
  readonly saved: string;
  readonly disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-strong">Who can join</legend>
      {visibilityChoices.map(([value, label, detail]) => (
        <label
          key={value}
          className="flex min-h-room-target items-start gap-3 text-sm"
        >
          <input
            type="radio"
            name="visibility"
            value={value}
            disabled={disabled}
            defaultChecked={saved === value}
            className="mt-1 size-4 shrink-0"
          />
          <span>
            {label}
            <span className="text-ink-muted"> — {detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

type View = Pick<
  RoomView,
  'id' | 'version' | 'title' | 'topic' | 'visibility' | 'capabilities'
>;
export function AssemblyDetailsFields({
  view,
  commandId,
  state,
  pending,
}: {
  readonly view: View;
  readonly commandId: string;
  readonly state: MockFormState;
  readonly pending: boolean;
}) {
  return (
    <>
      <AssemblyCommandFields
        type="update-details"
        version={Number(state.values.expectedVersion ?? view.version)}
        commandId={state.values.commandId ?? commandId}
      />
      <FormField id="room-title" label="Room name">
        <input
          id="room-title"
          name="title"
          required
          readOnly={!view.capabilities.canEdit}
          defaultValue={state.values.title ?? view.title}
          className={controlClass}
        />
      </FormField>
      <FormField id="room-topic" label="Resolution">
        <textarea
          id="room-topic"
          name="topic"
          required
          readOnly={!view.capabilities.canEdit}
          aria-describedby="room-topic-hint"
          defaultValue={state.values.topic ?? view.topic}
          className={controlClass}
        />
      </FormField>
      <p id="room-topic-hint" className="-mt-2 text-xs text-ink-muted">
        One statement: the Affirmative argues for it, the Negative against it.
      </p>
      <VisibilityField
        saved={state.values.visibility ?? view.visibility}
        disabled={!view.capabilities.canEdit}
      />
      <AssemblyEditFeedback state={state} roomId={view.id} />
      {view.capabilities.canEdit ? (
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          Save room
        </button>
      ) : (
        <p>Only the host can edit this room.</p>
      )}
    </>
  );
}

export function AssemblyDetails({
  view,
  commandId,
  action,
  onSaved,
}: {
  readonly view: View;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
  readonly onSaved?: () => void;
}) {
  return (
    <AssemblyEditForm action={action} label="Room details" onSaved={onSaved}>
      {(state, pending) => (
        <AssemblyDetailsFields
          view={view}
          commandId={commandId}
          state={state}
          pending={pending}
        />
      )}
    </AssemblyEditForm>
  );
}
