import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { refundIdempotencyKey } from '@daisy/protocol/billing';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { fullRead } from './billing-payment-read.test-support';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';
import { causeChainMember } from '../src/capacity-refusal';
requireTestServices(process.env);
setupRitewayBun();
type Input = Parameters<Parameters<typeof withClosedPurchase>[1]>[0];
type Read = Awaited<ReturnType<typeof fullRead>>;
function pair(first: Read) {
  const invoicePaymentId = `inpay_${createId()}`;
  return [
    first,
    {
      ...first,
      invoicePaymentId,
      evidence: {
        kind: 'verified' as const,
        payment: { ...first.evidence.payment, invoicePaymentId },
      },
    },
  ];
}
async function withBatch(work: (input: Input) => Promise<void>) {
  return withClosedPurchase(true, async (input) => {
    try {
      await work(input);
    } finally {
      await input.fixture
        .sql`delete from billing_payment_observations where user_id=${input.subject.userId}`;
      await input.fixture
        .sql`delete from billing_refund_actions where user_id=${input.subject.userId}`;
    }
  });
}
async function snapshot({ fixture, subject }: Input) {
  const [row] = await fixture.sql`select
 (select jsonb_agg(to_jsonb(row) order by row.id) from privacy_jobs row where subject_ref=${subject.userId} and vendor='stripe') as jobs,
 (select coalesce(jsonb_agg(to_jsonb(row) order by row.id),'[]'::jsonb) from billing_payment_observations row where user_id=${subject.userId}) as observations,
 (select coalesce(jsonb_agg(to_jsonb(row) order by row.id),'[]'::jsonb) from billing_refund_actions row where user_id=${subject.userId}) as actions`;
  return row!;
}

test('one bounded fresh HEAD batch retains both exact identities and one original-charge action with one cleanup rotation', async () =>
  withBatch(async (input) => {
    const reads = pair(await fullRead(input)),
      before = await snapshot(input);
    const result = await input.cleanup.recordPayments(
      input.subject.userId,
      reads,
    );
    const after = await snapshot(input);
    const replay = await input.cleanup.recordPayments(
      input.subject.userId,
      reads,
    );
    const tooMany = await input.cleanup.recordPayments(
      input.subject.userId,
      Array.from({ length: 21 }, () => reads[0]!),
    );
    const foreign = await input.cleanup.recordPayments(input.subject.userId, [
      reads[0],
      { ...reads[1], customerId: 'cus_foreign' },
    ]);
    const final = await snapshot(input);
    assert({
      given:
        'two positively owned exact invoice-payment identities sharing fully matching original money binding in one bounded actual public batch',
      should:
        'retain both, create one stable original-charge obligation, rotate once, keep replay byte-identical and refuse overflow/foreign batches',
      actual: {
        result,
        newJob: after.jobs[0].id !== before.jobs[0].id,
        jobs: after.jobs.length,
        observations: after.observations.length,
        actions: after.actions.length,
        ids: after.observations
          .map(
            (row: { vendor_invoice_payment_id: string }) =>
              row.vendor_invoice_payment_id,
          )
          .sort(),
        links: after.observations.map(
          (row: { refund_action_id: string }) => row.refund_action_id,
        ),
        states: after.observations.map(
          (row: { state: { kind: string } }) => row.state.kind,
        ),
        key: refundIdempotencyKey({ id: after.actions[0].id }),
        replay,
        tooMany,
        foreign,
        final,
      },
      expected: {
        result: 'recorded',
        newJob: true,
        jobs: 1,
        observations: 2,
        actions: 1,
        ids: reads.map((read) => read.invoicePaymentId).sort(),
        links: [after.actions[0].id, after.actions[0].id],
        states: ['refund-linked', 'refund-linked'],
        key: `daisy-closure-refund:${after.actions[0].id}`,
        replay: 'unchanged',
        tooMany: 'refuse',
        foreign: 'refuse',
        final: after,
      },
    });
  }));

