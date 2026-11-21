'use client';

import { StatusRegion } from '../components/status-region/status-region';
import { useState } from 'react';
import type { FormAction } from '../form-action/form-action';
import { Button } from '../components/button/button';
import { controlClass } from '../components/form-field/form-field-class';
import { FormField } from '../components/form-field/form-field';
import { ClubForm } from './club-form';
import type { ClubFormState } from './club-form-state';

type Action = FormAction<ClubFormState>;
type Person = { readonly userId: string; readonly name: string };

/** The consequence of giving up a seat, said before the member confirms it. */
const endsTodayCopy = (name: string) =>
  `${name} stays a member and keeps their ratings and Rounds, and drops to the free plan at the end of today (UTC).`;

/** Invite someone to a seat by email; the invitation holds a seat for 14 days. */
export function InviteForm({
  action,
  id = 'club-invite',
}: {
  readonly action: Action;
  readonly id?: string;
}) {
  return (
    <ClubForm
      action={action}
      label="Invite to a seat"
      focusTarget={`${id}-email`}
      className="flex flex-col gap-3"
    >
      {({ values, pending, done }) => (
        <>
          <input type="hidden" name="kind" value="invite" />
          <FormField
            id={`${id}-email`}
            label="Email"
            helper="They accept with this email. The invitation holds a seat for 14 days."
          >
            <input
              id={`${id}-email`}
              name="email"
              type="email"
              required
              autoComplete="off"
              maxLength={320}
              defaultValue={done ? '' : (values.email ?? '')}
              key={done ? 'sent' : 'typing'}
              className={controlClass}
            />
          </FormField>
          <Button type="submit" disabled={pending} className="self-start">
            Send invitation
          </Button>
          {done ? (
            <StatusRegion
              as="p"
              role="status"
              className="text-sm text-ink-muted"
            >
              Invitation sent.
            </StatusRegion>
          ) : null}
        </>
      )}
    </ClubForm>
  );
}

/** Move a held seat to a member without one, or to someone new by email. */
export function MoveSeatForm({
  action,
  holder,
  members,
}: {
  readonly action: Action;
  readonly holder: Person;
  readonly members: readonly Person[];
}) {
  const [to, setTo] = useState(members[0]?.userId ?? 'invite');
  const id = `move-${holder.userId}`;
  return (
    <ClubForm
      action={action}
      label={`Move ${holder.name}’s seat`}
      focusTarget={`${id}-to`}
      onlyWhenLost
      className="flex flex-col gap-3"
    >
      {({ values, pending }) => (
        <>
          <input type="hidden" name="kind" value="move" />
          <input type="hidden" name="fromUserId" value={holder.userId} />
          <FormField id={`${id}-to`} label={`Move ${holder.name}’s seat to`}>
            <select
              id={`${id}-to`}
              name="to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={controlClass}
            >
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
              <option value="invite">Someone new: invite by email</option>
            </select>
          </FormField>
          {to === 'invite' ? (
            <FormField id={`${id}-email`} label="Their email">
              <input
                id={`${id}-email`}
                name="email"
                type="email"
                required
                maxLength={320}
                defaultValue={values.email ?? ''}
                className={controlClass}
              />
            </FormField>
          ) : null}
          <p className="text-sm text-ink-muted">
            {endsTodayCopy(holder.name)} No charge for moving a seat.
          </p>
          <Button type="submit" disabled={pending} className="self-start">
            Move seat
          </Button>
        </>
      )}
    </ClubForm>
  );
}

/** Give up a held seat: the person stays a member. */
export function RemoveSeatForm({
  action,
  holder,
}: {
  readonly action: Action;
  readonly holder: Person;
}) {
  return (
    <ClubForm
      action={action}
      label={`Remove ${holder.name}’s seat`}
      onlyWhenLost
      className="flex flex-col gap-3"
    >
      {({ pending }) => (
        <>
          <input type="hidden" name="kind" value="remove" />
          <input type="hidden" name="userId" value={holder.userId} />
          <p className="text-sm text-ink-muted">{endsTodayCopy(holder.name)}</p>
          <Button
            type="submit"
            variant="secondary"
            disabled={pending}
            className="self-start"
          >
            Remove seat
          </Button>
        </>
      )}
    </ClubForm>
  );
}

/** Give a free seat to a member who has none. */
export function AssignSeatForm({
  action,
  member,
}: {
  readonly action: Action;
  readonly member: Person;
}) {
  return (
    <ClubForm action={action} label={`Give ${member.name} a seat`} onlyWhenLost>
      {({ pending }) => (
        <>
          <input type="hidden" name="kind" value="assign" />
          <input type="hidden" name="userId" value={member.userId} />
          <Button type="submit" variant="secondary" disabled={pending}>
            Give a seat
          </Button>
        </>
      )}
    </ClubForm>
  );
}

/** Resend or cancel a pending invitation. */
export function InvitationActions({
  action,
  invitation,
}: {
  readonly action: Action;
  readonly invitation: {
    readonly id: string;
    readonly email: string;
    readonly expired: boolean;
  };
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {invitation.expired ? null : (
        <ClubForm
          action={action}
          label={`Resend to ${invitation.email}`}
          onlyWhenLost
        >
          {({ pending, done }) => (
            <>
              <input type="hidden" name="kind" value="resend" />
              <input type="hidden" name="invitationId" value={invitation.id} />
              <Button type="submit" variant="secondary" disabled={pending}>
                {done ? 'Sent' : 'Resend'}
              </Button>
            </>
          )}
        </ClubForm>
      )}
      <ClubForm
        action={action}
        label={`Cancel the invite to ${invitation.email}`}
        onlyWhenLost
      >
        {({ pending }) => (
          <>
            <input type="hidden" name="kind" value="cancel" />
            <input type="hidden" name="invitationId" value={invitation.id} />
            <Button
              type="submit"
              variant="ghost"
              disabled={pending}
              aria-label={`Cancel the invite to ${invitation.email}`}
            >
              Cancel invite
            </Button>
          </>
        )}
      </ClubForm>
    </div>
  );
}
