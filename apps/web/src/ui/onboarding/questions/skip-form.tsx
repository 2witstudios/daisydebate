'use client';

import { useFormAction, type FormAction } from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { skipClass } from '../frame/frame';
import { destinationOf } from '../../../features/forms/form-state';
import {
  initialStepForm,
  stepFields,
  stepUnsaved,
  type StepFormState,
} from './step-form-state';

const skipUnavailable = (): StepFormState => stepUnsaved();

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
    skipUnavailable,
  );
  useMovedOn(destinationOf(answered));
  const pending = posting || answered.kind === 'moved';
  return (
    <form action={post} aria-busy={pending}>
      <button type="submit" disabled={pending} className={skipClass}>
        {stepFields(answered).unsaved ? 'Skip (try again)' : 'Skip'}
      </button>
    </form>
  );
}
