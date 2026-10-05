'use client';

import { useFormAction, type FormAction } from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { skipClass } from '../frame/frame';
import {
  initialStepForm,
  stepUnavailable,
  type StepFormState,
} from './step-form-state';

/**
 * Skip, as a form posting to its server action: it records that the
 * member finished and moves on to the last step, with or without
 * JavaScript.
 */
export function SkipForm({
  action,
}: {
  readonly action: FormAction<StepFormState>;
}) {
  const [answered, post, posting] = useFormAction(
    action,
    initialStepForm,
    stepUnavailable,
  );
  useMovedOn(answered.next);
  const pending = posting || answered.next !== undefined;
  return (
    <form action={post} aria-busy={pending}>
      <button type="submit" disabled={pending} className={skipClass}>
        {answered.refused ? 'Skip (try again)' : 'Skip'}
      </button>
    </form>
  );
}
