import { readAuthorizedRound } from './round-read-authority';
import { roundOutcomeForAudience } from './round-outcome-audience';
import type { RoundRoomAuthority } from './round-room-authority';
import { loadRoomDirection } from './tab/room-direction';
import { fenceTabAccountRead } from './tab/account-read-fence';
import {
  currentRoomTopic,
  withOpening,
  type ReadOpening,
  type ReadOpeningTopic,
} from './round-opening-read';
import { discoverRooms, type RoomDiscoveryFact } from './room-discovery';
import type { SpectatorClock } from './spectator-release-sql';
import type { roomCommandTransaction } from './room-command-transaction';
import type { CasualJudgeAdmission } from './casual-judge-admission';
import type { AllowanceDecision } from '@daisy/protocol/billing';
import { readEntitlementGrants } from './entitlement-grants';
import {
  roomListQuerySchema,
  type RoomListQuery,
  type RoomListPage,
} from '@daisy/protocol';
import { and, asc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { readWaitingOn } from './round-waiting-read';
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
import { roundViewFor } from './round-view-projection';
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
  transactionNow,
} from './room-command-facts';
export const roomReadOperations = ({
  database,
  eventSink,
  commandTransaction,
  judgeAdmission,
}: {
  readonly database: BunSQLDatabase;
  readonly judgeAdmission?: CasualJudgeAdmission | undefined;
  readonly eventSink?: DatabaseEventSink | undefined;
  readonly commandTransaction: ReturnType<typeof roomCommandTransaction>;
}) => ({
  async readLaunchedRound(
    roundId: string,
    caller: Caller,
    authorize: (
      round: LaunchedRound,
      account: Account,
      owner: RoundRoomAuthority,
    ) => boolean,
    readOpening: ReadOpening,
    /** The engine's decision, injected. Required: no read may report a played Round as waiting on nothing. */
    decideWaitingOn: (facts: RoundWaitingFacts) => RoundWaitingOn | null,
    readEventDecision: (owner: RoundRoomAuthority) => boolean,
  ): Promise<RoundView> {
    return instrumented(eventSink, 'readLaunchedRound', () =>
      database.transaction(async (tx) => {
        const { round, account, owner } = await readAuthorizedRound(tx, {
          roundId,
          caller,
          authorize,
        });
        return withOpening(
          tx,
          round,
          {
            ...roundOutcomeForAudience(
              roundViewFor(round, caller.actorId),
              owner,
              readEventDecision(owner),
            ),
            waitingOn: await readWaitingOn(tx, round, decideWaitingOn),
          },
          { actorId: caller.actorId, account },
          readOpening,
        );
      }),
    );
  },
  /** Whether the picker's catalog offers this format: a read for another concept. */
  async formatInCatalog(formatId: string): Promise<boolean> {
    return instrumented(eventSink, 'formatInCatalog', async () => {
      const [row] = await database
        .select({ id: formats.id })
        .from(formats)
        .where(and(eq(formats.id, formatId), isNotNull(formats.catalogRole)));
      return row !== undefined;
    });
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
    readTopic: ReadOpeningTopic,
  ): Promise<RoomAssemblyState> {
    return (
      await this.readRoomAssemblyFacts(roomId, caller, authorize, readTopic)
    ).state;
  },
  /** The Room and its draw seed in one read; the seed settles projections and never leaves the server. */
  async readRoomAssemblyFacts(
    roomId: string,
    caller: Caller,
    authorize: AuthorizeRoom,
    readTopic: ReadOpeningTopic,
  ): Promise<{ readonly state: RoomAssemblyState }> {
    return instrumented(eventSink, 'readRoomAssembly', () =>
      database.transaction(async (tx) => {
        const account = await sharedAccount(tx, caller);
        const [found] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, roomId));
        if (!found) throw createAppError('NOT_FOUND');
        if (found.hostActorId === null)
          await fenceTabAccountRead(tx, caller.userId);
        const direction = await loadRoomDirection(tx, {
          room: found,
          userId: caller.userId,
        });
        const [row] = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .for('share');
        if (!row) throw createAppError('NOT_FOUND');
        const facts = await roomFacts(tx, row);
        if (
          !authorize(facts.state, account, direction, await transactionNow(tx))
        )
          throw createAppError('NOT_FOUND');
        return {
          state: {
            ...facts.state,
            topic: await currentRoomTopic(tx, facts.state, readTopic),
          },
        };
      }),
    );
  },
  async listRoomPage(
    caller: Caller,
    query: RoomListQuery,
    authorize: (fact: RoomDiscoveryFact, account: Account) => boolean,
    authorizeCollection: (account: Account) => boolean,
    hostHidden: (fact: RoomDiscoveryFact) => boolean,
    clock: SpectatorClock,
    readTopic: ReadOpeningTopic,
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
          clock,
          readTopic,
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
  /** Display preview only; every mutation rereads the same policy under its fence. */
  async readOwnCasualJudgeAllowance(
    caller: Caller,
    withBot: boolean,
  ): Promise<AllowanceDecision> {
    return instrumented(eventSink, 'readOwnCasualJudgeAllowance', () =>
      database.transaction(async (tx) => {
        const account = await sharedAccount(tx, caller);
        if (!judgeAdmission) return { kind: 'refuse', reason: 'not-eligible' };
        return (
          await judgeAdmission.quoteLocked(tx, {
            account,
            roundId: null,
            withBot,
          })
        ).decision;
      }),
    );
  },
  /** The caller's own grants, for display; every seat command rereads them under its fence. */
  async readOwnEntitlementGrants(caller: Caller) {
    return instrumented(eventSink, 'readOwnEntitlementGrants', () =>
      readEntitlementGrants(database, caller.userId),
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
