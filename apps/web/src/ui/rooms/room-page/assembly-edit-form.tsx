'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
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

/** A hydrated save the room accepted: it carries the new view and no error. */
export const savedAnswer = (state: RoomFormState) =>
  state.view !== undefined && state.error === undefined;

/** Calls `onSaved` once per accepted answer, whatever its identity per render. */
function useOnSaved(state: RoomFormState, onSaved?: () => void) {
  const latest = useRef(onSaved);
  useEffect(() => {
    latest.current = onSaved;
  });
  useEffect(() => {
    if (savedAnswer(state)) latest.current?.();
  }, [state]);
}

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
 * consumers. A hydrated save hands its accepted view to room sync and
 * then to `onSaved`.
 */
export function AssemblyEditForm({
  action,
  label,
  onSaved,
  children,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly label: string;
  readonly onSaved?: (() => void) | undefined;
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
  useOnSaved(state, onSaved);
  const feedbackId = useId();
  useFocusAfterAnswer(state, feedbackId, !pending && state.next === undefined);
  return (
    <form
      action={post}
      aria-label={label}
      id={feedbackId}
      tabIndex={-1}
      aria-busy={pending}
      className="flex min-w-0 flex-col gap-4"
    >
      {children(state, pending)}
    </form>
  );
}
