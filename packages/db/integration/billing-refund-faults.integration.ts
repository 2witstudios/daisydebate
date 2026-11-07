import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { createBillingRefundActions } from '../src/billing-refund-actions';
import { currentWebTransaction } from '../src/web-service-authority';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';
import { withBillingRefunds } from './billing-refunds.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('refund admission and its cleanup obligation survive backend death and lost COMMIT without replacing the original action', async () =>
  withBillingRefunds(
    async ({ fixture, refunds, pool, run, instanceId, userId, payment }) => {
      const [before] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
      let terminated = false;
      const crashing = createBillingRefundActions({
        nextId: createId,
        run: currentWebTransaction(
          (callback, options) =>
            run(async (...args) => {
              const result = await callback(...args);
              const { writer } = args[2];
              const [killed] =
                await fixture.sql`select pg_terminate_backend(pid,500) as stopped from pg_stat_activity where pid=${writer.pid} and backend_start::text=${writer.backendStart}`;
              terminated = killed?.stopped === true;
              if (!terminated)
                throw Error('Owned refund writer was not terminated');
              return result;
            }, options),
          instanceId,
        ),
      });
      await assertRejects({
        given:
          'the exact owned writer is killed after action and cleanup writes',
        should: 'report failure before COMMIT',
        code: 'INFRASTRUCTURE',
        actual: () => crashing.admit(userId, payment),
      });
      const [rolledBack] =
        await fixture.sql`select count(*)::int as n from billing_refund_actions where user_id=${userId}`;
      const [oldJob] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
      assert({
        given: 'pre-COMMIT backend death',
        should: 'roll back both writes',
        actual: [terminated, rolledBack!.n, oldJob],
        expected: [true, 0, before],
      });
      const restore = loseTransactionCommitReply(pool, 2);
      try {
        await assertRejects({
          given: 'action and cleanup commit but the reply is lost',
          should: 'report uncertainty',
          code: 'INFRASTRUCTURE',
          actual: () => refunds.admit(userId, payment),
        });
      } finally {
        restore();
      }
      const [committed] =
        await fixture.sql`select id from billing_refund_actions where user_id=${userId}`;
      const [job] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
      const replay = await refunds.admit(userId, payment);
      const [replayedJob] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
      assert({
        given: 'retry after uncertain admission',
        should: 'reuse the committed identity and cleanup job',
        actual: [
          replay.kind,
          'action' in replay && replay.action.id,
          job!.id !== before!.id,
          replayedJob,
        ],
        expected: ['existing', committed!.id, true, job],
      });
      const restoreClaim = loseTransactionCommitReply(pool, 2);
      try {
        await assertRejects({
          given:
            'the first possible-dispatch claim commits but its reply is lost',
          should: 'leave an honest possible execution',
          code: 'INFRASTRUCTURE',
          actual: () => refunds.claim(committed!.id),
        });
      } finally {
        restoreClaim();
      }
      const [claimed] =
        await fixture.sql`select state,claim from billing_refund_actions where id=${committed!.id}`;
      const retry = await refunds.claim(committed!.id);
      assert({
        given: 'a worker restarts after the uncertain claim',
        should:
          'retain unknown exposure and wait for that claim without a new identity',
        actual: [retry?.work, retry?.action.state, retry?.action.claim],
        expected: ['wait', claimed!.state, claimed!.claim],
      });
    },
  ));
