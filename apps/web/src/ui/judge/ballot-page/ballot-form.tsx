'use client';

import { scoreChoices } from '../../../features/judge/ballot';
import { buttonClass } from '../../components/button/button-class';
import { FormError, FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { MockForm, type MockFormAction } from '../../form-action/mock-form';

const decisionOptions = [
  { value: 'affirmative', label: 'The affirmative won' },
  { value: 'negative', label: 'The negative won' },
  { value: 'draw', label: 'A draw' },
] as const;

/**
 * The ballot, a real POST: it works before hydration and without JavaScript,
 * and a refusal keeps what was typed. One ballot per judge seat; it cannot
 * be sent twice.
 */
export function BallotForm({ action }: { readonly action: MockFormAction }) {
  return (
    <MockForm
      action={action}
      label="Your ballot"
      className="flex flex-col gap-6"
    >
      {({ values, error, pending }) => (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-strong text-ink">
              Who won
            </legend>
            {decisionOptions.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-4 text-base text-ink"
              >
                <input
                  type="radio"
                  name="decision"
                  value={option.value}
                  defaultChecked={values['decision'] === option.value}
                  className="size-5 accent-accent"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
            {(
              [
                ['affirmative-score', 'Affirmative score'],
                ['negative-score', 'Negative score'],
              ] as const
            ).map(([name, label]) => (
              <FormField
                key={name}
                id={name}
                label={label}
                helper="1 is weak, 5 is excellent."
              >
                <select
                  id={name}
                  name={name}
                  defaultValue={values[name] ?? '3'}
                  aria-describedby={`${name}-helper`}
                  className={controlClass}
                >
                  {scoreChoices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              </FormField>
            ))}
          </div>
          <FormField
            id="ballot-reason"
            label="Reason for your decision"
            helper="Both debaters see this. Up to 600 characters."
          >
            <textarea
              id="ballot-reason"
              name="reason"
              rows={5}
              maxLength={600}
              defaultValue={values['reason'] ?? ''}
              aria-describedby="ballot-reason-helper"
              className="w-full min-w-0 rounded-md border border-border bg-surface-raised p-3 text-base text-ink"
            />
          </FormField>
          <FormError error={error} />
          <button
            type="submit"
            disabled={pending}
            className={`${buttonClass('primary')} w-fit`}
          >
            {pending ? 'Submitting…' : 'Submit ballot'}
          </button>
        </>
      )}
    </MockForm>
  );
}
