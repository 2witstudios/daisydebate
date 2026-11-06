import {
  preapprovalCommandSchema,
  type PreapprovalCommand,
} from '@daisy/protocol/beta-preapproval';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AdminExecutor, AdminTransaction } from '../../db/client';
import { auditEvents, pendingCommands } from '../../db/schema';

/**
 * The pending command rows (ADR 0077 amendment). A command opens with its
 * intent and closes once its outcome is known; closing is one conditional
 * UPDATE, so of two racing reconcilers exactly one records the outcome.
 */
export type AccountPendingCommand = {
  readonly commandId: string;
  readonly operatorId: string;
  readonly targetUserId: string;
  readonly desiredState: 'approved' | 'revoked';
  readonly expectedRevision: number;
};

export type PreapprovalPendingCommand = {
  readonly commandId: string;
  readonly operatorId: string;
  readonly targetUserId: null;
  readonly preapproval: PreapprovalCommand;
};
export type PendingCommand = AccountPendingCommand | PreapprovalPendingCommand;

export async function openPendingCommand(
  tx: AdminTransaction,
  command: PendingCommand & { readonly now: string },
): Promise<void> {
  await tx.insert(pendingCommands).values({
    commandId: command.commandId,
    operatorId: command.operatorId,
    targetUserId: command.targetUserId,
    desiredState: 'preapproval' in command ? null : command.desiredState,
    expectedRevision:
      'preapproval' in command ? null : command.expectedRevision,
    preapproval: 'preapproval' in command ? command.preapproval : null,
    createdAt: new Date(command.now),
    lastSignedAt: new Date(command.now),
  });
}

/**
 * Records a resend's signing time before it is sent, so a crash between the
 * two never leaves an earlier time that would abandon a PUT still valid.
 */
export async function markSigned(
  db: AdminExecutor,
  commandId: string,
  signedAt: string,
): Promise<void> {
  await db
    .update(pendingCommands)
    .set({ lastSignedAt: new Date(signedAt) })
    .where(eq(pendingCommands.commandId, commandId));
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
  if (rows.length === 1)
    await tx
      .delete(pendingCommands)
      .where(
        and(
          eq(pendingCommands.commandId, commandId),
          isNull(pendingCommands.targetUserId),
        ),
      );
  return rows.length === 1;
}

/** An open command and when its latest PUT was signed. */
export type OpenCommand = PendingCommand & { readonly lastSignedAt: string };

/** Oldest first: the commands whose outcome is still unknown. */
export async function openCommands(
  db: AdminExecutor,
  limit: number,
): Promise<readonly OpenCommand[]> {
  const rows = await db
    .select()
    .from(pendingCommands)
    .where(isNull(pendingCommands.resolvedAt))
    .orderBy(asc(pendingCommands.createdAt))
    .limit(limit);
  return rows.map((row): OpenCommand => ({
    commandId: row.commandId,
    operatorId: row.operatorId,
    lastSignedAt: row.lastSignedAt.toISOString(),
    ...(row.preapproval !== null
      ? {
          targetUserId: null,
          preapproval: preapprovalCommandSchema.parse(row.preapproval),
        }
      : {
          targetUserId: row.targetUserId!,
          desiredState:
            row.desiredState as AccountPendingCommand['desiredState'],
          expectedRevision: row.expectedRevision!,
        }),
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
