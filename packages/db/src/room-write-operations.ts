import type { RoundBotAdmission } from './round-bot-admission';
import { persistRoomMutation } from './room-mutation-persistence';

import { eq } from 'drizzle-orm';
import type { roomCommandTransaction } from './room-command-transaction';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomMutationOutcome,
} from '@daisy/protocol';

import { createAppError } from '@daisy/errors';

import {
  lockAuthorizationActors,
  loadAuthorizationAccount,
} from './authorization';

import { instrumented, type DatabaseEventSink } from './instrumented';
import { drawStartFacts } from './room-draw-persistence';

import { rooms, roomParticipants } from './schema/rooms';

import {
  type Tx,
  type Caller,
  type Account,
  type AuthorizeRoom,
  type Actor,
  actorFact,
  roomFacts,
  lockCommand,
  replayReceipt,
  acceptCommand,
  transactionNow,
} from './room-command-facts';
type CommandInput = {
  readonly caller: Caller;
  readonly authorizeRead: AuthorizeRoom;
  readonly roomId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly payloadDigest: string;
  readonly type: string;
  readonly targetActorId: string | null;
  readonly roundId: string;
  readonly prepare: (
    state: RoomAssemblyState,
    now: string,
    account: Account,
    drawSeed: string | null,
  ) => Promise<
    (
      state: RoomAssemblyState,
      now: string,
      target: Actor | null,
      account: Account,
      draw: RoomDrawFacts,
    ) => RoomMutationOutcome
  >;
};

/** The draw facts a command executes with: the seed, and new-draw facts. */
export type RoomDrawFacts = Awaited<ReturnType<typeof drawStartFacts>> & {
  readonly seed: string | null;
};

export const roomWriteOperations = ({
  transaction,
  eventSink,
  botAdmission,
}: {
  readonly transaction: ReturnType<typeof roomCommandTransaction>;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly botAdmission?: RoundBotAdmission | undefined;
}) => ({
  async executeRoomCommand(input: CommandInput): Promise<RoomCommandReceipt> {
    return instrumented(eventSink, 'executeRoomCommand', () =>
      transaction(async (tx) => {
        const preparation = await prepareCommand(tx, input);
        if ('replay' in preparation) return preparation.replay;
        const { prepared, execute } = preparation;
        await lockBotFreeze(tx, input.type, botAdmission);
        const initialSeats = await tx
          .select({ actorId: roomParticipants.actorId })
          .from(roomParticipants)
          .where(eq(roomParticipants.roomId, input.roomId));
        const fencedActors = [
          ...new Set([
            input.caller.actorId,
            ...initialSeats.map((p) => p.actorId),
            ...(input.targetActorId ? [input.targetActorId] : []),
          ]),
        ];
        await lockAuthorizationActors(tx, fencedActors, {
          maxActors: fencedActors.length,
        });
        const account = await loadAuthorizationAccount(tx, input.caller.userId);
        const [row] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, input.roomId))
          .for('update');
        if (!row) throw createAppError('NOT_FOUND');
        const { state, drawSeed } = await roomFacts(tx, row);
        if (!input.authorizeRead(state, account))
          throw createAppError('NOT_FOUND');
        if (state.participants.some((p) => !fencedActors.includes(p.actorId)))
          throw createAppError(
            'CONFLICT',
            'Cast changed while acquiring authority',
          );
        if (state.changeVersion !== prepared.changeVersion)
          throw createAppError(
            'CONFLICT',
            'Room changed while preparing consent',
          );
        const now = await transactionNow(tx);
        const target = input.targetActorId
          ? await actorFact(tx, input.targetActorId)
          : null;
        const outcome = execute(state, now, target, account, {
          seed: drawSeed,
          ...(input.type === 'start-pre-round'
            ? await drawStartFacts(tx, state)
            : { bank: null, exclusions: [] }),
        });
        if (!outcome.ok)
          throw createAppError(refusalCode(outcome.refusal), outcome.refusal);
        const next = outcome.mutation.state;
        const roundRef = await persistRoomMutation(
          tx,
          outcome.mutation,
          input.roundId,
          now,
          true,
          state.resolutionDraw?.strikes.length ?? 0,
        );
        await reserveBotFreeze(
          tx,
          outcome.mutation,
          input.roundId,
          botAdmission,
        );
        const receipt: RoomCommandReceipt = {
          commandId: input.commandId,
          roomId: next.id,
          resultingVersion: next.version,
          roundRef,
          replayed: false,
        };
        await acceptCommand(
          tx,
          receipt,
          input.actorId,
          input.payloadDigest,
          input.type,
          now,
          next.changeVersion,
        );
        return receipt;
      }),
    );
  },
});

const refusalCode = (refusal: string) =>
  refusal === 'host-required'
    ? ('AUTHORIZATION' as const)
    : refusal === 'readiness-unavailable'
      ? ('INFRASTRUCTURE' as const)
      : ('CONFLICT' as const);

async function prepareCommand(tx: Tx, input: CommandInput) {
  // Serialize retries first, without holding account or Room row locks
  // during external preparation. All Room command paths use this order.
  await lockCommand(tx, input.commandId);
  const preparationAccount = await loadAuthorizationAccount(
    tx,
    input.caller.userId,
  );
  const [preparationRow] = await tx
    .select()
    .from(rooms)
    .where(eq(rooms.id, input.roomId));
  if (!preparationRow) throw createAppError('NOT_FOUND');
  const { state: prepared, drawSeed } = await roomFacts(tx, preparationRow);
  if (!input.authorizeRead(prepared, preparationAccount))
    throw createAppError('NOT_FOUND');
  if (input.caller.actorId !== input.actorId)
    throw createAppError('AUTHORIZATION');
  const replay = await replayReceipt(
    tx,
    input.commandId,
    input.actorId,
    input.payloadDigest,
    input.roomId,
  );
  if (replay) return { replay } as const;
  const execute = await input.prepare(
    prepared,
    await transactionNow(tx),
    preparationAccount,
    drawSeed,
  );
  return { prepared, execute } as const;
}

async function lockBotFreeze(
  tx: Tx,
  command: string,
  admission: RoundBotAdmission | undefined,
) {
  if (command === 'start-round') await admission?.lock(tx);
}
async function reserveBotFreeze(
  tx: Tx,
  mutation: Extract<RoomMutationOutcome, { ok: true }>['mutation'],
  roundId: string,
  admission: RoundBotAdmission | undefined,
) {
  const state = mutation.state;
  if (
    !mutation.freeze ||
    state.competitionType === 'ranked' ||
    !state.participants.some((p) => p.kind === 'bot')
  )
    return;
  if (!admission)
    throw createAppError('INFRASTRUCTURE', 'Bot admission unavailable');
  await admission.reserveLocked(tx, { actorId: state.hostActorId, roundId });
}
