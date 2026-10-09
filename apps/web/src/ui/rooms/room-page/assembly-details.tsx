'use client';

import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import { type FormAction } from '../../form-action/form-action';
import { FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyEditForm, AssemblyEditFeedback } from './assembly-edit-form';
import { AssemblyCommandFields } from './assembly-command-fields';

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
      <FormField id="room-topic" label="Debate topic">
        <textarea
          id="room-topic"
          name="topic"
          required
          readOnly={!view.capabilities.canEdit}
          defaultValue={state.values.topic ?? view.topic}
          className={controlClass}
        />
      </FormField>
      <FormField id="room-visibility" label="Who can find the room">
        <select
          id="room-visibility"
          name="visibility"
          disabled={!view.capabilities.canEdit}
          defaultValue={state.values.visibility ?? view.visibility}
          className={controlClass}
        >
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
        </select>
      </FormField>
      <AssemblyEditFeedback state={state} roomId={view.id} />
      {view.capabilities.canEdit ? (
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          Save room details
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
}: {
  readonly view: View;
  readonly commandId: string;
  readonly action: FormAction<MockFormState>;
}) {
  return (
    <AssemblyEditForm action={action} label="Room details">
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
