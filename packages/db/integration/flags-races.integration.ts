import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { requireFlagAdmission } from '../src/flags';
import { lockAuthorizationActors } from '../src/authorization';
import { lockFlags } from '../src/flags-lock';
import { runFlagCommand } from '../src/flags-command';
import { readFlagSnapshot } from '../src/flags-read';
import {
  withFlags,
  flagCommand,
  barrier,
  waitingForFlags,
} from './flags.test-support';

requireTestServices(process.env);
setupRitewayBun();
test('expiry sweep and targeting update serialize in both real lock orders', async () => {
  for (const first of ['sweep', 'update'] as const)
    await withFlags(async ({ fixture, database, store, key, userId }) => {
      await store.runFlagCommand(
        flagCommand(key, 0, {
          action: 'flag.override.update',
          accountId: userId,
          override: {
            enabled: true,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
      );
      await fixture.sql`update flag_account_overrides set created_at=clock_timestamp()-interval '3 days',expires_at=clock_timestamp()-interval '2 days' where key=${key}`;
      const held = barrier();
      const finish = barrier();
      const holder = database.transaction(async (tx) => {
        await lockFlags(tx, 'write');
        held.release();
        await finish.ready;
      });
      await held.ready;
      const sweep = () =>
        store.purgeExpiredFlagOverrides({
          before: new Date().toISOString(),
          limit: 1,
        });
      const update = () =>
        store.runFlagCommand(
          flagCommand(key, 1, {
            action: 'flag.override.update',
            accountId: userId,
            override: {
              enabled: true,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
        );
      const leading = Promise.allSettled([
        first === 'sweep' ? sweep() : update(),
      ]);
      let trailing!: Promise<PromiseSettledResult<unknown>[]>;
      try {
        await waitingForFlags(fixture);
        trailing = Promise.allSettled([first === 'sweep' ? update() : sweep()]);
        await waitingForFlags(fixture, 2);
      } finally {
        finish.release();
      }
      await holder;
      const [a] = await leading;
      const [b] = await trailing;
      const read = await store.readFlagSnapshot(userId, [key]);
      assert({
        given: `the ${first} reaches the global lock first while the other races`,
        should:
          'preserve a renewed override or reject a stale expected revision after sweep',
        actual: {
          first: a!.status,
          second: b!.status,
          revision: read.snapshot.flags[0]!.revision,
          targeted: read.snapshot.flags[0]!.override !== null,
        },
        expected: {
          first: 'fulfilled',
          second: first === 'sweep' ? 'rejected' : 'fulfilled',
          revision: 2,
          targeted: first === 'update',
        },
      });
    });
});

test('a signed command deadline expiring behind the Flags lock rolls back state, audit and receipt', async () => {
  await withFlags(async ({ fixture, database, store, key }) => {
    const held = barrier();
    const finish = barrier();
    let live = true;
    const holder = database.transaction(async (tx) => {
      await lockFlags(tx, 'write');
      held.release();
      await finish.ready;
    });
    await held.ready;
    const pending = store.runFlagCommand(
      flagCommand(key, 0, undefined, { live: () => live }),
    );
    const observed = Promise.allSettled([pending]);
    try {
      await waitingForFlags(fixture);
      live = false;
    } finally {
      finish.release();
    }
    await holder;
    await observed;
    await assertRejects({
      given: 'the signed deadline passes while a real lock is held',
      should: 'refuse the delayed command',
      actual: () => pending,
      code: 'CONFLICT',
    });
    const [counts] = await fixture.sql`select
      (select count(*)::int from release_flags where key=${key}) as state,
      (select count(*)::int from flag_change_events where key=${key}) as audit,
      (select count(*)::int from operator_command_receipts where result->>'key'=${key}) as receipts`;
    assert({
      given: 'the refused delayed command',
      should: 'leave no durable effect',
      actual: counts,
      expected: { state: 0, audit: 0, receipts: 0 },
    });
  });
});

test('the final migrated daisy_web role can control/read targeting and cannot delete permanent revision state', async () => {
  await withFlags(async ({ database, key, userId, actorId }) => {
    const fact = await database.transaction(async (tx) => {
      await tx.execute(sql`set local role daisy_web`);
      await runFlagCommand(
        tx,
        flagCommand(key, 0, {
          action: 'flag.override.update',
          accountId: userId,
          override: {
            enabled: true,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
      );
      return readFlagSnapshot(tx, userId, [key]);
    });
    const admit = () =>
      database.transaction(async (tx) => {
        await tx.execute(sql`set local role daisy_web`);
        await lockAuthorizationActors(tx, [actorId], { maxActors: 1 });
        return requireFlagAdmission(tx, userId, {
          keys: [key],
          decide: (snapshot, now) =>
            snapshot.kind === 'available' &&
            snapshot.flags[0]!.state !== 'killed' &&
            (snapshot.flags[0]!.override?.expiresAt ?? 0) > now,
        });
      });
    const admitted = await admit();
    await database.transaction(async (tx) => {
      await tx.execute(sql`set local role daisy_web`);
      await runFlagCommand(
        tx,
        flagCommand(key, 1, { action: 'flag.state.update', state: 'killed' }),
      );
    });
    await assertRejects({
      given: 'the runtime role admits after a completed kill',
      should: 'refuse new work through the real admission adapter',
      actual: admit,
      code: 'NOT_FOUND',
    });
    const deletion = await Promise.allSettled([
      database.transaction(async (tx) => {
        await tx.execute(sql`set local role daisy_web`);
        await tx.execute(sql`delete from release_flags where key=${key}`);
      }),
    ]);
    assert({
      given: 'the least-privilege runtime role on the final migration',
      should:
        'write and read through the real command path while preserving permanent revision history',
      actual: {
        targeted: fact.snapshot.flags[0]!.override!.enabled,
        admitted: Number.isFinite(Date.parse(admitted.admittedAt)),
        deletion: deletion[0]!.status,
      },
      expected: { targeted: true, admitted: true, deletion: 'rejected' },
    });
  });
});
