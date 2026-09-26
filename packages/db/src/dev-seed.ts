import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { actors } from './schema/actors';
import { debates } from './schema/debates';
import { seedVersions } from './schema/seed-versions';
import { users } from './schema/users';
import { projectParticipants } from './debate-operations';
import { parseSnapshot, type NewDebate } from './debate-record';

/**
 * Dev and demo content for `bun db:seed` (ISSUE-8 AC4): fixed-id people,
 * each with a human actor, and one debate. Reference data (the formats) is
 * not seed content; the migrations insert it (ADR 0038).
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
  readonly debate: NewDebate;
};

/**
 * Applies a dev seed in one transaction, idempotently: rerunning leaves
 * every seeded row byte-identical. A seeded debate that a developer
 * advanced returns to the seed's own snapshot, and its lifecycle
 * projections (`started_at`, `completed_at`, `outcome`) and seats return
 * with it, so the lifecycle CHECK never refuses the reset. The version
 * marker's `updated_at` moves only when the version changes. This is the
 * only path `bun db:seed` writes through; it is not part of
 * `createDatabase()`, because no running application seeds.
 */
export async function applyDevSeed({
  url,
  seed,
}: {
  readonly url: string;
  readonly seed: DevSeed;
}): Promise<void> {
  const snapshot = parseSnapshot(seed.debate.id, seed.debate.snapshot);
  const client = new SQL(url, { max: 1 });
  try {
    await drizzle({ client }).transaction(async (tx) => {
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
              // force it back to null/false on every reseed (AUTH-7.6 review).
              email:
                person.email === undefined ? users.email : sql`excluded.email`,
              emailVerified:
                person.emailVerified === undefined
                  ? users.emailVerified
                  : sql`excluded.email_verified`,
            },
          });
        await tx
          .insert(actors)
          .values({ id: person.actorId, kind: 'human', userId: person.userId })
          .onConflictDoUpdate({
            target: actors.id,
            set: { kind: sql`excluded.kind`, userId: sql`excluded.user_id` },
          });
      }
      await tx
        .insert(debates)
        .values({
          id: seed.debate.id,
          createdByActorId: seed.debate.createdBy ?? null,
          resolution: seed.debate.resolution,
          formatId: seed.debate.format,
          snapshot,
          mode: seed.debate.mode,
          visibility: seed.debate.visibility,
          phase: snapshot.phase,
        })
        .onConflictDoUpdate({
          target: debates.id,
          set: {
            createdByActorId: sql`excluded.created_by_actor_id`,
            resolution: sql`excluded.resolution`,
            formatId: sql`excluded.format_id`,
            snapshot: sql`excluded.snapshot`,
            mode: sql`excluded.mode`,
            phase: sql`excluded.phase`,
            visibility: sql`excluded.visibility`,
            startedAt: null,
            completedAt: null,
            outcome: null,
          },
        });
      await projectParticipants(tx, snapshot);
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
