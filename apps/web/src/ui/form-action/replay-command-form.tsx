'use client';
import { useId } from 'react';
import {
  idle,
  unacknowledged,
  type Idle,
  type Refused,
  type Unacknowledged,
  type Moved,
  formFields,
  destinationOf,
} from '../../features/forms/form-state';
import { useFormAction, useFocusAfterAnswer } from './form-action';
import { useMovedOn } from './use-moved-on';
import { HiddenFields } from './hidden-fields';
import { Button } from '../components/button/button';

type ReplayCommandState = Idle | Refused | Unacknowledged | Moved;
export type ReplayCommandAction = (
  previous: ReplayCommandState,
  form: FormData,
) => Promise<ReplayCommandState>;
/** Every retry preserves the reviewed fields and the rendered command identity. */
export function ReplayCommandForm({
  action,
  label,
  submitLabel,
  children,
}: {
  readonly action: ReplayCommandAction;
  readonly label: string;
  readonly submitLabel: string;
  readonly children: React.ReactNode;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    idle(),
    unacknowledged,
  );
  const fields = formFields(state);
  const next = destinationOf(state);
  useMovedOn(next);
  const notice = useId();
  useFocusAfterAnswer(
    state,
    fields.error || state.kind === 'unacknowledged' ? notice : undefined,
    !pending,
  );
  return (
    <form
      action={submit}
      aria-label={label}
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      <fieldset
        disabled={pending || next !== undefined}
        className="flex flex-col gap-4"
      >
        {state.kind === 'unacknowledged' ? (
          <HiddenFields
            entries={Object.entries(fields.values).filter(
              ([name]) => !name.startsWith('$ACTION_'),
            )}
          />
        ) : null}
        <fieldset
          disabled={state.kind === 'unacknowledged'}
          className="flex flex-col gap-4"
        >
          {children}
        </fieldset>
        <Button type="submit" className="self-start">
          {state.kind === 'unacknowledged'
            ? 'Retry original change'
            : submitLabel}
        </Button>
      </fieldset>
      {fields.error || state.kind === 'unacknowledged' ? (
        <p id={notice} tabIndex={-1} role="status" className="text-sm text-ink">
          {state.kind === 'unacknowledged'
            ? 'The answer was lost. Retry the same change, or reload to see what was saved.'
            : fields.error}
        </p>
      ) : null}
    </form>
  );
}
