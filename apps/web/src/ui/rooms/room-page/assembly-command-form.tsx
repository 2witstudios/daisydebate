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
 * The transport every in-place room form shares. Native POST keeps the
 * server action. A hydrated answer goes to room sync; only Launch
 * navigates. `fields` is the form's own reading of each answer; controls
 * given as a function choose what to show for it.
 */
export function RoomAnswerForm({
  action,
  fields: fieldsOf,
  children,
  className,
}: {
  readonly action: FormAction<RoomFormState>;
  readonly fields: (answer: RoomFormState) => FormFields;
  readonly children:
    | ReactNode
    | ((
        answer: RoomFormState,
        fields: FormFields,
        pending: boolean,
      ) => ReactNode);
  readonly className?: string | undefined;
}) {
  const [state, post, pending] = useFormAction(
    action,
    unanswered,
    commandUnavailable,
  );
  useRoomAnswer(state, unanswered);
  const controlsId = useId();
  const feedbackId = useId();
  const fields = fieldsOf(state);
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
        {typeof children === 'function'
          ? children(state, fields, pending)
          : children}
      </fieldset>
      <div id={feedbackId} tabIndex={-1}>
        <FormError error={fields.error} />
      </div>
    </form>
  );
}

/**
 * A room command's form. While its answer is unknown it offers only the
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
  return (
    <RoomAnswerForm
      action={action}
      fields={roomFormFields}
      className={className}
    >
      {(answer, fields, pending) =>
        answer.kind === 'unacknowledged' ? (
          <RetryRoomCommand values={answer.values} pending={pending} />
        ) : typeof children === 'function' ? (
          children(fields)
        ) : (
          children
        )
      }
    </RoomAnswerForm>
  );
}
