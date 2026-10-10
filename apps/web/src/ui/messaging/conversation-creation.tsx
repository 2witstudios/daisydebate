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
  creationFormUnavailable,
  type CreationFormState,
} from '../../features/messaging/forms/create-form';
const fieldClass =
  'rounded-md border border-border-strong bg-surface px-3 py-2 text-ink disabled:opacity-60';
export function ConversationCreation({
  kind,
  requestId,
  action,
}: {
  readonly kind: 'dm' | 'private_group';
  readonly requestId: string;
  readonly action: FormAction<CreationFormState>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    { requestId, recipients: '', title: '', introduction: '' },
    creationFormUnavailable,
  );
  useMovedOn(answer.next);
  useFocusAfterAnswer(
    answer,
    answer.notice ? 'creation-notice' : 'creation-recipient',
    !pending,
  );
  const group = kind === 'private_group';
  return (
    <form
      action={post}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5"
    >
      <input type="hidden" name="requestId" value={answer.requestId} />
      <label htmlFor="creation-recipient" className="text-sm font-semibold">
        {group ? 'Invite usernames' : 'Username'}
      </label>
      <textarea
        id="creation-recipient"
        name="recipients"
        key={answer.recipients}
        defaultValue={answer.recipients}
        required
        disabled={pending}
        rows={group ? 3 : 1}
        className={fieldClass}
        aria-describedby={group ? 'creation-recipient-help' : undefined}
      />
      {group ? (
        <>
          <p id="creation-recipient-help" className="text-sm text-ink-muted">
            Separate usernames with commas or new lines. Each person receives an
            invitation.
          </p>
          <label htmlFor="creation-title" className="text-sm font-semibold">
            Group name
          </label>
          <input
            id="creation-title"
            name="title"
            key={answer.title}
            defaultValue={answer.title}
            required
            disabled={pending}
            className={fieldClass}
          />
        </>
      ) : (
        <>
          <label
            htmlFor="creation-introduction"
            className="text-sm font-semibold"
          >
            Introduction (optional)
          </label>
          <textarea
            id="creation-introduction"
            name="introduction"
            key={answer.introduction}
            defaultValue={answer.introduction}
            disabled={pending}
            rows={4}
            className={fieldClass}
          />
        </>
      )}
      <DraftNotice id="creation-notice" notice={answer.notice} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || answer.next !== undefined}>
          {group ? 'Create private group' : 'Send request'}
        </Button>
      </div>
    </form>
  );
}
