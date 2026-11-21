'use client';
import { StatusRegion } from '../../components/status-region/status-region';
import { useId } from 'react';
import {
  initialSanctionForm,
  sanctionFormUnavailable,
  type SanctionFormState,
} from '../../../features/tab/sanction-form';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../../form-action/form-action';
import { Button } from '../../components/button/button';
/** One immutable decision keeps its command id and displayed version on an uncertain retry. */
export function SanctionDecisionForm({
  action,
  label,
  event,
  primary = false,
}: {
  readonly action: FormAction<SanctionFormState>;
  readonly label: string;
  readonly event: string;
  readonly primary?: boolean;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    initialSanctionForm,
    sanctionFormUnavailable,
  );
  const notice = useId();
  useFocusAfterAnswer(
    state,
    state.kind === 'refused' || state.kind === 'unacknowledged'
      ? notice
      : undefined,
    !pending,
    { onlyWhenLost: true },
  );
  return (
    <form
      action={submit}
      aria-label={`${label}: ${event}`}
      aria-busy={pending}
      className="flex flex-col items-start gap-2"
    >
      <Button
        type="submit"
        variant={primary ? 'primary' : 'secondary'}
        disabled={pending || state.kind === 'done'}
      >
        {state.kind === 'unacknowledged'
          ? `Retry ${label.toLowerCase()}`
          : label}
      </Button>
      {state.kind === 'refused' || state.kind === 'unacknowledged' ? (
        <StatusRegion
          as="p"
          id={notice}
          tabIndex={-1}
          role="status"
          className="text-sm text-ink-muted"
        >
          {state.kind === 'refused'
            ? state.error
            : 'The answer was lost. Retry the same decision, or reload to check its status.'}
        </StatusRegion>
      ) : null}
    </form>
  );
}
