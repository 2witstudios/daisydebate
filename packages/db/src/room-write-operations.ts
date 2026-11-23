import { requireRankedProtection } from './guardians/ranked-protection';
import { lockActiveLobbySeason } from './ladder-season';
import {
  readGuardianWaiverAgeBand,
  refuseIneligibleDebaters,
} from './room-start-eligibility';
import {
  hasGuardianLobbyWaiver,
  readGuardianLobbyIds,
} from './guardians/lobby-permissions';
import {
  loadTournamentEligibility,
  tournamentDebatersAllowed,
} from './tab/tournament-eligibility';
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
import type { ReleaseAdmission } from './flags';
import type { CasualJudgeAdmission } from './casual-judge-admission';
import { persistRoomMutation } from './room-mutation-persistence';

import { eq, inArray } from 'drizzle-orm';
import type { TransactionRunner, Tx } from './tx';
import {
  readContentWaiverStanding,
  recordCaptureNotice,
  type ContentWaiverStanding,
} from './agreement-signatures';
import { readEntitlementGrants } from './entitlement-grants';
import type { EntitlementGrant } from '@daisy/protocol/entitlements';
import type { AgeBand } from '@daisy/protocol/ladder';
import type {
  RoomAssemblyState,
  RoomCommandReceipt,
  RoomMutationOutcome,
  RoomRefusal,
} from '@daisy/protocol/room-contract';
import type { TournamentCaptureAdmission } from '@daisy/protocol/tournament-capture-admission';

import { createAppError, createRefusal } from '@daisy/errors';
import { isDebatingSeat, isJudgeSeat, sameSeat } from '@daisy/protocol/seats';

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
import { retryStale } from './tx';
import {
  readFormatSelectionFacts,
  type FormatSelectionFactsRecord,
  type SelectionTuple,
} from './format-operations';
import { drawStartFacts } from './draw-start-facts';

import { rooms, roomParticipants } from './schema/rooms';
import { actors } from './schema/actors';

