import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';

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

test('the realtime role can only select the outbox and authorization read models; any other write is refused', async () => {
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
    const selectUsers = await rejected(() =>
      realtime!.unsafe('select id from users limit 1'),
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
    const updateUsers = await rejected(() =>
      realtime!.unsafe("update users set username = 'x' where id = 'none'"),
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

    expect({
      selectOutbox,
      selectDebates,
      selectDebateParticipants,
      selectActors,
      selectUsers,
    }).toEqual({
      selectOutbox: false,
      selectDebates: false,
      selectDebateParticipants: false,
      selectActors: false,
      selectUsers: false,
    });
    expect({
      insertOutbox,
      updateOutbox,
      deleteOutbox,
      updateUsers,
      insertActors,
      insertDebates,
    }).toEqual({
      insertOutbox: true,
      updateOutbox: true,
      deleteOutbox: true,
      updateUsers: true,
      insertActors: true,
      insertDebates: true,
    });
  } finally {
    await realtime?.close();
    await admin.unsafe('ALTER ROLE daisy_realtime PASSWORD NULL');
    await admin.close();
  }
});
