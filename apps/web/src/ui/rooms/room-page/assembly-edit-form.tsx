'use client';

import type { ReactNode } from 'react';
import {
  formValues,
  type MockFormState,
} from '../../../features/mock-form/form';
import { useFormAction, type FormAction } from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { FormError } from '../../components/form-field/form-field';

export function AssemblyEditFeedback({
  state,
  roomId,
}: {
  readonly state: MockFormState;
  readonly roomId: string;
}) {
  return (
    <>
      <FormError error={state.error} />
      {state.error ? <a href={`/rooms/${roomId}`}>Review latest room</a> : null}
    </>
  );
}

/** Common native edit transport for actual Room details and configuration consumers. */
export function AssemblyEditForm({
  action,
  label,
  children,
}: {
  readonly action: FormAction<MockFormState>;
  readonly label: string;
  readonly children: (state: MockFormState, pending: boolean) => ReactNode;
}) {
  const [state, post, pending] = useFormAction(
    action,
    { values: {} },
    (form) => ({
      values: formValues(form),
      error: 'These changes are not saved. Try again.',
    }),
  );
  useMovedOn(state.next);
  return (
    <form
      action={post}
      aria-label={label}
      className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
    >
      {children(state, pending)}
    </form>
  );
}
