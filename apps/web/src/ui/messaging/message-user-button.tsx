'use client';
import { useFormAction, type FormAction } from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import {
  creationFormUnavailable,
  type CreationFormState,
} from '../../features/messaging/forms/create-form';

/**
 * One-click "Message" for a known member: posts the native direct-request
 * form, which opens the existing conversation or request with them, or sends
 * a new request without an introduction. Works as a plain POST without
 * JavaScript; the action is the page's own DM creation action.
 */
export function MessageUserButton({
  username,
  requestId,
  action,
  variant = 'secondary',
}: {
  readonly username: string;
  readonly requestId: string;
  readonly action: FormAction<CreationFormState>;
  readonly variant?: 'primary' | 'secondary';
}) {
  const [answer, post, pending] = useFormAction(
    action,
    { requestId, recipients: username, title: '', introduction: '' },
    creationFormUnavailable,
  );
  useMovedOn(answer.next);
  return (
    <MessageUserFields
      username={username}
      answer={answer}
      pending={pending}
      action={post}
      variant={variant}
    />
  );
}

export function MessageUserFields({
  username,
  answer,
  pending,
  action,
  variant,
}: {
  readonly username: string;
  readonly answer: CreationFormState;
  readonly pending: boolean;
  readonly action: (form: FormData) => void;
  readonly variant: 'primary' | 'secondary';
}) {
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="requestId" value={answer.requestId} />
      <input type="hidden" name="recipients" value={username} />
      <input type="hidden" name="introduction" value="" />
      <Button
        type="submit"
        variant={variant}
        disabled={pending || answer.next !== undefined}
        aria-label={`Message @${username}`}
      >
        Message
      </Button>
      {answer.notice ? (
        <p role="status" className="text-sm text-ink-muted">
          {`Could not open a conversation with @${username}. Try again.`}
        </p>
      ) : null}
    </form>
  );
}
