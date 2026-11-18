import { and, eq, ne } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import {
  leagueSchoolController,
  type LeagueSchoolCommand,
} from '@daisy/protocol/lobby/league-school-command';
import { leagueSchools } from '../schema/league-schools';
import { organizations } from '../schema/organizations';
import { scopeTransaction } from '../tenant-scope';
import { readDatabaseTime } from '../database-clock';
import { lockTabCommandAccounts } from './command-accounts';
import { loadAuthorityContext } from './authority-context';
import { appendHistory, storedCommand } from './command-record';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Input = {
  readonly senderUserId: string;
  readonly command: LeagueSchoolCommand;
  readonly newId: string;
};
const load = async (tx: TabTransaction, input: Input) => {
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  await lockTabCommandAccounts(tx, [input.senderUserId]);
  const { command } = input;
  const found = [];
  for (const id of [...new Set([command.leagueId, command.schoolId])].sort()) {
    await scopeTransaction(tx, {
      subjectUserId: input.senderUserId,
      organizationId: id,
    });
    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .for('update');
    if (organization) found.push(organization);
  }
  const league = found.find((row) => row.id === command.leagueId),
    school = found.find((row) => row.id === command.schoolId);
  if (!league || !school) return null;
  const authorityScope = {
    subjectUserId: input.senderUserId,
    organizationId: leagueSchoolController(command),
  };
  await scopeTransaction(tx, authorityScope);
  const authorization = await loadAuthorityContext(
    tx,
    authorityScope,
    input.senderUserId,
  );
  await scopeTransaction(tx, {
    subjectUserId: input.senderUserId,
    organizationId: league.id,
  });
  // The open period, if any; ended periods stay as their own rows.
  const [membership] = await tx
    .select()
    .from(leagueSchools)
    .where(
      and(
        eq(leagueSchools.leagueId, league.id),
        eq(leagueSchools.schoolId, school.id),
        ne(leagueSchools.status, 'ended'),
      ),
    )
    .for('update');
  return {
    league,
    school,
    membership: membership ?? null,
    authorization,
    newId: input.newId,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
};
export type LoadedLeagueSchoolCommand = NonNullable<
  Awaited<ReturnType<typeof load>>
>;
export type LeagueSchoolWrite = {
  readonly type: 'invite' | 'join' | 'end';
  readonly id: string;
  readonly version: number;
};
/** Account first, then both organization fences in stable order; relation, writes and journal share one transaction. */
export const createLeagueSchoolCommandStore = (database: TabDatabase) => ({
  leagueSchoolCommand: <Answer>(
    input: Input,
    work: (session: {
      readonly load: () => Promise<LoadedLeagueSchoolCommand | null>;
      readonly stored: (id: string) => ReturnType<typeof storedCommand>;
      readonly apply: (
        writes: readonly LeagueSchoolWrite[],
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      let loaded: LoadedLeagueSchoolCommand | null = null;
      return work({
        load: async () => {
          loaded = await load(tx, input);
          return loaded;
        },
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt) => {
          if (
            !loaded ||
            history.scope.kind !== 'organization' ||
            history.scope.organizationId !== loaded.league.id
          )
            throw createAppError(
              'INVARIANT',
              'League school journal scope differs',
            );
          await scopeTransaction(tx, {
            subjectUserId: input.senderUserId,
            organizationId: loaded.league.id,
          });
          const at = new Date(loaded.checkedAt);
          for (const write of writes) {
            const pair = {
              leagueId: loaded.league.id,
              schoolId: loaded.school.id,
            };
            if (write.type === 'invite') {
              // An invitation always opens a new period.
              await tx.insert(leagueSchools).values({
                id: write.id,
                ...pair,
                status: 'invited' as const,
                invitedByUserId: input.senderUserId,
                invitedAt: at,
                version: write.version,
              });
            } else {
              const value =
                write.type === 'join'
                  ? {
                      status: 'active' as const,
                      joinedByUserId: input.senderUserId,
                      joinedAt: at,
                      version: write.version,
                    }
                  : {
                      status: 'ended' as const,
                      endedByUserId: input.senderUserId,
                      endedAt: at,
                      version: write.version,
                    };
              await tx
                .update(leagueSchools)
                .set(value)
                .where(
                  and(
                    eq(leagueSchools.id, write.id),
                    eq(leagueSchools.leagueId, pair.leagueId),
                    eq(leagueSchools.schoolId, pair.schoolId),
                  ),
                );
            }
          }
          await tx
            .update(organizations)
            .set({ version: loaded.league.version + 1, updatedAt: at })
            .where(eq(organizations.id, loaded.league.id));
          await appendHistory(tx, history, receipt);
        },
      });
    }),
});
