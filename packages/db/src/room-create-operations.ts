import type { roomCommandTransaction } from './room-command-transaction';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomMutationOutcome,
  FormatDefinition,
  FormatSelectionFacts,
} from '@daisy/protocol';
import {
  readFormatSelectionFacts,
  type SelectionTuple,
} from './format-operations';

import { eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';

import { instrumented, type DatabaseEventSink } from './instrumented';

import { rooms } from './schema/rooms';
import { roomParticipants } from './schema/rooms';
import { botProfiles } from './schema/bot-profiles';
import { aiJudgeProfiles } from './schema/ai-judge-profiles';
import { holdActiveRoomMembers } from './room-membership-persistence';

import { lockAuthorizationActors } from './authorization';

import { newRoomValues, type NewRoom } from './room-operations';
import { readPublishedResolution } from './published-resolutions';

import {
  type Actor,
  type Caller,
  type Account,
  type Tx,
  actorFact,
  lockedAccount,
  publishDefinition,
  lockCommand,
  replayReceipt,
  acceptCommand,
  transactionNow,
  roomFacts,
} from './room-command-facts';

/** One initial seat a create applies before anyone joins. */
export type InitialCastSeat = {
  readonly actorId: string;
  readonly role: 'affirmative' | 'negative' | 'judge';
  readonly slot: number;
  /** The command and participant identities the applied seat persists. */
  readonly commandId: string;
  readonly participantId: string;
};

/**
 * The slice's one engine edge, injected so the durable adapter stays
 * engine-free: the caller applies each seat through the same assign-seat
 * authority the Room keeps for its whole life, and every refusal refuses
 * the whole create.
 */
export type InitialCastApplier = (
  state: RoomAssemblyState,
  seat: InitialCastSeat,
  target: Actor | null,
  now: string,
) => RoomMutationOutcome;

export const roomCreateOperations = ({
  transaction,
  eventSink,
}: {
  readonly transaction: ReturnType<typeof roomCommandTransaction>;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  async createRoomCommand(input: {
    readonly room: NewRoom;
    /** The engine's member set for the new Room: its host (ADR 0070). */
    readonly members: readonly string[];
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly definition: FormatDefinition | null;
    readonly resolutionPublication?: {
      readonly id: string;
      readonly kind: 'policy' | 'value';
    } | null;
    /**
     * A catalog selection rechecked against the facts read FOR SHARE in this
     * transaction, so a publication that lands after the decision refuses the
     * create instead of pinning a preset the policy would now refuse.
     */
    readonly selection?: {
      readonly tuple: SelectionTuple;
      readonly admits: (facts: FormatSelectionFacts | null) => boolean;
    } | null;
    readonly caller: Caller;
    readonly authorize: (account: Account) => boolean;
    readonly cast?: {
      readonly seats: readonly InitialCastSeat[];
      readonly apply: InitialCastApplier;
    } | null;
  }): Promise<RoomCommandReceipt> {
    return instrumented(eventSink, 'createRoomCommand', () =>
      transaction(async (tx) => {
        await lockCommand(tx, input.commandId);
        const account = await lockedAccount(tx, input.caller);
        if (
          input.caller.actorId !== input.room.hostActorId ||
          !input.authorize(account)
        )
          throw createAppError('AUTHORIZATION');
        const replay = await replayReceipt(
          tx,
          input.commandId,
          input.room.hostActorId,
          input.payloadDigest,
        );
        if (replay) return replay;
        if (
          input.selection &&
          !input.selection.admits(
            await readFormatSelectionFacts(tx, input.selection.tuple),
          )
        )
          throw createAppError('CONFLICT', 'format-unavailable');
        if (input.definition)
          await publishDefinition(
            tx,
            input.room.formatId,
            input.room.hostActorId,
            input.definition,
          );
        if (input.resolutionPublication) {
          const resolution = await readPublishedResolution(
            tx,
            input.resolutionPublication.id,
            input.resolutionPublication.kind,
          );
          if (
            !resolution ||
            resolution.text !== input.room.topic ||
            resolution.id !== input.room.publishedResolutionId
          )
            throw createAppError('CONFLICT', 'format-unavailable');
        }
        if (input.room.competitionType === 'ranked') {
          const active = await tx.execute(
            sql`select id from seasons where status='active' for share`,
          );
          if (active.length !== 1)
            throw createAppError('CONFLICT', 'ranked-unavailable');
        }
        const now = await transactionNow(tx);
        await tx.insert(rooms).values({
          ...newRoomValues(input.room, 'assembling'),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
        // The initial cast applies through the injected assign-seat
        // authority against the canonical state of the inserted Room, so
        // the persisted version, status and receipt match the pure seat
        // transitions exactly. Any refusal rolls the whole create back.
        const assembled = input.cast?.seats.length
          ? await applyInitialCast(
              tx,
              input.caller,
              input.room,
              input.cast,
              now,
            )
          : null;
        if (assembled)
          await tx
            .update(rooms)
            .set({
              status: assembled.status,
              version: assembled.version,
              changeVersion: assembled.changeVersion,
              updatedAt: new Date(now),
            })
            .where(eq(rooms.id, input.room.id));
        if (assembled?.participants.length)
          await tx.insert(roomParticipants).values(
            assembled.participants.map((p) => ({
              id: p.id,
              roomId: input.room.id,
              actorId: p.actorId,
              role: p.role,
              slot: p.slot,
              readinessCommandId: p.consentCommandId,
              readinessVersion: p.consentVersion,
            })),
          );
        await holdActiveRoomMembers(tx, input.room.id, input.members);
        const receipt: RoomCommandReceipt = {
          commandId: input.commandId,
          roomId: input.room.id,
          resultingVersion: assembled?.version ?? 1,
          roundRef: null,
          replayed: false,
        };
        await acceptCommand(
          tx,
          receipt,
          input.room.hostActorId,
          input.payloadDigest,
          'create',
          now,
          assembled?.changeVersion ?? 1,
        );
        return receipt;
      }),
    );
  },
});

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
  now: string,
): Promise<RoomAssemblyState> => {
  const seats = cast.seats;
  if (new Set(seats.map((seat) => seat.actorId)).size !== seats.length)
    throw createAppError('CONFLICT', 'illegal-config');
  const fencedActors = [
    ...new Set([caller.actorId, ...seats.map((seat) => seat.actorId)]),
  ];
  await lockAuthorizationActors(tx, fencedActors, {
    maxActors: fencedActors.length,
  });
  // Eligibility and seatRole live on these profile rows, not the account
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
  let assembled = state;
  for (const seat of seats) {
    const target = await actorFact(tx, seat.actorId);
    const outcome = cast.apply(assembled, seat, target, now);
    if (!outcome.ok) throw createAppError('CONFLICT', outcome.refusal);
    assembled = outcome.mutation.state;
  }
  return assembled;
};
