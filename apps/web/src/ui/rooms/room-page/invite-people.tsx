'use client';

import { useRef } from 'react';
import type { RoomView } from '@daisy/protocol';
import { invitedTo } from '../../../features/notifications/notification-words';
import {
  initialInvitationForm,
  invitationFields,
  invitationFormUnavailable,
  type InvitationFormState,
} from '../../../features/room-invitations/submit';
import { buttonClass } from '../../components/button/button-class';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../../form-action/form-action';
import { EndInvitationForm } from './end-invitation-form';

/** Where focus returns after each answer: the next name is typed here. */
const USERNAME_FIELD = 'invite-people-username';

function InviteForm({
  action,
}: {
  readonly action: FormAction<InvitationFormState>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialInvitationForm,
    invitationFormUnavailable,
  );
  useFocusAfterAnswer(answer, USERNAME_FIELD, !pending);
  const fields = invitationFields(answer);
  return (
    <form action={post} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="invite" />
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Username
        <input
          id={USERNAME_FIELD}
          name="username"
          required
          maxLength={65}
          autoComplete="off"
          defaultValue={fields.username}
          key={fields.fieldKey}
          className="rounded-md border border-border bg-surface px-3 py-2 text-base text-ink"
        />
      </label>
      <fieldset className="flex items-center gap-3 text-sm text-ink">
        <legend className="sr-only">Invite as</legend>
        <label className="flex items-center gap-1">
          <input type="radio" name="seat" value="debater" defaultChecked />
          Debater
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="seat" value="judge" />
          Judge
        </label>
      </fieldset>
      <button
        type="submit"
        className={`${buttonClass('primary')} self-start`}
        disabled={pending}
      >
        Send invitation
      </button>
      {fields.notice ? (
        <p role="status" className="text-sm text-ink-muted">
          {fields.notice}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The host invites members by username, as a debater or the judge, and
 * withdraws a pending invitation (ADR 0124), in a dialog behind a header
 * button. The button carries the number pending, so held seats show without
 * opening it. The dialog stays open after each answer: the notice is read
 * in place and the next name can follow.
 */
export function InvitePeople({
  invitations,
  action,
}: {
  readonly invitations: RoomView['invitations'];
  readonly action: FormAction<InvitationFormState>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className={buttonClass('secondary')}
      >
        {/* One element: the button's gap would otherwise part the count from its bracket. */}
        <span>
          Invite people
          {invitations.length > 0 ? (
            <>
              {' '}
              ({invitations.length}
              <span className="sr-only"> pending</span>)
            </>
          ) : null}
        </span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="invite-people-title"
        className="m-auto w-room-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface p-6 text-ink shadow-3 backdrop:bg-scrim/50 open:flex"
      >
        <h2 id="invite-people-title" className="font-display text-lg">
          Invite people
        </h2>
        <p className="text-sm text-ink-muted">
          An invited member is told in Daisy and by email, and their seat is
          held for 24 hours or until the round starts.
        </p>
        <InviteForm action={action} />
        {invitations.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Pending invitations">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="text-base wrap-anywhere text-ink">
                  @{invitation.invitee} · invited {invitedTo(invitation.seat)}
                </span>
                <EndInvitationForm
                  action={action}
                  intent="withdraw"
                  invitationId={invitation.id}
                  label="Withdraw"
                  focusAfterAnswer={USERNAME_FIELD}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className={buttonClass('secondary')}
          >
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}
