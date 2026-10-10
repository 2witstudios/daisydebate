'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { Button } from '../components/button/button';
import { DraftNotice } from './draft-notice';
import {
  blockFormUnavailable,
  type BlockFormState,
} from '../../features/messaging/forms/block-form';
export function ContactBlockForm({
  requestId,
  action,
}: {
  readonly requestId: string;
  readonly action: FormAction<BlockFormState>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    { requestId, username: '' },
    blockFormUnavailable,
  );
  useFocusAfterAnswer(
    answer,
    answer.notice ? 'contact-notice' : 'contact-username',
    !pending,
  );
  return (
    <form
      action={post}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5"
    >
      <input type="hidden" name="requestId" value={answer.requestId} />
      <label htmlFor="contact-username" className="text-sm font-semibold">
        Username
      </label>
      <input
        id="contact-username"
        name="username"
        key={answer.username}
        defaultValue={answer.username}
        required
        disabled={pending}
        className="rounded-md border border-border-strong bg-surface px-3 py-2 text-ink disabled:opacity-60"
      />
      <DraftNotice id="contact-notice" notice={answer.notice} />
      <div className="flex gap-3">
        <Button type="submit" name="decision" value="block" disabled={pending}>
          Block contact
        </Button>
        <Button
          type="submit"
          name="decision"
          value="unblock"
          variant="secondary"
          disabled={pending}
        >
          Unblock contact
        </Button>
      </div>
    </form>
  );
}
