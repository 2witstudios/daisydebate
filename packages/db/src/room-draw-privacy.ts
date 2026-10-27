import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { RoomAssemblyState, RoomMutationOutcome } from '@daisy/protocol';
import type { PrivacyAdopter } from './privacy/contracts';
import { roomDrawPrivacyFields } from './room-draw-privacy-fields';
import { rooms, roomParticipants } from './schema/rooms';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import {
  roomResolutionDrawInputs,
  roomResolutionDrawItems,
  roomResolutionDraws,
  roundDrawPrivateInputs,
  roundResolutionDrawTexts,
} from './schema/resolution-draws';
import { appendRoomChanged, roomFacts, type Tx } from './room-command-facts';
import { persistRoomMutation } from './room-mutation-persistence';

/** A scrubbed host line: unique per list position, so lists stay valid. */
const placeholder = (index: number) => `Removed resolution ${index + 1}`;
const hostIndex = (candidateId: string) =>
  Number.parseInt(candidateId.slice(2), 10);

type Mutation = Extract<RoomMutationOutcome, { ok: true }>['mutation'];

/** The Room with every host-written line replaced by its placeholder. */
const scrubHostLines = (room: RoomAssemblyState): RoomAssemblyState => {
  const scrubSource = <T extends RoomAssemblyState['config']['resolutionDraw']>(
    draw: T,
  ): T =>
    draw.enabled && draw.source.kind === 'host'
      ? {
          ...draw,
          source: {
            kind: 'host',
            resolutions: draw.source.resolutions.map((_line, i) =>
              placeholder(i),
            ),
          },
        }
      : draw;
  const draw = room.resolutionDraw;
  const host = draw?.manifest.source.kind === 'host';
  const items = draw?.items.map((item) =>
    host ? { ...item, text: placeholder(hostIndex(item.candidateId)) } : item,
  );
  const revealed = draw && draw.strikes.length >= draw.manifest.drawSize - 1;
  const survivor =
    revealed &&
    items?.find((i) => !draw.strikes.some((s) => s.position === i.position));
  return {
    ...room,
    config: {
      ...room.config,
      resolutionDraw: scrubSource(room.config.resolutionDraw),
    },
    executionPlan: {
      ...room.executionPlan,
      resolutionDraw: scrubSource(room.executionPlan.resolutionDraw),
    },
    resolutionDraw: draw && items ? { ...draw, items } : draw,
    topic: host && survivor ? survivor.text : room.topic,
  };
};

const open = (room: RoomAssemblyState) =>
  room.status === 'assembling' || room.status === 'ready';

/**
 * Subject erasure for draws (plan rev 5 §8), inside the authorized privacy
 * operation and under each Room's row lock; it never goes through the
 * public Room command fence. The pure transitions come from the engine:
 *
 * - the host-list author: every hosted Room's host lines, drawn texts and
 *   a revealed topic become placeholders, its private inputs are deleted,
 *   and an open Room is closed; a launched Round's host-sourced texts and
 *   private inputs are deleted and its resolution becomes the placeholder;
 * - a seated player: every draw input row of a Room or Round they sat in is
 *   deleted; before any pre-round has begun, their seats are removed.
 */
