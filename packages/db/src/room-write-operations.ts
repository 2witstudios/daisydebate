import { reserveTournamentCapture } from './tab/tournament-capture-admission';
import {
  locateTournamentCaptureFunder,
  TournamentCaptureFundingChanged,
} from './tab/tournament-capture-funding';
import { lockNonrankedCaptureCapacity } from './nonranked-capture-capacity';
import {
  loadRoomDirection,
  type RoomDirectionInput,
} from './tab/room-direction';
import { admitCasualCapture } from './casual-capture-admission';
import type { RoundBotAdmission } from './round-bot-admission';
import type { CasualJudgeAdmission } from './casual-judge-admission';
import { persistRoomMutation } from './room-mutation-persistence';

import { eq } from 'drizzle-orm';
import type { roomCommandTransaction } from './room-command-transaction';
import {
  readContentWaiverStanding,
  recordCaptureNotice,
  type ContentWaiverStanding,
} from './agreement-signatures';
import { readEntitlementGrants } from './entitlement-grants';
import type {
  EntitlementGrant,
  AgeBand,
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomMutationOutcome,
  RoomRefusal,
  TournamentCaptureAdmission,
} from '@daisy/protocol';

import { createAppError, createRefusal } from '@daisy/errors';
import { isJudgeSeat } from '@daisy/protocol';

/**
 * The host a Room's admission or capture charges. A Room no person hosts
 * (TAB-6) is never charged: the engine seats no bot nor AI judge, and opts
 * into no casual capture, without a host, so reaching here is a defect.
 */
const chargedHostOf = (room: { readonly hostActorId: string | null }) => {
  if (room.hostActorId === null)
    throw createAppError('INVARIANT', 'A Room without a host is never charged');
  return room.hostActorId;
};

import {
  lockAuthorizationActors,
  loadAuthorizationAccount,
} from './authorization';

import { instrumented, type DatabaseEventSink } from './instrumented';
import { retryStale } from './retry-stale';
import {
  readFormatSelectionFacts,
  type FormatSelectionFactsRecord,
  type SelectionTuple,
} from './format-operations';
import { drawStartFacts } from './draw-start-facts';

import { rooms, roomParticipants } from './schema/rooms';

import {
  type Tx,
  type Caller,
  type Account,
  type AuthorizeRoom,
  type Actor,
  actorFact,
  roomFacts,
  roomFactsForWrite,
  lockCommand,
  replayReceipt,
  acceptCommand,
  transactionNow,
} from './room-command-facts';
type CommandInput = {
  readonly caller: Caller;
  readonly authorizeRead: AuthorizeRoom;
  readonly authorizeCommand?: (
    state: RoomAssemblyState,
    account: Account,
    direction: RoomDirectionInput | null,
    now: string,
  ) => boolean;
  readonly captureAdmission?: (
    state: RoomAssemblyState,
    direction: RoomDirectionInput | null,
    now: string,
  ) => TournamentCaptureAdmission | null;
  readonly roomId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly payloadDigest: string;
  readonly type: string;
  readonly targetActorId: string | null;
  /** The catalog tuple a select-format names; its facts load under this transaction (FMT-1). */
  readonly formatTuple: SelectionTuple | null;
  readonly roundId: string;
  /** The engine's cast rule: only a launch that seats a bot debater takes the bot-admission lock. */
  readonly seatsBotDebater: (state: RoomAssemblyState) => boolean;
  /**
   * What a Ready on this Room stands on (WATCH-15, WATCH-9): the waiver version
   * it needs and the notice it records. Null when it needs neither.
   */
  readonly readyAgreements: (
    state: RoomAssemblyState,
    /** The caller's age band: which ranked waiver they sign (ADR 0161). */
    signer: AgeBand | null,
  ) => {
    readonly contentWaiverVersion: string | null;
    readonly notice: {
      readonly id: string;
      readonly version: string;
      readonly words: string;
    } | null;
  } | null;
  readonly prepare: (
    state: RoomAssemblyState,
    now: string,
    account: Account,
    direction?: RoomDirectionInput | null,
  ) => Promise<
    (
      state: RoomAssemblyState,
      now: string,
      target: Actor | null,
      account: Account,
      draw: RoomDrawFacts,
      formatFacts: FormatSelectionFactsRecord | null,
      /** The caller's own grants, read under the account fence this holds. */
      grants: readonly EntitlementGrant[],
      /** This member's standing on the waiver a Ready needs, under this lock. */
      contentWaiver: ContentWaiverStanding | null,
      maySeatCasualAiJudge: boolean,
      direction?: RoomDirectionInput | null,
    ) => RoomMutationOutcome
  >;
};

