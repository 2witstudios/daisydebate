'use client';

import type { ReactNode } from 'react';
import {
  initialFormState,
  formUnavailable,
  type FormState,
} from '../../features/forms/form-state';
import { useFocusAfterAnswer, useFormAction } from './form-action';
import { useMovedOn } from './use-moved-on';

export type FormStateAction = (
  state: FormState,
  form: FormData,
) => Promise<FormState>;

/** What an action form's body is given: the answer so far and whether it is busy. */
export type ActionFormBody = {
  readonly values: Readonly<Record<string, string>>;
  readonly error: string | undefined;
  readonly pending: boolean;
};

/**
 * A real POST to a server action: before hydration or without JavaScript the
 * browser submits it to the same action. JavaScript adds the pending state
 * and navigates to the answered `next`. The typed values come back with a
 * refusal so nothing is lost.
 */
export function ActionForm({
  action,
  label,
  className,
  focusOnRefusal,
  children,
}: {
  readonly action: FormStateAction;
  readonly label: string;
  readonly className?: string;
  /** The element that takes focus once a refusal renders (ISSUE-107). */
  readonly focusOnRefusal?: string;
  readonly children: (body: ActionFormBody) => ReactNode;
}) {
  const [answered, post, posting] = useFormAction(
    action,
    initialFormState,
    formUnavailable,
  );
  useMovedOn(answered.next);
  const pending = posting || answered.next !== undefined;
  useFocusAfterAnswer(
    answered,
    answered.error === undefined ? undefined : focusOnRefusal,
    !pending,
  );
  return (
    <form
      action={post}
      aria-label={label}
      aria-busy={pending}
      className={className}
    >
      {children({ values: answered.values, error: answered.error, pending })}
    </form>
  );
}
