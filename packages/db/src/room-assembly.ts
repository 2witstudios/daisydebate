import { publicLobbyId } from './daisy-reference';
import { leagueRoomSelection } from './league-room-selection';
import { eq, inArray } from 'drizzle-orm';
import { createAppError, createRefusal } from '@daisy/errors';
import {
  ROOM_SEAT_HOLD_MS,
  type RoomAssemblyState,
  type RoomMutationOutcome,
  type RoomCapture,
  type SeatRef,
} from '@daisy/protocol';
import type { CasualJudgeAdmission } from './casual-judge-admission';
import { actors } from './schema/actors';
import { botProfiles } from './schema/bot-profiles';
import { aiJudgeProfiles } from './schema/ai-judge-profiles';
import { seatableInRoom } from './league-ladder-seat';
import { leagueRoomFacts } from './league-room-division';
import { rooms, roomParticipants, roomSeatHolds } from './schema/rooms';
import { columnsOfSeat } from './seat-columns';
import { holdActiveRoomMembers } from './room-membership-persistence';
import { lockAuthorizationActors } from './authorization';
import { newRoomValues, type NewRoom } from './room-operations';
import {
  actorFact,
  roomFacts,
  transactionNow,
  type Actor,
  type Caller,
  type Tx,
} from './room-command-facts';

/** One initial seat a create applies before anyone joins. */
export type InitialCastSeat = {
  readonly actorId: string;
  readonly seat: SeatRef;
  /** The command and participant identities the applied seat persists. */
  readonly commandId: string;
  readonly participantId: string;
};

/**
 * The slice's one engine edge, injected so the durable adapter stays
 * engine-free: the caller supplies the authorized pure seating transition.
 * Hosted creates assign their requested cast; event publication claims the
 * accepted people's seats. Neither creates Ready consent, and any refusal
 * rolls back the whole Room.
 */
export type InitialCastApplier = (
  state: RoomAssemblyState,
  seat: InitialCastSeat,
  target: Actor | null,
  now: string,
  maySeatCasualAiJudge: boolean,
) => RoomMutationOutcome;

/** One transaction's shared assembly path for hosted and event Rooms. */
export const assembleRoom = async (
  tx: Tx,
  input: {
    readonly room: NewRoom;
    readonly lobby: {
      readonly id: string;
      readonly kind: 'standing' | 'tournament';
    };
    readonly templateId: string | null;
    readonly ballotDefinition: {
      readonly id: string;
      readonly version: number;
    } | null;
    readonly capture: RoomCapture | null;
    readonly postRoundCall: boolean;
    readonly now: string;
    readonly caller: Caller;
    readonly cast: {
      readonly seats: readonly InitialCastSeat[];
      readonly apply: InitialCastApplier;
    } | null;
    readonly holdSeatsFor?: readonly string[];
    readonly membersOf: (
      participants: RoomAssemblyState['participants'],
    ) => readonly string[];
    readonly judgeAdmission?: CasualJudgeAdmission | undefined;
  },
): Promise<RoomAssemblyState | null> => {
  if (
    input.room.competitionType === 'ranked' &&
    input.lobby.id !== publicLobbyId
  )
    throw createRefusal('CONFLICT', 'illegal-config');
  await tx.insert(rooms).values({
    ...newRoomValues(input.room),
    leagueLadderId:
      input.lobby.kind === 'standing' && input.room.competitionType === 'casual'
        ? await leagueRoomSelection(tx, {
            lobbyId: input.lobby.id,
            templateId: input.templateId,
            config: input.room.config,
            subjectUserId: input.caller.userId,
          })
        : null,
    lobbyId: input.lobby.id,
    lobbyKind: input.lobby.kind,
    templateId: input.templateId,
    ballotDefinitionId: input.ballotDefinition?.id ?? null,
    ballotDefinitionVersion: input.ballotDefinition?.version ?? null,
    capture: input.capture,
    postRoundCall: input.postRoundCall,
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now),
  });
  const heldActors = input.holdSeatsFor ?? [];
  if (heldActors.length) {
    const known = await tx
      .select({ id: actors.id })
      .from(actors)
      .where(inArray(actors.id, [...heldActors]))
      .for('share');
    if (known.length !== heldActors.length)
      throw createRefusal('CONFLICT', 'illegal-config');
    const until = new Date(Date.parse(input.now) + ROOM_SEAT_HOLD_MS);
    await tx.insert(roomSeatHolds).values(
      heldActors.map((actorId) => ({
        roomId: input.room.id,
        actorId,
        seat: 'side' as const,
        until,
      })),
    );
  }
  const assembled = input.cast?.seats.length
    ? await applyInitialCast(
        tx,
        input.caller,
        input.room,
        input.cast,
        input.judgeAdmission,
      )
    : null;
  if (assembled)
    await tx
      .update(rooms)
      .set({
        status: assembled.status,
        version: assembled.version,
        changeVersion: assembled.changeVersion,
        updatedAt: new Date(input.now),
      })
      .where(eq(rooms.id, input.room.id));
  if (assembled?.participants.length)
    await tx.insert(roomParticipants).values(
      assembled.participants.map((participant) => ({
        id: participant.id,
        roomId: input.room.id,
        actorId: participant.actorId,
        ...columnsOfSeat(participant.seat),
        readinessCommandId: participant.consentCommandId,
        readinessVersion: participant.consentVersion,
      })),
    );
  await holdActiveRoomMembers(
    tx,
    input.room.id,
    input.membersOf(assembled?.participants ?? []),
  );
  return assembled;
};

