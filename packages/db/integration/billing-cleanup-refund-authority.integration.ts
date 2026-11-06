import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { advanceCleanup, type CleanupState } from '@daisy/protocol/billing';
import { createDatabase } from '../src/index';
import { withBillingRefunds } from './billing-refunds.test-support';
import { sqlStateOf } from './constraint-helpers';

const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();
const candidate = new URL(
  '../migrations/20261106110238_stripe_invoice_pass_authority/migration.sql',
  import.meta.url,
);

test('current unlinked original refund action cannot be skipped by public resolution or raw deletion admission', async () => {
  await withBillingRefunds(
    async ({
      fixture,
      pool,
      userId,
      actorId,
      instanceId,
      refunds,
      payment,
    }) => {
      await fixture.sql.begin(async (tx) =>
        tx.unsafe(await Bun.file(candidate).text()),
      );
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        return connection;
      };
      const database = createDatabase({
          url: databaseUrl,
          client: pool,
          nextActorId: createId,
        }),
        cleanup = database.billingCleanup(instanceId);
      try {
        const admitted = await refunds.admit(userId, payment);
        if (!('action' in admitted))
          throw Error('Missing original owed action');
        const [original] =
          await fixture.sql`select * from billing_refund_actions where id=${admitted.action.id}`;
        let selected: {
          jobId: string;
          state: CleanupState;
          claimId: string;
          work: NonNullable<
            ReturnType<typeof import('@daisy/protocol/billing').cleanupWork>
          >;
        } | null = null;
        for (let n = 0; n < 8; n++) {
          const [job] =
            await fixture.sql`select id,retry_at from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
          await fixture.sql`select pg_sleep(greatest(0,extract(epoch from ${job!.retry_at}::timestamptz-clock_timestamp()))+.01)`;
          await database.renewServiceInstance({ instanceId, role: 'web' });
          const active = await cleanup.claim(job!.id);
          if (
            active.kind !== 'claimed' ||
            active.state.kind === 'acknowledged' ||
            !active.state.claim
          )
            throw Error('Missing controlled refund claim');
          const { work } = active,
            claimId = active.state.claim.id;
          if (work.kind !== 'scan') throw Error('Expected refund discovery');
          if (work.lane === 'refunds' && work.scan.kind === 'selected') {
            selected = { jobId: job!.id, state: active.state, claimId, work };
            break;
          }
          if (work.scan.kind !== 'page')
            throw Error('Unexpected selected resource');
          if (work.lane === 'invoices')
            await cleanup.retainInvoicePage(job!.id, claimId, work, {
              reads: [],
              more: false,
            });
          else {
            let ids: string[] = [];
            if (work.lane === 'purchases' || work.lane === 'refunds') {
              const page = await cleanup.resources(job!.id, claimId, work);
              if (page.kind !== 'page')
                throw Error('Missing controlled resource page');
              ids = [...page.ids];
            }
            await cleanup.record(job!.id, {
              kind: 'page',
              claimId,
              work,
              ids,
              more: false,
            });
          }
        }
        if (!selected) throw Error('Current original action was not selected');
        const [before] =
          await fixture.sql`select * from privacy_jobs where id=${selected.jobId}`;
        const [clock] = await fixture.sql`select clock_timestamp() as at`;
        const at = clock!.at.toISOString();
        const unchecked = advanceCleanup(
          selected.state,
          { kind: 'resolved', claimId: selected.claimId, work: selected.work },
          {
            now: at,
            jobId: selected.jobId,
            closed: true,
            effects: {
              mappedCustomers: 1,
              possiblePurchases: 0,
              retainedFinancialRoutes: 1,
              owedFinancialEffects: false,
            },
          },
        );
        if (
          unchecked.kind !== 'progress' ||
          unchecked.state.kind !== 'deleting'
        )
          throw Error('Missing adverse deletion projection');
        const deletion = unchecked.state;
        const raw = await fixture.sql.begin(async (tx) => {
          await tx`set local role daisy_web`;
          await tx`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[],null::text,true)`;
          await tx`savepoint owed_refund_probe`;
          const code = await sqlStateOf(
            () =>
              tx`update privacy_jobs set billing_cleanup=${JSON.stringify(deletion)}::text::jsonb,retry_at=${deletion.retryAt}::timestamptz where id=${selected!.jobId}`,
          );
          await tx`rollback to savepoint owed_refund_probe`;
          return code;
        });
        const result = await cleanup.record(selected.jobId, {
          kind: 'resolved',
          claimId: selected.claimId,
          work: selected.work,
        });
        assert({
          given:
            'a current original action still ready/unlinked, with no retained observation row',
          should:
            'refuse public selection relief and raw deletion while preserving the original action and queue',
          actual: [
            raw,
            result,
            (
              await fixture.sql`select * from privacy_jobs where id=${selected.jobId}`
            )[0],
            (
              await fixture.sql`select * from billing_refund_actions where id=${admitted.action.id}`
            )[0],
          ],
          expected: ['23514', 'idle', before, original],
        });
      } finally {
        pool.reserve = reserve;
      }
    },
  );
}, 15_000);
