import { entries } from '../schema/entries';
import { rooms } from '../schema/rooms';
import { loadAccountHostingFacts } from './account-hosting-facts';
import { storedCreationCommand } from './creation-replay';
import { lockTabCommandAccounts } from './command-accounts';
import { loadLobbyActivity } from './lobby-activity';
import { and, eq, ne, sql } from 'drizzle-orm';
import { lobbies, tournaments } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { seasons } from '../schema/seasons';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { appendHistory, storedCommand } from './command-record';
import { loadAuthorityContext } from './authority-context';
import { ladders } from '../schema/ladders';
import type { TabDatabase, TabTransaction } from './tab-transaction';
import { applyLobbyAdministrationWrites } from './lobby-administration-writes';

import type {
  LobbyAdministrationInput,
  LobbyAdministrationFacts,
  LobbyAdministrationSession,
} from './lobby-administration-facts';
import { actors } from '../schema/actors';
import { grants } from '../schema/grants';

const fence = async (tx: TabTransaction, input: LobbyAdministrationInput) => {
  const { command } = input;
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  await lockTabCommandAccounts(tx, [input.senderUserId]);
  if (command.type === 'create-lobby') {
    // A handle is public identity. Serialize its first writer so concurrent
    // retries can find the receipt, and competing creates answer handle-taken.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`tab-lobby-handle:${command.handle.toLowerCase()}`}, 0))`,
    );
  }
  const addressedOrganization =
    'organizationId' in command ? command.organizationId : undefined;
  const [lobby] =
    'lobbyId' in command
      ? await tx
          .select({
            id: lobbies.id,
            ownerOrganizationId: lobbies.ownerOrganizationId,
          })
          .from(lobbies)
          .where(
            and(
              eq(lobbies.id, command.lobbyId),
              addressedOrganization === undefined
                ? undefined
                : eq(lobbies.ownerOrganizationId, addressedOrganization),
            ),
          )
      : [];
  const organizationId =
    command.type === 'create-lobby' && command.owner.kind === 'organization'
      ? command.owner.organizationId
      : (addressedOrganization ?? lobby?.ownerOrganizationId);
  const [organization] = organizationId
    ? await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
    : [];
  const scope: TenantScope = {
    subjectUserId: input.senderUserId,
    organizationId: organization?.id,
    lobbyId: command.type === 'create-lobby' ? input.newId : lobby?.id,
  };
  await scopeTransaction(tx, scope);
  return scope;
};