/** The new-draw facts a Start round executes with. */
type RoomDrawFacts = Awaited<ReturnType<typeof drawStartFacts>>;

export const roomWriteOperations = ({
  transaction,
  eventSink,
  botAdmission,
  judgeAdmission,
}: {
  readonly transaction: ReturnType<typeof roomCommandTransaction>;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly botAdmission?: RoundBotAdmission | undefined;
  readonly judgeAdmission?: CasualJudgeAdmission | undefined;
}) => ({
  async executeRoomCommand(input: CommandInput): Promise<RoomCommandReceipt> {
    return instrumented(eventSink, 'executeRoomCommand', () =>
      retryStale(
        () =>
          transaction((tx) =>
            executeOnce(tx, input, botAdmission, judgeAdmission),
          ),
        (error) =>
          error instanceof RoomMoved ||
          error instanceof TournamentCaptureFundingChanged,
        ATTEMPTS,
        // The Room kept moving under the command: the caller rereads it.
        () => createRefusal('CONFLICT', 'version-conflict'),
      ),
    );
  },
});

/** The Room moved between preparation and its lock: retry from fresh facts. */
class RoomMoved extends Error {}

const ATTEMPTS = 3;

async function executeOnce(
  tx: Tx,
  input: CommandInput,
  botAdmission: RoundBotAdmission | undefined,
  judgeAdmission: CasualJudgeAdmission | undefined,
): Promise<RoomCommandReceipt> {
  const preparation = await prepareCommand(tx, input);
  const { prepared } = preparation;
  const botLocked = await lockBotFreeze(
    tx,
    botDebaterLaunch(input, prepared),
    botAdmission,
  );
  const captureFunder =
    input.type === 'start-round' &&
    preparation.row.hostActorId === null &&
    prepared.capture?.recordingPolicy === 'officials'
      ? await locateTournamentCaptureFunder(tx, {
          lobbyId: preparation.row.lobbyId,
          callerUserId: input.caller.userId,
        })
      : null;
  const initialSeats = await tx
    .select({ actorId: roomParticipants.actorId })
    .from(roomParticipants)
    .where(eq(roomParticipants.roomId, input.roomId));
  const fencedActors = [
    ...new Set([
      input.caller.actorId,
      ...(captureFunder ? [captureFunder.actorId] : []),
      ...initialSeats.map((p) => p.actorId),
      ...(input.targetActorId ? [input.targetActorId] : []),
    ]),
  ];
  await lockAuthorizationActors(tx, fencedActors, {
    maxActors: fencedActors.length,
  });
  const account = await loadAuthorizationAccount(tx, input.caller.userId);
  const direction = await loadRoomDirection(tx, {
    room: preparation.row,
    userId: input.caller.userId,
    captureFunder,
  });
  const [row] = await tx
    .select()
    .from(rooms)
    .where(eq(rooms.id, input.roomId))
    .for('update');
  if (!row) throw createAppError('NOT_FOUND');
  const { state } = await roomFactsForWrite(tx, row);
  if (!input.authorizeRead(state, account, direction, await transactionNow(tx)))
    throw createAppError('NOT_FOUND');
  if (
    input.authorizeCommand &&
    !input.authorizeCommand(state, account, direction, await transactionNow(tx))
  )
    throw createAppError('AUTHORIZATION');
  if ('replay' in preparation) return preparation.replay;
  if (
    input.type === 'start-round' &&
    state.topic !== null &&
    direction?.resolutionReleasedAt === null
  )
    throw createRefusal('CONFLICT', 'resolution-not-released');
  const execute = preparation.execute;
  if (state.participants.some((p) => !fencedActors.includes(p.actorId)))
    throw new RoomMoved('Cast changed while acquiring authority');
  if (state.changeVersion !== prepared.changeVersion)
    throw new RoomMoved('Room changed while preparing consent');
  const target = input.targetActorId
    ? await actorFact(tx, input.targetActorId)
    : null;
  // FOR SHARE: a concurrent publication (FOR UPDATE on the format
  // row) serializes with this selection, so the policy judges facts
  // that hold at commit.
  const formatFacts = input.formatTuple
    ? await readFormatSelectionFacts(tx, input.formatTuple)
    : null;
  const agreements =
    input.type === 'ready'
      ? input.readyAgreements(state, account?.ageBand ?? null)
      : null;
  const draw = await drawFacts(tx, input.type, state);
  const grants = await readEntitlementGrants(tx, input.caller.userId);
  const contentWaiver = agreements?.contentWaiverVersion
    ? await readContentWaiverStanding(
        tx,
        input.caller.userId,
        agreements.contentWaiverVersion,
        state.lobbyId,
      )
    : null;
  const judgeQuote =
    judgeAdmission &&
    state.hostActorId === input.caller.actorId &&
    (target?.aiRole === 'judge' ||
      (input.type === 'start-round' &&
        state.participants.some(
          (p) => p.kind === 'bot' && isJudgeSeat(p.seat),
        )))
      ? await judgeAdmission.quoteLocked(tx, {
          account,
          roundId: input.roundId,
          withBot: input.seatsBotDebater(state),
        })
      : null;
  if (
    input.type === 'start-round' &&
    direction &&
    state.capture?.recordingPolicy === 'officials'
  )
    await lockNonrankedCaptureCapacity(tx);
  // Facts can wait on SQL locks. Admission uses one instant after those waits.
  const now = judgeQuote?.now ?? (await transactionNow(tx));
  const outcome = execute(
    state,
    now,
    target,
    account,
    draw,
    formatFacts,
    grants,
    contentWaiver,
    judgeQuote?.decision.kind === 'admit',
    direction,
  );
  if (!outcome.ok)
    throw createRefusal(refusalCode(outcome.refusal), outcome.refusal);
  const next = outcome.mutation.state;
  // Admission, allowance and capture below all name the Round by this id.
  if (outcome.mutation.freeze && next.roundRef?.id !== input.roundId)
    throw createAppError(
      'INVARIANT',
      'A Start round names the Round its command carries',
    );
  const roundRef = await persistRoomMutation(tx, outcome.mutation, now, true);
  await reserveBotFreeze(
    tx,
    outcome.mutation,
    input.roundId,
    botAdmission,
    botLocked,
  );
  if (
    outcome.mutation.freeze &&
    !outcome.mutation.seatsBotDebater &&
    next.competitionType !== 'ranked' &&
    next.participants.some((p) => p.kind === 'bot' && isJudgeSeat(p.seat))
  ) {
    if (!judgeAdmission)
      throw createAppError('INFRASTRUCTURE', 'Judge admission unavailable');
    await judgeAdmission.reserveLocked(tx, {
      actorId: chargedHostOf(next),
      roundId: input.roundId,
    });
  }
  if (
    outcome.mutation.freeze &&
    outcome.mutation.state.competitionType !== 'ranked' &&
    outcome.mutation.state.hostActorId !== null &&
    outcome.mutation.state.capture !== null &&
    (outcome.mutation.state.capture.recordingPolicy !== 'off' ||
      outcome.mutation.state.capture.broadcast !== null)
  )
    await admitCasualCapture(tx, {
      hostActorId: chargedHostOf(outcome.mutation.state),
      roundId: input.roundId,
    });
  if (agreements?.notice && outcome.mutation.consent?.type === 'ready')
    await recordCaptureNotice(tx, {
      ...agreements.notice,
      userId: input.caller.userId,
      roomId: next.id,
      now,
    });
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
  if (
    outcome.mutation.freeze &&
    next.hostActorId === null &&
    next.capture !== null &&
    next.capture.recordingPolicy !== 'off'
  ) {
    const admission = input.captureAdmission?.(next, direction, now);
    if (!admission || !direction)
      throw createRefusal('CONFLICT', 'capture-premium');
    await reserveTournamentCapture(tx, {
      admission,
      direction,
      roundId: input.roundId,
      roomId: next.id,
      commandId: input.commandId,
      actorId: input.caller.actorId,
    });
  }
  return receipt;
}

