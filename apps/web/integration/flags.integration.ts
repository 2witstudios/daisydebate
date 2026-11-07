import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '@daisy/db';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { operatorLimits } from '@daisy/protocol/operator';
import {
  api,
  signed,
  now as signedNow,
} from '../src/features/operator-api/router.test-support';
import { createRequestFlagReader } from '../src/features/flags/reader';
import { releaseAdmission } from '../src/features/flags/admission';
import { testDatabaseUrl } from './fixtures';
import { withFlagsLock } from './flags-lock-fixture';

requireTestServices(process.env);
setupRitewayBun();
test('signed Flags operations resolve real targeting without granting paid access; failed database reads close display', async () => {
  const client = new SQL(testDatabaseUrl, { connectionTimeout: 2 });
  const database = createDatabase({
    url: testDatabaseUrl,
    nextActorId: createId,
  });
  const userId = createId();
  const actorId = createId();
  const key = 'premium-checkout';
  await client`insert into users(id,username) values(${userId},${`flags-${userId}`})`;
  await client`insert into actors(id,kind,user_id) values(${actorId},'human',${userId})`;
  try {
    const { handle } = api({ store: database, nextId: createId });
    const path = `/operator/v1/flags/${key}/account-override`;
    const body = {
      v: 1,
      commandId: createId(),
      expectedRevision: 0,
      adminAuditHead: 'a'.repeat(64),
      accountId: userId,
      override: {
        enabled: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    const put = () =>
      signed({ method: 'PUT', path, body: JSON.stringify(body) });
    const first = await handle(put());
    const retry = await handle(put());
    const readback = await handle(
      signed({
        method: 'GET',
        path: `/operator/v1/commands/${body.commandId}`,
      }),
    );
    const receipt = await readback.json();
    const changed = await handle(
      signed({
        method: 'PUT',
        path,
        body: JSON.stringify({ ...body, override: null }),
      }),
    );
    const read = () =>
      createRequestFlagReader({
        read: database.readFlagSnapshot,
        now: Date.now,
        diagnostic: () => {},
      });
    const targeted = await read()(key, userId);
    const ordinary = await read()(key, null);
    const facts = await database.readFlagSnapshot(userId, [key]);
    const admission = releaseAdmission(key).decide(facts.snapshot, facts.now);
    const [grants] =
      await client`select count(*)::int as n from account_entitlement_grants where user_id=${userId}`;
    const [written] = await client`select
      (select count(*)::int from flag_change_events where key=${key}) as events,
      (select count(*)::int from operator_command_receipts where command_id=${body.commandId}) as receipts`;
    await client`update flag_account_overrides set created_at=clock_timestamp()-interval '1 day', expires_at=clock_timestamp()-interval '1 second' where key=${key}`;
    const expired = await read()(key, userId);
    await database.close();
    let diagnostics = 0;
    const failedRead = createRequestFlagReader({
      read: database.readFlagSnapshot,
      now: Date.now,
      diagnostic: () => {
        diagnostics++;
      },
    });
    const failed = await failedRead(key, userId);
    assert({
      given:
        'signed operator targeting, semantic retry/conflict, ordinary account, expired override and unavailable PostgreSQL',
      should:
        'persist one audited command, resolve only current targeting, never grant entitlement and fail closed on storage failure',
      actual: {
        statuses: [first.status, retry.status, changed.status, readback.status],
        receiptAction: receipt.action,
        targeted,
        ordinary,
        admission,
        grants,
        written,
        expired,
        failed,
        diagnostics,
      },
      expected: {
        statuses: [200, 200, 409, 200],
        receiptAction: 'flag.override.update',
        targeted: true,
        ordinary: false,
        admission: true,
        grants: { n: 0 },
        written: { events: 1, receipts: 1 },
        expired: false,
        failed: false,
        diagnostics: 1,
      },
    });
  } finally {
    await database.close();
    await client`delete from flag_change_events where key=${key}`;
    await client`delete from operator_command_receipts where action in ('flag.state.update','flag.override.update') and result->>'key'=${key}`;
    await client`delete from flag_account_overrides where key=${key}`;
    await client`delete from release_flags where key=${key}`;
    await client`delete from actors where id=${actorId}`;
    await client`delete from users where id=${userId}`;
    await client.close();
  }
});

test('signed operator deadline expires during a real Flags lock wait and leaves no durable effects', async () => {
  const client = new SQL(testDatabaseUrl, { connectionTimeout: 2 });
  const database = createDatabase({
    url: testDatabaseUrl,
    nextActorId: createId,
  });
  const key = 'premium-checkout';
  const commandId = createId();
  await withFlagsLock(client, database, async (pid, release) => {
    try {
      let clock = signedNow;
      const { handle } = api({
        store: database,
        nextId: createId,
        nowMs: () => clock,
      });
      const request = handle(
        signed({
          method: 'PUT',
          path: `/operator/v1/flags/${key}/state`,
          body: JSON.stringify({
            v: 1,
            commandId,
            expectedRevision: 0,
            adminAuditHead: 'a'.repeat(64),
            state: 'enabled',
          }),
        }),
      );
      let waited: 'finished' | 'blocked';
      try {
        waited = await finishedOrBlockedBehind(request, client, pid, {
          now: Date.now,
          deadlineMs: 1500,
        });
        // The actual signedAtMs + operatorLimits.skewMs closure crosses its cutoff.
        clock = signedNow + operatorLimits.skewMs + 1;
      } finally {
        release();
        await request;
      }
      const response = await request;
      const [effects] = await client`select
      (select count(*)::int from release_flags where key=${key}) as state,
      (select count(*)::int from flag_change_events where command_id=${commandId}) as audit,
      (select count(*)::int from operator_command_receipts where command_id=${commandId}) as receipts`;
      assert({
        given:
          'a genuinely signed PUT admitted by the production router and blocked on a real PostgreSQL lock while its signed timestamp expires',
        should:
          'return conflict and atomically discard state, audit and receipt',
        actual: { waited, status: response.status, effects },
        expected: {
          waited: 'blocked',
          status: 409,
          effects: { state: 0, audit: 0, receipts: 0 },
        },
      });
    } finally {
      release();
      await client`delete from flag_change_events where command_id=${commandId}`;
      await client`delete from operator_command_receipts where command_id=${commandId}`;
      await client`delete from release_flags where key=${key}`;
    }
  });
});

test('failed or timed-out lock acquisition rejects readiness and closes both fixture pools', async () => {
  for (const mode of ['error', 'timeout'] as const) {
    const client = new SQL(testDatabaseUrl, { connectionTimeout: 2 });
    const database = createDatabase({
      url: testDatabaseUrl,
      nextActorId: createId,
    });
    await database.readFlagSnapshot(null, ['premium-checkout']);
    let ranProof = false;
    const failure = await withFlagsLock(
      client,
      database,
      async () => {
        ranProof = true;
      },
      (tx) => (mode === 'error' ? tx`select 1 / 0` : tx`select pg_sleep(10)`),
    ).then(
      () => null,
      (error: { errno?: string }) => error.errno,
    );
    const closed = await Promise.all([
      database.readFlagSnapshot(null, ['premium-checkout']).then(
        () => false,
        () => true,
      ),
      client`select 1`.then(
        () => false,
        () => true,
      ),
    ]);
    assert({
      given: `a real PostgreSQL ${mode} before the holder publishes its PID`,
      should:
        'reject readiness promptly, skip the proof and close both pools despite holder rejection',
      actual: { failure, ranProof, closed },
      expected: {
        failure: mode === 'error' ? '22012' : '57014',
        ranProof: false,
        closed: [true, true],
      },
    });
  }
});
