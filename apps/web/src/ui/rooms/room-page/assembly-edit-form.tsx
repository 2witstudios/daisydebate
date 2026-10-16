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
import type { RoomFormState } from '../../../features/rooms/command-answer';
import { useRoomAnswer } from './room-sync-context';

const unanswered: RoomFormState = { values: {} };

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

/**
 * Common native edit transport for actual Room details and configuration
 * consumers. A hydrated save hands its accepted view to room sync.
 */
export function AssemblyEditForm({
  action,
  label,
  disclosure,
  children,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly label: string;
  readonly disclosure?: string;
  readonly children: (state: MockFormState, pending: boolean) => ReactNode;
}) {
  const [state, post, pending] = useFormAction(
    action,
    unanswered,
    (form): RoomFormState => ({
      values: formValues(form),
      error: 'These changes are not saved. Try again.',
    }),
  );
  useMovedOn(state.next);
  useRoomAnswer(state, unanswered);
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
      <summary className="flex min-h-12 cursor-pointer items-center text-sm font-strong">
        {disclosure}
      </summary>
      <div className="mt-4">{form}</div>
    </details>
  ) : (
    form
  );
}
