import { afterAll, expect } from 'bun:test';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import {
  createSlotDatabase,
  dropSlotDatabase,
  listSlotDatabases,
  provisionTestRoles,
  resetPublicSchema,
  setSlotDatabaseComment,
  withSlotLock,
} from '../src/slots';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

// A unique prefix outside `daisy_wt_*`: slot pruning can never select these,
// and these tests never touch another slot's databases.
const prefix = `slotit_${createId()}`;
const e2e = { user: 'daisy_e2e', password: 'e2e-loopback-only' };
const connect = (database: string) => {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return new SQL(next.toString(), { max: 1 });
};
const admin = connect('postgres');
// CREATE/DROP DATABASE copy and remove files; under a machine full of
// parallel suites a handful of them can exceed bun's 5 s per-test default.
const ddlTimeoutMs = 30_000;
const migrationsFolder = new URL('../migrations', import.meta.url).pathname;

const withDatabase = async <T>(
  database: string,
  run: (client: SQL) => Promise<T>,
): Promise<T> => {
  const client = connect(database);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
};

/** What `bun slot:up` and `bun db:reset` do: migrate, then provision. */
const migrateAndProvision = async (database: string) => {
  await withDatabase(database, (client) =>
    migrate(drizzle({ client }), { migrationsFolder }),
  );
  await provisionTestRoles(admin, e2e);
};

/** Whether the e2e login can append to the outbox (a bigserial default). */
const e2eCanWrite = (database: string) =>
  withDatabase(database, async (client) => {
    await client.unsafe(`set role ${e2e.user}`);
    try {
      await client`
        insert into outbox (topic, kind, version, payload)
        values ('user:slotit:inbox', 'session.revoked', 1, ${{ version: 1, kind: 'session.revoked', ids: [] }})
      `;
      return 'written';
    } catch (error) {
      return (error as { errno?: string }).errno ?? 'failed';
    }
  });

afterAll(async () => {
  for (const { name } of await listSlotDatabases(admin, prefix))
    await dropSlotDatabase(admin, name);
  await admin.close();
});

test(
  'a new slot database, migrated and provisioned, lets the e2e login write through daisy_web',
  async () => {
    const database = `${prefix}_a`;
    assert({
      given: 'the same slot database created twice',
      should: 'create it once and report the second call as a no-op',
      actual: [
        await createSlotDatabase(admin, database),
        await createSlotDatabase(admin, database),
      ],
      expected: [true, false],
    });
    await migrateAndProvision(database);
    await provisionTestRoles(admin, e2e);
    assert({
      given: 'the baseline applied and the test logins provisioned twice',
      should: 'let the e2e login insert into a bigserial table',
      actual: await e2eCanWrite(database),
      expected: 'written',
    });
  },
  ddlTimeoutMs,
);

test(
  'lists only the prefix, reads comments and force-drops one database',
  async () => {
    const kept = `${prefix}_kept`;
    const dropped = `${prefix}_dropped`;
    await createSlotDatabase(admin, kept);
    await createSlotDatabase(admin, dropped);
    await setSlotDatabaseComment(admin, kept, 'daisy-slot port-block=7');
    const listed = await listSlotDatabases(admin, `${prefix}_`);
    assert({
      given: 'two databases under a prefix, one with a claim comment',
      should: 'list both with their comments and nothing outside the prefix',
      actual: {
        mine: listed.filter(({ name }) => name === kept || name === dropped),
        allInPrefix: listed.every(({ name }) => name.startsWith(`${prefix}_`)),
      },
      expected: {
        mine: [
          { name: dropped, comment: null },
          { name: kept, comment: 'daisy-slot port-block=7' },
        ],
        allInPrefix: true,
      },
    });

    // An open session must not block the drop (WITH (FORCE)).
    const holder = connect(dropped);
    await holder`select 1`;
    await dropSlotDatabase(admin, dropped);
    await dropSlotDatabase(admin, dropped);
    const names = (await listSlotDatabases(admin, `${prefix}_`)).map(
      ({ name }) => name,
    );
    assert({
      given: 'a database dropped twice while a session holds it open',
      should: 'drop exactly that database and keep its sibling',
      actual: { dropped: names.includes(dropped), kept: names.includes(kept) },
      expected: { dropped: false, kept: true },
    });
    await holder.close().catch(() => undefined);
  },
  ddlTimeoutMs,
);

test(
  'db:reset re-applies the baseline and the test logins, so e2e keeps working (ISSUE-6)',
  async () => {
    const database = `${prefix}_reset`;
    await createSlotDatabase(admin, database);
    await migrateAndProvision(database);
    const before = await e2eCanWrite(database);
    await withDatabase(database, resetPublicSchema);
    const [emptied] = await withDatabase(
      database,
      (client) => client`select to_regclass('public.outbox') as table`,
    );
    await migrateAndProvision(database);
    assert({
      given: 'a slot database reset the way bun db:reset resets it',
      should:
        'drop every table, then let the e2e login write again after the re-migration',
      actual: {
        before,
        emptied: emptied?.table ?? null,
        after: await e2eCanWrite(database),
      },
      expected: { before: 'written', emptied: null, after: 'written' },
    });
  },
  ddlTimeoutMs,
);

test('slot administration is serialized across concurrent checkouts', async () => {
  const sessions = [connect('postgres'), connect('postgres')];
  const events: string[] = [];
  const critical = (name: string) => async () => {
    events.push(`${name}:start`);
    await Bun.sleep(150);
    events.push(`${name}:end`);
  };
  try {
    await Promise.all([
      withSlotLock(sessions[0]!, critical('a')),
      withSlotLock(sessions[1]!, critical('b')),
    ]);
    const first = events[0]?.split(':')[0];
    const second = first === 'a' ? 'b' : 'a';
    assert({
      given: 'two checkouts entering slot administration at once',
      should: 'let whichever holds the lock finish before the other starts',
      actual: events,
      expected: [
        `${first}:start`,
        `${first}:end`,
        `${second}:start`,
        `${second}:end`,
      ],
    });
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
  }
});

test('refuses identifiers and literals that are not on the allowlist', async () => {
  for (const hostile of [
    'x"; drop database daisy; --',
    'Upper',
    'has space',
    'a'.repeat(64),
    '',
  ]) {
    await expect(createSlotDatabase(admin, hostile)).rejects.toThrow(
      /identifier/,
    );
    await expect(dropSlotDatabase(admin, hostile)).rejects.toThrow(
      /identifier/,
    );
  }
  await expect(
    setSlotDatabaseComment(admin, `${prefix}_a`, "x'; drop database daisy; --"),
  ).rejects.toThrow(/comment/);
  await expect(
    provisionTestRoles(admin, { user: 'daisy_e2e', password: "p'w" }),
  ).rejects.toThrow(/password/);
});