import {
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

/** Ready and Start require the same evidence for the seat's own lobby. */
const readRoomSeatContentWaiverStanding = async (
  tx: Tx,
  state: RoomAssemblyState,
  userId: string,
  waiverVersion: string,
  guardianSigns = false,
): Promise<ContentWaiverStanding> => {
  if (!guardianSigns)
    return readContentWaiverStanding(tx, userId, waiverVersion, state.lobbyId);
  const seasonId = await lockActiveLobbySeason(tx, state.lobbyId);
  if (!seasonId) return 'no-active-season';
  return (await hasGuardianLobbyWaiver(tx, {
    minorUserId: userId,
    lobbyId: state.lobbyId,
    waiverVersion,
    seasonId,
  }))
    ? 'signed'
    : 'unsigned';
};

async function requireStartWaivers(
  tx: Tx,
  state: RoomAssemblyState,
  agreementsOf: CommandInput['readyAgreements'],
) {
  if (state.competitionType !== 'ranked') return;
  const people = state.participants.filter(({ kind }) => kind === 'human');
  if (people.length === 0) return;
  const signers = await tx
    .select({ userId: actors.userId })
    .from(actors)
    .where(
      inArray(
        actors.id,
        people.map(({ actorId }) => actorId),
      ),
    );
  for (const { userId } of signers) {
    if (userId === null)
      throw createAppError('INVARIANT', 'A human seat has no account');
    const account = await loadAuthorizationAccount(tx, userId);
    const agreements = agreementsOf(state, {
      currentAgeBand: account?.ageBand ?? null,
      competitionAgeBand: account?.actorId
        ? await readGuardianWaiverAgeBand(tx, state, userId, account.actorId)
        : null,
      actorId: account?.actorId ?? null,
    });
    const version = agreements?.contentWaiverVersion;
    if (!version) continue;
    const standing = await readRoomSeatContentWaiverStanding(
      tx,
      state,
      userId,
      version,
      agreements.guardianSigns,
    );
    if (standing !== 'signed')
      throw createRefusal(
        'CONFLICT',
        standing === 'no-active-season'
          ? 'ranked-unavailable'
          : 'content-waiver-required',
      );
  }
}

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
   * The application's trusted `bot-debates` release closure (ADR 0921): a
   * launch that seats a bot debater requires it on the charged host's
   * account in this transaction, whatever entitlement the host holds.
   */
  readonly botRelease: ReleaseAdmission;
  /**
   * What a Ready on this Room stands on (WATCH-15, WATCH-9): the waiver version
   * it needs and the notice it records. Null when it needs neither.
   */
  readonly readyAgreements: (
    state: RoomAssemblyState,
    signer: {
      readonly currentAgeBand: AgeBand | null;
      readonly competitionAgeBand: AgeBand | null;
      readonly actorId: string | null;
    },
  ) => {
    readonly contentWaiverVersion: string | null;
    readonly guardianSigns?: boolean;
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
  readonly transaction: TransactionRunner;
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
  const tournamentEligibility =
    direction && (input.type === 'ready' || input.type === 'start-round')
      ? await loadTournamentEligibility(
          tx,
          direction.configuration.scope,
          direction.configuration.lobby,
        )
      : null;
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
  const apply = preparation.apply;
  if (state.participants.some((p) => !fencedActors.includes(p.actorId)))
    throw new RoomMoved('Cast changed while acquiring authority');
  if (state.changeVersion !== prepared.changeVersion)
    throw new RoomMoved('Room changed while preparing consent');
  if (
    (input.type === 'ready' || input.type === 'start-round') &&
    state.competitionType === 'ranked' &&
    state.ageRule === 'adults' &&
    !(await lockActiveLobbySeason(tx, state.lobbyId))
  )
    throw createRefusal('CONFLICT', 'ranked-unavailable');
  if (input.type === 'ready')
    await refuseIneligibleDebaters(tx, state, input.caller.actorId);
  const target = input.targetActorId
    ? await actorFact(tx, input.targetActorId, {
        lobbyId: state.lobbyId,
        readPermissions: (userId) => readGuardianLobbyIds(tx, userId),
      })
    : null;
  // FOR SHARE: a concurrent publication (FOR UPDATE on the format
  // row) serializes with this selection, so the policy judges facts
  // that hold at commit.
  const formatFacts = input.formatTuple
    ? await readFormatSelectionFacts(tx, input.formatTuple)
    : null;
  const agreements =
    input.type === 'ready'
      ? input.readyAgreements(state, {
          currentAgeBand: account?.ageBand ?? null,
          competitionAgeBand: await readGuardianWaiverAgeBand(
            tx,
            state,
            input.caller.userId,
            input.caller.actorId,
          ),
          actorId: input.caller.actorId,
        })
      : null;
  const draw = await drawFacts(tx, input.type, state);
  const grants = await readEntitlementGrants(tx, input.caller.userId);
  const contentWaiver = agreements?.contentWaiverVersion
    ? await readRoomSeatContentWaiverStanding(
        tx,
        state,
        input.caller.userId,
        agreements.contentWaiverVersion,
        agreements.guardianSigns,
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
  if (direction && tournamentEligibility) {
    const debaters = state.participants.filter(
      (person) =>
        person.kind === 'human' &&
        isDebatingSeat(person.seat) &&
        (input.type !== 'ready' || person.actorId === input.caller.actorId),
    );
    if (
      !(await tournamentDebatersAllowed(
        tx,
        direction.configuration.scope,
        tournamentEligibility,
        debaters.map(({ actorId }) => actorId),
        now,
      ))
    )
      throw createRefusal('CONFLICT', 'other-division');
  }
  const outcome = apply(
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
  if (next.competitionType === 'ranked') {
    const entering = next.participants.filter(
      (participant) =>
        outcome.mutation.freeze ||
        state.competitionType !== 'ranked' ||
        !state.participants.some(
          (before) =>
            before.actorId === participant.actorId &&
            sameSeat(before.seat, participant.seat),
        ) ||
        (input.type === 'ready' &&
          participant.actorId === input.caller.actorId),
    );
    const entrants = entering.map(({ actorId }) => actorId);
    if (
      (outcome.mutation.freeze || state.competitionType !== 'ranked') &&
      next.hostActorId
    )
      entrants.push(next.hostActorId);
    await requireRankedProtection(tx, entrants, {
      userId: input.caller.userId,
      roomId: input.roomId,
    });
  }
  // Admission, allowance and capture below all name the Round by this id.
  if (outcome.mutation.freeze && next.roundRef?.id !== input.roundId)
    throw createAppError(
      'INVARIANT',
      'A Start round names the Round its command carries',
    );
  if (outcome.mutation.freeze)
    await requireStartWaivers(tx, state, input.readyAgreements);
  const roundRef = await persistRoomMutation(
    tx,
    outcome.mutation,
    now,
    true,
    tournamentEligibility?.ageRule,
  );
  await reserveBotFreeze(
    tx,
    outcome.mutation,
    input.roundId,
    botAdmission,
    botLocked,
    input.botRelease,
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
  const apply = await input.prepare(
    prepared,
    await transactionNow(tx),
    preparationAccount,
    direction,
  );
  return { prepared, apply, row: preparationRow } as const;
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
  release: ReleaseAdmission,
) {
  const state = mutation.state;
  // The pure engine decides whether this cast seats a bot debater; admission
  // then takes both its consequences, allowance and capacity (ADR 0106).
  if (!mutation.freeze || !mutation.seatsBotDebater) return;
  if (!admission)
    throw createAppError('INFRASTRUCTURE', 'Bot admission unavailable');
  if (!locked) throw createAppError('CONFLICT', 'Bot admission not serialized');
  await admission.reserveLocked(
    tx,
    { actorId: chargedHostOf(state), roundId },
    release,
  );
}
