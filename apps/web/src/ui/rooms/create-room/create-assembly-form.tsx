'use client';

import { FormatTemplatePicker } from './format-template-picker';

import type { RoomTemplate } from '../../../features/rooms/read-catalog';
import { formValues } from '../../../features/mock-form/form';
import { FormError, FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';

type CreateState = {
  readonly values: Readonly<Record<string, string>>;
  readonly error?: string;
  readonly next?: string;
};

type FieldsProps = {
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
  readonly state: CreateState;
  readonly pending: boolean;
};

export function CreateAssemblyFields({
  commandId,
  choices,
  state,
  pending,
}: FieldsProps) {
  return (
    <>
      {' '}
      <input
        type="hidden"
        name="commandId"
        value={state.values.commandId ?? commandId}
      />
      <FormField id="assembly-title" label="Room name">
        <input
          id="assembly-title"
          name="title"
          required
          defaultValue={state.values.title ?? ''}
          className={controlClass}
        />
      </FormField>
      <FormField id="assembly-topic" label="Debate topic">
        <textarea
          id="assembly-topic"
          name="topic"
          required
          defaultValue={state.values.topic ?? ''}
          className={controlClass}
        />
      </FormField>
      <FormatTemplatePicker
        key={state.values.selection ?? 'initial'}
        choices={choices}
        defaultValue={state.values.selection}
      />
      <FormField id="assembly-visibility" label="Who can find the room">
        <select
          id="assembly-visibility"
          name="visibility"
          defaultValue={state.values.visibility ?? 'unlisted'}
          className={controlClass}
        >
          <option value="unlisted">
            Unlisted — join through the room link
          </option>
          <option value="public">Public — show in the Lobby</option>
          <option value="private">Private</option>
        </select>
      </FormField>
      <FormError error={state.error} />
      {choices.length === 0 ? (
        <p role="status">No format templates are available yet.</p>
      ) : null}
      <button
        type="submit"
        disabled={pending || choices.length === 0}
        className={buttonClass('primary')}
      >
        Create room
      </button>
    </>
  );
}

/** Catalog revisions supply templates; all mutations still go through canonical CAP. */
export function CreateAssemblyForm({
  action,
  commandId,
  choices,
}: {
  readonly action: FormAction<CreateState>;
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
}) {
  const [state, post, pending] = useFormAction(
    action,
    { values: {} },
    (form) => ({
      values: formValues(form),
      error: 'Unable to create the room. Try again.',
    }),
  );
  useMovedOn(state.next);
  return (
    <form
      action={post}
      aria-label="Create a room"
      className="flex flex-col gap-5"
    >
      <CreateAssemblyFields
        commandId={commandId}
        choices={choices}
        state={state}
        pending={pending}
      />
    </form>
  );
}
