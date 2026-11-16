import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { ConfirmationCommand } from '@daisy/protocol/lobby/confirmation-command';
import { pendingCommands, conflicts } from '../schema/conflicts';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { scopeTransaction } from '../tenant-scope';
import { readDatabaseTime } from '../database-clock';
import { confirmationSource } from './confirmation-source';
import { fixtureCommandPeople } from './fixture-command-people';
import { lockTabCommandAccounts } from './command-accounts';
import { lockFixtureCommandContext } from './fixture-command-context';
import { readFixtureCompetitionFacts } from './fixture-competition-facts';
import {
  loadFixtureCommandFacts,
  fixtureCommandJudgeIds,
} from './fixture-command-facts';
import { loadAuthorityContext } from './authority-context';
import { fixtureConnections } from './fixture-conflict';
import type { TabTransaction } from './tab-transaction';

export type ConfirmationCommandInput = {
  readonly senderUserId: string;
  readonly lobbyId: string;
  readonly commandId: string;
  readonly command: Exclude<
    ConfirmationCommand,
    { readonly type: 'request-conflict-waiver' }
  >;
};
/** Current principals and the actual original source share account-before-parent-before-pending fences. */
export async function loadConfirmationCommandFacts(
  tx: TabTransaction,
  input: ConfirmationCommandInput,
  readTime: typeof readDatabaseTime,
) {
  for (const id of [
    ...new Set([input.commandId, input.command.pendingCommandId]),
  ].sort())
    await tx.execute(sql`select pg_advisory_xact_lock(59002,hashtext(${id}))`);
  await scopeTransaction(tx, {
    subjectUserId: input.senderUserId,
    lobbyId: input.lobbyId,
  });
  const [address] = await tx
    .select()
    .from(pendingCommands)
    .where(
      and(
        eq(pendingCommands.commandId, input.command.pendingCommandId),
        eq(pendingCommands.lobbyId, input.lobbyId),
      ),
    );
  if (!address) return null;
  const source = confirmationSource(address);
  const command = source.envelope.command;
  const roundSource =
    source.kind === 'result' && command.type === 'correct-result'
      ? ('retained-result' as const)
      : ('current-round' as const);
  const locator = {
    lobbyId: input.lobbyId,
    fixtureId: command.fixtureId,
    namedJudgeIds:
      source.kind === 'fixture'
        ? fixtureCommandJudgeIds(source.envelope.command)
        : [],
    roundSource,
  };
  const people = await fixtureCommandPeople(tx, locator);
  await lockTabCommandAccounts(tx, [
    input.senderUserId,
    address.proposerUserId,
    ...people.flatMap((person) => (person.userId ? [person.userId] : [])),
  ]);
  const context = await lockFixtureCommandContext(tx, {
    ...locator,
    senderUserId: address.proposerUserId,
  });
  if (!context) return null;
  const original =
    source.kind === 'fixture'
      ? {
          kind: 'fixture' as const,
          envelope: source.envelope,
          facts: await loadFixtureCommandFacts(tx, {
            senderUserId: address.proposerUserId,
            lobbyId: input.lobbyId,
            commandId: address.commandId,
            command: source.envelope.command,
          }),
        }
      : source.kind === 'result'
        ? {
            kind: 'result' as const,
            envelope: source.envelope,
            facts: await readFixtureCompetitionFacts(
              tx,
              context,
              address.proposerUserId,
            ),
          }
        : {
            kind: 'waiver' as const,
            envelope: source.envelope,
            facts: await readFixtureCompetitionFacts(
              tx,
              context,
              address.proposerUserId,
            ),
          };
  if (!original.facts) return null;
  const [pending] = await tx
    .select()
    .from(pendingCommands)
    .where(
      and(
        eq(pendingCommands.commandId, address.commandId),
        eq(pendingCommands.lobbyId, input.lobbyId),
      ),
    )
    .for('update');
  if (
    !pending ||
    pending.proposerUserId !== address.proposerUserId ||
    pending.payloadDigest !== address.payloadDigest
  )
    throw createAppError('CONFLICT');
  const [proposer] = await tx
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, pending.proposerUserId));
  const [proposerActor] = await tx
    .select({ id: actors.id })
    .from(actors)
    .where(eq(actors.userId, pending.proposerUserId));
  if (!proposer || !proposerActor) return null;
  const [conflict] = await tx
    .select()
    .from(conflicts)
    .where(
      and(
        eq(conflicts.id, pending.conflictId),
        eq(conflicts.lobbyId, input.lobbyId),
      ),
    );
  if (
    !conflict ||
    conflict.fixtureId !== context.fixture.id ||
    conflict.userId !== pending.proposerUserId
  )
    throw createAppError('INVARIANT');
  const settlerScope = {
    ...context.configuration.scope,
    subjectUserId: input.senderUserId,
  };
  await scopeTransaction(tx, settlerScope);
  const authorization = await loadAuthorityContext(
    tx,
    settlerScope,
    input.senderUserId,
    'share',
  );
  const connections = await fixtureConnections(tx, {
    fixtureId: context.fixture.id,
    roomId: context.fixture.roomId,
    userId: input.senderUserId,
  });
  const waivers = await tx
    .select()
    .from(conflicts)
    .where(
      and(
        eq(conflicts.fixtureId, context.fixture.id),
        eq(conflicts.lobbyId, input.lobbyId),
        eq(conflicts.userId, pending.proposerUserId),
      ),
    );
  const now = (await readTime(tx)).toISOString();
  return {
    context,
    original,
    pending,
    proposer,
    proposerActorId: proposerActor.id,
    conflict,
    waivers,
    authorization,
    connections,
    checkedAt: now,
  };
}
export type LoadedConfirmationCommand = NonNullable<
  Awaited<ReturnType<typeof loadConfirmationCommandFacts>>
>;
