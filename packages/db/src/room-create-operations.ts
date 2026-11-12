import type { roomCommandTransaction } from './room-command-transaction';
import type { CasualJudgeAdmission } from './casual-judge-admission';
import { recordCaptureNotice } from './agreement-signatures';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomMutationOutcome,
  FormatDefinition,
  FormatSelectionFacts,
  EntitlementGrant,
} from '@daisy/protocol';
import { ROOM_SEAT_HOLD_MS } from '@daisy/protocol';
import {
  readFormatSelectionFacts,
  type SelectionTuple,
} from './format-operations';

import { eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createAppError, createRefusal } from '@daisy/errors';

import { instrumented, type DatabaseEventSink } from './instrumented';

import { rooms } from './schema/rooms';
import { roomParticipants, roomSeatHolds } from './schema/rooms';
import { actors } from './schema/actors';
import { botProfiles } from './schema/bot-profiles';
import { aiJudgeProfiles } from './schema/ai-judge-profiles';
import { holdActiveRoomMembers } from './room-membership-persistence';

import { lockAuthorizationActors } from './authorization';
import { readEntitlementGrants } from './entitlement-grants';

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
  maySeatCasualAiJudge: boolean,
) => RoomMutationOutcome;

export const roomCreateOperations = ({
  transaction,
  eventSink,
  judgeAdmission,
}: {
  readonly transaction: ReturnType<typeof roomCommandTransaction>;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly judgeAdmission?: CasualJudgeAdmission | undefined;
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
    /** Members a debater seat stays held for (ADR 0103), the host included. */
    readonly holdSeatsFor?: readonly string[];
    /** Evaluated against the host's grants under the create account fence. */
    readonly recording?: {
      readonly authorize: (
        grants: readonly EntitlementGrant[],
        now: string,
      ) => boolean;
    };
    /** The casual host keeps the call open after the Round (ADR 0126). */
    readonly postRoundCall?: boolean;
    /** The notice the create form showed its host, recorded with the Room. */
    readonly notice?: {
      readonly id: string;
      readonly version: string;
      readonly words: string;
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
          throw createRefusal('CONFLICT', 'format-unavailable');
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
            throw createRefusal('CONFLICT', 'format-unavailable');
        }
        if (input.room.competitionType === 'ranked') {
          const active = await tx.execute(
            sql`select id from seasons where status='active' for share`,
          );
          if (active.length !== 1)
            throw createRefusal('CONFLICT', 'ranked-unavailable');
        }
        if (
          (input.recording || input.postRoundCall) &&
          input.room.competitionType === 'ranked'
        )
          throw createRefusal('CONFLICT', 'illegal-config');
        const now = await transactionNow(tx);
        await tx.insert(rooms).values({
          ...newRoomValues(input.room),
          capture: input.recording
            ? { broadcast: null, recording: true }
            : null,
          postRoundCall: input.postRoundCall === true,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });
        if (input.notice)
          await recordCaptureNotice(tx, {
            ...input.notice,
            userId: input.caller.userId,
            roomId: input.room.id,
            now,
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
          const until = new Date(Date.parse(now) + ROOM_SEAT_HOLD_MS);
          await tx.insert(roomSeatHolds).values(
            heldActors.map((actorId) => ({
              roomId: input.room.id,
              actorId,
              seat: 'debater' as const,
              until,
            })),
          );
        }
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
              judgeAdmission,
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
        if (input.recording) {
          // Cast and membership may wait: judge the grant at commit admission,
          // after their locks and facts, while the host account fence still holds.
          const grants = await readEntitlementGrants(tx, input.caller.userId);
          const captureNow = await transactionNow(tx);
          if (!input.recording.authorize(grants, captureNow))
            throw createRefusal('CONFLICT', 'capture-premium');
        }
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
  const targets: (Actor | null)[] = [];
  for (const seat of seats) targets.push(await actorFact(tx, seat.actorId));
  const judgeQuote =
    judgeAdmission && targets.some((target) => target?.seatRole === 'judge')
      ? await judgeAdmission.quoteLocked(tx, {
          account:
            accounts.find((account) => account?.actorId === caller.actorId) ??
            null,
          roundId: null,
          withBot: targets.some(
            (target, index) =>
              target?.seatRole === 'debater' && seats[index]?.role !== 'judge',
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
