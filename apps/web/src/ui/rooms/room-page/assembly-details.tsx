'use client';

import { Button } from '../../components/button/button';
import type { RoomView } from '@daisy/protocol/room-contract';
import type { FormFields } from '../../../features/forms/form-state';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { type FormAction } from '../../form-action/form-action';
import { FormField } from '../../components/form-field/form-field';
import { drawnTopicLabel } from '../../../features/debate-room/vocabulary';
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
  readonly state: FormFields;
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
      {view.topic === null ? (
        <p className="text-sm text-ink-muted">
          Resolution: {drawnTopicLabel.toLocaleLowerCase()}. Turn the strike off
          in the round settings to name one instead.
        </p>
      ) : (
        <>
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
            One statement: the Affirmative argues for it, the Negative against
            it.
          </p>
        </>
      )}
      {/* Who can join is set from the page's Room controls (ADR 0145). */}
      <input
        type="hidden"
        name="visibility"
        value={state.values.visibility ?? view.visibility}
      />
      <AssemblyEditFeedback state={state} roomId={view.id} />
      {view.capabilities.canEdit ? (
        <Button
          variant="unstyled"
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          Save room
        </Button>
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
