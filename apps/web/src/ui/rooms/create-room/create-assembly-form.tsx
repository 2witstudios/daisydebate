'use client';

import { FormatTemplatePicker } from './format-template-picker';

import type { RoomTemplate } from '../../../features/rooms/read-catalog';
import { formValues } from '../../../features/forms/form-state';
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
      <FormField id="assembly-topic" label="Resolution">
        <textarea
          id="assembly-topic"
          name="topic"
          required
          aria-describedby="assembly-topic-hint"
          defaultValue={state.values.topic ?? ''}
          className={controlClass}
        />
      </FormField>
      <p id="assembly-topic-hint" className="-mt-3 text-xs text-ink-muted">
        One statement: the Affirmative argues for it, the Negative against it.
      </p>
      <FormatTemplatePicker
        key={state.values.selection ?? 'initial'}
        choices={choices}
        defaultValue={state.values.selection}
      />
      <FormField id="assembly-visibility" label="Who can join">
        <select
          id="assembly-visibility"
          name="visibility"
          defaultValue={state.values.visibility ?? 'unlisted'}
          className={controlClass}
        >
          <option value="unlisted">Anyone with the link</option>
          <option value="public">Listed in the lobby — anyone can join</option>
          {/* Private returns with an invite path (ISSUE-443, DEC-206). */}
        </select>
      </FormField>
      <FormError error={state.error} />
      {choices.length === 0 ? (
        <p role="status">No formats are available yet.</p>
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
