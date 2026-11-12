'use client';

import { Fragment, useState } from 'react';
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
import { RoomDialog, RoomDialogClose } from './room-dialog';

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
  useFocusAfterAnswer(answer, USERNAME_FIELD, !pending, {
    onlyWhenLost: true,
  });
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
          <input
            type="radio"
            name="seat"
            value="debater"
            defaultChecked={fields.seat === 'debater'}
          />
          Debater
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="seat"
            value="judge"
            defaultChecked={fields.seat === 'judge'}
          />
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
 * in place and the next name can follow. Each time it closes, its forms
 * start again, so a notice about an earlier invitation is not what the
 * host finds on the next open.
 */
export function InvitePeople({
  invitations,
  action,
}: {
  readonly invitations: RoomView['invitations'];
  readonly action: FormAction<InvitationFormState>;
}) {
  const [opening, setOpening] = useState(0);
  return (
    <RoomDialog
      label={
        // One element: the button's gap would otherwise part the count from its bracket.
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
      }
      titleId="invite-people-title"
      title="Invite people"
      onClose={() => setOpening((count) => count + 1)}
    >
      <p className="text-sm text-ink-muted">
        An invited member is told in Daisy and by email, and their seat is held
        for 24 hours or until the round starts.
      </p>
      <Fragment key={opening}>
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
      </Fragment>
      <div className="flex justify-end">
        <RoomDialogClose>Done</RoomDialogClose>
      </div>
    </RoomDialog>
  );
}
