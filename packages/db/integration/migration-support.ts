import { SQL } from 'bun';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createId } from '@paralleldrive/cuid2';

/** Shared fixtures for the isolated auth-migration integration suites. */

export const migrationsDir = join(import.meta.dir, '../migrations');
const historicalMigrations = [
  '0000_optimal_calypso.sql',
  '0001_zippy_shen.sql',
] as const;

/** Legacy identities minted before the cuid2 conversion (ADR 0018). */
export const legacyUserId = '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';
export const legacySecondUserId = '1c2c3c4c-5c6c-4c7c-8c9c-0c1c2c3c4c5c';
export const legacyDebateId = '0f0e6d1c-2b3a-4455-9a8b-7c6d5e4f3a21';
export const legacyUserCreatedAt = '2024-03-04T05:06:07.089Z';
export const legacyUserUpdatedAt = '2024-04-05T06:07:08.090Z';
export const legacyDebateCreatedAt = '2024-05-06T07:08:09.010Z';
export const legacySnapshot = {
  version: 1,
  id: legacyDebateId,
  resolution: 'A pre-cuid2 resolution',
  format: 'foundation',
  phase: 'waiting',
  createdAt: legacyDebateCreatedAt,
  participants: [{ id: legacyUserId, side: 'affirmative', ready: false }],
};

const adminUrl = (testDatabaseUrl: string) => {
  const url = new URL(testDatabaseUrl);
  url.pathname = '/postgres';
  return url.toString();
};
export const newScratchName = () => `daisy_auth_upgrade_${createId()}_test`;
export const scratchUrl = (testDatabaseUrl: string, name: string) => {
  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
};

export const createScratchDatabase = async (
  testDatabaseUrl: string,
  name: string,
) => {
  const admin = new SQL(adminUrl(testDatabaseUrl));
  try {
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.close();
  }
};

export const dropScratchDatabase = async (
  testDatabaseUrl: string,
  name: string,
) => {
  const admin = new SQL(adminUrl(testDatabaseUrl));
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
  } finally {
    await admin.close();
  }
};

/**
 * Recreates the historical pre-auth database state by applying the committed
 * pre-auth migrations and seeding legacy UUID users plus an owned debate.
 */
export const seedPreAuthState = async (
  testDatabaseUrl: string,
  name: string,
  usernames: readonly [string, string][],
) => {
  const client = new SQL(scratchUrl(testDatabaseUrl, name));
  try {
    for (const file of historicalMigrations) {
      const content = await readFile(join(migrationsDir, file), 'utf8');
      for (const statement of content.split('--> statement-breakpoint'))
        await client.unsafe(statement.trim());
    }
    for (const [id, username] of usernames)
      await client.unsafe(
        'insert into users (id, username, created_at, updated_at, version) values ($1, $2, $3, $4, 1)',
        [id, username, legacyUserCreatedAt, legacyUserUpdatedAt],
      );
    await client.unsafe(
      `insert into debates (id, created_by, resolution, format, snapshot, created_at, updated_at, version)
       values ($1, $2, $3, 'foundation', $4, $5, $5, 1)`,
      [
        legacyDebateId,
        legacyUserId,
        legacySnapshot.resolution,
        JSON.stringify(legacySnapshot),
        legacyDebateCreatedAt,
      ],
    );
    await recordHistoricalJournal(testDatabaseUrl, name);
  } finally {
    await client.close();
  }
};

/**
 * The real migrator only orders by created_at: recording the historical
 * migrations as applied makes the forward run apply exactly 0002 onward.
 */
const recordHistoricalJournal = async (
  testDatabaseUrl: string,
  name: string,
) => {
  const client = new SQL(scratchUrl(testDatabaseUrl, name));
  try {
    const journal = JSON.parse(
      await readFile(join(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: readonly { idx: number; tag: string; when: number }[] };
    await client.unsafe('create schema if not exists drizzle');
    await client.unsafe(
      'create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)',
    );
    for (const entry of journal.entries.filter(({ idx }) => idx < 2))
      await client.unsafe(
        'insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)',
        [entry.tag, String(entry.when)],
      );
  } finally {
    await client.close();
  }
};

export const journalCount = async (testDatabaseUrl: string, name: string) => {
  const client = new SQL(scratchUrl(testDatabaseUrl, name));
  try {
    const rows = await client.unsafe(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    return rows[0]?.count ?? 0;
  } finally {
    await client.close();
  }
};

export const scalar = async (
  testDatabaseUrl: string,
  name: string,
  query: string,
  params: unknown[] = [],
) => {
  const client = new SQL(scratchUrl(testDatabaseUrl, name));
  try {
    const rows = await client.unsafe(query, params);
    return rows[0];
  } finally {
    await client.close();
  }
};

/** Bun SQL delivers jsonb in its raw string form; decode for comparisons. */
export const asJson = (value: unknown) =>
  typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
