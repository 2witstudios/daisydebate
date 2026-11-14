import { eq } from 'drizzle-orm';
import {
  lobbyCommandReceiptSchema,
  type ActionHistoryEntry,
  type LobbyCommandReceipt,
  type StoredOutcome,
} from '@daisy/protocol/lobby/command';
import { actionHistory } from '../schema/grants';
import type { TabTransaction } from './tab-transaction';

/**
 * The command record every Tab aggregate shares: what is stored for a
 * command id, read before anything is decided, and the one action-history
 * entry an accepted command appends. A held command's `pending_commands`
 * row answers `stored` the same way once lobby commands are wired.
 */

/** What is stored for a command id: who sent it, its digest and its outcome. */
export type StoredTabCommand = {
  readonly actorUserId: string | null;
  readonly payloadDigest: string;
  readonly outcome: StoredOutcome;
};

type HistoryRow = typeof actionHistory.$inferInsert;
type StoredHistoryRow = Pick<
  typeof actionHistory.$inferSelect,
  'actorUserId' | 'payloadDigest' | 'result'
>;

/** A history row as a stored command: the receipt it answered, accepted. */
export const storedCommandOf = (row: StoredHistoryRow): StoredTabCommand => ({
  actorUserId: row.actorUserId,
  payloadDigest: row.payloadDigest,
  outcome: {
    kind: 'accepted',
    receipt: lobbyCommandReceiptSchema.parse(row.result),
  },
});

const authorityColumns = (
  authority: ActionHistoryEntry['authority'],
): Pick<HistoryRow, 'authority' | 'grantId' | 'relation' | 'serviceId'> => {
  const none = { grantId: null, relation: null, serviceId: null };
  switch (authority.kind) {
    case 'fixed':
    case 'owner':
      return { ...none, authority: authority.kind };
    case 'grant':
      return { ...none, authority: 'grant', grantId: authority.grantId };
    case 'relationship':
      return {
        ...none,
        authority: 'relationship',
        relation: authority.relation,
      };
    case 'service':
      return { ...none, authority: 'service', serviceId: authority.serviceId };
  }
};

/** One accepted command as its `action_history` row; the receipt is its result. */
export const historyRowOf = (
  entry: ActionHistoryEntry,
  receipt: LobbyCommandReceipt,
): HistoryRow => ({
  commandId: entry.commandId,
  organizationId:
    entry.scope.kind === 'organization' ? entry.scope.organizationId : null,
  lobbyId: entry.scope.kind === 'lobby' ? entry.scope.lobbyId : null,
  actorUserId: entry.actorUserId,
  ...authorityColumns(entry.authority),
  aggregateKind: entry.aggregate.kind,
  aggregateId: entry.aggregate.id,
  conflictId: entry.conflictId,
  type: entry.type,
  payloadDigest: entry.payloadDigest,
  result: receipt,
  resultingVersion: entry.resultingVersion,
  appliedAt: new Date(entry.appliedAt),
});

/** What the record holds for a command id, or null for a new one. */
export const storedCommand = async (
  tx: TabTransaction,
  commandId: string,
): Promise<StoredTabCommand | null> => {
  const [row] = await tx
    .select({
      actorUserId: actionHistory.actorUserId,
      payloadDigest: actionHistory.payloadDigest,
      result: actionHistory.result,
    })
    .from(actionHistory)
    .where(eq(actionHistory.commandId, commandId))
    .limit(1);
  return row === undefined ? null : storedCommandOf(row);
};

/** Appends the one history entry of an accepted command. */
export const appendHistory = async (
  tx: TabTransaction,
  entry: ActionHistoryEntry,
  receipt: LobbyCommandReceipt,
): Promise<void> => {
  await tx.insert(actionHistory).values(historyRowOf(entry, receipt));
};
