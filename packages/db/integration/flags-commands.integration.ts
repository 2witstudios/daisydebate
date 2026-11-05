import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { flagCommand, withFlags } from './flags.test-support';

setupRitewayBun();
test('Flags revisions serialize competing commands; identical retries have one receipt and audit', async () => {
  await withFlags(async ({ store, fixture, key }) => {
    const first = flagCommand(key, 0);
    const results = await Promise.allSettled([
      store.runFlagCommand(first),
      store.runFlagCommand(first),
    ]);
    const stale = await Promise.allSettled([
      store.runFlagCommand(flagCommand(key, 1)),
      store.runFlagCommand(flagCommand(key, 1)),
    ]);
    const [counts] = await fixture.sql`select
      (select count(*)::int from flag_change_events where key=${key}) as events,
      (select count(*)::int from operator_command_receipts where result->>'key'=${key}) as receipts,
      (select revision from release_flags where key=${key}) as revision`;
    assert({
      given:
        'duplicate command and then two distinct commands at the same revision',
      should:
        'replay once and accept exactly one competing revision with atomic audit',
      actual: {
        replay: results.map((r) => r.status),
        contenders: stale.map((r) => r.status).sort(),
        counts,
      },
      expected: {
        replay: ['fulfilled', 'fulfilled'],
        contenders: ['fulfilled', 'rejected'],
        counts: { events: 2, receipts: 2, revision: 2 },
      },
    });
    await assertRejects({
      given: 'the same command id with another semantic digest',
      should: 'refuse replay',
      actual: () =>
        store.runFlagCommand({ ...first, requestDigest: 'c'.repeat(64) }),
      code: 'CONFLICT',
    });
  });
});
test('Flags authorization, audit insertion failure and deadline refusal leave no partial state', async () => {
  await withFlags(async ({ store, fixture, key }) => {
    await assertRejects({
      given: 'an unauthorized caller',
      should: 'refuse before mutation',
      actual: () =>
        store.runFlagCommand(
          flagCommand(key, 0, undefined, { authorize: () => false }),
        ),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'a deadline that expires before commit',
      should: 'roll back all writes',
      actual: () =>
        store.runFlagCommand(
          flagCommand(key, 0, undefined, { live: () => false }),
        ),
      code: 'CONFLICT',
    });
    const accepted = flagCommand(key, 0);
    await store.runFlagCommand(accepted);
    const [audit] =
      await fixture.sql`select id from flag_change_events where key=${key}`;
    const failed = await Promise.allSettled([
      store.runFlagCommand(
        flagCommand(key, 1, undefined, { nextId: () => audit!.id }),
      ),
    ]);
    const [state] = await fixture.sql`select revision,
      (select count(*)::int from flag_change_events where key=${key}) as events,
      (select count(*)::int from operator_command_receipts where result->>'key'=${key}) as receipts
      from release_flags where key=${key}`;
    assert({
      given: 'an audit primary-key failure after the state update',
      should: 'roll the new revision back with no extra receipt',
      actual: { status: failed[0]!.status, state },
      expected: {
        status: 'rejected',
        state: { revision: 1, events: 1, receipts: 1 },
      },
    });
  });
});
test('Flags targeting never creates paid entitlement and expiry is visible before bounded sweep', async () => {
  await withFlags(async ({ store, fixture, key, userId }) => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await store.runFlagCommand(
      flagCommand(key, 0, {
        action: 'flag.override.update',
        accountId: userId,
        override: { enabled: true, expiresAt },
      }),
    );
    const [grants] =
      await fixture.sql`select count(*)::integer as n from account_entitlement_grants where user_id=${userId}`;
    const read = await store.readFlagSnapshot(userId, [key]);
    await fixture.sql`update flag_account_overrides set created_at=clock_timestamp()-interval '2 days', expires_at=clock_timestamp()-interval '1 day' where key=${key}`;
    const expired = await store.readFlagSnapshot(userId, [key]);
    const count = await store.purgeExpiredFlagOverrides({
      before: new Date().toISOString(),
      limit: 1,
    });
    const after = await store.readFlagSnapshot(userId, [key]);
    assert({
      given:
        'a selected account and then an expired override with the sweep stopped',
      should:
        'leave entitlements empty, expose expiry at read time, and sweep with a revision advance',
      actual: {
        grants,
        targeted:
          read.snapshot.kind === 'available' &&
          read.snapshot.flags[0]!.override!.enabled,
        expired:
          expired.snapshot.kind === 'available' &&
          expired.snapshot.flags[0]!.override!.expiresAt <= expired.now,
        count,
        fact: after.snapshot.kind === 'available' && after.snapshot.flags[0],
      },
      expected: {
        grants: { n: 0 },
        targeted: true,
        expired: true,
        count: 1,
        fact: { key, revision: 2, state: 'default', override: null },
      },
    });
    await assertRejects({
      given: 'an override update using its pre-sweep revision',
      should: 'refuse the stale update',
      actual: () => store.runFlagCommand(flagCommand(key, 1)),
      code: 'CONFLICT',
    });
  });
});
