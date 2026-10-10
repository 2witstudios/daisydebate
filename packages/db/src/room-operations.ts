import { seatSlotsComplete } from '@daisy/protocol';
import type {
  RoomConfig,
  RoomExecutionPlan,
  RoundRules,
} from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { isUniqueViolation } from './unique-violation';
import { roomParticipants, rooms } from './schema/rooms';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { appendRoundPhaseChanged } from './round-projection-writer';

export type NewRoom = {
  readonly id: string;
  readonly hostActorId: string;
  readonly title: string;
  readonly topic: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number | null;
  readonly competitionType: 'ranked' | 'casual' | 'practice';
  readonly length: 'full' | 'quick';
  readonly config: RoomConfig;
  readonly executionPlan: RoomExecutionPlan;
  readonly rules: RoundRules;
};

export type RoomRecord = {
  readonly id: string;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number | null;
  readonly competitionType: string;
  readonly length: string;
  readonly status: string;
  readonly rules: RoundRules;
};

export const newRoomValues = (
  room: NewRoom,
  status: 'assembling' | 'started',
) => ({
  id: room.id,
  hostActorId: room.hostActorId,
  title: room.title,
  topic: room.topic,
  visibility: room.visibility,
  formatId: room.formatId,
  formatVersion: room.formatVersion,
  presetVersion: room.presetVersion,
  competitionType: room.competitionType,
  length: room.length,
  config: room.config,
  executionPlan: room.executionPlan,
  rulesSnapshot: room.rules,
  prepRemainingMs: room.executionPlan.preRoundPrep.enabled
    ? room.executionPlan.preRoundPrep.durationMs
    : null,
  status,
});

const seatsComplete = (
  required: RoundRules['seats'],
  held: readonly { readonly role: string; readonly slot: number }[],
): boolean =>
  Object.entries(required).every(([role, wanted]) =>
    seatSlotsComplete(
      wanted,
      held
        .filter((seat) => seat.role === role)
        .map((seat) => seat.slot)
        .sort((a, b) => a - b),
    ),
  );

/**
 * The Room area (ADR 0058 §5a): a durable pre-competition aggregate. The
 * caller resolves the configuration (the outer `resolveRoom` composition
 * lives in the feature layer, which may call the domain); these operations
 * persist what it resolved, seat the assembly, and run the startRound
 * freeze that computes nothing.
 */
