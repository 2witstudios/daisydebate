import type { ReactNode } from 'react';
import {
  affirmativeSide,
  aiRoleFits,
  freeSeatsOf,
  isDebatingSeat,
  isJudgeSeat,
  isModeratorSeat,
  isNamedSeat,
  negativeSide,
  sameSeat,
  seatKey,
  seatKinds,
  type RoomCastChoice,
  type RoomView,
  type SeatRef,
} from '@daisy/protocol';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { RoomCommandIds } from '../../../features/rooms/room-command-ids';
import type { FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { controlClass } from '../../components/form-field/form-field-class';
import { initialsOf } from '../../../lib/initials';
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
import { officialTone, sideTone, speakerTone } from './side-tone';
import {
  isEventRoom,
  ordinalOf,
  rosterBoxes,
  showsTeams,
  sideLabels,
  type RosterBoxes,
  type SideMark,
} from './roster-seat';

type SeatIds = RoomCommandIds['seats'][number];
type Seat = SeatRef;
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

/**
 * The AI actors a seat may hold: a bot debater for a side's or a speaker's
 * seat, the AI judge for a judge's, and none for a moderator's (TAB-6.18).
 */
export const botsForSeat = (
  bots: readonly RoomCastChoice[],
  seat: SeatRef,
): readonly RoomCastChoice[] =>
  bots.filter((bot) => aiRoleFits(bot.aiRole, seat));

const twoSideTones = [{ key: affirmativeSide }, { key: negativeSide }];
const boxTone: Readonly<Record<SideMark, string>> = {
  [affirmativeSide]: sideTone(twoSideTones, affirmativeSide),
  [negativeSide]: sideTone(twoSideTones, negativeSide),
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

function ReadyMark({ seat }: { readonly seat: Participant }) {
  const ready = !seat.needsReady || seat.ready === 'ready';
  return (
    <span
      role="img"
      aria-label={ready ? 'Ready' : 'Not ready'}
      className={`flex size-8 items-center justify-center justify-self-center rounded-md border-2 text-sm font-bold ${ready ? 'border-accent bg-accent text-accent-ink' : 'border-border-strong'}`}
    >
      {ready ? '✓' : null}
    </span>
  );
}

/** A seat's avatar tone: its side's, the speakers' shared one, or the officials'. */
const avatarTone = (
  sides: readonly { readonly key: string }[],
  seat: Seat,
): string => {
  switch (seat.kind) {
    case 'side':
      return sideTone(sides, seat.side);
    case 'speaker':
      return speakerTone;
    case 'judge':
    case 'moderator':
      return officialTone;
  }
};

/** The name, an inline rating, and who they are to this viewer. */
function Who({
  props,
  seat,
  place,
}: {
  readonly props: RosterProps;
  readonly seat: Named | null;
  readonly place: Seat;
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
        className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTone(props.view.rules.sides, place)}`}
      >
        {initialsOf(seat?.label ?? 'Judge')}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 font-semibold wrap-anywhere">
          {seat?.label ?? 'Judge'}
          {seat?.rating ? (
            <span
              className={`text-xs font-book text-ink-muted tabular-nums ${seat.rating.provisional ? 'italic' : ''}`}
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
  const judge = isJudgeSeat(seat);
  const bots = botsForSeat(props.bots, seat).filter(
    (bot) =>
      bot.eligible &&
      !(judge && !aiJudgeSeatable(view.aiJudgeSeating)) &&
      !(view.competitionType === 'ranked' && !judge),
  );
  if (people.length + bots.length === 0) return null;
  const id = `assign-${seatKey(seat).replace(':', '-')}`;
  return (
    <AssemblyCommandForm action={props.action} className="flex gap-2">
      <AssemblyCommandFields
        type="assign-seat"
        version={view.version}
        commandId={ids.assign}
      />
      <input type="hidden" name="seat" value={JSON.stringify(seat)} />
      <label className="sr-only" htmlFor={id}>
        Seat someone in {roomSeatLabel(view, seat)}
      </label>
      <select
        id={id}
        name="actorId"
        required
        defaultValue=""
        className={controlClass}
      >
        <option value="" disabled>
          Seat…
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
      <button type="submit" className={buttonClass('secondary')}>
        Seat
      </button>
    </AssemblyCommandForm>
  );
}

/** Whether every free seat of this kind is held for someone other than this viewer. */
const heldFromViewer = (view: RoomView, seat: Seat) => {
  const held = view.seatsHeldFromViewer[seat.kind];
  return held > 0 && freeSeatsOf(view, seat.kind) <= held;
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
  const position = { seat: JSON.stringify(seat) };
  const judge = isJudgeSeat(seat);
  const aiJudge =
    judge && aiJudgeSeatable(view.aiJudgeSeating)
      ? botsForSeat(props.bots, seat).find((bot) => bot.eligible)
      : undefined;
  // An event Room's seats are the organiser's: nobody takes or invites into
  // one from the roster (ADR 0145, Tab).
  const event = isEventRoom(view);
  return (
    <>
      <span
        aria-hidden="true"
        className="size-8 justify-self-center rounded-md border-2 border-dashed border-border"
      />
      <div className="col-span-full col-start-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
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
        <div className="flex flex-wrap items-center gap-2">
          {!event &&
          view.capabilities.canClaimSeat &&
          !heldFromViewer(view, seat) ? (
            <CommandButton
              props={props}
              type="claim-seat"
              commandId={ids.claim}
              fields={position}
              label="Take seat"
              name={`Take ${roomSeatLabel(view, seat)}`}
            />
          ) : null}
          {event ? null : !invited ? (
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
          {view.capabilities.host && aiJudge ? (
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
  const occupant = view.participants.find((p) => sameSeat(p.seat, seat));
  const named = occupant && isNamedSeat(occupant) ? occupant : null;
  const boxes = occupant
    ? rosterBoxes(view, occupant, props.viewer.actorId)
    : null;
  return (
    <li
      aria-label={named?.label ?? roomSeatLabel(view, seat)}
      className={`grid items-center gap-x-3 border-t border-border py-2 first:border-t-0 ${!isDebatingSeat(seat) ? 'room-roster-judges' : teams ? 'room-roster-teams' : 'room-roster-sides'}`}
    >
      {!occupant ? (
        <OpenSeat props={props} seat={seat} ids={ids} invited={invited} />
      ) : (
        <>
          <ReadyMark seat={occupant} />
          <Who props={props} seat={named} place={seat} />
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
            {named &&
            named.actorId === props.viewer.actorId &&
            !isEventRoom(view) ? (
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
    (seat) => !view.participants.some((p) => sameSeat(p.seat, seat)),
  );
  const kept = new Map<string, RoomView['invitations'][number]>();
  // Every kind an invitation may hold: a side's seat, a speaker's, a judge's.
  for (const kind of seatKinds) {
    const pending = view.invitations.filter((i) => i.seat === kind);
    open
      .filter((seat) => seat.kind === kind)
      .forEach((seat, index) => {
        const invitation = pending[index];
        if (invitation) kept.set(seatKey(seat), invitation);
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
  const seats = declaredSeats(view.rules);
  const teams = showsTeams(view.definition);
  const invited = invitationsBySeat(view, seats);
  const debaters = seats.filter(isDebatingSeat);
  const officials = seats.filter((seat) => !isDebatingSeat(seat));
  const seated = view.participants.filter((p) => isDebatingSeat(p.seat)).length;
  const row = (seat: Seat) => {
    const ids = props.commandIds.seats[seats.indexOf(seat)];
    if (!ids) throw new Error('Missing Room seat command identities');
    return (
      <Row
        key={seatKey(seat)}
        props={props}
        seat={seat}
        ids={ids}
        teams={teams}
        invited={invited.get(seatKey(seat))}
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
          {seated} / {debaters.length}
        </p>
      </div>
      {isEventRoom(view) ? (
        // A published event Room: the organiser seated it from the draw,
        // which also decided its sides; nobody hosts it (ADR 0145, Tab).
        <p className="text-sm text-ink-muted">
          Seated by the organiser. Sides come from the draw.
        </p>
      ) : null}
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
      {officials.length > 0 ? (
        <>
          <h3 className="mt-2 text-sm font-semibold text-ink-muted">
            {officials.some(isModeratorSeat) ? 'Officials' : 'Judges'}
          </h3>
          <ul className="flex flex-col">{officials.map(row)}</ul>
          <AiJudgeNotice view={view} />
        </>
      ) : null}
      <div className="mt-2 border-t border-border pt-3">{props.footer}</div>
    </section>
  );
}
