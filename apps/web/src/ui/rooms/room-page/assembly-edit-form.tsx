'use client';

import { useId, type ReactNode } from 'react';
import {
  formValues,
  type MockFormState,
} from '../../../features/mock-form/form';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../../form-action/form-action';
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
  disclosure,
  children,
}: {
  readonly action: FormAction<MockFormState>;
  readonly label: string;
  readonly disclosure?: string;
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
  const feedbackId = useId();
  useFocusAfterAnswer(state, feedbackId, !pending && state.next === undefined);
  const form = (
    <form
      action={post}
      aria-label={label}
      id={feedbackId}
      tabIndex={-1}
      aria-busy={pending}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4"
    >
      {children(state, pending)}
    </form>
  );
  return disclosure ? (
    <details open={state.error ? true : undefined}>
      <summary className="cursor-pointer text-sm font-strong">
        {disclosure}
      </summary>
      <div className="mt-4">{form}</div>
    </details>
  ) : (
    form
  );
}
