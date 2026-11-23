import { createAppError } from '@daisy/errors';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { parsedColumn } from '../raw-rows';
import { z } from 'zod';
import { lobbies } from '../schema/lobbies';
import { fenceTabAccountRead } from './account-read-fence';
import { loadAccountHostingFacts } from './account-hosting-facts';
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
import { inTransaction, type Tx, type TxOpener } from '../tx';

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
  tx: Tx,
  lobbyId: string,
): Promise<TournamentHostingPurchaseRow[]> =>
  (
    await tx
      .select({
        id: tournamentHostingPurchases.id,
        lobbyId: tournamentHostingPurchases.lobbyId,
        payerUserId: tournamentHostingPurchases.payerUserId,
        payerName: parsedColumn(
          z.string(),
          sql`coalesce(nullif(${users.name}, ''), ${users.username}, '')`,
        ),
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
  tx: Tx,
  input: {
    readonly viewerUserId: string;
    readonly lobbyId: string;
    /** `read` for a page view; checkout locks the tournament row. */
    readonly lock?: 'update' | 'read';
  },
) => {
  const authority = await loadLobbyAuthority(tx, input);
  if (!authority || authority.lobby.kind !== 'tournament') return null;
  const hosting = await loadTournamentHostingFacts(
    tx,
    authority.lobby.id,
    input.lock ?? 'update',
  );
  if (!hosting) return null;
  const [accepted] = await tx
    .select({ count: parsedColumn(z.number().int(), sql`count(*)::int`) })
    .from(entries)
    .where(
      and(
        eq(entries.lobbyId, authority.lobby.id),
        eq(entries.status, 'accepted'),
      ),
    );
  const [waiting] = await tx
    .select({ count: parsedColumn(z.number().int(), sql`count(*)::int`) })
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

const openPurchase = (tx: Tx, lobbyId: string, purchaseId: string) =>
  and(
    eq(tournamentHostingPurchases.id, purchaseId),
    eq(tournamentHostingPurchases.lobbyId, lobbyId),
    eq(tournamentHostingPurchases.state, 'open'),
  );

/** The writes a hosting checkout or its settlement makes, each idempotent. */
const purchaseWrites = (tx: Tx, lobbyId: string) => ({
  open: async (row: {
    readonly id: string;
    readonly payerUserId: string;
    readonly tier: PaidHostingTier;
    readonly amount: number;
    readonly mode: 'test' | 'live';
  }): Promise<'opened' | 'taken'> => {
    // The tournament's one open purchase may already exist: a concurrent
    // checkout won the partial unique index, and this one resumes it.
    const inserted = await tx
      .insert(tournamentHostingPurchases)
      .values({ ...row, lobbyId })
      .onConflictDoNothing()
      .returning({ id: tournamentHostingPurchases.id });
    return inserted.length === 1 ? 'opened' : 'taken';
  },
  /** Whether the session was recorded: false once the purchase stopped being open. */
  recordSession: async (purchaseId: string, vendorSessionId: string) => {
    const recorded = await tx
      .update(tournamentHostingPurchases)
      .set({ vendorSessionId })
      .where(openPurchase(tx, lobbyId, purchaseId))
      .returning({ id: tournamentHostingPurchases.id });
    return recorded.length === 1;
  },
  /**
   * Settles a purchase as paid. An expired one is credited too: Stripe took
   * the money, so Daisy honours it. A paid purchase is left alone.
   */
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
      .set({ state: 'paid', paidAt: now, expiredAt: null, ...vendor })
      .where(
        and(
          eq(tournamentHostingPurchases.id, purchaseId),
          eq(tournamentHostingPurchases.lobbyId, lobbyId),
          inArray(tournamentHostingPurchases.state, ['open', 'expired']),
        ),
      )
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
export type TournamentHostingPurchaseWrites = ReturnType<typeof purchaseWrites>;

/**
 * The open tournaments a person owns themselves, newest first, each read
 * under its own lobby scope with its tier facts and accepted entries.
 */
const loadHostedTournaments = async (tx: Tx, viewerUserId: string) => {
  await scopeTransaction(tx, { subjectUserId: viewerUserId });
  await fenceTabAccountRead(tx, viewerUserId);
  const owned = await tx
    .select({
      id: lobbies.id,
      handle: lobbies.handle,
      name: lobbies.name,
      ageRule: lobbies.ageRule,
    })
    .from(lobbies)
    .where(
      and(
        eq(lobbies.ownerUserId, viewerUserId),
        eq(lobbies.kind, 'tournament'),
        isNull(lobbies.closedAt),
      ),
    )
    .orderBy(desc(lobbies.createdAt), desc(lobbies.id))
    .limit(100);
  const hosted = [];
  for (const lobby of owned) {
    await scopeTransaction(tx, {
      subjectUserId: viewerUserId,
      lobbyId: lobby.id,
    });
    const paid = await tx
      .select({ tier: tournamentHostingPurchases.tier })
      .from(tournamentHostingPurchases)
      .where(
        and(
          eq(tournamentHostingPurchases.lobbyId, lobby.id),
          eq(tournamentHostingPurchases.state, 'paid'),
        ),
      );
    const [accepted] = await tx
      .select({ count: parsedColumn(z.number().int(), sql`count(*)::int`) })
      .from(entries)
      .where(
        and(eq(entries.lobbyId, lobby.id), eq(entries.status, 'accepted')),
      );
    if (lobby.ageRule === null)
      throw createAppError(
        'INVARIANT',
        'A self-run tournament has no age rule',
      );
    hosted.push({
      ...lobby,
      ageRule: lobby.ageRule,
      paidTiers: paid.map((row) => row.tier),
      acceptedEntries: accepted?.count ?? 0,
    });
  }
  return {
    hosting: await loadAccountHostingFacts(tx, viewerUserId),
    tournaments: hosted,
  };
};
export type HostedTournamentsFacts = Awaited<
  ReturnType<typeof loadHostedTournaments>
>;

export const createTournamentHostingPurchaseStore = (database: TxOpener) => ({
  hostedTournaments: <Answer>(
    viewerUserId: string,
    work: (facts: HostedTournamentsFacts) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) =>
      work(await loadHostedTournaments(tx, viewerUserId)),
    ),
  /** A host's view of a tournament's hosting, with the writes checkout makes. */
  tournamentHosting: <Answer>(
    input: {
      readonly viewerUserId: string;
      readonly lobbyId: string;
      readonly lock?: 'update' | 'read';
    },
    work: (
      account: TournamentHostingAccount | null,
      writes: TournamentHostingPurchaseWrites,
    ) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) =>
      work(
        await loadHostingAccount(tx, input),
        purchaseWrites(tx, input.lobbyId),
      ),
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
    inTransaction(database, async (tx) => {
      await scopeTransaction(tx, { lobbyId: input.lobbyId });
      await loadTournamentHostingFacts(tx, input.lobbyId);
      const purchase =
        (await readPurchases(tx, input.lobbyId)).find(
          (row) => row.id === input.purchaseId,
        ) ?? null;
      return work(purchase, purchaseWrites(tx, input.lobbyId));
    }),
});
