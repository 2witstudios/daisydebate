import Link from 'next/link';
import type { ClubSeatsView } from '../../features/clubs/views';
import type { FormAction } from '../form-action/form-action';
import { Avatar } from '../components/avatar/avatar';
import { buttonClass } from '../components/button/button-class';
import { Icon } from '../components/icon/icon';
import { PageHeader } from '../components/page-header/page-header';
import { TabLinks } from '../components/tab-links/tab-links';
import { ClubFrame, type ClubReleaseTabs } from './club-frame';
import { dollars, seatTally, shortDay } from './club-copy';
import type { ClubFormState } from './club-form-state';
import {
  AssignSeatForm,
  InvitationActions,
  InviteForm,
  MoveSeatForm,
  RemoveSeatForm,
} from './seat-forms';

export const seatFilters = ['everyone', 'youth', 'open', 'invited'] as const;
export type SeatFilter = (typeof seatFilters)[number];

type Seat = ClubSeatsView['seats'][number];
type Member = ClubSeatsView['members'][number];
type Invitation = ClubSeatsView['invitations'][number];

const rowClass =
  'grid grid-cols-club-row items-start gap-4 border-t border-border py-4 max-compact:grid-cols-1 max-compact:gap-2';
const disclosureClass = `${buttonClass('secondary')} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

function Stat({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface-raised px-4 py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <strong className="font-display text-2xl">{value}</strong>
      <span className="text-sm text-ink-muted">{detail}</span>
    </div>
  );
}

function Who({ name, line }: { readonly name: string; readonly line: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} nameVisible />
      <div className="flex min-w-0 flex-col">
        <strong className="truncate">{name}</strong>
        <span className="truncate text-sm text-ink-muted">{line}</span>
      </div>
    </div>
  );
}

function SeatRow({
  seat,
  members,
  action,
}: {
  readonly seat: Seat;
  readonly members: readonly {
    readonly userId: string;
    readonly name: string;
  }[];
  readonly action: FormAction<ClubFormState>;
}) {
  const holder = { userId: seat.userId, name: seat.name };
  return (
    <li className={rowClass}>
      <Who name={seat.name} line={seat.username ? `@${seat.username}` : ''} />
      <span className="text-sm">
        {seat.funded ? (
          <span className="font-strong">Premium seat</span>
        ) : (
          <span className="text-live">Not covered by the seat count</span>
        )}
      </span>
      <div className="flex flex-wrap gap-2">
        <details className="group">
          <summary className={disclosureClass}>Move seat</summary>
          <div className="mt-3 w-club-disclosure max-w-full">
            <MoveSeatForm action={action} holder={holder} members={members} />
          </div>
        </details>
        <details className="group">
          <summary
            className={disclosureClass}
            aria-label={`Remove ${seat.name}’s seat`}
          >
            <Icon name="close" size={16} />
          </summary>
          <div className="mt-3 w-club-disclosure max-w-full">
            <RemoveSeatForm action={action} holder={holder} />
          </div>
        </details>
      </div>
    </li>
  );
}

function InvitationRow({
  invitation,
  action,
}: {
  readonly invitation: Invitation;
  readonly action: FormAction<ClubFormState>;
}) {
  return (
    <li className={rowClass}>
      <Who
        name={invitation.email}
        line={
          invitation.expired
            ? 'Invitation expired'
            : `Invited · open until ${shortDay(invitation.expiresAt)}`
        }
      />
      <span className="text-sm text-ink-muted">Set when they join</span>
      <span className="text-sm">
        {invitation.expired ? 'Expired' : 'Invited'}
      </span>
      <InvitationActions action={action} invitation={invitation} />
    </li>
  );
}

function MemberRow({
  member,
  freeSeat,
  action,
}: {
  readonly member: Member;
  readonly freeSeat: boolean;
  readonly action: FormAction<ClubFormState>;
}) {
  return (
    <li className={rowClass}>
      <Who
        name={member.name}
        line={member.username ? `@${member.username}` : ''}
      />
      <span className="text-sm text-ink-muted">No seat</span>
      {freeSeat ? (
        <AssignSeatForm
          action={action}
          member={{ userId: member.userId, name: member.name }}
        />
      ) : (
        <span />
      )}
    </li>
  );
}

/**
 * The club's seats (RClubSeats, RClubSeatsPhone): who holds a seat, who is
 * invited, and who could be given one, with the plan's tally above. On a
 * phone each row stacks.
 */
export function ClubSeatsPage({
  view,
  filter,
  action,
  releases = null,
}: {
  /** The media release tabs, while releases are open (ADR 0151). */
  readonly releases?: ClubReleaseTabs | null;
  readonly view: ClubSeatsView;
  readonly filter: SeatFilter;
  readonly action: FormAction<ClubFormState>;
}) {
  const tally = seatTally(view);
  const base = `/clubs/${view.club.id}`;
  const youth = view.seats.filter((seat) => seat.ladder === 'youth');
  const open = view.seats.filter((seat) => seat.ladder === 'open');
  const pending = view.invitations;
  const freeSeat = tally.empty > 0;
  const seats =
    filter === 'youth' ? youth : filter === 'open' ? open : view.seats;
  const members =
    filter === 'everyone'
      ? view.members
      : filter === 'youth'
        ? view.members.filter((member) => member.ladder === 'youth')
        : filter === 'open'
          ? view.members.filter((member) => member.ladder === 'open')
          : [];
  const moveTargets = view.members.map((member) => ({
    userId: member.userId,
    name: member.name,
  }));
  const tab = (id: SeatFilter, label: string, count: number) => ({
    id,
    label: `${label} · ${count}`,
    href: id === 'everyone' ? `${base}/seats` : `${base}/seats?show=${id}`,
    selected: filter === id,
  });
  return (
    <ClubFrame view={view} section="seats" releases={releases}>
      <PageHeader
        title="Seats"
        lede="Each seat gives one member Premium, paid by the club. Move a seat to another student any time."
        actions={
          <>
            <Link
              href={`${base}/billing#change-seats`}
              className={buttonClass('secondary')}
            >
              <Icon name="plus" size={18} />
              Add seats
            </Link>
            <a href="#invite" className={buttonClass('primary')}>
              Invite a student
            </a>
          </>
        }
      />
      {view.plan.state === 'none' ? (
        <p role="status" className="rounded-xl bg-surface-sunken p-4">
          Seats start once the club plan is paid.{' '}
          <Link href={`${base}/billing`} className="font-strong underline">
            Go to Billing
          </Link>
        </p>
      ) : null}
      <div className="grid grid-cols-club-stats gap-3">
        <Stat
          label="Seats filled"
          value={`${tally.filled} of ${view.plan.seatCount}`}
          detail={`${tally.invited} invited · ${tally.empty} empty`}
        />
        <Stat
          label="Youth students"
          value={String(youth.length)}
          detail="Under 18"
        />
        <Stat
          label="Monthly"
          value={dollars(view.plan.monthlyTotalMinor)}
          detail={
            view.plan.renewsAt
              ? `Next invoice ${shortDay(view.plan.renewsAt)}`
              : 'Not paid yet'
          }
        />
      </div>
      <section aria-label="Club members and seats" className="flex flex-col">
        <TabLinks
          label="Filter members"
          tabs={[
            tab(
              'everyone',
              'Everyone',
              view.seats.length + view.members.length + pending.length,
            ),
            tab('youth', 'Youth', youth.length),
            tab('open', 'Open', open.length),
            tab('invited', 'Invited', pending.length),
          ]}
        />
        <div
          aria-hidden="true"
          className={`${rowClass} border-t-0 text-xs font-bold tracking-widest text-ink-muted uppercase max-compact:hidden`}
        >
          <span>Member</span>
          <span>Seat</span>
          <span>Actions</span>
        </div>
        <ul className="flex flex-col">
          {filter === 'invited'
            ? null
            : seats.map((seat) => (
                <SeatRow
                  key={seat.userId}
                  seat={seat}
                  members={moveTargets}
                  action={action}
                />
              ))}
          {filter === 'everyone' || filter === 'invited'
            ? pending.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  action={action}
                />
              ))
            : null}
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              freeSeat={freeSeat}
              action={action}
            />
          ))}
        </ul>
      </section>
      {tally.empty > 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-surface-sunken p-5">
          <div className="flex flex-col">
            <strong>
              {tally.empty} empty {tally.empty === 1 ? 'seat' : 'seats'}
            </strong>
            <span className="text-sm text-ink-muted">
              You pay for {view.plan.seatCount}. Invite students to fill them,
              or lower your seat count in Billing.
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="#invite" className={buttonClass('primary')}>
              Invite a student
            </a>
            <Link
              href={`${base}/billing#change-seats`}
              className={buttonClass('secondary')}
            >
              Change seats
            </Link>
          </div>
        </section>
      ) : null}
      <section
        id="invite"
        aria-labelledby="invite-heading"
        className="flex max-w-reading flex-col gap-3 rounded-xl bg-surface p-6 shadow-1"
      >
        <h2 id="invite-heading" className="font-display text-xl font-bold">
          Invite a student
        </h2>
        <InviteForm action={action} />
      </section>
    </ClubFrame>
  );
}
