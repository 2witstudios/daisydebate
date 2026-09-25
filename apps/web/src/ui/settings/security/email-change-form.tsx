'use client';

import { Button } from '../../components/button/button';
import { Notice } from '../../auth/notice/notice';
import { useFormAction } from '../../form-action/form-action';
import {
  emailChangeNotice,
  emailChangeUnavailable,
  initialEmailChange,
  refusesNewAddress,
  type EmailChangeState,
} from './email-change-state';

const NOTICE_ID = 'email-change-notice';

/** The email change: a server action that runs the Better Auth route. */
export type EmailChangeAction = (
  state: EmailChangeState,
  form: FormData,
) => Promise<EmailChangeState>;

/**
 * Starting an email change. The form posts to `action`, a server action, so
 * a submission before hydration or without JavaScript is the same POST and
 * the page renders its answer. JavaScript only adds the pending state, which
 * also hides the previous answer while a new one is on its way, and the
 * unavailable notice when the post never reaches the server.
 */
export function EmailChangeForm({
  action,
}: {
  readonly action: EmailChangeAction;
}) {
  const [answered, post, pending] = useFormAction(
    action,
    initialEmailChange,
    emailChangeUnavailable,
  );
  const notice = pending ? undefined : emailChangeNotice(answered);
  const refused = notice !== undefined && refusesNewAddress(answered);
  return (
    <form action={post} className="flex flex-col items-start gap-3">
      <label htmlFor="new-email">New email address</label>
      <input
        id="new-email"
        name="newEmail"
        type="email"
        required
        autoComplete="email"
        defaultValue={answered.newEmail}
        disabled={pending}
        aria-invalid={refused ? true : undefined}
        aria-describedby={refused ? NOTICE_ID : undefined}
        className="rounded-md border border-border bg-surface px-2 py-1"
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Change email'}
      </Button>
      {notice ? (
        <Notice id={NOTICE_ID} tone={notice.tone} title={notice.title} />
      ) : null}
    </form>
  );
}
