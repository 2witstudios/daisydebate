import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AdminExecutor, AdminTransaction } from '../../db/client';
import { auditEvents, pendingCommands } from '../../db/schema';

/**
 * The pending command rows (ADR 0077 amendment). A command opens with its
 * intent and closes once its outcome is known; closing is one conditional
 * UPDATE, so of two racing reconcilers exactly one records the outcome.
 */
export type PendingCommand = {
  readonly commandId: string;
  readonly operatorId: string;
  readonly targetUserId: string;
  readonly desiredState: 'approved' | 'revoked';
  readonly expectedRevision: number;
};

export async function openPendingCommand(
  tx: AdminTransaction,
  command: PendingCommand & { readonly now: string },
): Promise<void> {
  await tx.insert(pendingCommands).values({
    commandId: command.commandId,
    operatorId: command.operatorId,
    targetUserId: command.targetUserId,
    desiredState: command.desiredState,
    expectedRevision: command.expectedRevision,
    createdAt: new Date(command.now),
  });
}

/** True when this caller closed it; false when someone already had. */
export async function resolvePendingCommand(
  tx: AdminTransaction,
  commandId: string,
  now: string,
): Promise<boolean> {
  const rows = await tx
    .update(pendingCommands)
    .set({ resolvedAt: new Date(now) })
    .where(
      and(
        eq(pendingCommands.commandId, commandId),
        isNull(pendingCommands.resolvedAt),
      ),
    )
    .returning({ commandId: pendingCommands.commandId });
  return rows.length === 1;
}

/** Oldest first: the commands whose outcome is still unknown. */
export async function openCommands(
  db: AdminExecutor,
  limit: number,
): Promise<readonly PendingCommand[]> {
  const rows = await db
    .select()
    .from(pendingCommands)
    .where(isNull(pendingCommands.resolvedAt))
    .orderBy(asc(pendingCommands.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    commandId: row.commandId,
    operatorId: row.operatorId,
    targetUserId: row.targetUserId,
    desiredState: row.desiredState as PendingCommand['desiredState'],
    expectedRevision: row.expectedRevision,
  }));
}

/** The anchor the command first carried: the chain head after its intent. */
export async function intentAnchor(
  db: AdminExecutor,
  commandId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.commandId, commandId),
        eq(auditEvents.kind, 'command.intent'),
      ),
    );
  return row?.hash ?? null;
}