/**
 * The cast application inside the create transaction: locks every cast
 * actor (the host fence included), re-verifies each actor's durable fact
 * under that lock, and refuses duplicates explicitly — assign-seat would
 * move, not reject, a repeated actor.
 */
const applyInitialCast = async (
  tx: Tx,
  caller: Caller,
  room: NewRoom,
  cast: {
    readonly seats: readonly InitialCastSeat[];
    readonly apply: InitialCastApplier;
  },
  judgeAdmission: CasualJudgeAdmission | undefined,
): Promise<RoomAssemblyState> => {
  const seats = cast.seats;
  if (new Set(seats.map((seat) => seat.actorId)).size !== seats.length)
    throw createRefusal('CONFLICT', 'illegal-config');
  const fencedActors = [
    ...new Set([caller.actorId, ...seats.map((seat) => seat.actorId)]),
  ];
  const accounts = await lockAuthorizationActors(tx, fencedActors, {
    maxActors: fencedActors.length,
  });
  // Eligibility and seatKind live on these profile rows, not the account
  // authorization fence. Lock extant profiles in actor-id order before
  // actorFact reads them, so profile removal serializes with this create.
  const castActorIds = seats.map((seat) => seat.actorId).sort();
  await tx
    .select({ actorId: botProfiles.actorId })
    .from(botProfiles)
    .where(inArray(botProfiles.actorId, castActorIds))
    .orderBy(botProfiles.actorId)
    .for('share');
  await tx
    .select({ actorId: aiJudgeProfiles.actorId })
    .from(aiJudgeProfiles)
    .where(inArray(aiJudgeProfiles.actorId, castActorIds))
    .orderBy(aiJudgeProfiles.actorId)
    .for('share');
  const [row] = await tx.select().from(rooms).where(eq(rooms.id, room.id));
  if (!row) throw createAppError('INFRASTRUCTURE');
  const { state } = await roomFacts(tx, row);
  const league = await leagueRoomFacts(tx, row);
  const targets: (Actor | null)[] = [];
  for (const seat of seats)
    targets.push(seatableInRoom(league, await actorFact(tx, seat.actorId)));
  const judgeQuote =
    judgeAdmission && targets.some((target) => target?.aiRole === 'judge')
      ? await judgeAdmission.quoteLocked(tx, {
          account:
            accounts.find((account) => account?.actorId === caller.actorId) ??
            null,
          roundId: null,
          withBot: targets.some(
            (target, index) =>
              target?.aiRole === 'debater' &&
              seats[index]?.seat.kind !== 'judge',
          ),
        })
      : null;
  // Creation's timestamp predates profile/allowance waits; it is not cast authority.
  const now = judgeQuote?.now ?? (await transactionNow(tx));
  let assembled = state;
  for (const [index, seat] of seats.entries()) {
    const outcome = cast.apply(
      assembled,
      seat,
      targets[index] ?? null,
      now,
      judgeQuote?.decision.kind === 'admit',
    );
    if (!outcome.ok) throw createRefusal('CONFLICT', outcome.refusal);
    assembled = outcome.mutation.state;
  }
  return assembled;
};
