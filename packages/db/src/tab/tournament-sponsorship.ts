import { and, desc, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  tournamentSponsorshipVersionSchema,
  type TournamentSponsorshipVersion,
  type TournamentSponsorshipChange,
} from '@daisy/protocol';
import type { TournamentSponsorshipCommand } from '@daisy/protocol/lobby/sponsorship-command';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import { tournamentSponsorshipVersions } from '../schema/tournament-sponsorships';
import { scopeTransaction } from '../tenant-scope';
import { readDatabaseTime } from '../database-clock';
import { retryStale } from '../retry-stale';
import { loadAuthorizationAccount } from '../authorization';
import { lockTabCommandAccounts } from './command-accounts';
import { loadAuthorityContext } from './authority-context';
import { loadAccountHostingFacts } from './account-hosting-facts';
import { appendHistory, storedCommand } from './command-record';
import { inTransaction, type Tx, type TxOpener } from '../tx';

export const currentTournamentSponsorship = async (
  tx: Tx,
  lobbyId: string,
): Promise<TournamentSponsorshipVersion | null> => {
  const [row] = await tx
    .select()
    .from(tournamentSponsorshipVersions)
    .where(eq(tournamentSponsorshipVersions.lobbyId, lobbyId))
    .orderBy(desc(tournamentSponsorshipVersions.version))
    .limit(1);
  if (!row) return null;
  const common = {
    id: row.id,
    lobbyId: row.lobbyId,
    version: row.version,
    sponsorUserId: row.sponsorUserId,
    actedByUserId: row.actedByUserId,
    authority: row.authority,
    actedAt: row.createdAt.toISOString(),
    previousVersionId: row.previousVersionId,
  };
  return tournamentSponsorshipVersionSchema.parse(
    row.kind === 'active'
      ? { ...common, kind: row.kind, hostingVersionId: row.hostingVersionId }
      : row.kind === 'revoked'
        ? { ...common, kind: row.kind, reason: row.reason }
        : { ...common, kind: row.kind },
  );
};
class SponsorshipChanged extends Error {}
const load = async (
  tx: Tx,
  input: {
    readonly senderUserId: string;
    readonly command: TournamentSponsorshipCommand;
  },
) => {
  const lobbyId = input.command.lobbyId;
  await scopeTransaction(tx, { subjectUserId: input.senderUserId, lobbyId });
  const initial = await currentTournamentSponsorship(tx, lobbyId);
  const proposedUserId =
    input.command.type === 'propose-tournament-sponsorship'
      ? input.command.sponsorUserId
      : null;
  await lockTabCommandAccounts(tx, [
    input.senderUserId,
    ...(initial ? [initial.sponsorUserId] : []),
    ...(proposedUserId ? [proposedUserId] : []),
  ]);
  const [address] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, lobbyId));
  if (!address || address.kind !== 'tournament' || !address.ownerOrganizationId)
    return null;
  const scope = {
    subjectUserId: input.senderUserId,
    lobbyId,
    organizationId: address.ownerOrganizationId,
  };
  await scopeTransaction(tx, scope);
  const authorization = await loadAuthorityContext(
    tx,
    scope,
    input.senderUserId,
  );
  const [lobby] = await tx
    .select()
    .from(lobbies)
    .where(
      and(
        eq(lobbies.id, lobbyId),
        eq(lobbies.ownerOrganizationId, address.ownerOrganizationId),
      ),
    )
    .for('update');
  if (!lobby) return null;
  const current = await currentTournamentSponsorship(tx, lobbyId);
  if (current?.id !== initial?.id) throw new SponsorshipChanged();
  const sponsorUserId = proposedUserId ?? current?.sponsorUserId ?? null;
  const [sponsor] = sponsorUserId
    ? await tx
        .select({ actorId: actors.id })
        .from(actors)
        .where(eq(actors.userId, sponsorUserId))
    : [];
  const account = proposedUserId
    ? await loadAuthorizationAccount(tx, proposedUserId)
    : null;
  const hosting = await loadAccountHostingFacts(tx, input.senderUserId);
  return {
    authorization,
    current,
    sponsorActorId: sponsor?.actorId ?? null,
    hosting,
    lobby: {
      id: lobby.id,
      version: lobby.version,
      ownerOrganizationId: lobby.ownerOrganizationId,
      closedAt: lobby.closedAt?.toISOString() ?? null,
    },
    proposedAccountExists:
      account !== null &&
      account.member &&
      !account.erased &&
      account.ageBand === 'adult' &&
      !account.restricted,
    now: (await readDatabaseTime(tx)).toISOString(),
  };
};
export type LoadedTournamentSponsorship = NonNullable<
  Awaited<ReturnType<typeof load>>
>;
// Persist only a parsed complete version; authority comes from the actual accepted command journal.
export type TournamentSponsorshipWrite = {
  readonly sponsorship: TournamentSponsorshipChange;
  readonly lobbyVersion: number;
};
export const createTournamentSponsorshipStore = (database: TxOpener) => ({
  tournamentSponsorshipCommand: <Answer>(
    input: Parameters<typeof load>[1],
    work: (session: {
      readonly load: () => Promise<LoadedTournamentSponsorship | null>;
      readonly stored: (id: string) => ReturnType<typeof storedCommand>;
      readonly apply: (
        writes: readonly TournamentSponsorshipWrite[],
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    retryStale(
      () =>
        inTransaction(database, async (tx) =>
          work({
            load: () => load(tx, input),
            stored: (id) => storedCommand(tx, id),
            apply: async (writes, history, receipt) => {
              for (const write of writes) {
                const row = tournamentSponsorshipVersionSchema.parse({
                  ...write.sponsorship,
                  authority: history.authority,
                });
                await tx.insert(tournamentSponsorshipVersions).values({
                  id: row.id,
                  lobbyId: row.lobbyId,
                  version: row.version,
                  kind: row.kind,
                  sponsorUserId: row.sponsorUserId,
                  actedByUserId: row.actedByUserId,
                  authority: row.authority,
                  previousVersionId: row.previousVersionId,
                  hostingVersionId:
                    row.kind === 'active' ? row.hostingVersionId : null,
                  reason: row.kind === 'revoked' ? row.reason : null,
                  createdAt: new Date(row.actedAt),
                });
                const changed = await tx
                  .update(lobbies)
                  .set({ version: write.lobbyVersion })
                  .where(
                    and(
                      eq(lobbies.id, row.lobbyId),
                      eq(lobbies.version, write.lobbyVersion - 1),
                    ),
                  )
                  .returning({ id: lobbies.id });
                if (changed.length !== 1) throw createAppError('CONFLICT');
              }
              await appendHistory(tx, history, receipt);
            },
          }),
        ),
      (error) => error instanceof SponsorshipChanged,
      3,
      () => createAppError('CONFLICT'),
    ),
});
