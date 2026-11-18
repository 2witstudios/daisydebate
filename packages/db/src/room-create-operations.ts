import {
  assembleRoom,
  type InitialCastSeat,
  type InitialCastApplier,
} from './room-assembly';
export type { InitialCastSeat, InitialCastApplier } from './room-assembly';
import type { roomCommandTransaction } from './room-command-transaction';
import { daisyOrganizationId, publicLobbyId } from './daisy-reference';
import type { CasualJudgeAdmission } from './casual-judge-admission';
import { recordCaptureNotice } from './agreement-signatures';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  FormatDefinition,
  FormatSelectionFacts,
  EntitlementGrant,
  RecordingPolicy,
  RatingDivision,
} from '@daisy/protocol';
import { roomLobbyAtCreation } from '@daisy/protocol';
import { readRoomCreator } from './room-creator';
import {
  readFormatSelectionFacts,
  type SelectionTuple,
} from './format-operations';

import { sql } from 'drizzle-orm';
import { createAppError, createRefusal } from '@daisy/errors';

import { instrumented, type DatabaseEventSink } from './instrumented';

import { readEntitlementGrants } from './entitlement-grants';

import type { NewRoom } from './room-operations';

import {
  type Caller,
  type Account,
  lockedAccount,
  publishDefinition,
  lockCommand,
  replayReceipt,
  acceptCommand,
  transactionNow,
} from './room-command-facts';

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
    readonly room: Omit<NewRoom, 'division'> & { readonly hostActorId: string };
    /**
     * The lobby the creator chose (ADR 0156); null is their own. Decided
     * under the creator's account lock by `roomLobbyAtCreation`.
     */
    readonly lobbyChoice: RatingDivision | null;
    /**
     * The engine's member set for the new Room's seats once its initial
     * cast is applied (ADR 0070, TAB-6.16): the seated humans, never a
     * host without a seat.
     */
    readonly membersOf: (
      participants: RoomAssemblyState['participants'],
    ) => readonly string[];
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly definition: FormatDefinition | null;
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
    /** Members a side's seat stays held for (ADR 0103), the host included. */
    readonly holdSeatsFor?: readonly string[];
    /**
     * The Recording the casual host chose and its premium check, evaluated
     * against the host's grants under the create account fence.
     */
    readonly recording?: {
      readonly policy: Exclude<RecordingPolicy, 'off'>;
      readonly authorize: (
        grants: readonly EntitlementGrant[],
        now: string,
      ) => boolean;
    };
    /** The casual host keeps the call open after the Round (ADR 0127). */
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
        // A Room belongs to the lobby it is created in (ADR 0156).
        const lobby = roomLobbyAtCreation(
          await readRoomCreator(tx, input.caller.userId),
          input.lobbyChoice,
        );
        if (lobby.kind === 'refused')
          throw createRefusal('CONFLICT', lobby.refusal);
        const room = { ...input.room, division: lobby.division };
        // A ranked Room rates on its own division's ladder, so opening one
        // needs that division's active Daisy season.
        if (room.competitionType === 'ranked') {
          const active = await tx.execute(
            sql`select id from seasons where status='active' and organization_id=${daisyOrganizationId} and division=${room.division} for share`,
          );
          if (active.length === 0)
            throw createRefusal('CONFLICT', 'ranked-unavailable');
        }
        if (
          (input.recording || input.postRoundCall) &&
          input.room.competitionType === 'ranked'
        )
          throw createRefusal('CONFLICT', 'illegal-config');
        const now = await transactionNow(tx);
        const assembled = await assembleRoom(tx, {
          room,
          lobby: { id: publicLobbyId, kind: 'standing' },
          templateId: null,
          ballotDefinition: null,
          capture: input.recording
            ? { broadcast: null, recordingPolicy: input.recording.policy }
            : null,
          postRoundCall: input.postRoundCall === true,
          now,
          caller: input.caller,
          cast: input.cast ?? null,
          ...(input.holdSeatsFor ? { holdSeatsFor: input.holdSeatsFor } : {}),
          membersOf: input.membersOf,
          judgeAdmission,
        });
        if (input.notice)
          await recordCaptureNotice(tx, {
            ...input.notice,
            userId: input.caller.userId,
            roomId: input.room.id,
            now,
          });
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
