import { confirmationDeadline } from '@daisy/protocol/lobby/confirmation-command';
import { createAppError } from '@daisy/errors';
import { readDatabaseTime } from '../database-clock';
import { jsonObjectSchema } from '../schema/columns';
import { CommandIdTaken, storedCommand } from './command-record';
import { isUniqueViolationOf } from '../driver-failure';
import { and, eq } from 'drizzle-orm';
import type {
  ConflictConnection,
  ConflictHandling,
} from '@daisy/protocol/authorization';
import type { CommandExpected } from '@daisy/protocol/lobby/command';
import { conflicts, pendingCommands } from '../schema/conflicts';
import type { Tx } from '../tx';

export const recordFixtureConflict = async (
  tx: Tx,
  input: {
    readonly fixtureId: string;
    readonly lobbyId: string;
    readonly userId: string;
    readonly now: string;
    readonly newId: () => string;
    readonly conflict: {
      readonly connections: readonly ConflictConnection[];
      readonly handling: ConflictHandling;
    };
  },
) => {
  const rows = input.conflict.connections.map((basis) => ({
    id: input.newId(),
    fixtureId: input.fixtureId,
    lobbyId: input.lobbyId,
    userId: input.userId,
    basis,
    handling: input.conflict.handling,
    detectedAt: new Date(input.now),
  }));
  await tx.insert(conflicts).values(rows);
  return rows[0]!.id;
};
export const holdFixtureCommand = async (
  tx: Tx,
  input: {
    readonly lobbyId: string;
    readonly proposerUserId: string;
    readonly commandId: string;
    readonly type: string;
    readonly payload: { readonly type: string };
    readonly payloadDigest: string;
    readonly expected: CommandExpected;
    readonly conflictId: string;
  },
) => {
  const issuedAt = (await readDatabaseTime(tx)).toISOString();
  const expiresAt = confirmationDeadline(issuedAt);
  if (!expiresAt) throw createAppError('INVARIANT');
  try {
    await tx.insert(pendingCommands).values({
      ...input,
      payload: jsonObjectSchema.parse(input.payload),
      expected: jsonObjectSchema.parse(input.expected),
      expiresAt: new Date(expiresAt),
      createdAt: new Date(issuedAt),
    });
  } catch (error) {
    if (isUniqueViolationOf(error, 'pending_commands_pkey'))
      throw new CommandIdTaken();
    throw error;
  }
  return { pendingCommandId: input.commandId, expiresAt };
};

export const storedFixtureCommand = async (
  tx: Tx,
  lobbyId: string,
  id: string,
) => {
  const accepted = await storedCommand(tx, id);
  if (accepted) return accepted;
  const [pending] = await tx
    .select()
    .from(pendingCommands)
    .where(
      and(
        eq(pendingCommands.commandId, id),
        eq(pendingCommands.lobbyId, lobbyId),
      ),
    );
  if (!pending) return null;
  if (pending.status === 'confirmed')
    throw createAppError(
      'INVARIANT',
      'Confirmed proposal has no accepted history',
    );
  return {
    actorUserId: pending.proposerUserId,
    payloadDigest: pending.payloadDigest,
    outcome:
      pending.status === 'pending'
        ? {
            kind: 'pending' as const,
            pendingCommandId: id,
            expiresAt: pending.expiresAt.toISOString(),
          }
        : {
            kind: 'settled' as const,
            pendingCommandId: id,
            status: pending.status,
            expiresAt: pending.expiresAt.toISOString(),
          },
  };
};
