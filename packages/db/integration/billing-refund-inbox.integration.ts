import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createBillingDiscovery } from '../src/billing-discovery';
import { currentWebTransaction } from '../src/web-service-authority';
import { withBillingRefunds } from './billing-refunds.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('refund hints require exact owned action/charge/refund/mode, survive customer deletion and never settle from an event body', async () =>
  withBillingRefunds(
    async ({
      fixture,
      refunds,
      inbox,
      userId,
      payment,
      pool,
      run,
      instanceId,
    }) => {
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        return connection;
      };
      const admitted = await refunds.admit(userId, payment);
      if (!('action' in admitted)) throw Error('Refund fixture refused');
      const id = admitted.action.id;
      const current = await refunds.claim(id);
      if (!current?.action.claim) throw Error('Missing claim');
      const refundId = `re_${createId()}`;
      await fixture.sql`delete from billing_customers where user_id=${userId}`;
      const event = {
        eventId: `evt_${createId()}`,
        mode: 'test' as const,
        refund: {
          id: refundId,
          chargeId: payment.chargeId,
          customerId: null,
          actionId: id,
        },
      };
      const first = await inbox(event);
      const [job] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
      const repeated = await inbox(event);
      const badTargets = [
        { ...event.refund, chargeId: 'ch_other' },
        { ...event.refund, actionId: createId() },
        { ...event.refund, customerId: 'cus_other' },
        { ...event.refund, actionId: null },
      ];
      const refused = [];
      for (const refund of badTargets)
        refused.push(
          await inbox({ ...event, eventId: `evt_${createId()}`, refund }),
        );
      refused.push(
        await inbox({ ...event, eventId: `evt_${createId()}`, mode: 'live' }),
      );
      const [sameJob] =
        await fixture.sql`select id from privacy_jobs where subject_ref=${userId}`;
      const [state] =
        await fixture.sql`select state,claim from billing_refund_actions where id=${id}`;
      assert({
        given:
          'a new signed refund hint, identical replay and foreign or unlinked routing',
        should:
          'reopen once, preserve possible execution, and ignore foreign targets',
        actual: [first, repeated, refused, sameJob, state!.state, state!.claim],
        expected: [
          'closed',
          'duplicate',
          Array(5).fill('ignored'),
          job,
          current.action.state,
          current.action.claim,
        ],
      });
      await refunds.record(id, {
        kind: 'observe',
        claimId: current.action.claim.id,
        refundId,
        status: 'succeeded',
      });
      const known = await inbox({
        ...event,
        eventId: `evt_${createId()}`,
        refund: { ...event.refund, actionId: null },
      });
      const unrelated = await inbox({
        ...event,
        eventId: `evt_${createId()}`,
        refund: { ...event.refund, id: `re_${createId()}` },
      });
      const [facts] = await fixture.sql`select state->>'status' as status,
      (select count(*)::int from billing_webhook_events where vendor_customer_id=${payment.customerId}) as receipts from billing_refund_actions where id=${id}`;
      assert({
        given:
          'known immutable refund ID without metadata and a different refund on the same charge',
        should:
          'route the known ID only without trusting webhook status or creating extra receipts',
        actual: [known, unrelated, facts],
        expected: ['closed', 'ignored', { status: 'succeeded', receipts: 2 }],
      });
      const missed = `evt_${createId()}`;
      await fixture.sql`insert into billing_webhook_events(id,vendor_event_id,vendor_customer_id,mode)
      values(${createId()},${missed},${payment.customerId},'test')`;
      const discovery = createBillingDiscovery(
        currentWebTransaction(run, instanceId),
      );
      const page = await discovery.receipts({ mode: 'test', limit: 100 });
      const target = page.rows.find((row) => row.eventId === missed);
      if (!target) throw Error('Retained customer receipt not discovered');
      const repaired = await inbox({
        eventId: target.eventId,
        mode: target.mode,
        customerId: target.customerId,
      });
      assert({
        given: 'an unnotified durable receipt after ordinary mapping deletion',
        should:
          'discover and repair it through retained financial routing with actual web permissions',
        actual: repaired,
        expected: 'closed',
      });
    },
  ));
