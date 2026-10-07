import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { actors } from './schema/actors';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { seedVersions } from './schema/seed-versions';
import { users } from './schema/users';
import type { RoundRules } from '@daisy/protocol';

/**
 * Dev and demo content for `bun db:seed` (ISSUE-8 AC4): fixed-id people,
 * each with a human actor, and one scheduled practice round. Reference
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
    readonly seats: ReadonlyArray<{
      readonly id: string;
      readonly actorId: string;
      readonly role: 'affirmative' | 'negative';
      readonly slot: number;
    }>;
  };
};

/**
 * Applies a dev seed in one transaction, idempotently: rerunning leaves
 * every seeded row byte-identical. A seeded round a developer advanced
 * returns to the seed's own state — status, stage, timestamps, outcome,
 * checkpoint and seats — so the lifecycle CHECK never refuses the reset.
 * The version marker's `updated_at` moves only when the version changes.
 * This is the only path `bun db:seed` writes through; it is not part of
 * `createDatabase()`, because no running application seeds.
 */
export async function applyDevSeed({
  url,
  seed,
}: {
  readonly url: string;
  readonly seed: DevSeed;
}): Promise<void> {
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
              // force it back to null/false on every reseed.
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
        .insert(rounds)
        .values({
          id: seed.round.id,
          createdByActorId: seed.round.createdByActorId,
          resolution: seed.round.resolution,
          competitionType: 'practice',
          length: 'full',
          formatId: seed.round.formatId,
          formatVersion: seed.round.formatVersion,
          presetVersion: null,
          rulesSnapshot: seed.round.rules,
          status: 'scheduled',
          ladderId: null,
        })
        .onConflictDoUpdate({
          target: rounds.id,
          set: {
            createdByActorId: sql`excluded.created_by_actor_id`,
            resolution: sql`excluded.resolution`,
            formatId: sql`excluded.format_id`,
            formatVersion: sql`excluded.format_version`,
            rulesSnapshot: sql`excluded.rules_snapshot`,
            status: sql`excluded.status`,
            currentStage: null,
            outcome: null,
            ladderId: sql`excluded.ladder_id`,
            startedAt: null,
            completedAt: null,
            // The checkpoint is lifecycle too: a seeded round that ran a prep
            // must come back with no active prep and nothing consumed.
            runtimeState: sql`excluded.runtime_state`,
          },
        });
      await tx
        .delete(roundParticipants)
        .where(
          sql`${roundParticipants.roundId} = ${seed.round.id} and (${roundParticipants.role} <> 'affirmative' and ${roundParticipants.role} <> 'negative')`,
        );
      for (const seat of seed.round.seats) {
        await tx
          .insert(roundParticipants)
          .values({
            id: seat.id,
            roundId: seed.round.id,
            actorId: seat.actorId,
            role: seat.role,
            slot: seat.slot,
          })
          .onConflictDoUpdate({
            target: roundParticipants.id,
            set: {
              actorId: sql`excluded.actor_id`,
              role: sql`excluded.role`,
              slot: sql`excluded.slot`,
            },
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
