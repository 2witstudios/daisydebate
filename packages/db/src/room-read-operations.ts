import { discoverRooms, type RoomDiscoveryFact } from './room-discovery';
import type { roomCommandTransaction } from './room-command-transaction';
import {
  roomListQuerySchema,
  type RoomListQuery,
  type RoomListPage,
} from '@daisy/protocol';
import { and, asc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { unresolvedAttendance } from './attendance-settlement';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import { judgingJobCanRule } from './round-judging-end';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type {
  LaunchedRound,
  RoundView,
  RoomAssemblyState,
  RoomCommandReceipt,
  RoundWaitingFacts,
  RoundWaitingOn,
} from '@daisy/protocol';

import { createAppError } from '@daisy/errors';
import { botDifficulties } from '@daisy/protocol';

import { instrumented, type DatabaseEventSink } from './instrumented';
import { actors } from './schema/actors';

import { botProfiles } from './schema/bot-profiles';
import { aiJudgeProfiles } from './schema/ai-judge-profiles';

import { rooms } from './schema/rooms';
import { rounds } from './schema/rounds';
import { segmentRows } from './round-hydration';
import { recordedPanelRuling } from './round-panel-decisions';
import { roundCommands } from './schema/round-commands';
import { readableCheckpoint, roundViewFor } from './round-view-projection';
import { roundParticipants } from './schema/round-participants';
import { formats } from './schema/formats';
import { formatRevisions } from './schema/format-revisions';

import { formatPresets } from './schema/format-presets';

import {
  type Caller,
  type Account,
  type AuthorizeRoom,
  type Actor,
  lockedAccount,
  sharedAccount,
  requireAccount,
  actorFact,
  roomFacts,
  lockCommand,
  replayReceipt,
} from './room-command-facts';
import { roundResolutionAudit } from './room-draw-persistence';
/** Facts only: the injected engine decision says what they mean. */
async function readWaitingFacts(
  tx: Pick<BunSQLDatabase, 'execute'>,
  round: Pick<LaunchedRound, 'id' | 'participants'>,
): Promise<RoundWaitingFacts> {
  const [facts] = (await tx.execute(sql`select
    clock_timestamp()::text as now,
    r.final_segment_ended_at is not null as ended,
    to_char(r.ballot_deadline_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "ballotDeadlineAt",
    to_char(r.attendance_resolution_cutoff_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "attendanceCutoffAt",
    exists(select 1 from round_transcript_freezes where round_id=r.id) as frozen,
    exists(select 1 from round_check_in_attempts where round_id=r.id and state='pending') as held,
    ${unresolvedAttendance(sql`r.id`, sql`clock_timestamp()`)} as unresolved,
    coalesce((select json_agg(judge_participant_id) from ballots where round_id=r.id and status='submitted'),'[]'::json) as ruled,
    coalesce((select json_agg(json_build_object(
      'generationDeadlineAt',to_char(generation_deadline_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'canRule',${judgingJobCanRule},
      'holdsBallot',pending_ballot is not null)) from round_judging_jobs where round_id=r.id and status<>'succeeded'),'[]'::json) as jobs
    from rounds r where r.id=${round.id}`)) as unknown as {
    now: string;
    ended: boolean;
    ballotDeadlineAt: string | null;
    attendanceCutoffAt: string | null;
    frozen: boolean;
    held: boolean;
    unresolved: boolean;
    ruled: readonly string[];
    jobs: RoundWaitingFacts['jobs'];
  }[];
  return {
    nowMs: Date.parse(facts!.now),
    finalSegmentEnded: facts!.ended,
    frozen: facts!.frozen,
    heldByWriter: facts!.held,
    attendanceUnresolved: facts!.unresolved,
    ballotDeadlineAt: facts!.ballotDeadlineAt,
    attendanceCutoffAt: facts!.attendanceCutoffAt,
    humanJudgeUnruled: round.participants.some(
      (seat) =>
        seat.role === 'judge' &&
        seat.kind === 'human' &&
        !facts!.ruled.includes(seat.id),
    ),
    jobs: facts!.jobs,
  };
}
export async function launchedRoundRows(
  tx: Pick<BunSQLDatabase, 'select'>,
  roundId: string,
): Promise<LaunchedRound> {
  const [row] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('share');
  if (!row || !row.roomId || !row.roomConfigSnapshot || !row.visibility)
    throw createAppError('NOT_FOUND');
  const seats = await tx
    .select()
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, roundId));
  const participants = await Promise.all(
    seats.map(async (p) => {
      const actor = await actorFact(tx, p.actorId);
      if (!actor) throw createAppError('INVARIANT');
      return {
        id: p.id,
        actorId: actor.actorId,
        kind: actor.kind,
        label: actor.label,
        role: p.role,
        slot: p.slot,
      };
    }),
  );
  const round: LaunchedRound = {
    id: row.id,
    roomId: row.roomId,
    version: row.version,
    status: row.status,
    competitionType: row.competitionType,
    ladderId: row.ladderId,
    topic: row.resolution,
    visibility: row.visibility,
    hostActorId: row.createdByActorId,
    config: row.roomConfigSnapshot,
    rules: row.rulesSnapshot,
    participants,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    outcome: row.outcome,
    panelRuling: recordedPanelRuling(
      await tx
        .select()
        .from(roundCommands)
        .where(
          and(
            eq(roundCommands.roundId, roundId),
            eq(roundCommands.type, 'complete'),
          ),
        ),
    ),
    waitingOn: null,
    transcriptCompleteness:
      (
        await tx
          .select({ completeness: roundTranscriptFreezes.completeness })
          .from(roundTranscriptFreezes)
          .where(eq(roundTranscriptFreezes.roundId, roundId))
      )[0]?.completeness ?? null,
    resolutionAudit: await roundResolutionAudit(tx, row),
    checkpoint: readableCheckpoint(row.runtimeState),
    segments: await segmentRows(tx, roundId),
  };
  return round;
}
export const roomReadOperations = ({
  database,
  eventSink,
  commandTransaction,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly commandTransaction: ReturnType<typeof roomCommandTransaction>;
}) => ({
  async readLaunchedRound(
    roundId: string,
    caller: Caller,
    authorize: (round: LaunchedRound, account: Account) => boolean,
    /** The engine's decision, injected; only the live room's reads ask for it. */
    decideWaitingOn?: (facts: RoundWaitingFacts) => RoundWaitingOn | null,
  ): Promise<RoundView> {
    return instrumented(eventSink, 'readLaunchedRound', () =>
      database.transaction(async (tx) => {
        const account = await sharedAccount(tx, caller);
        const round = await launchedRoundRows(tx, roundId);
        if (!authorize(round, account)) throw createAppError('NOT_FOUND');
        const waitingOn =
          decideWaitingOn && round.status === 'active'
            ? decideWaitingOn(await readWaitingFacts(tx, round))
            : null;
        return roundViewFor({ ...round, waitingOn }, caller.actorId);
      }),
    );
  },
  /**
   * The picker's catalog (FMT-1): every format with a catalog role, at its
   * current revision and canonical (current) preset. A listed format with
   * no current preset is corruption the publication trigger forbids, so the
   * read refuses rather than inventing a config.
   */
  async listRoomCatalogSources(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ) {
    return instrumented(eventSink, 'listRoomCatalogSources', () =>
      database.transaction(async (tx) => {
        await requireAccount(tx, caller, authorize);
        const rows = await tx
          .select({
            id: formats.id,
            name: formats.name,
            version: formats.currentVersion,
            role: formats.catalogRole,
            family: formats.family,
            leagues: formats.leagues,
            searchTerms: formats.searchTerms,
            sortOrder: formats.sortOrder,
            definition: formatRevisions.definition,
            rulesEdition: formatRevisions.rulesEdition,
            sourceUrl: formatRevisions.sourceUrl,
          })
          .from(formats)
          .innerJoin(
            formatRevisions,
            and(
              eq(formatRevisions.formatId, formats.id),
              eq(formatRevisions.version, formats.currentVersion),
            ),
          )
          .where(isNotNull(formats.catalogRole))
          .orderBy(asc(formats.sortOrder), asc(formats.id));
        const presets = await tx
          .select({
            formatId: formatPresets.formatId,
            version: formatPresets.version,
            formatVersion: formatPresets.formatVersion,
            config: formatPresets.config,
            rankedEligible: formatPresets.rankedEligible,
          })
          .from(formatPresets)
          .where(isNull(formatPresets.supersededAt));
        return rows.map(({ role, ...row }) => {
          const preset = presets.find(
            (p) => p.formatId === row.id && p.formatVersion === row.version,
          );
          if (!role || !preset)
            throw createAppError(
              'INVARIANT',
              `Catalog format ${row.id} has no current preset`,
            );
          return { ...row, role, preset };
        });
      }),
    );
  },
  async readRoomAssembly(
    roomId: string,
    caller: Caller,
    authorize: AuthorizeRoom,
  ): Promise<RoomAssemblyState> {
    return (await this.readRoomAssemblyFacts(roomId, caller, authorize)).state;
  },
  /** The Room and its draw seed in one read; the seed settles projections and never leaves the server. */
  async readRoomAssemblyFacts(
    roomId: string,
    caller: Caller,
    authorize: AuthorizeRoom,
  ): Promise<{
    readonly state: RoomAssemblyState;
    readonly drawSeed: string | null;
  }> {
    return instrumented(eventSink, 'readRoomAssembly', () =>
      database.transaction(async (tx) => {
        const account = await sharedAccount(tx, caller);
        const [row] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .for('share');
        if (!row) throw createAppError('NOT_FOUND');
        const facts = await roomFacts(tx, row);
        if (!authorize(facts.state, account)) throw createAppError('NOT_FOUND');
        return facts;
      }),
    );
  },
  async listRoomPage(
    caller: Caller,
    query: RoomListQuery,
    authorize: (fact: RoomDiscoveryFact, account: Account) => boolean,
    authorizeCollection: (account: Account) => boolean,
    hostHidden: (fact: RoomDiscoveryFact) => boolean,
  ): Promise<RoomListPage> {
    if (!roomListQuerySchema.safeParse(query).success)
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'listRoomPage', () =>
      database.transaction((tx) =>
        discoverRooms(
          tx,
          caller,
          query,
          authorize,
          authorizeCollection,
          hostHidden,
        ),
      ),
    );
  },
  /** Every AI actor a host may seat: bot debaters and the AI judge, each with its seat role (ISSUE-750). */
  async listRoomBots(
    caller: Caller,
    authorize: (account: Account) => boolean,
  ): Promise<readonly Actor[]> {
    return instrumented(eventSink, 'listRoomBots', () =>
      database.transaction(async (tx) => {
        await requireAccount(tx, caller, authorize);
        const rows = await tx
          .select({
            id: actors.id,
            persona: botProfiles.persona,
            difficulty: botProfiles.difficulty,
          })
          .from(actors)
          .leftJoin(botProfiles, eq(botProfiles.actorId, actors.id))
          .leftJoin(aiJudgeProfiles, eq(aiJudgeProfiles.actorId, actors.id))
          .where(
            and(
              eq(actors.kind, 'bot'),
              or(
                isNotNull(botProfiles.actorId),
                isNotNull(aiJudgeProfiles.actorId),
              ),
            ),
          );
        const bots = await Promise.all(
          rows.map(async (row) => {
            const bot = await actorFact(tx, row.id);
            // The AI judge carries no roster card: persona and difficulty
            // belong to the debater profiles alone (ISSUE-750).
            return bot && row.persona && row.difficulty
              ? {
                  ...bot,
                  persona: row.persona,
                  difficulty:
                    row.difficulty as (typeof botDifficulties)[number],
                }
              : bot;
          }),
        );
        return bots.filter((bot): bot is Actor => bot !== null);
      }),
    );
  },
  async readRoomCreateReceipt(input: {
    readonly caller: Caller;
    readonly commandId: string;
    readonly payloadDigest: string;
    readonly authorize: (account: Account) => boolean;
  }): Promise<RoomCommandReceipt | null> {
    return instrumented(eventSink, 'readRoomCreateReceipt', () =>
      commandTransaction(async (tx) => {
        await lockCommand(tx, input.commandId);
        const account = await lockedAccount(tx, input.caller);
        if (!input.authorize(account)) throw createAppError('AUTHORIZATION');
        return replayReceipt(
          tx,
          input.commandId,
          input.caller.actorId,
          input.payloadDigest,
        );
      }),
    );
  },
});
