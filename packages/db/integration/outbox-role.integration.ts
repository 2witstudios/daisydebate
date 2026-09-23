import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { sqlStateOf } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/**
 * `daisy_realtime` (RT-2.2 migration 0004) is created without a password:
 * production sets its runtime credential out of band. Roles are
 * cluster-wide and every checkout's slot shares one cluster (ADR 0034), so
 * this test never sets a password on it: a dedicated single-connection
 * session switches to the role with SET ROLE, which drops the admin's
 * superuser rights and checks every statement against the role's grants.
 */

test('the realtime role can only select the outbox and authorization read models, column-scoped on actors and session; any other write is refused', async () => {
  let realtime: SQL | undefined;
  try {
    realtime = new SQL(url, { max: 1 });
    await realtime.unsafe('SET ROLE daisy_realtime');
    const [session] = await realtime.unsafe('select current_user as role');
    assert({
      given: 'the dedicated session after SET ROLE',
      should: 'run every statement as daisy_realtime',
      actual: session?.role,
      expected: 'daisy_realtime',
    });

    const selectOutbox = await sqlStateOf(() =>
      realtime!.unsafe('select seq from outbox limit 1'),
    );
    const selectDebates = await sqlStateOf(() =>
      realtime!.unsafe('select id from debates limit 1'),
    );
    const selectDebateParticipants = await sqlStateOf(() =>
      realtime!.unsafe(
        'select debate_id, actor_id from debate_participants limit 1',
      ),
    );
    const selectActors = await sqlStateOf(() =>
      realtime!.unsafe('select id, user_id from actors limit 1'),
    );
    // Column-scoped like session: kind and the audit timestamps carry
    // nothing realtime needs (plan revision 4.8, ADR 0032 §7).
    const selectActorsKind = await sqlStateOf(() =>
      realtime!.unsafe('select kind from actors limit 1'),
    );
    // No grant on users at all today (ADR 0032 §7): identity resolves
    // through actors.user_id. RT-3.2b adds the presence-preference column.
    const selectUsersAnyColumn = await sqlStateOf(() =>
      realtime!.unsafe('select id from users limit 1'),
    );
    const selectSessionIdentity = await sqlStateOf(() =>
      realtime!.unsafe('select id, user_id, expires_at from session limit 1'),
    );
    // The bearer credential; column-scoped grant must never include it.
    const selectSessionToken = await sqlStateOf(() =>
      realtime!.unsafe('select token from session limit 1'),
    );

    const insertOutbox = await sqlStateOf(() =>
      realtime!.unsafe(
        "insert into outbox (topic, kind, version, payload) values ('t', 'k', 1, '{}'::jsonb)",
      ),
    );
    const updateOutbox = await sqlStateOf(() =>
      realtime!.unsafe("update outbox set kind = 'x' where seq = -1"),
    );
    const deleteOutbox = await sqlStateOf(() =>
      realtime!.unsafe('delete from outbox where seq = -1'),
    );
    const updateSession = await sqlStateOf(() =>
      realtime!.unsafe("update session set user_id = 'x' where id = 'none'"),
    );
    const insertActors = await sqlStateOf(() =>
      realtime!.unsafe(
        "insert into actors (id, kind, user_id) values ('x', 'human', null)",
      ),
    );
    const insertDebates = await sqlStateOf(() =>
      realtime!.unsafe(
        "insert into debates (id, resolution, format_id, snapshot, mode, phase, visibility) values ('x', 'r', 'f', '{}'::jsonb, 'casual', 'waiting', 'unlisted')",
      ),
    );

    assert({
      given: 'reads the role is granted',
      should:
        'succeed for outbox, debates, debate_participants, the two actors columns and the three session columns, and refuse users entirely, actors.kind and session.token',
      actual: {
        selectOutbox,
        selectDebates,
        selectDebateParticipants,
        selectActors,
        selectActorsKind,
        selectSessionIdentity,
        selectUsersAnyColumn,
        selectSessionToken,
      },
      expected: {
        selectOutbox: 'accepted',
        selectDebates: 'accepted',
        selectDebateParticipants: 'accepted',
        selectActors: 'accepted',
        selectActorsKind: '42501',
        selectSessionIdentity: 'accepted',
        selectUsersAnyColumn: '42501',
        selectSessionToken: '42501',
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
        insertOutbox: '42501',
        updateOutbox: '42501',
        deleteOutbox: '42501',
        updateSession: '42501',
        insertActors: '42501',
        insertDebates: '42501',
      },
    });
  } finally {
    await realtime?.close();
  }
});