/** New-draw facts, only for a Start round on a draw Room. */
const drawFacts = async (
  tx: Tx,
  type: string,
  state: RoomAssemblyState,
): Promise<RoomDrawFacts> =>
  type === 'start-round' && state.executionPlan.resolutionDraw.enabled
    ? await drawStartFacts(tx, state)
    : { bank: null, exclusions: [] };

const refusalCode = (refusal: RoomRefusal) =>
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
  const { state: prepared } = await roomFacts(tx, preparationRow);
  const direction = await loadRoomDirection(tx, {
    room: preparationRow,
    userId: input.caller.userId,
    snapshot: true,
  });
  if (
    !input.authorizeRead(
      prepared,
      preparationAccount,
      direction,
      await transactionNow(tx),
    )
  )
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
  if (
    input.authorizeCommand &&
    !input.authorizeCommand(
      prepared,
      preparationAccount,
      direction,
      await transactionNow(tx),
    )
  )
    throw createAppError('AUTHORIZATION');
  if (replay) return { replay, prepared, row: preparationRow } as const;
  const execute = await input.prepare(
    prepared,
    await transactionNow(tx),
    preparationAccount,
    direction,
  );
  return { prepared, execute, row: preparationRow } as const;
}

/** A Launch whose prepared cast seats a bot debater. */
const botDebaterLaunch = (input: CommandInput, prepared: RoomAssemblyState) =>
  input.type === 'start-round' && input.seatsBotDebater(prepared);

/**
 * Serializes bot-debater launches fleet-wide, so concurrent freezes cannot
 * both read capacity below the cap. Taken before account and Room locks,
 * only for a launch whose prepared cast seats a bot debater; the
 * changeVersion check after the locks refuses a cast that changed since.
 */
async function lockBotFreeze(
  tx: Tx,
  botDebaterLaunch: boolean,
  admission: RoundBotAdmission | undefined,
) {
  if (!botDebaterLaunch || !admission) return false;
  await admission.lock(tx);
  return true;
}
async function reserveBotFreeze(
  tx: Tx,
  mutation: Extract<RoomMutationOutcome, { ok: true }>['mutation'],
  roundId: string,
  admission: RoundBotAdmission | undefined,
  locked: boolean,
) {
  const state = mutation.state;
  // The pure engine decides whether this cast seats a bot debater; admission
  // then takes both its consequences, allowance and capacity (ADR 0106).
  if (!mutation.freeze || !mutation.seatsBotDebater) return;
  if (!admission)
    throw createAppError('INFRASTRUCTURE', 'Bot admission unavailable');
  if (!locked) throw createAppError('CONFLICT', 'Bot admission not serialized');
  await admission.reserveLocked(tx, { actorId: chargedHostOf(state), roundId });
}
