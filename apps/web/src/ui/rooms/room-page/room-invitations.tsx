'use client';

import { isOpenRoomStatus, type RoomView } from '@daisy/protocol';
import { invitedTo } from '../../../features/notifications/notification-words';
import {
  initialInvitationForm,
  invitationFields,
  invitationFormUnavailable,
  type InvitationFormState,
} from '../../../features/room-invitations/submit';
import { buttonClass } from '../../components/button/button-class';
import { useFormAction, type FormAction } from '../../form-action/form-action';

function EndForm({
  action,
  intent,
  invitationId,
  label,
}: {
  readonly action: FormAction<InvitationFormState>;
  readonly intent: 'withdraw' | 'decline';
  readonly invitationId: string;
  readonly label: string;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialInvitationForm,
    invitationFormUnavailable,
  );
  const fields = invitationFields(answer);
  return (
    <form action={post} className="flex items-center gap-2">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <button
        type="submit"
        className={buttonClass('secondary')}
        disabled={pending}
      >
        {label}
      </button>
      {fields.notice ? (
        <span role="status" className="text-sm text-ink-muted">
          {fields.notice}
        </span>
      ) : null}
    </form>
  );
}

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
  const fields = invitationFields(answer);
  return (
    <form
      action={post}
      aria-label="Invite people"
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="intent" value="invite" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Username
          <input
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
          className={buttonClass('primary')}
          disabled={pending}
        >
          Send invitation
        </button>
      </div>
      {fields.notice ? (
        <p role="status" className="text-sm text-ink-muted">
          {fields.notice}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Named invitations to this Room (ADR 0124). An invited member sees who
 * asked them and as what, and can decline; the seat is held for them, so
 * they take it from the seats below. The host invites by username as a
 * debater or the judge, and sees each pending invitation with Withdraw.
 * Every control is a native form.
 */
export function RoomInvitations({
  view,
  viewerLabel,
  action,
}: {
  readonly view: RoomView;
  readonly viewerLabel: string;
  readonly action: FormAction<InvitationFormState>;
}) {
  const open = isOpenRoomStatus(view.status);
  if (!open) return null;
  const mine = view.invitations.filter(
    (invitation) => invitation.invitee === viewerLabel,
  );
  const host = view.capabilities.host;
  if (!host && mine.length === 0) return null;
  return (
    <section
      aria-labelledby="room-invitations-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="room-invitations-heading" className="text-lg font-strong">
        {host ? 'Invite people' : 'You’re invited'}
      </h2>
      {mine.map((invitation) => (
        <div
          key={invitation.id}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-base text-ink">
            @{invitation.inviter} invited you {invitedTo(invitation.seat)}.{' '}
            {invitation.seat === 'judge'
              ? 'The judge seat below is held for you.'
              : 'A debater seat below is held for you.'}
          </p>
          <EndForm
            action={action}
            intent="decline"
            invitationId={invitation.id}
            label="Decline"
          />
        </div>
      ))}
      {host ? (
        <>
          <p className="text-sm text-ink-muted">
            An invited member is told in Daisy and by email, and their seat is
            held for 24 hours or until the round starts.
          </p>
          <InviteForm action={action} />
          {view.invitations.length > 0 ? (
            <ul
              className="flex flex-col gap-2"
              aria-label="Pending invitations"
            >
              {view.invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <span className="text-base text-ink">
                    @{invitation.invitee} · invited {invitedTo(invitation.seat)}
                  </span>
                  <EndForm
                    action={action}
                    intent="withdraw"
                    invitationId={invitation.id}
                    label="Withdraw"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
