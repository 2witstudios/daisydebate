'use client';

import { useId, type ReactNode } from 'react';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../../form-action/form-action';
import {
  commandUnavailable,
  type RoomFormState,
} from '../../../features/rooms/command-answer';
import { useMovedOn } from '../../form-action/use-moved-on';
import { FormError } from '../../components/form-field/form-field';
import { useRoomAnswer } from './room-sync-context';

const unanswered: RoomFormState = { values: {} };

function CommandNavigation({ next }: { readonly next: string }) {
  useMovedOn(next);
  return null;
}
/**
 * Native POST keeps the server action; hydrated transport failures preserve a
 * retryable form. A hydrated answer goes to room sync; only Launch navigates.
 */
export function AssemblyCommandForm({
  action,
  children,
  className,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const [state, post, pending] = useFormAction(
    action,
    unanswered,
    commandUnavailable,
  );
  useRoomAnswer(state, unanswered);
  const controlsId = useId();
  const feedbackId = useId();
  useFocusAfterAnswer(
    state,
    state.error ? feedbackId : controlsId,
    !pending && state.next === undefined,
  );
  return (
    <form action={post} className={className} aria-busy={pending}>
      {state.next ? <CommandNavigation next={state.next} /> : null}
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
