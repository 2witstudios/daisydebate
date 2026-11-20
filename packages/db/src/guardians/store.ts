import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { lockAuthorizationActors } from '../authorization';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import {
  childAccountRequests,
  guardianConsentEvidence,
  guardianLinks,
} from '../schema/guardian-links';
import { reports } from '../schema/reports';
import { scopeTransaction } from '../tenant-scope';

type GuardianTx = Pick<
  BunSQLDatabase,
  'select' | 'execute' | 'insert' | 'update'
>;

export type GuardianLinkRow = typeof guardianLinks.$inferSelect;
type LinkInsert = typeof guardianLinks.$inferInsert;
type RequestInsert = typeof childAccountRequests.$inferInsert;

function scopedGuardians(tx: GuardianTx, userId: string) {
  const person = async (where: ReturnType<typeof eq>) => {
    const [row] = await tx
      .select({ userId: users.id, email: users.email, actorId: actors.id })
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

export function createGuardianStore(database: {
  readonly transaction: <T>(work: (tx: GuardianTx) => Promise<T>) => Promise<T>;
}) {
  return {
    forSubject<T>(
      userId: string,
      work: (session: GuardianSession) => Promise<T>,
    ) {
      return database.transaction(async (tx) => {
        await scopeTransaction(tx, { subjectUserId: userId });
        return work(scopedGuardians(tx, userId));
      });
    },
  };
}
