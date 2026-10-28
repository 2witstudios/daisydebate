import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { RoomAssemblyState, RoomMutationOutcome } from '@daisy/protocol';
import type { PrivacyAdopter } from './privacy/contracts';
import { rooms, roomParticipants } from './schema/rooms';
import { appendRoomChanged, roomFacts, type Tx } from './room-command-facts';
import { persistRoomMutation } from './room-mutation-persistence';
import { roomIsOpen } from './room-open';

type Mutation = Extract<RoomMutationOutcome, { ok: true }>['mutation'];

/** The engine's pure Room transitions, injected by the caller. */
export type RoomClosureTransitions = {
  readonly closeRoom: (room: RoomAssemblyState) => RoomAssemblyState;
  readonly eraseSeats: (
    room: RoomAssemblyState,
    actorId: string,
  ) => RoomAssemblyState;
  readonly activeRoomMembers: (room: RoomAssemblyState) => readonly string[];
};

/**
 * What closing an account does to Rooms, inside the subject-rights
 * transaction and under each Room's row lock; it never goes through the
 * public Room command fence. A closed account cannot keep a Room open or
 * hold a seat nobody can fill: every open Room it hosts closes, and before
 * any pre-round has begun its seats are freed. Nothing is rewritten:
 * titles, topics, resolutions, drawn texts and draw inputs are the
 * competitive record (ADR 0087). The pure transitions come from the engine.
 */
export const createRoomClosurePrivacyAdopter = (
  transitions: RoomClosureTransitions,
): PrivacyAdopter => {
  const persist = async (
    tx: Tx,
    before: RoomAssemblyState,
    after: RoomAssemblyState,
    now: string,
  ) => {
    const state = { ...after, changeVersion: before.changeVersion + 1 };
    const mutation: Mutation = {
      state,
      consent: null,
      freeze: false,
      // Closure freezes no Round, so it never spends an AI round or seats a bot.
      spendsAiRound: false,
      seatsBotDebater: false,
      publishDefinition: false,
      drawSecrets: null,
      members: transitions.activeRoomMembers(state),
    };
    await persistRoomMutation(
      tx,
      mutation,
      '',
      now,
      false,
      before.resolutionDraw?.strikes.length ?? 0,
    );
    await appendRoomChanged(tx, state.id, state.changeVersion);
  };

  const closeHosted = async (tx: Tx, actorId: string, now: string) => {
    const hosted = await tx
      .select()
      .from(rooms)
      .where(and(eq(rooms.hostActorId, actorId), roomIsOpen()))
      .for('update');
    for (const row of hosted) {
      const { state } = await roomFacts(tx, row);
      await persist(tx, state, transitions.closeRoom(state), now);
    }
  };

  const freeSeats = async (tx: Tx, actorId: string, now: string) => {
    const seatedRooms = tx
      .select({ id: roomParticipants.roomId })
      .from(roomParticipants)
      .where(eq(roomParticipants.actorId, actorId));
    const unbegun = await tx
      .select()
      .from(rooms)
      .where(
        and(
          inArray(rooms.id, seatedRooms),
          roomIsOpen(),
          isNull(rooms.prepStartedAt),
          sql`not exists (select 1 from room_resolution_draws d where d.room_id = ${rooms.id})`,
        ),
      )
      .for('update');
    for (const row of unbegun) {
      const { state } = await roomFacts(tx, row);
      if (!state.participants.some((p) => p.actorId === actorId)) continue;
      await persist(tx, state, transitions.eraseSeats(state, actorId), now);
    }
  };

  return {
    id: 'room-closure',
    phase: 'before-auth',
    erase: async (tx, subject, { now }) => {
      await closeHosted(tx as unknown as Tx, subject.actorId, now);
      await freeSeats(tx as unknown as Tx, subject.actorId, now);
    },
    // Hosted Rooms are public competitive record, not the member's private data.
    export: async () => ({}),
  };
};
