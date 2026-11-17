import type {
  RoomAssemblyState,
  RoomCommand,
  RoomConsent,
  RoomMutationOutcome,
  RoomRefusal,
  SeatDraw,
  TwoSideKey,
} from '@daisy/protocol';
import {
  affirmativeSide,
  negativeSide,
  seatsTwoTeams,
  sidesSwappable,
  sideSeat,
  teamPlacementOf,
  twoSideKeys,
} from '@daisy/protocol';
import {
  canonicalJson,
  canonicalOrder,
  digestOf,
  uniformIndex,
  type WordStream,
} from '@daisy/seeded-random';
import { seatCommitment, seatStream } from './draw-random';
import { acceptedRoomMutation, type Edges } from './room-assembly-facts';

/**
 * Room seats as teams (ADR 0145). A debater's Room role is their team's
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

/** A debater's team placement and slot: the side seat they hold before Start round. */
type Placement = { readonly role: TwoSideKey; readonly slot: number };

const isTeamSide = (side: string): side is TwoSideKey =>
  (twoSideKeys as readonly string[]).includes(side);

/** A debater's placement, or null for a judge (or any seat that is no team's). */
const placementOf = (p: Participant): Placement | null =>
  p.seat.kind === 'side' && isTeamSide(p.seat.side)
    ? { role: p.seat.side, slot: p.seat.slot }
    : null;

const isDebater = (p: Participant): boolean => placementOf(p) !== null;

const placed = (p: Participant): Placement => placementOf(p)!;

/**
 * A Room no person hosts is a Tab event Room: its draw seated its teams on
 * their sides (ADR 0145), so nobody moves a seat or flips its sides there.
 */
const isEventRoom = (room: RoomAssemblyState) => room.hostActorId === null;

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
  if (!seatsTwoTeams(room.rules)) return refuse('illegal-config');
  if (isEventRoom(room)) return refuse('host-required');
  const mover = room.participants.find((p) => p.id === command.participantId);
  if (!mover || !isDebater(mover)) return refuse('not-seated');
  if (!mayMove(room, actorId, mover)) return refuse('host-required');
  const from = placed(mover);
  const teamOpen = command.team === null;
  const positionOpen = teamOpen || command.position === null;
  const role =
    command.team === null ? from.role : teamPlacementOf(command.team);
  const capacity = room.rules.seats.sides[role] ?? 0;
  const others = room.participants.filter((p) => p.id !== mover.id);
  const inRole = (p: Participant) => placementOf(p)?.role === role;
  const holder = (slot: number) =>
    others.find((p) => inRole(p) && placed(p).slot === slot);
  const movable = (p: Participant) =>
    role !== from.role ? p.teamOpen : p.positionOpen || p.teamOpen;
  const slot = (() => {
    if (command.position !== null && command.team !== null)
      return command.position;
    if (role === from.role) return from.slot;
    const free = Array.from({ length: capacity }, (_, i) => i).find(
      (i) => !holder(i),
    );
    if (free !== undefined) return free;
    const swap = others.find((p) => inRole(p) && movable(p));
    return swap ? placed(swap).slot : undefined;
  })();
  if (slot === undefined || slot >= capacity) return refuse('seat-unavailable');
  const occupant = holder(slot);
  if (occupant && !movable(occupant)) return refuse('seat-unavailable');
  const participants = room.participants.map((p) => {
    if (p.id === mover.id)
      return {
        ...p,
        seat: sideSeat(role, slot),
        teamOpen,
        positionOpen,
        consentCommandId: null,
      };
    if (occupant && p.id === occupant.id)
      return { ...p, seat: sideSeat(from.role, from.slot) };
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
  if (isEventRoom(room)) return refuse('host-required');
  const seated = room.participants.find((p) => p.actorId === actorId);
  if (room.hostActorId !== actorId && (!seated || !isDebater(seated)))
    return refuse('host-required');
  if (room.competitionType === 'ranked' && command.teamOneSide !== null)
    return refuse('illegal-config');
  if (!sidesSwappable(room.rules) && command.teamOneSide !== affirmativeSide)
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

const placementOrder = (a: Participant, b: Participant) => {
  const [x, y] = [placed(a), placed(b)];
  return x.role === y.role
    ? x.slot - y.slot
    : x.role === affirmativeSide
      ? -1
      : 1;
};

/**
 * Resolve every ? in one draw (ADR 0145): debaters whose team is ? are
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
  readonly teamOneSide: TwoSideKey;
  readonly seatDraw: SeatDraw | null;
} {
  // A Room that seats no two teams has no ? and no coin: its seats are its
  // sides (TAB-6.2), and its Round reads them as they are.
  if (!seatsTwoTeams(room.rules))
    return {
      participants: room.participants,
      teamOneSide: room.teamOneSide ?? affirmativeSide,
      seatDraw: null,
    };
  const stream = seatStream(input.seed);
  let at = 0;
  const seats = new Map(
    room.participants.filter(isDebater).map((p) => [p.id, placed(p)]),
  );

  const teamOpen = canonicalOrder(
    room.participants.filter((p) => isDebater(p) && p.teamOpen),
  );
  const teamSeats = [...teamOpen].sort(placementOrder);
  const teamDraw = shuffled(teamOpen, stream, at);
  at = teamDraw.next;
  teamDraw.out.forEach((p, i) => seats.set(p.id, placed(teamSeats[i]!)));

  for (const role of twoSideKeys) {
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
  const teamOneSide: TwoSideKey =
    coin === null
      ? room.teamOneSide!
      : coin === 'kept'
        ? affirmativeSide
        : negativeSide;
  const sideOf = (placement: TwoSideKey): TwoSideKey =>
    teamOneSide === affirmativeSide
      ? placement
      : placement === affirmativeSide
        ? negativeSide
        : affirmativeSide;

  const participants = room.participants.map((p) => {
    if (!isDebater(p)) return p;
    const seat = seats.get(p.id)!;
    return {
      ...p,
      seat: sideSeat(sideOf(seat.role), seat.slot),
      teamOpen: false,
      positionOpen: false,
    };
  });
  // The commitment's input keeps its pre-TAB-6 shape (role, slot), so a
  // seat draw replays the same way on either side of the seat vocabulary.
  const before = canonicalOrder(room.participants)
    .filter(isDebater)
    .map((p) => ({
      id: p.id,
      ...placed(p),
      teamOpen: p.teamOpen,
      positionOpen: p.positionOpen,
    }));
  const moved = canonicalOrder(
    room.participants.filter(
      (p) => isDebater(p) && (p.teamOpen || p.positionOpen),
    ),
  ).map((p) => {
    const to = placed(participants.find((q) => q.id === p.id)!);
    return {
      participantId: p.id,
      open: p.teamOpen
        ? (['team', 'position'] as const)
        : (['position'] as const),
      from: placed(p),
      to,
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
