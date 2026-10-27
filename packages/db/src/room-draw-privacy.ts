import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { RoomAssemblyState, RoomMutationOutcome } from '@daisy/protocol';
import type {
  PrivacyAdopter,
  PrivacyFieldDeclaration,
} from './privacy/contracts';
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

type Field = Pick<
  PrivacyFieldDeclaration,
  'column' | 'category' | 'visibility' | 'exportable'
>;
const id = (column: string): Field => ({
  column,
  category: 'identifier',
  exportable: false,
});
const none = (column: string): Field => ({
  column,
  category: 'none',
  exportable: false,
});
const personal = (column: string, exportable = false): Field => ({
  column,
  category: 'personal',
  visibility: 'private',
  exportable,
});
const secret = (column: string): Field => ({
  column,
  category: 'secret',
  exportable: false,
});

/** DEC-245: draw data lives with the Room or Round it serves. */
const retention = {
  status: 'pending' as const,
  decision: 'uofng5a07pluhrisfeqa0vx4',
};

const tables: readonly {
  readonly table: string;
  readonly purpose: string;
  readonly fields: readonly Field[];
}[] = [
  {
    table: 'resolution_bank_revisions',
    purpose: "Version Daisy's curated resolution bank (FMT-7)",
    fields: [none('revision'), none('note'), none('published_at')],
  },
  {
    table: 'resolution_bank_entries',
    purpose: 'Daisy-authored resolutions a draw may choose from',
    fields: [
      id('id'),
      none('text'),
      none('category'),
      none('difficulty'),
      none('locale'),
      none('provenance'),
      none('added_in_revision'),
      none('retired_in_revision'),
    ],
  },
  {
    table: 'room_resolution_draws',
    purpose: "Run a Room's pre-round resolution draw",
    fields: [
      id('id'),
      id('room_id'),
      none('source_kind'),
      none('draw_size'),
      none('manifest'),
      none('manifest_digest'),
      none('commitment'),
      secret('seed'),
      none('started_at'),
    ],
  },
  {
    table: 'room_resolution_draw_inputs',
    purpose:
      "Replay a draw: host-written lines and the seated players' recent resolutions",
    fields: [id('draw_id'), personal('inputs')],
  },
  {
    table: 'room_resolution_draw_items',
    purpose: 'The drawn resolutions the debaters strike from',
    fields: [
      id('draw_id'),
      none('position'),
      none('source_kind'),
      none('draw_size'),
      id('candidate_id'),
      id('bank_entry_id'),
      personal('text'),
      none('category'),
    ],
  },
  {
    table: 'room_resolution_strikes',
    purpose: 'Who struck which drawn resolution, and when',
    fields: [
      id('draw_id'),
      none('ordinal'),
      none('position'),
      none('draw_size'),
      none('side'),
      none('kind'),
      id('actor_id'),
      id('command_id'),
      none('struck_at'),
    ],
  },
  {
    table: 'round_draw_seeds',
    purpose: "Let operators replay a Round's draw; never delivered",
    fields: [id('round_id'), secret('seed')],
  },
  {
    table: 'round_resolution_draw_texts',
    purpose: "The drawn resolutions frozen with a Round's evidence",
    fields: [id('round_id'), none('position'), personal('text')],
  },
  {
    table: 'round_draw_private_inputs',
    purpose: "Let operators replay a Round's draw while its inputs exist",
    fields: [id('round_id'), personal('inputs')],
  },
];

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
      })
      .where(eq(rooms.id, room.id));
    await scrubItems(tx, room);
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
    fields: tables.flatMap(({ table, purpose, fields }) =>
      fields.map((field) => ({
        table,
        ...field,
        storage: 'postgres' as const,
        owner: 'FMT',
        purpose,
        lawfulBasis: retention,
        retention,
        erasure:
          field.category === 'personal' || field.category === 'secret'
            ? ('delete' as const)
            : ('retain-nonpersonal' as const),
      })),
    ),
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
