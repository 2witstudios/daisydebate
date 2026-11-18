import { and, asc, eq, sql } from 'drizzle-orm';
import type { PaidHostingTier } from '@daisy/protocol/lobby/hosting-tier';
import { entries } from '../schema/entries';
import {
  tournamentHostingPurchases,
  type TournamentHostingPurchaseState,
} from '../schema/tournament-hosting-purchases';
import { users } from '../schema/users';
import { scopeTransaction } from '../tenant-scope';
import { readDatabaseTime } from '../database-clock';
import { loadLobbyAuthority } from './lobby-authority';
import { loadTournamentHostingFacts } from './tournament-hosting-facts';
import type { TabDatabase, TabTransaction } from './tab-transaction';

/** One stored hosting payment, as the hosting feature reads it. */
export type TournamentHostingPurchaseRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly payerUserId: string;
  readonly payerName: string;
  readonly tier: PaidHostingTier;
  readonly amount: number;
  readonly mode: 'test' | 'live';
  readonly state: TournamentHostingPurchaseState;
  readonly vendorSessionId: string | null;
  readonly receiptUrl: string | null;
  readonly createdAt: string;
  readonly paidAt: string | null;
};

const readPurchases = async (
  tx: TabTransaction,
  lobbyId: string,
): Promise<TournamentHostingPurchaseRow[]> =>
  (
    await tx
      .select({
        id: tournamentHostingPurchases.id,
        lobbyId: tournamentHostingPurchases.lobbyId,
        payerUserId: tournamentHostingPurchases.payerUserId,
        payerName: sql<string>`coalesce(nullif(${users.name}, ''), ${users.username}, '')`,
        tier: tournamentHostingPurchases.tier,
        amount: tournamentHostingPurchases.amount,
        mode: tournamentHostingPurchases.mode,
        state: tournamentHostingPurchases.state,
        vendorSessionId: tournamentHostingPurchases.vendorSessionId,
        receiptUrl: tournamentHostingPurchases.receiptUrl,
        createdAt: tournamentHostingPurchases.createdAt,
        paidAt: tournamentHostingPurchases.paidAt,
      })
      .from(tournamentHostingPurchases)
      .innerJoin(users, eq(users.id, tournamentHostingPurchases.payerUserId))
      .where(eq(tournamentHostingPurchases.lobbyId, lobbyId))
      .orderBy(
        asc(tournamentHostingPurchases.createdAt),
        asc(tournamentHostingPurchases.id),
      )
  ).map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
  }));

/**
 * What a host's hosting page or checkout is decided from: the viewer's
 * authority at the tournament, its tier facts, its accepted entries and its
 * payments. The tournament row is locked for the transaction.
 */
const loadHostingAccount = async (
  tx: TabTransaction,
  input: { readonly viewerUserId: string; readonly lobbyId: string },
) => {
  const authority = await loadLobbyAuthority(tx, input);
  if (!authority || authority.lobby.kind !== 'tournament') return null;
  const hosting = await loadTournamentHostingFacts(tx, authority.lobby.id);
  if (!hosting) return null;
  const [accepted] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(entries)
    .where(
      and(
        eq(entries.lobbyId, authority.lobby.id),
        eq(entries.status, 'accepted'),
      ),
    );
  const [waiting] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(entries)
    .where(
      and(
        eq(entries.lobbyId, authority.lobby.id),
        eq(entries.status, 'pending'),
      ),
    );
  return {
    ...authority,
    hosting,
    acceptedEntries: accepted?.count ?? 0,
    waitingEntries: waiting?.count ?? 0,
    purchases: await readPurchases(tx, authority.lobby.id),
  };
};
export type TournamentHostingAccount = NonNullable<
  Awaited<ReturnType<typeof loadHostingAccount>>
>;

const openPurchase = (
  tx: TabTransaction,
  lobbyId: string,
  purchaseId: string,
) =>
  and(
    eq(tournamentHostingPurchases.id, purchaseId),
    eq(tournamentHostingPurchases.lobbyId, lobbyId),
    eq(tournamentHostingPurchases.state, 'open'),
  );

/** The writes a hosting checkout or its settlement makes, each idempotent. */
const purchaseWrites = (tx: TabTransaction, lobbyId: string) => ({
  open: async (row: {
    readonly id: string;
    readonly payerUserId: string;
    readonly tier: PaidHostingTier;
    readonly amount: number;
    readonly mode: 'test' | 'live';
  }) => {
    await tx.insert(tournamentHostingPurchases).values({ ...row, lobbyId });
  },
  recordSession: async (purchaseId: string, vendorSessionId: string) => {
    await tx
      .update(tournamentHostingPurchases)
      .set({ vendorSessionId })
      .where(openPurchase(tx, lobbyId, purchaseId));
  },
  /** Settles an open purchase as paid; a purchase already settled is left alone. */
  paid: async (
    purchaseId: string,
    vendor: {
      readonly vendorPaymentIntentId: string;
      readonly receiptUrl: string | null;
    },
  ) => {
    const now = await readDatabaseTime(tx);
    const settled = await tx
      .update(tournamentHostingPurchases)
      .set({ state: 'paid', paidAt: now, ...vendor })
      .where(openPurchase(tx, lobbyId, purchaseId))
      .returning({ id: tournamentHostingPurchases.id });
    return settled.length === 1;
  },
  expired: async (purchaseId: string) => {
    const now = await readDatabaseTime(tx);
    await tx
      .update(tournamentHostingPurchases)
      .set({ state: 'expired', expiredAt: now })
      .where(openPurchase(tx, lobbyId, purchaseId));
  },
});
export type TournamentHostingPurchaseWrites = ReturnType<
  typeof purchaseWrites
>;

export const createTournamentHostingPurchaseStore = (
  database: TabDatabase,
) => ({
  /** A host's view of a tournament's hosting, with the writes checkout makes. */
  tournamentHosting: <Answer>(
    input: { readonly viewerUserId: string; readonly lobbyId: string },
    work: (
      account: TournamentHostingAccount | null,
      writes: TournamentHostingPurchaseWrites,
    ) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) =>
      work(await loadHostingAccount(tx, input), purchaseWrites(tx, input.lobbyId)),
    ),
  /**
   * Settlement from a verified vendor observation: no viewer, only the
   * tournament the purchase names, read under that tournament's scope.
   */
  tournamentHostingSettlement: <Answer>(
    input: { readonly lobbyId: string; readonly purchaseId: string },
    work: (
      purchase: TournamentHostingPurchaseRow | null,
      writes: TournamentHostingPurchaseWrites,
    ) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      await scopeTransaction(tx, { lobbyId: input.lobbyId });
      await loadTournamentHostingFacts(tx, input.lobbyId);
      const purchase =
        (await readPurchases(tx, input.lobbyId)).find(
          (row) => row.id === input.purchaseId,
        ) ?? null;
      return work(purchase, purchaseWrites(tx, input.lobbyId));
    }),
});