export const createRoomDrawPrivacyAdopter = (transitions: {
  readonly closeRoom: (room: RoomAssemblyState) => RoomAssemblyState;
  readonly removeSeat: (
    room: RoomAssemblyState,
    participantId: string,
  ) => RoomAssemblyState;
  readonly activeRoomMembers: (room: RoomAssemblyState) => readonly string[];
}): PrivacyAdopter => {
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
    await scrubItems(tx, after);
    await appendRoomChanged(tx, state.id, state.changeVersion);
  };

  /** A launched or closed Room keeps its lifecycle; only its copies change. */
  const scrubLaunched = async (tx: Tx, room: RoomAssemblyState) => {
    await tx
      .update(rooms)
      .set({
        config: room.config,
        executionPlan: room.executionPlan,
        topic: room.topic,
        changeVersion: room.changeVersion + 1,
      })
      .where(eq(rooms.id, room.id));
    await scrubItems(tx, room);
    await appendRoomChanged(tx, room.id, room.changeVersion + 1);
  };
  const scrubItems = async (tx: Tx, room: RoomAssemblyState) => {
    if (room.resolutionDraw)
      for (const item of room.resolutionDraw.items)
        await tx
          .update(roomResolutionDrawItems)
          .set({ text: item.text })
          .where(
            and(
              eq(roomResolutionDrawItems.drawId, room.resolutionDraw.id),
              eq(roomResolutionDrawItems.position, item.position),
            ),
          );
  };

  const eraseAuthor = async (tx: Tx, actorId: string, now: string) => {
    const hosted = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.hostActorId, actorId))
      .for('update');
    for (const row of hosted) {
      const { state } = await roomFacts(tx, row);
      const scrubbed = scrubHostLines(state);
      if (state.resolutionDraw)
        await tx
          .delete(roomResolutionDrawInputs)
          .where(eq(roomResolutionDrawInputs.drawId, state.resolutionDraw.id));
      if (open(state))
        await persist(tx, state, transitions.closeRoom(scrubbed), now);
      else await scrubLaunched(tx, scrubbed);
      if (state.resolutionDraw?.manifest.source.kind !== 'host') continue;
      const launched = await tx
        .select({ id: rounds.id })
        .from(rounds)
        .where(eq(rounds.roomId, row.id));
      for (const round of launched) {
        await tx
          .delete(roundResolutionDrawTexts)
          .where(eq(roundResolutionDrawTexts.roundId, round.id));
        await tx
          .delete(roundDrawPrivateInputs)
          .where(eq(roundDrawPrivateInputs.roundId, round.id));
        if (scrubbed.topic !== null)
          await tx
            .update(rounds)
            .set({ resolution: scrubbed.topic })
            .where(eq(rounds.id, round.id));
      }
    }
  };

  const erasePlayer = async (tx: Tx, actorId: string, now: string) => {
    const seatedRooms = tx
      .select({ id: roomParticipants.roomId })
      .from(roomParticipants)
      .where(eq(roomParticipants.actorId, actorId));
    await tx
      .delete(roomResolutionDrawInputs)
      .where(
        inArray(
          roomResolutionDrawInputs.drawId,
          tx
            .select({ id: roomResolutionDraws.id })
            .from(roomResolutionDraws)
            .where(inArray(roomResolutionDraws.roomId, seatedRooms)),
        ),
      );
    await tx
      .delete(roundDrawPrivateInputs)
      .where(
        inArray(
          roundDrawPrivateInputs.roundId,
          tx
            .select({ id: roundParticipants.roundId })
            .from(roundParticipants)
            .where(eq(roundParticipants.actorId, actorId)),
        ),
      );
    const unbegun = await tx
      .select()
      .from(rooms)
      .where(
        and(
          inArray(rooms.id, seatedRooms),
          inArray(rooms.status, ['assembling', 'ready']),
          isNull(rooms.prepStartedAt),
          sql`not exists (select 1 from room_resolution_draws d where d.room_id = ${rooms.id})`,
        ),
      )
      .for('update');
    for (const row of unbegun) {
      const { state } = await roomFacts(tx, row);
      const seats = state.participants.filter((p) => p.actorId === actorId);
      if (!seats.length) continue;
      await persist(
        tx,
        state,
        seats.reduce(
          (room, seat) => transitions.removeSeat(room, seat.id),
          state,
        ),
        now,
      );
    }
  };

  return {
    id: 'room-draw',
    phase: 'before-auth',
    fields: roomDrawPrivacyFields,
    erase: async (tx, subject, { now }) => {
      // The privacy transaction is the authority; the setting only lets its
      // own deletes of immutable Round copies past the accidental-write guard.
      await tx.execute(sql`set local daisy.privacy_erasure = 'on'`);
      await eraseAuthor(tx as unknown as Tx, subject.actorId, now);
      await erasePlayer(tx as unknown as Tx, subject.actorId, now);
    },
    export: async (tx, subject) => {
      const hosted = await (tx as unknown as Tx)
        .select({ id: rooms.id, config: rooms.config })
        .from(rooms)
        .where(eq(rooms.hostActorId, subject.actorId));
      return {
        room_resolution_lists: hosted.flatMap(({ id, config }) =>
          config.resolutionDraw.enabled &&
          config.resolutionDraw.source.kind === 'host'
            ? [
                {
                  room_id: id,
                  resolutions: config.resolutionDraw.source.resolutions,
                },
              ]
            : [],
        ),
      };
    },
  };
};
