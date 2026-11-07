import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { flagCommand, withFlags, barrier } from './flags.test-support';
import { flagsPrivacyAdopter } from '../src/flags-privacy';
import { runPrivacyErasure, runPrivacyExport } from '../src/privacy/operations';
import { subjectRightsVerificationBindings } from '../src/privacy/verification-bindings';
import { sqlStateOf } from './constraint-helpers';

requireTestServices(process.env);
setupRitewayBun();
const override = (accountId: string) => ({
  action: 'flag.override.update' as const,
  accountId,
  override: {
    enabled: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
});

test('Flags export owns its targeting; erasure removes targeting linkage while preserving audit and refusing retries', async () => {
  await withFlags(
    async ({ fixture, database, store, key, userId, actorId }) => {
      const command = flagCommand(key, 0, override(userId));
      await store.runFlagCommand(command);
      const exported = await runPrivacyExport(database, { userId, actorId }, [
        flagsPrivacyAdopter,
      ]);
      const held = barrier();
      const finish = barrier();
      const erasure = runPrivacyErasure(
        database,
        {
          subject: { userId, actorId },
          now: new Date().toISOString(),
          vendors: [],
          jobIds: [],
        },
        [
          {
            id: 'fixture-fence',
            phase: 'before-auth',
            export: async () => ({}),
            erase: async () => {
              held.release();
              await finish.ready;
            },
          },
          flagsPrivacyAdopter,
        ],
        subjectRightsVerificationBindings,
      );
      await held.ready;
      const concurrent = Promise.allSettled([
        store.runFlagCommand(flagCommand(key, 1, override(userId))),
      ]);
      try {
        const deadline = Date.now() + 1500;
        for (;;) {
          const [waiting] =
            await fixture.sql`select count(*)::int as n from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock'
          and query like '%daisy_authorization_accounts_v2%'`;
          if (waiting?.n > 0) break;
          if (Date.now() >= deadline)
            throw new Error(
              'targeting did not wait on canonical account fence',
            );
          await Bun.sleep(5);
        }
      } finally {
        finish.release();
      }
      await erasure;
      await assertRejects({
        given:
          'an old successful targeting command retried after account erasure',
        should: 'refuse instead of restoring targeting',
        actual: () => store.runFlagCommand(command),
        code: 'NOT_FOUND',
      });
      const [counts] = await fixture.sql`select
      (select count(*)::int from flag_account_overrides where key=${key}) as overrides,
      (select count(*)::int from operator_command_receipts where result->>'key'=${key}) as receipts,
      (select count(*)::int from flag_change_events where key=${key}) as events,
      (select revision from release_flags where key=${key}) as revision`;
      assert({
        given:
          'erasure wins the account fence against a concurrent targeting writer',
        should:
          'export own records, remove targeting and preserve audit without resurrection',
        actual: {
          exported: Object.fromEntries(
            Object.entries(exported).map(([key, rows]) => [key, rows.length]),
          ),
          concurrent: (await concurrent)[0]!.status,
          counts,
        },
        expected: {
          exported: { users: 1, flag_account_overrides: 1, flag_commands: 1 },
          concurrent: 'rejected',
          counts: { overrides: 0, receipts: 1, events: 1, revision: 2 },
        },
      });
    },
  );
});

test('Flags audit is append-only to runtime; retention is bounded and cannot erase recent evidence or live accounts', async () => {
  await withFlags(async ({ fixture, store, key, userId }) => {
    await store.runFlagCommand(flagCommand(key, 0, override(userId)));
    const refused = await Promise.all(
      ['delete', 'update'].map((kind) =>
        sqlStateOf(() =>
          fixture.sql.begin(async (tx) => {
            await tx`set local role daisy_web`;
            if (kind === 'delete')
              await tx`delete from flag_change_events where key=${key}`;
            else
              await tx`update flag_change_events set revision=3 where key=${key}`;
          }),
        ),
      ),
    );
    const liveErase = await sqlStateOf(() =>
      fixture.sql.begin(async (tx) => {
        await tx`set local role daisy_web`;
        await tx`select public.daisy_erase_flag_subject(${userId})`;
      }),
    );
    const recent = await store.purgeExpiredFlagEvidence({
      before: '9999-01-01T00:00:00.000Z',
      limit: 1,
    });
    await store.runFlagCommand(flagCommand(key, 1));
    await fixture.sql`update operator_command_receipts set created_at=clock_timestamp()-interval '91 days' where result->>'key'=${key}`;
    const removed = await fixture.sql.begin(async (client) => {
      await client`set local role daisy_web`;
      const database = drizzle({ client });
      const [row] =
        await client`select public.daisy_purge_flag_evidence(clock_timestamp(), 1) as n`;
      // A fresh runtime read still works after its unrelated evidence was pruned.
      await flagsPrivacyAdopter.export(database, { userId, actorId: 'unused' });
      return row!.n;
    });
    const [remaining] = await fixture.sql`select
      (select count(*)::int from operator_command_receipts where result->>'key'=${key}) as receipts,
      (select count(*)::int from flag_change_events where key=${key}) as events`;
    assert({
      given: 'runtime audit edits, live-account erasure and retention requests',
      should:
        'deny ordinary edits, enforce the 90-day floor and delete at most one linked command per batch',
      actual: { refused, liveErase, recent, removed, remaining },
      expected: {
        refused: ['42501', '42501'],
        liveErase: '23514',
        recent: 0,
        removed: 1,
        remaining: { receipts: 1, events: 1 },
      },
    });
  });
});

test('closing a targeted account unlinks only Flags receipts and preserves other operator audit', async () => {
  await withFlags(
    async ({ fixture, database, store, key, userId, actorId }) => {
      const command = flagCommand(key, 0, override(userId));
      await store.runFlagCommand(command);
      const otherCommand = createId();
      await fixture.sql`insert into operator_command_receipts(command_id,service_id,operator_ref,action,target_user_id,request_digest,result,admin_audit_head)
      values(${otherCommand},'daisy-admin',${'o'.repeat(24)},'account.beta_access.update',${userId},${'b'.repeat(64)},'{}'::jsonb,${'a'.repeat(64)})`;
      try {
        await runPrivacyErasure(
          database,
          {
            subject: { userId, actorId },
            now: new Date().toISOString(),
            vendors: [],
            jobIds: [],
          },
          [flagsPrivacyAdopter],
          subjectRightsVerificationBindings,
        );
        const [evidence] = await fixture.sql`select
        (select target_user_id from operator_command_receipts where command_id=${command.commandId}) as flags_target,
        (select request_digest from operator_command_receipts where command_id=${command.commandId}) as digest,
        (select operator_ref from operator_command_receipts where command_id=${command.commandId}) as operator,
        (select target_user_id from operator_command_receipts where command_id=${otherCommand}) as other_target,
        (select count(*)::int from flag_change_events where command_id=${command.commandId}) as events`;
        assert({
          given:
            'a committed Flags targeting command and a different-action operator receipt before closure',
          should:
            'remove only the direct Flags target link while retaining both security audit trails',
          actual: evidence,
          expected: {
            flags_target: null,
            digest: command.requestDigest,
            operator: command.operatorRef,
            other_target: userId,
            events: 1,
          },
        });
      } finally {
        await fixture.sql`delete from operator_command_receipts where command_id=${otherCommand}`;
      }
    },
  );
});
