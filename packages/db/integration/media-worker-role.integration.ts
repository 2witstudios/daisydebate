import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaWorkerDatabase } from '../src/media-worker-database';
import { sqlStateOf, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const asWorker = (client: SQL, statement: string, values: unknown[] = []) =>
  sqlStateOf(() =>
    client.begin(async (tx) => {
      await tx`set local role daisy_media_worker`;
      await tx.unsafe(statement, values);
    }),
  );

test('the media worker role reads capture authority and writes nothing', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const sessionId = createId();
    await fixture.insert('media_sessions', {
      id: sessionId,
      round_id: roundId,
      room_name: createId(),
    });
    const granted = await Promise.all(
      [
        'select id,status from rounds limit 1',
        'select id,role from round_participants limit 1',
        'select id,started_at from round_segments limit 1',
        'select id,ended_at from media_sessions limit 1',
        'select identity from media_participants limit 1',
        'select epoch,expires_at from media_worker_leases limit 1',
      ].map((statement) => asWorker(fixture.sql, statement)),
    );
    assert({
      given: 'each table the capture worker discovers sessions from',
      should: 'grant SELECT',
      actual: granted,
      expected: Array(6).fill('accepted'),
    });
    const refused = await Promise.all(
      [
        ['select id from users limit 1'],
        ['select text from utterances limit 1'],
        ['update rounds set version=version where id=$1', [roundId]],
        ['delete from media_sessions where id=$1', [sessionId]],
        [
          'insert into media_worker_leases(session_id,worker_id,epoch,expires_at) values($1,$2,1,clock_timestamp())',
          [sessionId, createId()],
        ],
        ['delete from media_worker_leases where session_id=$1', [sessionId]],
      ].map(([statement, values]) =>
        asWorker(fixture.sql, statement as string, values as unknown[]),
      ),
    );
    assert({
      given:
        'reads outside capture authority, competitive writes and direct lease writes',
      should:
        'refuse them: leases move only through the locked signed web path',
      actual: refused,
      expected: Array(6).fill('42501'),
    });
  });
});

test('discovery under the worker role finds sessions needing a capture worker', async () => {
  await withFixture(url, async (fixture) => {
    const session = async (roundId: string) => {
      const id = createId();
      await fixture.insert('media_sessions', {
        id,
        round_id: roundId,
        room_name: createId(),
      });
      return id;
    };
    const lease = (sessionId: string, interval: string) =>
      fixture.sql.unsafe(
        `insert into media_worker_leases(session_id,worker_id,epoch,expires_at) values($1,$2,1,clock_timestamp()+interval '${interval}')`,
        [sessionId, createId()],
      );
    const unleased = await fixture.round();
    const unleasedId = await session(unleased);
    const held = await session(await fixture.round());
    await lease(held, '30 seconds');
    const expired = await fixture.round();
    const expiredId = await session(expired);
    await lease(expiredId, '-1 second');
    const ended = await session(await fixture.round());
    await fixture.sql.unsafe(
      'update media_sessions set ended_at=clock_timestamp() where id=$1',
      [ended],
    );
    const unsafe = await session(await fixture.round());
    await fixture.sql.unsafe(
      'update media_sessions set unsafe_at=clock_timestamp() where id=$1',
      [unsafe],
    );
    const abandonedRound = await fixture.round();
    const abandoned = await session(abandonedRound);
    await fixture.sql.unsafe(
      "update rounds set status='abandoned',completed_at=clock_timestamp() where id=$1",
      [abandonedRound],
    );
    const client = new SQL(url, { max: 1 });
    await client`set role daisy_media_worker`;
    const worker = createMediaWorkerDatabase({ url, client });
    try {
      const found = await worker.discoverCaptureSessions(64);
      const mine = new Set([
        unleasedId,
        held,
        expiredId,
        ended,
        unsafe,
        abandoned,
      ]);
      assert({
        given:
          'unleased, live-leased, expired, ended, unsafe and abandoned sessions',
        should:
          'offer only the unleased and expired sessions of open Rounds, as scope',
        actual: found
          .filter((s) => mine.has(s.sessionId))
          .sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
        expected: [
          { roundId: unleased, sessionId: unleasedId },
          { roundId: expired, sessionId: expiredId },
        ].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
      });
      assert({
        given: 'a limit outside 1..64',
        should: 'refuse rather than scan unbounded',
        actual: await worker.discoverCaptureSessions(0).then(
          () => 'accepted',
          (error: { code?: string }) => error.code,
        ),
        expected: 'VALIDATION',
      });
    } finally {
      await worker.close();
    }
  });
});

test('the worker refuses a database login broader than its role', async () => {
  const problemsAs = async (role?: string) => {
    const client = new SQL(url, { max: 1 });
    if (role) await client.unsafe(`set role ${role}`);
    const worker = createMediaWorkerDatabase({ url, client });
    try {
      return await worker.privilegeProblems();
    } finally {
      await worker.close();
    }
  };
  assert({
    given: 'the migration owner, the web runtime role and the worker role',
    should: 'refuse the owner and the web role and accept only the worker role',
    actual: [
      (await problemsAs()).includes('writes'),
      await problemsAs('daisy_web'),
      await problemsAs('daisy_media_worker'),
    ],
    expected: [true, ['not a capture worker', 'writes', 'reads'], []],
  });
});

test('the worker refuses a capture login with any broader privilege', async () => {
  const admin = new SQL(url, { max: 1 });
  const [{ database }] = await admin`select current_database() as database`;
  const problemsWith = async (grant: (role: string) => string) => {
    const role = `media_worker_probe_${createId()}`;
    await admin.unsafe(
      `create role ${role} nologin in role daisy_media_worker`,
    );
    try {
      await admin.unsafe(grant(role));
      const client = new SQL(url, { max: 1 });
      await client.unsafe(`set role ${role}`);
      const worker = createMediaWorkerDatabase({ url, client });
      try {
        return await worker.privilegeProblems();
      } finally {
        await worker.close();
      }
    } finally {
      await admin.unsafe(`drop owned by ${role}`);
      await admin.unsafe(`drop role ${role}`);
    }
  };
  try {
    assert({
      given:
        'a capture worker login that can create roles or databases, bypass RLS, replicate, read beyond its six tables, belongs to pg_read_all_data, writes a non-public table or a sequence, or creates in the database or a schema',
      should: 'name each broader privilege so startup and doctor refuse it',
      actual: [
        await problemsWith((r) => `alter role ${r} createrole`),
        await problemsWith((r) => `alter role ${r} createdb`),
        await problemsWith((r) => `alter role ${r} bypassrls`),
        await problemsWith((r) => `alter role ${r} replication`),
        await problemsWith((r) => `grant select on users to ${r}`),
        await problemsWith((r) => `grant pg_read_all_data to ${r}`),
        await problemsWith(
          (r) =>
            `grant usage on schema drizzle to ${r}; grant insert on drizzle.__drizzle_migrations to ${r}`,
        ),
        await problemsWith(
          (r) => `grant update on all sequences in schema public to ${r}`,
        ),
        await problemsWith(
          (r) => `grant create on database "${database}" to ${r}`,
        ),
        await problemsWith((r) => `grant create on schema public to ${r}`),
      ],
      expected: [
        ['createrole'],
        ['createdb'],
        ['bypassrls'],
        ['replication'],
        ['reads'],
        ['reads', 'other roles'],
        ['writes'],
        ['writes'],
        ['creates'],
        ['creates'],
      ],
    });
  } finally {
    await admin.close();
  }
});
