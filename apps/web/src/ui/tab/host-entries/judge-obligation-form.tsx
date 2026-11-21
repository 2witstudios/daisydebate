'use client';
import { StatusRegion } from '../../components/status-region/status-region';
import { useId } from 'react';
import { formFields, destinationOf } from '../../../features/forms/form-state';
import {
  initialJudgeObligation,
  judgeObligationUnacknowledged,
  type JudgeObligationState,
} from '../../../features/tab/judge-obligation-form';
import {
  useFormAction,
  useFocusAfterAnswer,
} from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { Button } from '../../components/button/button';
import {
  controlClass,
  labelClass,
} from '../../components/form-field/form-field-class';

export function JudgeObligationForm({
  entries,
  judges,
  action,
}: {
  readonly entries: string;
  readonly judges: string;
  readonly action: (
    previous: JudgeObligationState,
    form: FormData,
  ) => Promise<JudgeObligationState>;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    initialJudgeObligation(entries, judges),
    judgeObligationUnacknowledged,
  );
  const fields = formFields(state);
  const next = destinationOf(state);
  useMovedOn(next);
  const noticeId = useId();
  useFocusAfterAnswer(
    state,
    fields.error || state.kind === 'unacknowledged' ? noticeId : undefined,
    !pending,
  );
  return (
    <form
      action={submit}
      aria-label="Judge obligations"
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      <h2 className="font-display text-xl font-bold">Judge obligations</h2>
      <p className="text-sm text-ink-muted">
        Each school owes judges for its accepted entries in this event. Partial
        groups round up. Set judges per group to zero for no obligation.
      </p>
      <fieldset
        disabled={pending || next !== undefined}
        className="flex flex-wrap items-end gap-4"
      >
        {(['entries-per-judge', 'judges-per-group'] as const).map((name) => (
          <label key={name} className={labelClass}>
            {name === 'entries-per-judge'
              ? 'Entries per group'
              : 'Judges per group'}
            {state.kind === 'unacknowledged' ? (
              <input type="hidden" name={name} value={fields.values[name]} />
            ) : null}
            <input
              key={fields.values[name]}
              className={controlClass}
              name={name}
              type="number"
              min={name === 'entries-per-judge' ? 1 : 0}
              max={10000}
              step={1}
              required
              defaultValue={fields.values[name]}
              disabled={state.kind === 'unacknowledged'}
            />
          </label>
        ))}
        <Button type="submit">
          {state.kind === 'unacknowledged'
            ? 'Retry save'
            : 'Save judge obligations'}
        </Button>
      </fieldset>
      {fields.error || state.kind === 'unacknowledged' ? (
        <StatusRegion
          as="p"
          id={noticeId}
          tabIndex={-1}
          role="status"
          className="text-sm text-ink"
        >
          {state.kind === 'unacknowledged'
            ? 'The answer was lost. Retry the same values, or reload to check what was saved.'
            : fields.error}
        </StatusRegion>
      ) : null}
    </form>
  );
}