export const roomOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async createRoom(room: NewRoom): Promise<RoomRecord> {
    return instrumented(eventSink, 'createRoom', async () => {
      try {
        const [row] = await database
          .insert(rooms)
          .values(newRoomValues(room, 'assembling'))
          .returning();
        if (!row) throw new Error('Room insert returned no row');
        return {
          id: row.id,
          formatId: row.formatId,
          formatVersion: row.formatVersion,
          presetVersion: row.presetVersion,
          competitionType: row.competitionType,
          length: row.length,
          status: row.status,
          rules: row.rulesSnapshot,
        };
      } catch (error) {
        if (isUniqueViolation(error))
          throw createAppError('CONFLICT', 'The room already exists', error);
        throw error;
      }
    });
  },

  /**
   * Seats one actor in the assembling Room; refused once the Room has
   * started, because assembly state stops at the freeze.
   */
  async seatRoomParticipant(input: {
    readonly roomId: string;
    readonly participantId: string;
    readonly actorId: string;
    readonly role: 'affirmative' | 'negative' | 'judge';
    readonly slot: number;
  }): Promise<void> {
    await instrumented(eventSink, 'seatRoomParticipant', async () => {
      try {
        await database.transaction(async (tx) => {
          const [room] = await tx
            .select({ status: rooms.status, rules: rooms.rulesSnapshot })
            .from(rooms)
            .where(eq(rooms.id, input.roomId))
            .for('update');
          if (!room) throw createAppError('NOT_FOUND', 'No such room');
          if (room.status !== 'assembling')
            throw createAppError(
              'CONFLICT',
              'The room is no longer assembling',
            );
          if (
            !Number.isInteger(input.slot) ||
            input.slot < 0 ||
            input.slot >= room.rules.seats[input.role]
          )
            throw createAppError(
              'VALIDATION',
              'The seat is not declared by the room',
            );
          await tx.insert(roomParticipants).values({
            id: input.participantId,
            roomId: input.roomId,
            actorId: input.actorId,
            role: input.role,
            slot: input.slot,
          });
          const seats = await tx
            .select({
              role: roomParticipants.role,
              slot: roomParticipants.slot,
            })
            .from(roomParticipants)
            .where(eq(roomParticipants.roomId, input.roomId));
          if (seatsComplete(room.rules.seats, seats)) {
            await tx
              .update(rooms)
              .set({ status: 'ready', updatedAt: sql`statement_timestamp()` })
              .where(eq(rooms.id, input.roomId));
          }
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw createAppError(
            'CONFLICT',
            'The seat or actor is already seated',
            error,
          );
        throw error;
      }
    });
  },

  /** Anchor enabled pre-round prep on the database clock after seating. */
  async startRoomPrep(roomId: string): Promise<void> {
    await instrumented(eventSink, 'startRoomPrep', async () => {
      await database.transaction(async (tx) => {
        const [room] = await tx
          .select({
            status: rooms.status,
            plan: rooms.executionPlan,
            startedAt: rooms.prepStartedAt,
          })
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .for('update');
        if (!room) throw createAppError('NOT_FOUND', 'No such room');
        if (
          room.status !== 'ready' ||
          room.startedAt !== null ||
          !room.plan.preRoundPrep.enabled
        )
          throw createAppError('CONFLICT', 'Pre-round prep cannot start');
        await tx
          .update(rooms)
          .set({
            prepStartedAt: sql`statement_timestamp()`,
            updatedAt: sql`statement_timestamp()`,
          })
          .where(eq(rooms.id, roomId));
      });
    });
  },

  /**
   * The startRound freeze (ADR 0058 §3): copies the Room's already-resolved
   * values into a new scheduled Round and freezes its participants — and
   * computes nothing. Seat completeness is the write-path invariant the
   * database cannot express: the held slots must be exactly
   * `0..seats[role] - 1` for every role, so the Round is born with a valid
   * competitive cast or not born at all. Idempotent-refusing: a started
   * Room takes no second freeze.
   */
  async startRound(input: {
    readonly roomId: string;
    readonly roundId: string;
    /** The resolution the round debates; the freeze's one caller input. */
    readonly resolution: string;
  }): Promise<void> {
    await instrumented(eventSink, 'startRound', async () => {
      await database.transaction(async (tx) => {
        const [room] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, input.roomId))
          .for('update');
        if (!room) throw createAppError('NOT_FOUND', 'No such room');
        if (room.status !== 'ready')
          throw createAppError('CONFLICT', 'Only a ready room starts a round');
        if (room.executionPlan.preRoundPrep.enabled) {
          const [progress] = await tx
            .select({
              finished: sql<boolean>`${rooms.prepStartedAt} is not null and ${rooms.prepStartedAt} + (${rooms.prepRemainingMs} * interval '1 millisecond') <= statement_timestamp()`,
            })
            .from(rooms)
            .where(eq(rooms.id, input.roomId));
          if (!progress?.finished)
            throw createAppError('CONFLICT', 'Pre-round prep is still running');
        }
        const seats = await tx
          .select({
            participantId: roomParticipants.id,
            actorId: roomParticipants.actorId,
            role: roomParticipants.role,
            slot: roomParticipants.slot,
          })
          .from(roomParticipants)
          .where(eq(roomParticipants.roomId, input.roomId));
        if (!seatsComplete(room.rulesSnapshot.seats, seats))
          throw createAppError('INVARIANT', 'The room has incomplete seats');
        const ladder =
          room.competitionType === 'ranked'
            ? room.length === 'full'
              ? 'ranked'
              : 'quick'
            : null;
        await tx.insert(rounds).values({
          id: input.roundId,
          roomId: room.id,
          createdByActorId: room.hostActorId,
          roomConfigSnapshot: room.config,
          visibility: room.visibility,
          resolution: input.resolution,
          competitionType: room.competitionType,
          length: room.length,
          formatId: room.formatId,
          formatVersion: room.formatVersion,
          presetVersion: room.presetVersion,
          rulesSnapshot: room.rulesSnapshot,
          status: 'scheduled',
          ladderId: ladder,
        });
        await tx.insert(roundParticipants).values(
          seats.map((seat) => ({
            id: seat.participantId,
            roundId: input.roundId,
            actorId: seat.actorId,
            role: seat.role,
            slot: seat.slot,
          })),
        );
        await tx
          .update(rooms)
          .set({ status: 'started', updatedAt: sql`statement_timestamp()` })
          .where(eq(rooms.id, input.roomId));
        await appendRoundPhaseChanged(tx, input.roundId, 1);
      });
    });
  },
});