const load = async (
  tx: TabTransaction,
  input: LobbyAdministrationInput,
  initialScope: TenantScope,
): Promise<LobbyAdministrationFacts> => {
  const { command } = input;
  let scope = initialScope;
  // Seasons are organization-fenced. A close names only its id, so find it
  // through the sender's memberships/owned organizations, never a guessed scope.
  if (command.type === 'close-season') {
    const owned = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.ownerUserId, input.senderUserId));
    const held = await tx
      .select({ organizationId: grants.organizationId })
      .from(grants)
      .where(eq(grants.userId, input.senderUserId));
    for (const organizationId of [
      ...new Set([
        ...owned.map((row) => row.id),
        ...held.flatMap((row) =>
          row.organizationId === null ? [] : [row.organizationId],
        ),
      ]),
    ].sort()) {
      await scopeTransaction(tx, { ...initialScope, organizationId });
      const [found] = await tx
        .select({ id: seasons.id, lobbyId: seasons.lobbyId })
        .from(seasons)
        .where(
          and(
            eq(seasons.id, command.seasonId),
            eq(seasons.organizationId, organizationId),
          ),
        );
      if (found) {
        scope = { ...initialScope, organizationId, lobbyId: found.lobbyId };
        break;
      }
    }
    await scopeTransaction(tx, scope);
  }
  const authorization = await loadAuthorityContext(
    tx,
    scope,
    input.senderUserId,
  );
  const organization = authorization.organization;
  const [row] =
    scope.lobbyId && command.type !== 'create-lobby'
      ? await tx
          .select()
          .from(lobbies)
          .where(eq(lobbies.id, scope.lobbyId))
          .for('update')
      : [];
  const [schedule] =
    row?.kind === 'tournament'
      ? await tx
          .select()
          .from(tournaments)
          .where(eq(tournaments.lobbyId, row.id))
      : [];
  const [owner] = row?.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, row.ownerUserId))
    : [];
  const [season] =
    'seasonId' in command
      ? await tx
          .select()
          .from(seasons)
          .where(
            and(
              eq(seasons.id, command.seasonId),
              eq(seasons.lobbyId, row?.id ?? ''),
              eq(seasons.organizationId, scope.organizationId ?? ''),
            ),
          )
          .for('update')
      : [];
  const [active] =
    row && organization
      ? await tx
          .select({ id: seasons.id })
          .from(seasons)
          .where(and(eq(seasons.lobbyId, row.id), eq(seasons.status, 'active')))
      : [];
  const [ladder] = row
    ? await tx
        .select({ id: ladders.id })
        .from(ladders)
        .where(
          and(
            eq(ladders.lobbyId, row.id),
            command.type === 'save-ladder' && command.ladderId !== null
              ? eq(ladders.id, command.ladderId)
              : undefined,
          ),
        )
        .limit(1)
    : [];
  const [referencedRoom] = ladder
    ? await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(eq(rooms.leagueLadderId, ladder.id))
        .limit(1)
    : [];
  const [taken] =
    command.type === 'create-lobby'
      ? await tx
          .select({ id: lobbies.id })
          .from(lobbies)
          .where(
            and(
              sql`lower(${lobbies.handle}) = lower(${command.handle})`,
              ne(lobbies.id, input.newId),
            ),
          )
      : [];
  const parentId =
    command.type === 'create-lobby' &&
    command.lobby.kind === 'tournament' &&
    command.lobby.eligibility.kind === 'standing'
      ? command.lobby.eligibility.lobbyId
      : null;
  if (parentId && scope.organizationId)
    await scopeTransaction(tx, { ...scope, lobbyId: parentId });
  const [standingParent] =
    parentId && scope.organizationId
      ? await tx
          .select({
            id: lobbies.id,
            ownerOrganizationId: lobbies.ownerOrganizationId,
            closedAt: lobbies.closedAt,
          })
          .from(lobbies)
          .where(
            and(
              eq(lobbies.id, parentId),
              eq(lobbies.kind, 'standing'),
              eq(lobbies.ownerOrganizationId, scope.organizationId),
            ),
          )
          .for('share')
      : [];
  if (parentId && scope.organizationId) await scopeTransaction(tx, scope);
  const [registeredEntry] =
    command.type === 'update-lobby' && command.ageRule !== undefined && row
      ? await tx
          .select({ id: entries.id })
          .from(entries)
          .where(
            and(eq(entries.lobbyId, row.id), ne(entries.status, 'withdrawn')),
          )
          .limit(1)
      : [];
  const activity = await loadLobbyActivity(tx, row?.id ?? null);
  const hosting = await loadAccountHostingFacts(tx, input.senderUserId);
  return {
    hosting,
    organization: authorization,
    lobby: row
      ? {
          id: row.id,
          kind: row.kind,
          ownerUserId: row.ownerUserId,
          ownerActorId: owner?.id ?? null,
          ownerOrganizationId: row.ownerOrganizationId,
          closedAt: row.closedAt?.toISOString() ?? null,
          version: row.version,
          status: schedule?.status ?? 'draft',
        }
      : null,
    season: season
      ? {
          id: season.id,
          organizationId: season.organizationId,
          status: season.status as 'active' | 'closed',
          startsAt: season.startsAt.toISOString(),
          version: season.version,
        }
      : null,
    activeSeasonId: active?.id ?? null,
    ladder: ladder ? { ...ladder, inUse: referencedRoom !== undefined } : null,
    handleTaken: taken !== undefined,
    ageRuleLocked: registeredEntry !== undefined,
    standingParent: standingParent ?? null,
    activity,
    scope,
  };
};

export const createLobbyAdministrationStore = (database: TabDatabase) => ({
  lobbyAdministrationCommand: <Answer>(
    input: LobbyAdministrationInput,
    work: (session: LobbyAdministrationSession) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      const scope = await fence(tx, input);
      return work({
        stored: (id) => replayRecord(tx, input, scope, id),
        load: () => load(tx, input, scope),
        apply: async (writes, history, receipt) => {
          await applyLobbyAdministrationWrites(tx, writes);
          await appendHistory(tx, history, receipt);
        },
      });
    }),
});

const replayRecord = async (
  tx: TabTransaction,
  input: LobbyAdministrationInput,
  scope: TenantScope,
  commandId: string,
) => {
  if (input.command.type !== 'create-lobby')
    return storedCommand(tx, commandId);
  const [existing] = await tx
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(sql`lower(${lobbies.handle}) = lower(${input.command.handle})`);
  if (!existing) return storedCommand(tx, commandId);
  return storedCreationCommand(
    tx,
    scope,
    { ...scope, lobbyId: existing.id },
    commandId,
  );
};