test('a semantic inner-proof refusal in a later batch member rolls back earlier retained money and queue changes', async () =>
  withBatch(async (input) => {
    const reads = pair(await fullRead(input));
    const invalid = {
      ...reads[1]!,
      evidence: {
        kind: 'verified' as const,
        payment: { ...reads[1]!.evidence.payment, invoiceId: 'in_foreign' },
      },
    };
    const before = await snapshot(input);
    const result = await input.cleanup.recordPayments(input.subject.userId, [
      reads[0],
      invalid,
    ]);
    assert({
      given:
        'a coherent owned first payment followed by an outer-owned member whose nested invoice proof is foreign',
      should:
        'report only the exact semantic refusal after confirmed rollback with no partial observation/action/cleanup change',
      actual: [result, await snapshot(input)],
      expected: ['refuse', before],
    });
  }));

test('real database failure after both positive writes cannot become a semantic refusal or partial batch', async () =>
  withBatch(async (input) => {
    const reads = pair(await fullRead(input)),
      before = await snapshot(input);
    await input.fixture
      .sql`create function daisy_test_payment_batch_reopen() returns trigger language plpgsql as $$ begin
 if new.vendor='stripe' and new.id<>old.id then
   if (select count(*) from billing_payment_observations where user_id=new.subject_ref)<>2 then raise exception 'missing two positive writes' using errcode='22000'; end if;
   raise exception 'controlled failure after two positive writes' using errcode='23514',constraint='daisy_test_payment_batch_after_two';
 end if;return new;end $$`;
    await input.fixture
      .sql`create trigger daisy_test_payment_batch_reopen before update on privacy_jobs for each row execute function daisy_test_payment_batch_reopen()`;
    let failedAtExpectedStage = false;
    try {
      await assertRejects({
        given:
          'actual PostgreSQL raises only after both payment rows/action are visible before job rotation',
        should:
          'propagate database infrastructure failure instead of treating it as ordinary semantic refusal',
        code: 'INFRASTRUCTURE',
        actual: async () => {
          try {
            return await input.cleanup.recordPayments(
              input.subject.userId,
              reads,
            );
          } catch (error) {
            failedAtExpectedStage =
              causeChainMember(
                (cause) =>
                  Object.getOwnPropertyDescriptor(cause, 'constraint')
                    ?.value === 'daisy_test_payment_batch_after_two',
                error,
              ) !== undefined;
            throw error;
          }
        },
      });
      assert({
        given: 'the real injected post-write database failure',
        should:
          'restore the exact original job and remove all partial observation/action effects',
        actual: [failedAtExpectedStage, await snapshot(input)],
        expected: [true, before],
      });
    } finally {
      await input.fixture
        .sql`drop trigger daisy_test_payment_batch_reopen on privacy_jobs`;
      await input.fixture.sql`drop function daisy_test_payment_batch_reopen()`;
    }
  }));

test('lost batch COMMIT reply remains uncertain and replay retains one original action/key and one reopened job', async () =>
  withBatch(async (input) => {
    const reads = pair(await fullRead(input)),
      before = await snapshot(input);
    const restore = loseTransactionCommitReply(input.pool, 2);
    try {
      await assertRejects({
        given: 'the real bounded payment batch commits but its reply is lost',
        should: 'report uncertainty without claiming a failed or absent effect',
        code: 'INFRASTRUCTURE',
        actual: () => input.cleanup.recordPayments(input.subject.userId, reads),
      });
    } finally {
      restore();
    }
    const committed = await snapshot(input),
      replay = await input.cleanup.recordPayments(input.subject.userId, reads);
    assert({
      given: 'recovery through the same exact original payment identities',
      should:
        'observe two retained identities, one original-charge key/job and unchanged replay without resubmitting money',
      actual: {
        newJob: committed.jobs[0].id !== before.jobs[0].id,
        jobs: committed.jobs.length,
        observations: committed.observations.length,
        actions: committed.actions.length,
        key: refundIdempotencyKey({ id: committed.actions[0].id }),
        replay,
        after: await snapshot(input),
      },
      expected: {
        newJob: true,
        jobs: 1,
        observations: 2,
        actions: 1,
        key: `daisy-closure-refund:${committed.actions[0].id}`,
        replay: 'unchanged',
        after: committed,
      },
    });
  }));
