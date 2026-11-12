'use client';

import { isOpenRoomStatus, type RoomView } from '@daisy/protocol';
import { invitedTo } from '../../../features/notifications/notification-words';
import type { InvitationFormState } from '../../../features/room-invitations/submit';
import type { FormAction } from '../../form-action/form-action';
import { EndInvitationForm } from './end-invitation-form';

/**
 * What an invited member sees on the Room page (ADR 0124): who asked them
 * and as what, and Decline. The seat is held for them, so they take it from
 * the seats below. It is a prompt they must see, so it stays on the page;
 * the host's own tool is `InvitePeople`, behind a button in the header.
 */
export function InvitedNotice({
  view,
  viewerLabel,
  action,
}: {
  readonly view: RoomView;
  readonly viewerLabel: string;
  readonly action: FormAction<InvitationFormState>;
}) {
  if (!isOpenRoomStatus(view.status)) return null;
  const mine = view.invitations.filter(
    (invitation) => invitation.invitee === viewerLabel,
  );
  if (mine.length === 0) return null;
  return (
    <section
      aria-labelledby="invited-notice-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="invited-notice-heading" className="text-lg font-strong">
        You’re invited
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
          <EndInvitationForm
            action={action}
            intent="decline"
            invitationId={invitation.id}
            label="Decline"
          />
        </div>
      ))}
    </section>
  );
}
