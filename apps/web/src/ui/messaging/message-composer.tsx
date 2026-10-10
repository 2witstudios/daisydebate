'use client';
import { DraftNotice } from './draft-notice';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import {
  messageFormUnavailable,
  type MessageFormState,
} from '../../features/messaging/forms/send-form';

export function MessageComposer({
  action,
  requestId,
  maxUnits,
}: {
  readonly action: FormAction<MessageFormState>;
  readonly requestId: string;
  readonly maxUnits: number;
}) {
  const [answer, post, pending] = useFormAction<MessageFormState>(
    action,
    { text: '', requestId },
    messageFormUnavailable,
  );
  useMovedOn(answer.next);
  useFocusAfterAnswer(
    answer,
    answer.notice ? 'message-notice' : 'message-text',
    !pending,
  );
  return (
    <form
      action={post}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4"
    >
      <input type="hidden" name="requestId" value={answer.requestId} />
      <label htmlFor="message-text" className="text-sm font-semibold">
        Your message
      </label>
      <textarea
        key={answer.text}
        id="message-text"
        name="text"
        defaultValue={answer.text}
        maxLength={maxUnits}
        required
        disabled={pending}
        rows={4}
        className="rounded-md border border-border-strong bg-surface px-3 py-2 text-ink disabled:opacity-60"
        aria-describedby={answer.notice ? 'message-notice' : undefined}
      />
      <DraftNotice id="message-notice" notice={answer.notice} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || answer.next !== undefined}>
          {pending ? 'Sending…' : 'Send message'}
        </Button>
      </div>
    </form>
  );
}
