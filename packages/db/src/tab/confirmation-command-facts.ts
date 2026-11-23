import { readFixtureWaiverRound } from './fixture-waiver-round';
import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { ConfirmationCommand } from '@daisy/protocol/lobby/confirmation-command';
import { pendingCommands, conflicts } from '../schema/conflicts';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { scopeTransaction } from '../tenant-scope';
import { readDatabaseTime } from '../database-clock';
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
import type { Tx } from '../tx';
import { takeLock, transactionLocks } from '../locks';
import { fixtureCommandEnvelopeSchema } from '@daisy/protocol/lobby/fixture-command';
import { resultCommandEnvelopeSchema } from '@daisy/protocol/lobby/result-command';
import { confirmationCommandEnvelopeSchema } from '@daisy/protocol/lobby/confirmation-command';

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
  tx: Tx,
  input: ConfirmationCommandInput,
  readTime: typeof readDatabaseTime,
) {
  for (const id of [
    ...new Set([input.commandId, input.command.pendingCommandId]),
  ].sort())
    await takeLock(tx, transactionLocks.tabCommand(id));
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
    observedRound:
      source.kind === 'waiver'
        ? await readFixtureWaiverRound(tx, context)
        : null,
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

/** Reparse the persisted original envelope; JSONB key order never becomes command identity. */
export function confirmationSource(row: typeof pendingCommands.$inferSelect) {
  const envelope = {
    version: 1,
    commandId: row.commandId,
    expected: row.expected,
    command: row.payload,
  };
  const fixture = fixtureCommandEnvelopeSchema.safeParse(envelope);
  if (fixture.success && fixture.data.command.type === row.type)
    return { kind: 'fixture' as const, envelope: fixture.data };
  const result = resultCommandEnvelopeSchema.safeParse(envelope);
  if (
    result.success &&
    'fixtureId' in result.data.command &&
    result.data.command.type === row.type
  )
    return {
      kind: 'result' as const,
      envelope: { ...result.data, command: result.data.command },
    };
  const waiver = confirmationCommandEnvelopeSchema.safeParse(envelope);
  if (
    waiver.success &&
    waiver.data.command.type === 'request-conflict-waiver' &&
    row.type === waiver.data.command.type
  )
    return {
      kind: 'waiver' as const,
      envelope: { ...waiver.data, command: waiver.data.command },
    };
  throw createAppError('INVARIANT', 'Stored confirmation source is invalid');
}
