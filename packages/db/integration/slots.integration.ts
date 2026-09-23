import { afterAll, expect } from 'bun:test';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import {
  createSlotDatabase,
  dropSlotDatabase,
  ensureE2ERole,
  ensureTemplate,
  listSlotDatabases,
  resetPublicSchema,
  setSlotDatabaseComment,
  withSlotLock,
} from '../src/slots';

setupRitewayBun();
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

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
const template = `${prefix}_template`;
// CREATE/DROP DATABASE copy and remove files; under a machine full of
// parallel suites a handful of them can exceed bun's 5 s per-test default.
const ddlTimeoutMs = 30_000;

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

/** Creates a table and a sequence as the migration role, then reads grants. */
const e2eAccessToNewObjects = (client: SQL) =>
  client.begin(async (transaction) => {
    await transaction`create table public.slot_probe (id integer)`;
    await transaction`create sequence public.slot_probe_seq`;
    const [row] = await transaction`
      select
        has_schema_privilege('daisy_e2e', 'public', 'USAGE') as schema,
        has_table_privilege('daisy_e2e', 'public.slot_probe',
          'SELECT,INSERT,UPDATE,DELETE') as tables,
        has_sequence_privilege('daisy_e2e', 'public.slot_probe_seq',
          'USAGE,SELECT') as sequences
    `;
    await transaction`drop table public.slot_probe`;
    await transaction`drop sequence public.slot_probe_seq`;
    return row as { schema: boolean; tables: boolean; sequences: boolean };
  });

afterAll(async () => {
  await admin`update pg_database set datistemplate = false where datname = ${template}`;
  for (const { name } of await listSlotDatabases(admin, prefix))
    await dropSlotDatabase(admin, name);
  await admin.close();
});

const allGranted = { schema: true, tables: true, sequences: true };

test(
  'a slot database copied from the template carries the e2e grants',
  async () => {
    await ensureE2ERole(admin, e2e);
    await ensureE2ERole(admin, e2e);
    await ensureTemplate({ admin, connect, template, e2eUser: e2e.user });
    await ensureTemplate({ admin, connect, template, e2eUser: e2e.user });
    const [templateRow] = await admin`
      select datistemplate, datallowconn from pg_database where datname = ${template}
    `;
    assert({
      given: 'the template ensured twice',
      should: 'be a template that accepts no connections',
      actual: templateRow,
      expected: { datistemplate: true, datallowconn: false },
    });

    const database = `${prefix}_a`;
    assert({
      given: 'the same slot database created twice',
      should: 'create it once and report the second call as a no-op',
      actual: [
        await createSlotDatabase(admin, database, template),
        await createSlotDatabase(admin, database, template),
      ],
      expected: [true, false],
    });
    assert({
      given: 'a table and a sequence the migration role creates in the copy',
      should: 'grant daisy_e2e schema usage, table DML and sequence use',
      actual: await withDatabase(database, e2eAccessToNewObjects),
      expected: allGranted,
    });
  },
  ddlTimeoutMs,
);

test(
  'lists only the prefix, reads comments and force-drops one database',
  async () => {
    const kept = `${prefix}_kept`;
    const dropped = `${prefix}_dropped`;
    await createSlotDatabase(admin, kept, template);
    await createSlotDatabase(admin, dropped, template);
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
  'resetting the public schema keeps the e2e grants',
  async () => {
    const database = `${prefix}_reset`;
    await createSlotDatabase(admin, database, template);
    await withDatabase(database, async (client) => {
      await client`create table public.leftover (id integer)`;
      await resetPublicSchema(client, e2e.user);
      const [row] =
        await client`select to_regclass('public.leftover') as table`;
      assert({
        given: 'a slot database with a table, reset',
        should: 'drop the table and keep the e2e grants for new objects',
        actual: {
          leftover: row?.table ?? null,
          grants: await e2eAccessToNewObjects(client),
        },
        expected: { leftover: null, grants: allGranted },
      });
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
    await expect(createSlotDatabase(admin, hostile, template)).rejects.toThrow(
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
    ensureE2ERole(admin, { user: 'daisy_e2e', password: "p'w" }),
  ).rejects.toThrow(/password/);
});
