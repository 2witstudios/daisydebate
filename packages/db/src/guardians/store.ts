import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  lockAuthorizationActors,
  readAuthorizationActors,
} from '../authorization';
import type { ProtectionLevel } from '@daisy/protocol/protection-level';
import { readProtectionLevel } from './protection-level';
import { mintNoticeIds } from '../notifications/mint-notice-ids';
import { run } from '../raw-rows';
import {
  answerFriendApproval,
  readWaitingFriendApprovals,
} from '../friends/guardian-approvals';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import {
  childAccountRequests,
  guardianConsentEvidence,
  guardianLinks,
} from '../schema/guardian-links';
import { reports } from '../schema/reports';
import { scopeTransaction } from '../tenant-scope';
import { inTransaction, type Tx, type TxOpener } from '../tx';

type GuardianTx = Pick<
  Tx,
  'select' | 'execute' | 'insert' | 'update' | 'delete'
>;

export type GuardianLinkRow = typeof guardianLinks.$inferSelect;
type LinkInsert = typeof guardianLinks.$inferInsert;
type RequestInsert = typeof childAccountRequests.$inferInsert;

function scopedGuardians(tx: GuardianTx, userId: string) {
  const person = async (where: ReturnType<typeof eq>) => {
    const [row] = await tx
      .select({
        userId: users.id,
        email: users.email,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        actorId: actors.id,
      })
      .from(users)
      .leftJoin(actors, eq(actors.userId, users.id))
      .where(and(where, isNull(users.deletedAt)));
    return row ?? null;
  };

  return {
    personByEmail: (email: string) => person(eq(users.email, email)),
    personByUsername: (username: string) =>
      person(eq(sql`lower(${users.username})`, username.toLowerCase())),
    personById: (id: string) => person(eq(users.id, id)),
    lockAccounts: (actorIds: readonly string[]) =>
      lockAuthorizationActors(tx, actorIds, { maxActors: 2 }),
    async lockProtectionAccounts(
      childUserId: string,
      actorIds: readonly string[],
    ) {
      await run(
        tx,
        sql`select public.daisy_lock_protection_accounts(${childUserId})`,
      );
      return readAuthorizationActors(tx, actorIds, { maxActors: 2 });
    },
    async link(id: string) {
      const [row] = await tx
        .select()
        .from(guardianLinks)
        .where(eq(guardianLinks.id, id));
      return row ?? null;
    },
    async openLink(minorUserId: string) {
      const [row] = await tx
        .select()
        .from(guardianLinks)
        .where(
          and(
            eq(guardianLinks.guardianUserId, userId),
            eq(guardianLinks.minorUserId, minorUserId),
            inArray(guardianLinks.status, ['requested', 'active']),
          ),
        );
      return row ?? null;
    },
    async request(id: string) {
      const [row] = await tx
        .select()
        .from(childAccountRequests)
        .where(
          and(
            eq(childAccountRequests.id, id),
            eq(childAccountRequests.guardianUserId, userId),
          ),
        );
      return row ?? null;
    },
    async liveRequest(email: string, now: Date) {
      const [row] = await tx
        .select()
        .from(childAccountRequests)
        .where(
          and(
            eq(childAccountRequests.guardianUserId, userId),
            eq(childAccountRequests.email, email),
            inArray(childAccountRequests.status, ['open', 'linked']),
            gt(childAccountRequests.expiresAt, now),
          ),
        );
      return row ?? null;
    },
    async links() {
      return tx
        .select({
          link: guardianLinks,
          username: users.username,
        })
        .from(guardianLinks)
        .innerJoin(
          users,
          eq(
            users.id,
            sql`case when ${guardianLinks.guardianUserId} = ${userId}
            then ${guardianLinks.minorUserId} else ${guardianLinks.guardianUserId} end`,
          ),
        )
        .where(
          and(
            isNull(users.deletedAt),
            or(
              eq(guardianLinks.guardianUserId, userId),
              eq(guardianLinks.minorUserId, userId),
            ),
          ),
        )
        .orderBy(asc(guardianLinks.createdAt));
    },
    requests() {
      return tx
        .select()
        .from(childAccountRequests)
        .where(eq(childAccountRequests.guardianUserId, userId))
        .orderBy(asc(childAccountRequests.createdAt));
    },
    waitingFriendApprovals: () => readWaitingFriendApprovals(tx, userId),
    answerFriendApproval: (input: Parameters<typeof answerFriendApproval>[1]) =>
      answerFriendApproval(tx, input),
    protectionLevel: (childUserId: string) =>
      readProtectionLevel(tx, childUserId),
    setProtectionLevel(
      childUserId: string,
      choice: ProtectionLevel,
      at: string,
      nextId: () => string,
    ) {
      return mintNoticeIds(
        tx,
        sql`public.daisy_set_protection_level`,
        sql`${childUserId}, ${JSON.stringify(choice)}::text::jsonb, ${at}::timestamptz`,
        nextId,
      );
    },
    async insertEvidence(
      evidence: typeof guardianConsentEvidence.$inferInsert,
    ) {
      await tx.insert(guardianConsentEvidence).values(evidence);
    },
    async insertLink(link: LinkInsert) {
      await tx.insert(guardianLinks).values(link);
    },
    async moveLink(
      row: GuardianLinkRow,
      change: Pick<
        LinkInsert,
        | 'status'
        | 'activation'
        | 'activatedAt'
        | 'closedAt'
        | 'childConfirmationId'
        | 'version'
        | 'updatedAt'
      >,
    ) {
      const [after] = await tx
        .update(guardianLinks)
        .set(change)
        .where(
          and(
            eq(guardianLinks.id, row.id),
            eq(guardianLinks.version, row.version),
          ),
        )
        .returning({ id: guardianLinks.id });
      return after !== undefined;
    },
    async insertRequest(request: RequestInsert) {
      const [row] = await tx
        .insert(childAccountRequests)
        .values(request)
        .onConflictDoNothing()
        .returning({ id: childAccountRequests.id });
      return row !== undefined;
    },
    linkRequestDeadlines() {
      return tx
        .select({
          linkId: childAccountRequests.requestedLinkId,
          expiresAt: childAccountRequests.expiresAt,
        })
        .from(childAccountRequests)
        .innerJoin(
          guardianLinks,
          eq(guardianLinks.id, childAccountRequests.requestedLinkId),
        )
        .where(eq(guardianLinks.minorUserId, userId));
    },
    async requestForLink(linkId: string) {
      const [row] = await tx
        .select({ expiresAt: childAccountRequests.expiresAt })
        .from(childAccountRequests)
        .where(eq(childAccountRequests.requestedLinkId, linkId))
        .orderBy(asc(childAccountRequests.expiresAt));
      return row ?? null;
    },
    async linkRequest(id: string, linkId: string | null, now: Date) {
      const [row] = await tx
        .update(childAccountRequests)
        .set({
          status: 'linked',
          requestedLinkId: linkId,
          closedAt: sql`coalesce(${childAccountRequests.closedAt}, ${now})`,
        })
        .where(
          and(
            eq(childAccountRequests.id, id),
            eq(childAccountRequests.guardianUserId, userId),
            inArray(childAccountRequests.status, ['open', 'linked']),
            isNull(childAccountRequests.requestedLinkId),
            gt(childAccountRequests.expiresAt, now),
          ),
        )
        .returning({ id: childAccountRequests.id });
      return row !== undefined;
    },
    async cancelRequest(id: string, now: Date) {
      const [row] = await tx
        .update(childAccountRequests)
        .set({
          status: 'cancelled',
          closedAt: now,
          email: null,
          firstName: null,
          birthMonth: null,
        })
        .where(
          and(
            eq(childAccountRequests.id, id),
            eq(childAccountRequests.guardianUserId, userId),
            inArray(childAccountRequests.status, ['open', 'linked']),
          ),
        )
        .returning({ id: childAccountRequests.id });
      return row !== undefined;
    },
    async fileRefusal(input: {
      readonly reportId: string;
      readonly childActorId: string;
      readonly guardianActorId: string;
      readonly now: Date;
    }) {
      await tx
        .insert(reports)
        .values({
          id: input.reportId,
          reporterActorId: input.childActorId,
          subjectActorId: input.guardianActorId,
          reason: 'not-my-parent',
          surface: 'guardian-link',
          createdAt: input.now,
        })
        .onConflictDoNothing();
    },
    async bumpAuthority(guardianUserId: string, at: Date) {
      await tx
        .update(users)
        .set({
          version: sql`${users.version} + 1`,
          updatedAt: at,
        })
        .where(eq(users.id, guardianUserId));
    },
  };
}

export type GuardianSession = ReturnType<typeof scopedGuardians>;

export function createGuardianStore(database: TxOpener) {
  return {
    forSubject<T>(
      userId: string,
      work: (session: GuardianSession) => Promise<T>,
    ) {
      return inTransaction(database, async (tx) => {
        await scopeTransaction(tx, { subjectUserId: userId });
        return work(scopedGuardians(tx, userId));
      });
    },
  };
}
