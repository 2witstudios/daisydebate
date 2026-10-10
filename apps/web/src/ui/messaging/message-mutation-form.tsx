'use client';
import { useFormAction, type FormAction } from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { DraftNotice } from './draft-notice';
import { messageMutationUnavailable } from '../../features/messaging/forms/message-mutation-form';
import type { MessageFormState } from '../../features/messaging/forms/send-form';
/** These own-message controls do not grant author, posting or cleanup permission. */
export function MessageMutationForm({
  action,
  state,
  maxUnits,
}: {
  readonly action: FormAction<MessageFormState>;
  readonly state: MessageFormState;
  readonly maxUnits: number;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    state,
    messageMutationUnavailable,
  );
  useMovedOn(answer.next);
  return (
    <form action={post} className="mt-4 flex flex-col gap-3">
      <MessageMutationFields
        answer={answer}
        pending={pending}
        maxUnits={maxUnits}
      />
    </form>
  );
}
/** The native field set keeps a refused draft and distinct edit/removal intent. */
export function MessageMutationFields({
  answer,
  pending,
  maxUnits,
}: {
  readonly answer: MessageFormState;
  readonly pending: boolean;
  readonly maxUnits: number;
}) {
  const noticeId = `message-mutation-${answer.requestId}`;
  return (
    <>
      <input type="hidden" name="requestId" value={answer.requestId} />
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
        <Button
          type="submit"
          name="operation"
          value="edit"
          disabled={pending || answer.next !== undefined}
        >
          Save message edit
        </Button>
        <Button
          type="submit"
          name="operation"
          value="remove"
          formNoValidate
          disabled={pending || answer.next !== undefined}
        >
          Remove your message
        </Button>
      </div>
    </>
  );
}
