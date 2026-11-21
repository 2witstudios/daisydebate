import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { accountAge } from './schema/account-age';
import { actors } from './schema/actors';
import { accountBetaAccess } from './schema/beta-access';
import { applyBetaEntitlementGrants } from './entitlement-grants';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { seedVersions } from './schema/seed-versions';
import { users } from './schema/users';
import {
  roundStatus,
  emptyRuntimeCheckpointFor,
  type RoundRules,
  type SideSeat,
} from '@daisy/protocol';
import { frozenJudgingFor } from './round-judging-freeze';
import { columnsOfSeat } from './seat-columns';
import { inTransaction } from './tx';

/**
 * Dev and demo content for `bun db:seed` (ISSUE-8 AC4): fixed-id people,
 * each with a human actor, and one scheduled casual round. Reference
 * data (formats, revisions, presets, bots) is not seed content; the
 * migrations insert it (ADR 0038).
 */
export type DevSeed = {
  /** The `seed_versions` row that records which content was applied. */
  readonly name: string;
  readonly version: string;
  readonly people: ReadonlyArray<{
    readonly userId: string;
    readonly actorId: string;
    readonly username: string;
    /** AUTH-7.6's restore rehearsal seed: a verified email, absent by default. */
    readonly email?: string;
    readonly emailVerified?: boolean;
  }>;
  readonly round: {
    readonly id: string;
    readonly createdByActorId: string;
    readonly resolution: string;
    readonly formatId: string;
    readonly formatVersion: number;
    readonly rules: RoundRules;
    /** The seeded debaters, each in a side's seat. */
    readonly seats: ReadonlyArray<{
      readonly id: string;
      readonly actorId: string;
      readonly seat: SideSeat;
    }>;
  };
};

/**
 * Applies a dev seed in one transaction, idempotently: rerunning leaves
 * every seeded row byte-identical. A seeded round a developer advanced
 * returns to the seed's own state — status, stage, timestamps, outcome,
 * checkpoint, execution segments (with their utterances) and seats — so
 * the lifecycle CHECK never refuses the reset.
 * The version marker's `updated_at` moves only when the version changes.
 * This is the only path `bun db:seed` writes through; it is not part of
 * `createDatabase()`, because no running application seeds.
 */
/** A birth month every seeded member is an adult for. */
const SEEDED_BIRTH_MONTH = '1990-01';

export async function applyDevSeed({
  url,
  seed,
}: {
  readonly url: string;
  readonly seed: DevSeed;
}): Promise<void> {
  const client = new SQL(url, { max: 1 });
  try {
    await inTransaction(drizzle({ client }), async (tx) => {
      for (const person of seed.people) {
        await tx
          .insert(users)
          .values({
            id: person.userId,
            username: person.username,
            email: person.email ?? null,
            emailVerified: person.emailVerified ?? false,
          })
          .onConflictDoUpdate({
            target: users.id,
            set: {
              username: sql`excluded.username`,
              // A seed entry that omits email/emailVerified must not wipe a
              // value an earlier run (or another writer) already set: only
              // overwrite the column this entry actually specifies, never
              // force it back to null/false on every reseed.
              email:
                person.email === undefined ? users.email : sql`excluded.email`,
              emailVerified:
                person.emailVerified === undefined
                  ? users.emailVerified
                  : sql`excluded.email_verified`,
            },
          });
        // Seeded members are adults (WAIT-4.6): the age step is answered.
        await tx
          .insert(accountAge)
          .values({
            userId: person.userId,
            birthMonth: SEEDED_BIRTH_MONTH,
            recordedAt: sql`now()`,
          })
          .onConflictDoNothing({ target: accountAge.userId });
        await tx
          .insert(actors)
          .values({ id: person.actorId, kind: 'human', userId: person.userId })
          .onConflictDoUpdate({
            target: actors.id,
            set: { kind: sql`excluded.kind`, userId: sql`excluded.user_id` },
          });
        // Seeded people are beta members (ADR 0075): dev and demo sign-in
        // reaches the app, never the waiting page.
        await tx
          .insert(accountBetaAccess)
          .values({
            userId: person.userId,
            state: 'approved',
            requestedAt: sql`now()`,
            decidedAt: sql`now()`,
            provenance: 'signup',
          })
          .onConflictDoNothing();
        await applyBetaEntitlementGrants(tx, person.userId, 'approved');
      }
      const [previous] = await tx
        .select({
          createdAt: sql<string>`${rounds.createdAt}::text`,
          updatedAt: sql<string>`${rounds.updatedAt}::text`,
        })
        .from(rounds)
        .where(sql`${rounds.id} = ${seed.round.id}`);
      await tx.delete(rounds).where(sql`${rounds.id} = ${seed.round.id}`);
      await tx.insert(rounds).values({
        id: seed.round.id,
        ...(previous
          ? {
              createdAt: sql`${previous.createdAt}::timestamptz`,
              updatedAt: sql`${previous.updatedAt}::timestamptz`,
            }
          : {}),
        createdByActorId: seed.round.createdByActorId,
        resolution: seed.round.resolution,
        competitionType: 'casual',
        formatId: seed.round.formatId,
        formatVersion: seed.round.formatVersion,
        presetVersion: null,
        rulesSnapshot: seed.round.rules,
        judging: frozenJudgingFor(seed.round.rules),
        runtimeState: emptyRuntimeCheckpointFor(seed.round.rules),
        status: roundStatus.opening,
        ladderId: null,
      });
      for (const seat of seed.round.seats) {
        await tx.insert(roundParticipants).values({
          id: seat.id,
          roundId: seed.round.id,
          actorId: seat.actorId,
          ...columnsOfSeat(seat.seat),
        });
      }
      await tx
        .insert(seedVersions)
        .values({ seedName: seed.name, version: seed.version })
        .onConflictDoUpdate({
          target: seedVersions.seedName,
          set: {
            version: sql`excluded.version`,
            updatedAt: sql`case when ${seedVersions.version} <> excluded.version then excluded.updated_at else ${seedVersions.updatedAt} end`,
          },
        });
    });
  } finally {
    await client.close();
  }
}
