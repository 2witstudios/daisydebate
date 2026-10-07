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

export type NewRoom = {
  readonly id: string;
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
          .values({
            id: room.id,
            formatId: room.formatId,
            formatVersion: room.formatVersion,
            presetVersion: room.presetVersion,
            competitionType: room.competitionType,
            length: room.length,
            config: room.config,
            executionPlan: room.executionPlan,
            rulesSnapshot: room.rules,
            status: 'assembling',
          })
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
            .select({ status: rooms.status })
            .from(rooms)
            .where(eq(rooms.id, input.roomId))
            .for('update');
          if (!room) throw createAppError('NOT_FOUND', 'No such room');
          if (room.status !== 'assembling' && room.status !== 'ready')
            throw createAppError(
              'CONFLICT',
              'The room has started or been abandoned',
            );
          await tx.insert(roomParticipants).values({
            id: input.participantId,
            roomId: input.roomId,
            actorId: input.actorId,
            role: input.role,
            slot: input.slot,
          });
          if (room.status === 'assembling') {
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
        const seats = await tx
          .select({
            participantId: roomParticipants.id,
            actorId: roomParticipants.actorId,
            role: roomParticipants.role,
            slot: roomParticipants.slot,
          })
          .from(roomParticipants)
          .where(eq(roomParticipants.roomId, input.roomId));
        const declared = room.rulesSnapshot.seats as Record<string, number>;
        for (const [role, wanted] of Object.entries(declared)) {
          const held = seats
            .filter((seat) => seat.role === role)
            .map((seat) => seat.slot)
            .sort((a, b) => a - b);
          if (
            held.length !== wanted ||
            !held.every((slot, index) => slot === index)
          )
            throw createAppError(
              'INVARIANT',
              `Held ${role} seats are not exactly 0..${wanted - 1}`,
            );
        }
        const ladder =
          room.competitionType === 'ranked'
            ? room.length === 'full'
              ? 'ranked'
              : 'quick'
            : null;
        await tx.insert(rounds).values({
          id: input.roundId,
          roomId: room.id,
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
      });
    });
  },
});
