import { jsonObjectSchema } from '../schema/columns';
import { CommandIdTaken, storedCommand } from './command-record';
import { isUniqueViolationOf } from '../unique-violation';
import { and, eq } from 'drizzle-orm';
import type {
  ConflictConnection,
  ConflictHandling,
} from '@daisy/protocol/authorization';
import type { CommandExpected } from '@daisy/protocol/lobby/command';
import { conflicts, pendingCommands } from '../schema/conflicts';
import type { TabTransaction } from './tab-transaction';

export const recordFixtureConflict = async (
  tx: TabTransaction,
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
  tx: TabTransaction,
  input: {
    readonly lobbyId: string;
    readonly proposerUserId: string;
    readonly commandId: string;
    readonly type: string;
    readonly payload: { readonly type: string };
    readonly payloadDigest: string;
    readonly expected: CommandExpected;
    readonly conflictId: string;
    readonly expiresAt: string;
  },
) => {
  try {
    await tx.insert(pendingCommands).values({
      ...input,
      payload: jsonObjectSchema.parse(input.payload),
      expected: jsonObjectSchema.parse(input.expected),
      expiresAt: new Date(input.expiresAt),
    });
  } catch (error) {
    if (isUniqueViolationOf(error, 'pending_commands_pkey'))
      throw new CommandIdTaken();
    throw error;
  }
  return { pendingCommandId: input.commandId, expiresAt: input.expiresAt };
};

export const storedFixtureCommand = async (
  tx: TabTransaction,
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
  return pending
    ? {
        actorUserId: pending.proposerUserId,
        payloadDigest: pending.payloadDigest,
        outcome: {
          kind: 'pending' as const,
          pendingCommandId: id,
          expiresAt: pending.expiresAt.toISOString(),
        },
      }
    : null;
};
