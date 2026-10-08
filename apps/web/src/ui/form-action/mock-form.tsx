'use client';

import type { ReactNode } from 'react';
import {
  initialMockForm,
  mockFormUnavailable,
  type MockFormState,
} from '../../features/mock-form/form';
import { useFocusAfterAnswer, useFormAction } from './form-action';
import { useMovedOn } from './use-moved-on';

export type MockFormAction = (
  state: MockFormState,
  form: FormData,
) => Promise<MockFormState>;

/** What a mock form's body is given: the answer so far and whether it is busy. */
export type MockFormBody = {
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
export function MockForm({
  action,
  label,
  className,
  focusOnRefusal,
  children,
}: {
  readonly action: MockFormAction;
  readonly label: string;
  readonly className?: string;
  /** The element that takes focus once a refusal renders (ISSUE-107). */
  readonly focusOnRefusal?: string;
  readonly children: (body: MockFormBody) => ReactNode;
}) {
  const [answered, post, posting] = useFormAction(
    action,
    initialMockForm,
    mockFormUnavailable,
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
