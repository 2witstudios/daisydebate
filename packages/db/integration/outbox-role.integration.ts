import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

/**
 * `daisy_realtime` (RT-2.2 migration 0004) is created without a password:
 * production sets its runtime credential out of band. This test owns its
 * own throwaway credential lifecycle so it never depends on, or commits,
 * a real one.
 */
const TEST_PASSWORD = `outbox-role-test-${createId()}`;

const rejected = async (attempt: () => Promise<unknown>) => {
  try {
    await attempt();
    return false;
  } catch {
    return true;
  }
};

test('the realtime role can only select the outbox and authorization read models, column-scoped on users and session; any other write is refused', async () => {
  const admin = new SQL(url, { max: 1 });
  let realtime: SQL | undefined;
  try {
    await admin.unsafe(
      `ALTER ROLE daisy_realtime LOGIN PASSWORD '${TEST_PASSWORD}'`,
    );
    const realtimeUrl = new URL(url);
    realtimeUrl.username = 'daisy_realtime';
    realtimeUrl.password = TEST_PASSWORD;
    realtime = new SQL(realtimeUrl.toString(), { max: 1 });

    const selectOutbox = await rejected(() =>
      realtime!.unsafe('select seq from outbox limit 1'),
    );
    const selectDebates = await rejected(() =>
      realtime!.unsafe('select id from debates limit 1'),
    );
    const selectDebateParticipants = await rejected(() =>
      realtime!.unsafe('select id from debate_participants limit 1'),
    );
    const selectActors = await rejected(() =>
      realtime!.unsafe('select id from actors limit 1'),
    );
    // No grant on users at all today (ADR 0032 §7): identity resolves
    // through actors.user_id. RT-3.2b adds the presence-preference column.
    const selectUsersAnyColumn = await rejected(() =>
      realtime!.unsafe('select id from users limit 1'),
    );
    const selectSessionIdentity = await rejected(() =>
      realtime!.unsafe('select id, user_id, expires_at from session limit 1'),
    );
    // The bearer credential; column-scoped grant must never include it.
    const selectSessionToken = await rejected(() =>
      realtime!.unsafe('select token from session limit 1'),
    );

    const insertOutbox = await rejected(() =>
      realtime!.unsafe(
        "insert into outbox (topic, kind, version, payload) values ('t', 'k', 1, '{}'::jsonb)",
      ),
    );
    const updateOutbox = await rejected(() =>
      realtime!.unsafe("update outbox set kind = 'x' where seq = -1"),
    );
    const deleteOutbox = await rejected(() =>
      realtime!.unsafe('delete from outbox where seq = -1'),
    );
    const updateSession = await rejected(() =>
      realtime!.unsafe("update session set user_id = 'x' where id = 'none'"),
    );
    const insertActors = await rejected(() =>
      realtime!.unsafe(
        "insert into actors (id, kind, user_id) values ('x', 'human', null)",
      ),
    );
    const insertDebates = await rejected(() =>
      realtime!.unsafe(
        "insert into debates (id, resolution, format, snapshot, mode, phase, visibility) values ('x', 'r', 'f', '{}'::jsonb, 'casual', 'waiting', 'unlisted')",
      ),
    );

    assert({
      given: 'reads the role is granted',
      should:
        'succeed for outbox, debates, debate_participants, actors and the three session columns, and refuse users entirely and session.token',
      actual: {
        selectOutbox,
        selectDebates,
        selectDebateParticipants,
        selectActors,
        selectSessionIdentity,
        selectUsersAnyColumn,
        selectSessionToken,
      },
      expected: {
        selectOutbox: false,
        selectDebates: false,
        selectDebateParticipants: false,
        selectActors: false,
        selectSessionIdentity: false,
        selectUsersAnyColumn: true,
        selectSessionToken: true,
      },
    });
    assert({
      given:
        'writes anywhere the role is not explicitly granted service_instances on',
      should: 'refuse every one',
      actual: {
        insertOutbox,
        updateOutbox,
        deleteOutbox,
        updateSession,
        insertActors,
        insertDebates,
      },
      expected: {
        insertOutbox: true,
        updateOutbox: true,
        deleteOutbox: true,
        updateSession: true,
        insertActors: true,
        insertDebates: true,
      },
    });
  } finally {
    await realtime?.close();
    await admin.unsafe('ALTER ROLE daisy_realtime PASSWORD NULL');
    await admin.close();
  }
});
