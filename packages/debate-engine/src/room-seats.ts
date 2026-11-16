import type {
  DebateSide,
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
  RoomTeam,
  SeatDraw,
} from '@daisy/protocol';
import { teamOfPlacement, teamPlacementOf } from '@daisy/protocol';
import {
  canonicalJson,
  canonicalOrder,
  digestOf,
  seatCommitment,
  seatStream,
  uniformIndex,
  type WordStream,
} from './draw-random';
import { acceptedRoomMutation, type Edges } from './room-assembly-facts';

/**
 * Room seats as teams (ADR 0143). A debater's Room role is their team's
 * placement (team 1 in the affirmative seats, team 2 in the negative ones),
 * and the Room's `teamOneSide` says which side team 1 argues, or null for a
 * coin flip. A team or position marked open is placed at random at Start
 * round by one draw on its own stream; until then every debater still holds
 * a concrete seat, so capacity and uniqueness read exactly as before.
 */

type Participant = RoomAssemblyState['participants'][number];

const refuse = (refusal: RoomRefusal): RoomMutationOutcome => ({
  ok: false,
  refusal,
});

const isDebater = (p: Participant): p is Participant & { role: DebateSide } =>
  p.role !== 'judge';

/** Both teams the same size: the only Rooms whose sides may swap or flip. */
export const sidesSwappable = (room: Pick<RoomAssemblyState, 'rules'>) =>
  room.rules.seats.affirmative === room.rules.seats.negative;

/** Whether `actorId` may change this debater's row: themselves, or the host. */
const mayMove = (room: RoomAssemblyState, actorId: string, p: Participant) =>
  p.actorId === actorId || room.hostActorId === actorId;

/**
 * Move one debater to a team (or ?) and a position (or ?). A seat taken by a
 * debater whose team is ? (or, within a team, whose position is ?) is free
 * to swap with: that debater was going to be placed at random anyway. A team
 * of ? also opens the position, since the team decides the slots.
 */
export const setSeat = (
  room: RoomAssemblyState,
  actorId: string,
  command: Extract<RoomCommand, { type: 'set-seat' }>,
  _consent: RoomConsent,
  _edges: Edges,
): RoomMutationOutcome => {
  const mover = room.participants.find((p) => p.id === command.participantId);
  if (!mover || !isDebater(mover)) return refuse('not-seated');
  if (!mayMove(room, actorId, mover)) return refuse('host-required');
  const teamOpen = command.team === null;
  const positionOpen = teamOpen || command.position === null;
  const role =
    command.team === null ? mover.role : teamPlacementOf(command.team);
  const capacity = room.rules.seats[role];
  const others = room.participants.filter((p) => p.id !== mover.id);
  const holder = (slot: number) =>
    others.find((p) => p.role === role && p.slot === slot);
  const movable = (p: Participant) =>
    role !== mover.role ? p.teamOpen : p.positionOpen || p.teamOpen;
  const slot = (() => {
    if (command.position !== null && command.team !== null)
      return command.position;
    if (role === mover.role) return mover.slot;
    const free = Array.from({ length: capacity }, (_, i) => i).find(
      (i) => !holder(i),
    );
    if (free !== undefined) return free;
    return others.find((p) => p.role === role && movable(p))?.slot;
  })();
  if (slot === undefined || slot >= capacity) return refuse('seat-unavailable');
  const occupant = holder(slot);
  if (occupant && !movable(occupant)) return refuse('seat-unavailable');
  const participants = room.participants.map((p) => {
    if (p.id === mover.id)
      return {
        ...p,
        role,
        slot,
        teamOpen,
        positionOpen,
        consentCommandId: null,
      };
    if (occupant && p.id === occupant.id)
      return { ...p, role: mover.role, slot: mover.slot };
    return p;
  });
  return acceptedRoomMutation({ ...room, participants });
};

/**
 * Team 1's side, or null for a coin flip. A debater sets their own team's
 * side (team 2's choice is the opposite of team 1's), the host either. A
 * ranked Room's sides stay open, and teams of different sizes keep the side
 * their seats were declared for.
 */
export const setSides = (
  room: RoomAssemblyState,
  actorId: string,
  command: Extract<RoomCommand, { type: 'set-sides' }>,
  _consent: RoomConsent,
  _edges: Edges,
): RoomMutationOutcome => {
  const seated = room.participants.find((p) => p.actorId === actorId);
  if (room.hostActorId !== actorId && (!seated || !isDebater(seated)))
    return refuse('host-required');
  if (room.competitionType === 'ranked' && command.teamOneSide !== null)
    return refuse('illegal-config');
  if (!sidesSwappable(room) && command.teamOneSide !== 'affirmative')
    return refuse('illegal-config');
  return acceptedRoomMutation({ ...room, teamOneSide: command.teamOneSide });
};

