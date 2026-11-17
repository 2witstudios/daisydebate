import type { ReactNode } from 'react';
import {
  freeSeatsOf,
  isNamedSeat,
  seatKindOf,
  type RoomCastChoice,
  type RoomView,
} from '@daisy/protocol';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { RoomCommandIds } from '../../../features/rooms/room-command-ids';
import type { FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { controlClass } from '../../components/form-field/form-field-class';
import { initialsOf } from '../../../lib/initials';
import { Icon } from '../../components/icon/icon';
import { AiJudgeNotice, aiJudgeSeatable } from './ai-judge-notice';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import { declaredSeats } from './assembly-controls';
import { roomSeatLabel } from './room-labels';
import { RoomInvite } from './room-invite';
import { EndInvitationForm } from './end-invitation-form';
import { HeldUntil } from './held-until';
import { ROOM_TITLE_ID } from './room-setup-modal';
import type { InvitationFormState } from '../../../features/room-invitations/submit';
import {
  ordinalOf,
  rosterBoxes,
  showsTeams,
  sideLabels,
  type RosterBoxes,
  type SideMark,
} from './roster-seat';

type SeatIds = RoomCommandIds['seats'][number];
type Seat = ReturnType<typeof declaredSeats>[number];
type Participant = RoomView['participants'][number];
type Named = Extract<Participant, { actorId: string }>;

export type RosterProps = {
  readonly view: RoomView;
  readonly viewer: { readonly actorId: string; readonly label: string };
  readonly bots: readonly RoomCastChoice[];
  readonly action: FormAction<RoomFormState>;
  readonly commandIds: Pick<RoomCommandIds, 'seats' | 'sides' | 'leave'>;
  /** What Start waits on, and Start round for the host: the roster's last line. */
  readonly footer: ReactNode;
  /** The host's withdraw, which releases a seat held for an invitation. */
  readonly invitationAction: FormAction<InvitationFormState>;
};

const boxTone: Readonly<Record<SideMark, string>> = {
  affirmative: 'bg-hue-sky-soft text-hue-sky',
  negative: 'bg-hue-clay-soft text-hue-clay',
  '?': 'border-2 border-dashed border-gold-border bg-gold-soft text-ink',
};
const boxClass =
  'flex min-h-room-target w-full items-center justify-center rounded-lg text-sm font-semibold';

/** One box of a row: a button that posts its next value, or the value alone. */
function CycleBox({
  props,
  label,
  text,
  tone,
  type,
  commandId,
  fields,
}: {
  readonly props: RosterProps;
  readonly label: string;
  readonly text: string;
  readonly tone: string;
  readonly type: 'set-seat' | 'set-sides';
  /** Null when the viewer may not change this box. */
  readonly commandId: string | null;
  readonly fields: Readonly<Record<string, string>>;
}) {
  if (commandId === null)
    return (
      <span aria-label={label} className={`${boxClass} ${tone}`}>
        {text}
      </span>
    );
  return (
    <AssemblyCommandForm action={props.action} className="w-full">
      <AssemblyCommandFields
        type={type}
        version={props.view.version}
        commandId={commandId}
      />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        aria-label={label}
        className={`${boxClass} ${tone} hover:ring-2 hover:ring-border-strong`}
      >
        {text}
      </button>
    </AssemblyCommandForm>
  );
}

const valueOf = (value: number | null) => (value === null ? '' : String(value));

function SeatBoxes({
  props,
  seat,
  boxes,
  ids,
  teams,
}: {
  readonly props: RosterProps;
  readonly seat: Named;
  readonly boxes: RosterBoxes;
  readonly ids: SeatIds;
  readonly teams: boolean;
}) {
  const who = seat.label;
  const team = boxes.team === '?' ? null : boxes.team;
  const sideText = sideLabels[boxes.side];
  const positionText = boxes.position === '?' ? '?' : ordinalOf(boxes.position);
  return (
    <>
      {teams ? (
        <CycleBox
          props={props}
          label={`${who}'s team: ${boxes.team === '?' ? 'random' : boxes.team}`}
          text={String(boxes.team)}
          tone={
            boxes.team === '?' ? boxTone['?'] : 'bg-surface-sunken text-ink'
          }
          type="set-seat"
          commandId={boxes.mayMove ? ids.team : null}
          fields={{
            participantId: seat.id,
            team: valueOf(boxes.next.team),
            position: '',
          }}
        />
      ) : null}
      <CycleBox
        props={props}
        label={`${who}'s side: ${boxes.side === '?' ? 'coin flip' : sideText}`}
        text={sideText}
        tone={boxTone[boxes.side]}
        type="set-sides"
        commandId={boxes.maySetSide ? props.commandIds.sides : null}
        fields={{ teamOneSide: boxes.next.teamOneSide ?? '' }}
      />
      {teams ? (
        <CycleBox
          props={props}
          label={`${who}'s position: ${boxes.position === '?' ? 'random' : positionText}`}
          text={positionText}
          tone={
            boxes.position === '?' ? boxTone['?'] : 'bg-surface-sunken text-ink'
          }
          type="set-seat"
          commandId={boxes.mayMove && team !== null ? ids.position : null}
          fields={{
            participantId: seat.id,
            team: valueOf(team),
            position: valueOf(boxes.next.position),
          }}
        />
      ) : null}
    </>
  );
}

/** Display only: everyone readies with the button under their own tile. */
function ReadyMark({ seat }: { readonly seat: Participant }) {
  const ready = !seat.needsReady || seat.ready === 'ready';
  return ready ? (
    <Icon
      name="check"
      label="Ready"
      size={20}
      className="justify-self-center text-online"
    />
  ) : (
    <span
      role="img"
      aria-label="Not ready"
      className="size-4 justify-self-center rounded-full border-2 border-dashed border-border-strong"
    />
  );
}

const avatarTone = {
  affirmative: 'bg-hue-sky-soft text-hue-sky',
  negative: 'bg-hue-clay-soft text-hue-clay',
  judge: 'bg-hue-teal-soft text-hue-teal',
} as const;

/** The name, an inline rating, and who they are to this viewer. */
function Who({
  props,
  seat,
  role,
}: {
  readonly props: RosterProps;
  readonly seat: Named | null;
  readonly role: Seat['role'];
}) {
  const meta = seat
    ? [
        seat.actorId === props.viewer.actorId ? 'You' : null,
        seat.actorId === props.view.hostActorId ? 'Host' : null,
        seat.kind === 'bot' ? 'Bot' : null,
        seat.eligible ? null : 'Not eligible',
      ].filter((part) => part !== null)
    : [];
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTone[role]}`}
      >
        {initialsOf(seat?.label ?? 'Judge')}
      </span>
      <div className="min-w-0">
        <p className="flex min-w-0 items-baseline gap-x-2 font-semibold">
          <span className="truncate" title={seat?.label ?? 'Judge'}>
            {seat?.label ?? 'Judge'}
          </span>
          {seat?.rating ? (
            <span
              className={`shrink-0 text-xs font-book text-ink-muted tabular-nums ${seat.rating.provisional ? 'italic' : ''}`}
            >
              {seat.rating.value}
              {seat.rating.provisional ? '*' : ''}
            </span>
          ) : null}
        </p>
        {meta.length > 0 ? (
          <p className="text-xs text-ink-muted">{meta.join(' · ')}</p>
        ) : null}
      </div>
    </div>
  );
}

function CommandButton({
  props,
  type,
  commandId,
  fields,
  label,
  name = label,
}: {
  readonly props: RosterProps;
  readonly type: 'claim-seat' | 'assign-seat' | 'remove-seat' | 'leave-seat';
  readonly commandId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly label: string;
  /** The accessible name, when the visible label leans on its row. */
  readonly name?: string;
}) {
  return (
    <AssemblyCommandForm action={props.action}>
      <AssemblyCommandFields
        type={type}
        version={props.view.version}
        commandId={commandId}
      />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        aria-label={name === label ? undefined : name}
        className={buttonClass('ghost')}
      >
        {label}
      </button>
    </AssemblyCommandForm>
  );
}

/** The host's pick of who sits in an open seat: members first, then bots. */
function AssignSeat({
  props,
  seat,
  ids,
}: {
  readonly props: RosterProps;
  readonly seat: Seat;
  readonly ids: SeatIds;
}) {
  const { view } = props;
  const seated = new Set(
    view.participants.filter(isNamedSeat).map((p) => p.actorId),
  );
  const people = [
    ...new Map(
      [props.viewer, ...view.participants.filter(isNamedSeat)]
        .filter((p) => !('kind' in p) || p.kind === 'human')
        .filter((p) => !seated.has(p.actorId))
        .map((p) => [p.actorId, p]),
    ).values(),
  ];
  const bots = props.bots.filter(
    (bot) =>
      bot.seatRole === (seat.role === 'judge' ? 'judge' : 'debater') &&
      bot.eligible &&
      !(bot.seatRole === 'judge' && !aiJudgeSeatable(view.aiJudgeSeating)) &&
      !(view.competitionType === 'ranked' && bot.seatRole === 'debater'),
  );
  if (people.length + bots.length === 0) return null;
  const id = `assign-${seat.role}-${seat.slot}`;
  // One button on the open seat's line; the choice opens over it, natively.
  return (
    <>
      <button
        type="button"
        popoverTarget={`${id}-menu`}
        className={buttonClass('ghost')}
      >
        Seat someone
      </button>
      <div
        id={`${id}-menu`}
        popover="auto"
        role="dialog"
        aria-label="Seat someone"
        className="m-auto w-room-dialog max-w-full rounded-lg border border-border-strong bg-surface p-4 text-ink shadow-3 backdrop:bg-scrim/50"
      >
        <AssemblyCommandForm action={props.action} className="flex gap-2">
          <AssemblyCommandFields
            type="assign-seat"
            version={view.version}
            commandId={ids.assign}
          />
          <input type="hidden" name="role" value={seat.role} />
          <input type="hidden" name="slot" value={String(seat.slot)} />
          <label className="sr-only" htmlFor={id}>
            Seat someone in {roomSeatLabel(view, seat.role, seat.slot)}
          </label>
          <select
            id={id}
            name="actorId"
            required
            defaultValue=""
            className={`${controlClass} min-w-0 flex-1`}
          >
            <option value="" disabled>
              Choose someone
            </option>
            {people.map((p) => (
              <option key={p.actorId} value={p.actorId}>
                {p.label}
              </option>
            ))}
            {bots.map((bot) => (
              <option key={bot.actorId} value={bot.actorId}>
                {bot.label} · Bot
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass('primary')}>
            Seat
          </button>
        </AssemblyCommandForm>
      </div>
    </>
  );
}

/** Whether every free seat of this kind is held for someone other than this viewer. */
const heldFromViewer = (view: RoomView, role: Seat['role']) => {
  const kind = seatKindOf(role);
  const held = view.seatsHeldFromViewer[kind];
  return held > 0 && freeSeatsOf(view, kind) <= held;
};

/** An open seat: take it, invite someone, seat an AI judge, or (host) seat anyone. */
function OpenSeat({
  props,
  seat,
  ids,
  invited,
}: {
  readonly props: RosterProps;
  readonly seat: Seat;
  readonly ids: SeatIds;
  /** The pending invitation this seat is kept for, if any. */
  readonly invited: RoomView['invitations'][number] | undefined;
}) {
  const { view } = props;
  const position = { role: seat.role, slot: String(seat.slot) };
  const aiJudge = aiJudgeSeatable(view.aiJudgeSeating)
    ? props.bots.find((bot) => bot.seatRole === 'judge' && bot.eligible)
    : undefined;
  return (
    <>
      <span aria-hidden="true" />
      <div className="col-span-full col-start-2 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-ink-muted">
          {invited ? (
            <>
              {`Invited: ${invited.invitee}`}
              <HeldUntil expiresAt={invited.expiresAt} />
            </>
          ) : (
            'Open'
          )}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {view.capabilities.canClaimSeat &&
          !heldFromViewer(view, seat.role) ? (
            <CommandButton
              props={props}
              type="claim-seat"
              commandId={ids.claim}
              fields={position}
              label="Take seat"
              name={`Take ${roomSeatLabel(view, seat.role, seat.slot)}`}
            />
          ) : null}
          {!invited ? (
            <RoomInvite
              roomId={view.id}
              visibility={view.visibility}
              label="Invite"
            />
          ) : view.capabilities.host ? (
            // The host releases the held seat by withdrawing its invitation (ADR 0124).
            <EndInvitationForm
              action={props.invitationAction}
              intent="withdraw"
              invitationId={invited.id}
              label="Release"
              focusAfterAnswer={ROOM_TITLE_ID}
            />
          ) : null}
          {seat.role === 'judge' && view.capabilities.host && aiJudge ? (
            <CommandButton
              props={props}
              type="assign-seat"
              commandId={ids.ai}
              fields={{ ...position, actorId: aiJudge.actorId }}
              label="AI judge"
            />
          ) : null}
          {view.capabilities.host ? (
            <AssignSeat props={props} seat={seat} ids={ids} />
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({
  props,
  seat,
  ids,
  teams,
  invited,
}: {
  readonly props: RosterProps;
  readonly seat: Seat;
  readonly ids: SeatIds;
  readonly teams: boolean;
  readonly invited: RoomView['invitations'][number] | undefined;
}) {
  const { view } = props;
  const occupant = view.participants.find(
    (p) => p.role === seat.role && p.slot === seat.slot,
  );
  const named = occupant && isNamedSeat(occupant) ? occupant : null;
  const boxes = occupant
    ? rosterBoxes(view, occupant, props.viewer.actorId)
    : null;
  return (
    <li
      aria-label={named?.label ?? roomSeatLabel(view, seat.role, seat.slot)}
      className={`grid items-center gap-x-3 border-t border-border py-2 first:border-t-0 ${seat.role === 'judge' ? 'room-roster-judges' : teams ? 'room-roster-teams' : 'room-roster-sides'}`}
    >
      {!occupant ? (
        <OpenSeat props={props} seat={seat} ids={ids} invited={invited} />
      ) : (
        <>
          <ReadyMark seat={occupant} />
          <Who props={props} seat={named} role={seat.role} />
          {named && boxes ? (
            <SeatBoxes
              props={props}
              seat={named}
              boxes={boxes}
              ids={ids}
              teams={teams}
            />
          ) : null}
          <div className="room-roster-action flex justify-end empty:hidden">
            {named && named.actorId === props.viewer.actorId ? (
              <CommandButton
                props={props}
                type="leave-seat"
                commandId={props.commandIds.leave}
                fields={{}}
                label="Leave"
                name="Leave seat"
              />
            ) : named && view.capabilities.host ? (
              <CommandButton
                props={props}
                type="remove-seat"
                commandId={ids.remove}
                fields={{ participantId: named.id }}
                label="Remove"
                name={`Remove ${named.label}`}
              />
            ) : null}
          </div>
        </>
      )}
    </li>
  );
}

/** Pending invitations of each kind, kept for that kind's first open seats. */
function invitationsBySeat(view: RoomView, seats: readonly Seat[]) {
  const open = seats.filter(
    (seat) =>
      !view.participants.some(
        (p) => p.role === seat.role && p.slot === seat.slot,
      ),
  );
  const kept = new Map<string, RoomView['invitations'][number]>();
  for (const kind of ['debater', 'judge'] as const) {
    const pending = view.invitations.filter((i) => i.seat === kind);
    open
      .filter((seat) => seatKindOf(seat.role) === kind)
      .forEach((seat, index) => {
        const invitation = pending[index];
        if (invitation) kept.set(`${seat.role}:${seat.slot}`, invitation);
      });
  }
  return kept;
}

/**
 * The Room's roster (ADR 0145): one row per declared seat, debaters then
 * judges. A debater row shows Ready, the debater, and the boxes that decide
 * their seat: Side always, Team and Position when a team seats more than
 * one. `?` is decided at Start round.
 */
export function RoomRoster(props: RosterProps) {
  const { view } = props;
  const seats = declaredSeats(view.definition.seats);
  const teams = showsTeams(view.definition.seats);
  const invited = invitationsBySeat(view, seats);
  const debaters = seats.filter((seat) => seat.role !== 'judge');
  const judges = seats.filter((seat) => seat.role === 'judge');
  const filled = (role: 'debater' | 'judge') =>
    view.participants.filter((p) => (p.role === 'judge') === (role === 'judge'))
      .length;
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;
  const row = (seat: Seat) => {
    const ids = props.commandIds.seats[seats.indexOf(seat)];
    if (!ids) throw new Error('Missing Room seat command identities');
    return (
      <Row
        key={`${seat.role}:${seat.slot}`}
        props={props}
        seat={seat}
        ids={ids}
        teams={teams}
        invited={invited.get(`${seat.role}:${seat.slot}`)}
      />
    );
  };
  return (
    <section
      aria-labelledby="room-roster-title"
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="room-roster-title" className="text-md font-semibold">
          Players
        </h2>
        <p className="text-sm text-ink-muted tabular-nums">
          {`${filled('debater')} of ${plural(debaters.length, 'debater')}`}
          {judges.length > 0
            ? ` · ${filled('judge')} of ${plural(judges.length, 'judge')}`
            : null}
        </p>
      </div>
      <div
        aria-hidden="true"
        className={`grid gap-x-3 text-xs font-semibold text-ink-muted ${teams ? 'room-roster-teams' : 'room-roster-sides'}`}
      >
        <span className="justify-self-center">Ready</span>
        <span>Debater</span>
        {teams ? <span className="justify-self-center">Team</span> : null}
        <span className="justify-self-center">Side</span>
        {teams ? <span className="justify-self-center">Position</span> : null}
      </div>
      <ul className="flex flex-col">{debaters.map(row)}</ul>
      {judges.length > 0 ? (
        <>
          <h3 className="mt-2 text-sm font-semibold text-ink-muted">Judges</h3>
          <ul className="flex flex-col">{judges.map(row)}</ul>
          <AiJudgeNotice view={view} />
        </>
      ) : null}
      <div className="mt-2 border-t border-border pt-3">{props.footer}</div>
    </section>
  );
}
