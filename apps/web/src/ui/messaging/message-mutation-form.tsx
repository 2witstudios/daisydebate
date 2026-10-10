'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { DraftNotice } from './draft-notice';
import { messageMutationUnavailable } from '../../features/messaging/forms/message-mutation-form';
import type { MessageFormState } from '../../features/messaging/forms/send-form';
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
    { requestId: removeRequestId, text: '' },
    messageMutationUnavailable,
  );
  useMovedOn(answer.next ?? removeAnswer.next);
  useFocusAfterAnswer(
    answer,
    answer.notice ? `message-mutation-${answer.requestId}` : undefined,
    !editPending,
  );
  useFocusAfterAnswer(
    removeAnswer,
    removeAnswer.notice
      ? `message-removal-${removeAnswer.requestId}`
      : undefined,
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
  const noticeId = `message-mutation-${answer.requestId}`;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={answer.requestId} />
      <input type="hidden" name="operation" value="edit" />
      <label className="flex flex-col gap-2">
        Revise your message
        <textarea
          name="text"
          key={answer.text}
          defaultValue={answer.text}
          maxLength={maxUnits}
          rows={3}
          required
          disabled={pending}
          className="rounded-md border border-border-strong bg-surface px-3 py-2 text-ink"
        />
      </label>
      <DraftNotice id={noticeId} notice={answer.notice} />
      <div className="flex gap-3">
        <Button type="submit" disabled={pending || answer.next !== undefined}>
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
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={answer.requestId} />
      <input type="hidden" name="operation" value="remove" />
      <DraftNotice
        id={`message-removal-${answer.requestId}`}
        notice={answer.notice}
      />
      <Button
        type="submit"
        disabled={pending || answer.next !== undefined}
        formNoValidate
      >
        Remove your message
      </Button>
    </form>
  );
}
