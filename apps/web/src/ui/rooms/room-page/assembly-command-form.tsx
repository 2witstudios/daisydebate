'use client';

import { useId, type ReactNode } from 'react';
import type { MockFormState } from '../../../features/mock-form/form';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../../form-action/form-action';
import { commandUnavailable } from '../../../features/rooms/command-answer';
import {
  useMovedOnce,
  useMovedOnRemainder,
} from '../../form-action/use-moved-on';
import { FormError } from '../../components/form-field/form-field';

/** Native POST keeps the server action; hydrated transport failures preserve a retryable form. */
export function AssemblyCommandForm({
  action,
  children,
  className,
}: {
  readonly action: FormAction<MockFormState>;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const moved = useMovedOnce();
  const [state, post, pending] = useFormAction(
    action,
    { values: {} },
    commandUnavailable,
    moved,
  );
  const controlsId = useId();
  const feedbackId = useId();
  useMovedOnRemainder(state.next, moved);
  useFocusAfterAnswer(
    state,
    state.error ? feedbackId : controlsId,
    !pending && state.next === undefined,
  );
  return (
    <form action={post} className={className} aria-busy={pending}>
      <fieldset
        id={controlsId}
        tabIndex={-1}
        disabled={pending}
        className="flex flex-wrap items-center gap-2 border-0 p-0"
      >
        {children}
      </fieldset>
      <div id={feedbackId} tabIndex={-1}>
        <FormError error={state.error} />
      </div>
    </form>
  );
}
