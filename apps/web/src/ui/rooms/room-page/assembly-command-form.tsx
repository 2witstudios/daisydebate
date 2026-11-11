'use client';

import { useId, type ReactNode } from 'react';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../../form-action/form-action';
import {
  destinationOf,
  idle,
  type FormFields,
} from '../../../features/forms/form-state';
import {
  commandUnavailable,
  roomFormFields,
  type RoomFormState,
} from '../../../features/rooms/command-answer';
import { RetryRoomCommand } from './retry-room-command';
import { useMovedOn } from '../../form-action/use-moved-on';
import { FormError } from '../../components/form-field/form-field';
import { useRoomAnswer } from './room-sync-context';

const unanswered: RoomFormState = idle();

function CommandNavigation({ next }: { readonly next: string }) {
  useMovedOn(next);
  return null;
}
/**
 * Native POST keeps the server action. A hydrated answer goes to room sync;
 * only Launch navigates. While an answer is unknown the form offers only the
 * retry of the command it posted.
 */
export function AssemblyCommandForm({
  action,
  children,
  className,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly children: ReactNode | ((state: FormFields) => ReactNode);
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
  const fields = roomFormFields(state);
  const next = destinationOf(state);
  useFocusAfterAnswer(
    state,
    fields.error ? feedbackId : controlsId,
    !pending && next === undefined,
  );
  return (
    <form action={post} className={className} aria-busy={pending}>
      {next ? <CommandNavigation next={next} /> : null}
      <fieldset
        id={controlsId}
        tabIndex={-1}
        disabled={pending}
        className="flex flex-wrap items-center gap-2 border-0 p-0"
      >
        {state.kind === 'unacknowledged' ? (
          <RetryRoomCommand values={state.values} pending={pending} />
        ) : typeof children === 'function' ? (
          children(fields)
        ) : (
          children
        )}
      </fieldset>
      <div id={feedbackId} tabIndex={-1}>
        <FormError error={fields.error} />
      </div>
    </form>
  );
}
