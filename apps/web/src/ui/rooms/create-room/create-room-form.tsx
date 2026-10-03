'use client';

import { prepChoices, speechChoices } from '../../../features/rooms/settings';
import { buttonClass } from '../../components/button/button-class';
import { FormError, FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { MockForm, type MockFormAction } from '../../form-action/mock-form';

const judgeOptions = [
  {
    value: 'person',
    label: 'A person',
    helper: 'The room waits until someone takes the judge seat.',
  },
  {
    value: 'ai',
    label: 'Placeholder AI judge',
    helper:
      'Rules at random between the two sides. It does not hear the round. Practice rooms only.',
  },
] as const;

/**
 * Opening a practice room, a real POST: it works before hydration and
 * without JavaScript, and a refusal keeps what was typed. A practice room is
 * unranked, so there is no rules or visibility choice to make.
 */
export function CreateRoomForm({
  action,
}: {
  readonly action: MockFormAction;
}) {
  return (
    <MockForm
      action={action}
      label="Open a practice room"
      className="flex flex-col gap-6"
    >
      {({ values, error, pending }) => (
        <>
          <FormField
            id="room-name"
            label="Room name (optional)"
            helper="Shown in the lobby. Up to 60 characters."
          >
            <input
              id="room-name"
              name="name"
              type="text"
              maxLength={60}
              defaultValue={values['name'] ?? ''}
              aria-describedby="room-name-helper"
              className={controlClass}
            />
          </FormField>
          <FormField id="room-format" label="Format">
            <select
              id="room-format"
              name="format"
              defaultValue={values['format'] ?? 'foundation'}
              className={controlClass}
            >
              <option value="foundation">Foundation, one against one</option>
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
            <FormField id="room-speech" label="Speech length">
              <select
                id="room-speech"
                name="speech"
                defaultValue={values['speech'] ?? '4'}
                className={controlClass}
              >
                {speechChoices.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {`${minutes} minutes`}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="room-prep" label="Prep time">
              <select
                id="room-prep"
                name="prep"
                defaultValue={values['prep'] ?? '2'}
                className={controlClass}
              >
                {prepChoices.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {`${minutes} minutes`}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-strong text-ink">
              Who judges
            </legend>
            {judgeOptions.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 text-base text-ink"
              >
                <input
                  type="radio"
                  name="judge"
                  value={option.value}
                  defaultChecked={
                    (values['judge'] ?? 'person') === option.value
                  }
                  className="mt-1 size-5 accent-accent"
                />
                <span className="flex flex-col">
                  <span className="font-strong">{option.label}</span>
                  <span className="text-sm text-ink-muted">
                    {option.helper}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <FormError error={error} />
          <button
            type="submit"
            disabled={pending}
            className={`${buttonClass('primary')} w-fit`}
          >
            {pending ? 'Opening…' : 'Open room'}
          </button>
        </>
      )}
    </MockForm>
  );
}
