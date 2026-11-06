import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { billingOperations } from '../src/billing-operations';
import { finishedOrBlockedBehind } from '../src/testing';
import { withHeldCommit } from './usage-ledger.test-support';
import { withObservationCompletion } from './billing-observation-completion.test-support';
requireTestServices(process.env);
setupRitewayBun();

for (const order of ['reversal-first', 'completion-first'] as const)
  test(
    `observation completion and original refund reversal serialize ${order} through current account/job authority`,
    async () =>
      withObservationCompletion(async (input) => {
        const {
          run,
          fixture,
          instanceId,
          subject,
          jobId,
          cleanup,
          refunds,
          actionId,
          observationId,
          completion,
          reversal,
          payment,
        } = input;
        await withHeldCommit(run, async (held) => {
          const operations = billingOperations({
            run: held.run,
            nextId: createId,
          });
          const first =
            order === 'reversal-first'
              ? operations.billingRefunds(instanceId).record(actionId, reversal)
              : operations.billingCleanup(instanceId).record(jobId, completion);
          const pid = await held.entered;
          const second = held.observe(
            order === 'reversal-first'
              ? cleanup.record(jobId, completion)
              : refunds.record(actionId, reversal),
          );
          const ordering = await finishedOrBlockedBehind(
            second,
            fixture.sql,
            pid,
            { now: performance.now, deadlineMs: 300 },
          );
          assert({
            given:
              'the first actual current-service operation holds its canonical account lock until COMMIT',
            should:
              'force the competing completion/refund observation to wait rather than consume cached authority',
            actual: ordering,
            expected: 'blocked',
          });
          held.release();
          const result = [await first, await second];
          const [job] =
            await fixture.sql`select id,status,billing_cleanup from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
          const [action] =
            await fixture.sql`select id,vendor_charge_id,period_starts_at,period_ends_at,state from billing_refund_actions where id=${actionId}`;
          const [observation] =
            await fixture.sql`select refund_action_id,state->>'kind' as kind from billing_payment_observations where id=${observationId}`;
          const [access] =
            await fixture.sql`select (select count(*)::int from billing_customers where user_id=${subject.userId}) customers,(select count(*)::int from account_entitlement_grants where user_id=${subject.userId}) grants`;
          assert({
            given:
              'the same original refund action reverses to failed on either side of completion',
            should:
              'rotate/reopen atomically, reject an old completion after a fact-first commit and preserve original identities/routing without access resurrection',
            actual: [
              result,
              job!.id !== jobId,
              job!.status,
              job!.billing_cleanup,
              action!.id,
              action!.vendor_charge_id,
              action!.period_starts_at.toISOString(),
              action!.period_ends_at.toISOString(),
              action!.state.status,
              observation,
              access,
            ],
            expected: [
              order === 'reversal-first'
                ? ['changed', 'idle']
                : ['complete', 'changed'],
              true,
              'pending',
              null,
              actionId,
              payment.chargeId,
              payment.period.startsAt,
              payment.period.endsAt,
              'failed',
              { refund_action_id: actionId, kind: 'refund-linked' },
              { customers: 0, grants: 0 },
            ],
          });
          const replay = await refunds.record(actionId, reversal);
          const [same] =
            await fixture.sql`select id,status from privacy_jobs where subject_ref=${subject.userId} and vendor='stripe'`;
          const current = await cleanup.claim(job!.id);
          assert({
            given:
              'identical consumed-claim replay and a fresh read after reversal',
            should:
              'leave the healthy replacement identity stable and rederive owed observations from current original action status',
            actual: [
              replay,
              same,
              current.kind === 'claimed' &&
                current.facts.effects.owedObservations,
            ],
            expected: ['refuse', { id: job!.id, status: 'pending' }, true],
          });
        });
      }),
    20_000,
  );