/** Fisher–Yates over the seat stream, continuing from `at`. */
const shuffled = <T>(items: readonly T[], stream: WordStream, at: number) => {
  const out = [...items];
  let next = at;
  for (let i = out.length - 1; i >= 1; i -= 1) {
    const pick = uniformIndex(stream, next, i + 1);
    next = pick.next;
    [out[i], out[pick.index]] = [out[pick.index]!, out[i]!];
  }
  return { out, next };
};

const placementOrder = (a: Participant, b: Participant) =>
  a.role === b.role ? a.slot - b.slot : a.role === 'affirmative' ? -1 : 1;

/**
 * Resolve every ? in one draw (ADR 0143): debaters whose team is ? are
 * shuffled over the seats they hold, then each team's debaters whose
 * position is ? over their slots, then a coin decides the sides when they
 * are open. Debaters are taken in canonical id order and seats in placement
 * order, so the same seed and seats always give the same Round. The result
 * is concrete: every debater's role is the side they argue.
 */
export function resolveSeats(
  room: RoomAssemblyState,
  input: { readonly seed: Uint8Array; readonly roundId: string },
): {
  readonly participants: RoomAssemblyState['participants'];
  readonly teamOneSide: DebateSide;
  readonly seatDraw: SeatDraw;
} {
  const stream = seatStream(input.seed);
  let at = 0;
  const seats = new Map(
    room.participants.map((p) => [p.id, { role: p.role, slot: p.slot }]),
  );

  const teamOpen = canonicalOrder(
    room.participants.filter((p) => isDebater(p) && p.teamOpen),
  );
  const teamSeats = [...teamOpen].sort(placementOrder);
  const teamDraw = shuffled(teamOpen, stream, at);
  at = teamDraw.next;
  teamDraw.out.forEach((p, i) =>
    seats.set(p.id, { role: teamSeats[i]!.role, slot: teamSeats[i]!.slot }),
  );

  for (const role of ['affirmative', 'negative'] as const) {
    const open = canonicalOrder(
      room.participants.filter(
        (p) => isDebater(p) && p.positionOpen && seats.get(p.id)!.role === role,
      ),
    );
    const slots = open.map((p) => seats.get(p.id)!.slot).sort((a, b) => a - b);
    const draw = shuffled(open, stream, at);
    at = draw.next;
    draw.out.forEach((p, i) => seats.set(p.id, { role, slot: slots[i]! }));
  }

  const coin =
    room.teamOneSide === null
      ? uniformIndex(stream, at, 2).index === 0
        ? ('kept' as const)
        : ('swapped' as const)
      : null;
  const teamOneSide: DebateSide =
    coin === null
      ? room.teamOneSide!
      : coin === 'kept'
        ? 'affirmative'
        : 'negative';
  const sideOf = (placement: DebateSide): DebateSide =>
    teamOneSide === 'affirmative'
      ? placement
      : placement === 'affirmative'
        ? 'negative'
        : 'affirmative';

  const participants = room.participants.map((p) => {
    if (!isDebater(p)) return p;
    const seat = seats.get(p.id)!;
    return {
      ...p,
      role: sideOf(seat.role as DebateSide),
      slot: seat.slot,
      teamOpen: false,
      positionOpen: false,
    };
  });
  const before = canonicalOrder(room.participants)
    .filter(isDebater)
    .map(({ id, role, slot, teamOpen: t, positionOpen: q }) => ({
      id,
      role,
      slot,
      teamOpen: t,
      positionOpen: q,
    }));
  const moved = canonicalOrder(
    room.participants.filter(
      (p) => isDebater(p) && (p.teamOpen || p.positionOpen),
    ),
  ).map((p) => {
    const to = participants.find((q) => q.id === p.id)!;
    return {
      participantId: p.id,
      open: p.teamOpen
        ? (['team', 'position'] as const)
        : (['position'] as const),
      from: { role: p.role as DebateSide, slot: p.slot },
      to: { role: to.role as DebateSide, slot: to.slot },
    };
  });
  return {
    participants,
    teamOneSide,
    seatDraw: {
      algorithm: 'daisy-draw-v1/seats',
      commitment: seatCommitment({
        roomId: room.id,
        roundId: input.roundId,
        seatsDigest: digestOf(
          canonicalJson({ teamOneSide: room.teamOneSide, seats: before }),
        ),
        seed: input.seed,
      }),
      coin,
      teamOneSide,
      moved,
    },
  };
}

/** The team a debater's Room seat belongs to. */
export const teamOf = (p: { readonly role: DebateSide }): RoomTeam =>
  teamOfPlacement(p.role);
