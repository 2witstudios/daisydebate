'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { DraftNotice } from './draft-notice';
import { CountedTextarea } from './counted-textarea';
import { messageMutationUnavailable } from '../../features/messaging/forms/message-mutation-form';
import { destinationOf } from '../../features/forms/form-state';
import {
  messageFields,
  messageIdle,
  type MessageFormState,
} from '../../features/messaging/forms/send-form';
/** These own-message controls do not grant author, posting or cleanup permission. */
export function MessageMutationForm({
  action,
  state,
  removeRequestId,
  maxUnits,
}: {
  readonly action: FormAction<MessageFormState>;
  readonly state: MessageFormState;
  readonly removeRequestId: string;
  readonly maxUnits: number;
}) {
  const [answer, postEdit, editPending] = useFormAction(
    action,
    state,
    messageMutationUnavailable,
  );
  const [removeAnswer, postRemove, removePending] = useFormAction(
    action,
    messageIdle(removeRequestId),
    messageMutationUnavailable,
  );
  useMovedOn(destinationOf(answer) ?? destinationOf(removeAnswer));
  const edit = messageFields(answer);
  const removal = messageFields(removeAnswer);
  useFocusAfterAnswer(
    answer,
    edit.notice ? `message-mutation-${edit.requestId}` : undefined,
    !editPending,
  );
  useFocusAfterAnswer(
    removeAnswer,
    removal.notice ? `message-removal-${removal.requestId}` : undefined,
    !removePending,
  );
  return (
    <div className="mt-4 flex flex-col gap-3">
      <MessageMutationFields
        answer={answer}
        pending={editPending}
        maxUnits={maxUnits}
        action={postEdit}
      />
      <MessageRemovalFields
        answer={removeAnswer}
        pending={removePending}
        action={postRemove}
      />
    </div>
  );
}
/** The native field set keeps a refused draft and distinct edit/removal intent. */
export function MessageMutationFields({
  answer,
  pending,
  maxUnits,
  action,
}: {
  readonly answer: MessageFormState;
  readonly pending: boolean;
  readonly maxUnits: number;
  readonly action: (form: FormData) => void;
}) {
  const { requestId, text, notice } = messageFields(answer);
  const noticeId = `message-mutation-${requestId}`;
  const editId = `message-edit-${requestId}`;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="operation" value="edit" />
      <label htmlFor={editId} className="flex flex-col gap-2">
        Revise your message
      </label>
      <CountedTextarea
        id={editId}
        name="text"
        key={text}
        defaultValue={text}
        maxUnits={maxUnits}
        rows={3}
        required
        disabled={pending}
        className="rounded-md border border-border-strong bg-surface px-3 py-2 text-ink"
        describedBy={notice ? noticeId : undefined}
      />
      <DraftNotice id={noticeId} notice={notice} />
      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={pending || destinationOf(answer) !== undefined}
        >
          Save message edit
        </Button>
      </div>
    </form>
  );
}

/** Removal is a separate native command with its own idempotency key. */
export function MessageRemovalFields({
  answer,
  pending,
  action,
}: {
  readonly answer: MessageFormState;
  readonly pending: boolean;
  readonly action: (form: FormData) => void;
}) {
  const { requestId, notice } = messageFields(answer);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="operation" value="remove" />
      <DraftNotice id={`message-removal-${requestId}`} notice={notice} />
      <Button
        type="submit"
        disabled={pending || destinationOf(answer) !== undefined}
        formNoValidate
      >
        Remove your message
      </Button>
    </form>
  );
}
