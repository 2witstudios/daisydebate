import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { runMigrations } from '../src/migrator';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

/** ADR 0075's expand step for the account fence (ISSUE-677). */
const gate = '20261027041618_beta_access_gate';
const committed = new URL('../migrations', import.meta.url).pathname;
const upgraded = scratchDatabase(url, 'betaexpand');
const failed = scratchDatabase(url, 'betaexpandfail');
afterAll(async () => {
  await upgraded.drop();
  await failed.drop();
});

/** An admitted participant written as the predecessor schema allows. */
async function seedAccount(databaseUrl: string) {
  const sql = new SQL(databaseUrl, { max: 1 });
  const userId = createId();
  const actorId = createId();
  try {
    await sql`insert into users (id, username, email_verified) values (${userId}, ${userId}, true)`;
    await sql`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${userId})`;
    await sql`insert into account_beta_access (user_id, state, requested_at, decided_at, provenance) values (${userId}, 'approved', now(), now(), 'signup')`;
    await sql`insert into account_age (user_id, birth_month, version, recorded_at) values (${userId}, '2000-01', 1, now() - interval '1 day')`;
  } finally {
    await sql.close();
  }
  return { userId, actorId };
}

const ledger = async (databaseUrl: string) => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const [row] =
      await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
    const [fence] =
      await sql`select to_regprocedure('public.daisy_authorization_accounts_v2(text[],text,boolean)') is not null as present`;
    return { applied: row?.count as number, v2: fence?.present as boolean };
  } finally {
    await sql.close();
  }
};

test(
  'statements a live instance prepared against the predecessor survive the real expand migration',
  async () => {
    await upgraded.create();
    await upgraded.migrate((folder) => folder < gate);
    const { userId, actorId } = await seedAccount(upgraded.url);
    // A live instance's runtime connection, its old statements prepared.
    const live = new SQL(upgraded.url, { max: 1 });
    try {
      await live.unsafe('set role daisy_web');
      const read = async () => {
        const [account] =
          await live`select * from public.daisy_authorization_accounts(null::text[], ${userId}::text, false)`;
        const [room] =
          await live`select * from public.daisy_room_read_account(${actorId}::text, ${userId}::text)`;
        const [age] =
          await live`select * from public.daisy_authorization_age(${userId}, ${actorId}, 1, clock_timestamp())`;
        return [account, room, age].map((row) => Object.keys(row ?? {}));
      };
      await read();
      const before = await read();
      await upgraded.migrate((folder) => folder <= gate);
      const after = await read();
      const [expanded] =
        await live`select "betaState", "ageBand" from public.daisy_authorization_accounts_v2(null::text[], ${userId}::text, false)`;
      const v1 = ['userId', 'actorId', 'member', 'erased', 'revision'];
      const age = [
        'actorId',
        'band',
        'revision',
        'accountRevision',
        'validUntil',
      ];
      assert({
        given:
          'the v1 account, v1 Room and age reads prepared on a daisy_web connection to a predecessor database, then the real gate folder applied through the migrator',
        should:
          'keep each exact result shape on the same connection while v2 serves the new facts',
        actual: { before, after, expanded },
        expected: {
          before: [v1, v1, age],
          after: [v1, v1, age],
          expanded: { betaState: 'approved', ageBand: 'adult' },
        },
      });
    } finally {
      await live.close();
    }
  },
  ddlTimeoutMs,
);

test(
  'a failing gate folder rolls back whole and leaves the migration ledger unchanged',
  async () => {
    await failed.create();
    await failed.migrate((folder) => folder < gate);
    const before = await ledger(failed.url);
    // The real gate folder, followed by a statement that fails.
    const folder = await mkdtemp(join(tmpdir(), 'daisy-betaexpandfail-'));
    try {
      for (const entry of (await readdir(committed)).sort())
        if (entry <= gate)
          await cp(join(committed, entry), join(folder, entry), {
            recursive: true,
          });
      const file = join(folder, gate, 'migration.sql');
      await writeFile(
        file,
        `${await readFile(file, 'utf8')}\n--> statement-breakpoint\nSELECT 1 / 0;\n`,
      );
      const outcome = await runMigrations({
        databaseUrl: failed.url,
        migrationsFolder: folder,
      }).then(
        () => 'applied',
        () => 'refused',
      );
      assert({
        given:
          'the gate folder with a failing final statement on a predecessor database',
        should:
          'refuse it, leaving no v2 function and the same ledger as before',
        actual: { outcome, after: await ledger(failed.url) },
        expected: { outcome: 'refused', after: before },
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
  ddlTimeoutMs,
);
