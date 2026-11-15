'use client';
import { useId } from 'react';
import {
  idle,
  formFields,
  destinationOf,
} from '../../../features/forms/form-state';
import {
  ballotAuthoringUnacknowledged,
  type BallotAuthoringState,
} from '../../../features/tab/ballot-authoring-form';
import {
  useFormAction,
  useFocusAfterAnswer,
} from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { HiddenFields } from '../../form-action/hidden-fields';
import { Button } from '../../components/button/button';

export type BallotAuthoringAction = (
  previous: BallotAuthoringState,
  form: FormData,
) => Promise<BallotAuthoringState>;
/** Every retry preserves the original fields and command identity, including authored criteria and weights. */
export function BallotCommandForm({
  action,
  label,
  submitLabel,
  children,
}: {
  readonly action: BallotAuthoringAction;
  readonly label: string;
  readonly submitLabel: string;
  readonly children: React.ReactNode;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    idle(),
    ballotAuthoringUnacknowledged,
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
