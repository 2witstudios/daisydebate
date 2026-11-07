import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '../src/testing';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { seedInvoicePassPredecessor } from './billing-invoice-pass-predecessor.test-support';
requireTestServices(process.env);
setupRitewayBun();
const previous = new URL(
  './fixtures/billing-private-113/20261106023226_stripe_cleanup_failure_classification.sql',
  import.meta.url,
);
const authority = new URL(
  './fixtures/billing-private-113/20261106110238_stripe_invoice_pass_authority.sql',
  import.meta.url,
);
const forward = new URL(
  './fixtures/billing-private-113/20261106223739_stripe_invoice_coverage_repair.sql',
  import.meta.url,
);

// Real account-lock ordering, not a sleep-based assumption or a claimed public endpoint race.
test(
  'a repair waiting on its frozen account cannot recruit a newly reopened different subject',
  async () =>
    withClosedPurchase(true, async (first) =>
      withClosedPurchase(true, async (second) => {
        const { fixture } = first;
        await fixture.sql.unsafe(await Bun.file(previous).text());
        await fixture.sql.begin(async (tx) => {
          await tx`set local role daisy_web`;
          await tx`select id from users where id=${second.subject.userId} for update`;
          await seedInvoicePassPredecessor(tx, second.jobId, 'acknowledged');
        });
        await fixture.sql.unsafe(await Bun.file(authority).text());
        const a = await fixture.sql.reserve(),
          b = await fixture.sql.reserve(),
          migration = await fixture.sql.reserve();
        let activeA = false,
          activeB = false,
          activeMigration = false;
        let candidate: ReturnType<typeof migration.unsafe> | undefined;
        let observed: Promise<unknown> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await a`begin`;
          activeA = true;
          await a`set local role daisy_web`;
          await a`select id from users where id=${first.subject.userId} for update`;
          const [backendA] = await a`select pg_backend_pid() as pid`;
          await migration`begin`;
          activeMigration = true;
          await migration`set local statement_timeout='2500ms'`;
          // The index's normal table lock is deliberately absent: this tests the function-only replay path too.
          const path =
            process.env.BILLING_COVERAGE_COHORT_CANDIDATE ?? forward.pathname;
          const body = (await Bun.file(path).text())
            .split('--> statement-breakpoint')
            .slice(1)
            .join('--> statement-breakpoint');
          candidate = migration.unsafe(body);
          observed = Promise.allSettled([candidate]);
          timer = setTimeout(() => candidate?.cancel(), 2500);
          const firstWait = await finishedOrBlockedBehind(
            candidate,
            fixture.sql,
            Number(backendA!.pid),
            { now: performance.now, deadlineMs: 400 },
          );
          if (firstWait !== 'blocked')
            throw Error(
              'Repair never reached the held frozen canonical account',
            );
          await second.renew();
          const retained = await second.cleanup.recordInvoices(
            second.subject.userId,
            [
              {
                mode: 'test',
                customerId: second.session.customerId,
                invoiceId: `in_${createId()}`,
                source: {
                  kind: 'unresolved',
                  vendorSubscriptionId: second.session.subscriptionId,
                  priceId: null,
                },
              },
            ],
          );
          const [late] =
            await fixture.sql`select to_jsonb(job) as value from privacy_jobs job where subject_ref=${second.subject.userId} and vendor='stripe'`;
          const facts =
            await fixture.sql`select to_jsonb(row) as value from billing_payment_observations row where user_id=${second.subject.userId} order by id`;
          await b`begin`;
          activeB = true;
          await b`set local role daisy_web`;
          await b`select id from users where id=${second.subject.userId} for update`;
          const [backendB] = await b`select pg_backend_pid() as pid`;
          await a`rollback`;
          activeA = false;
          const secondWait = await finishedOrBlockedBehind(
            candidate,
            fixture.sql,
            Number(backendB!.pid),
            { now: performance.now, deadlineMs: 400 },
          );
          await candidate;
          await migration`commit`;
          activeMigration = false;
          if (timer) clearTimeout(timer);
          const [target] =
            await fixture.sql`select billing_cleanup from privacy_jobs where id=${first.jobId}`;
          const [after] =
            await fixture.sql`select to_jsonb(job) as value from privacy_jobs job where subject_ref=${second.subject.userId} and vendor='stripe'`;
          const afterFacts =
            await fixture.sql`select to_jsonb(row) as value from billing_payment_observations row where user_id=${second.subject.userId} order by id`;
          assert({
            given:
              'repair target membership captured before an actual account wait, followed by independently admitted positive invoice knowledge reopening another account',
            should:
              'repair only the frozen target while leaving the new current job and its actual owed facts unchanged, even with that account held',
            actual: {
              firstWait,
              retained,
              newJob: late!.value.id !== second.jobId,
              lateExecution: late!.value.billing_cleanup,
              secondWait,
              targetVersion: target!.billing_cleanup.version,
              job: after,
              facts: afterFacts,
            },
            expected: {
              firstWait: 'blocked',
              retained: 'recorded',
              newJob: true,
              lateExecution: null,
              secondWait: 'finished',
              targetVersion: 3,
              job: late,
              facts,
            },
          });
          await b`rollback`;
          activeB = false;
          await second.renew();
          const fresh = await second.cleanup.claim(late!.value.id);
          assert({
            given:
              'the preserved new pending NULL execution after the repair commits',
            should:
              'admit only a fresh runtime v3 claim without inherited coverage',
            actual:
              fresh.kind === 'claimed' &&
              fresh.state.kind === 'scanning' &&
              fresh.state.version === 3 &&
              fresh.work.kind === 'scan' &&
              fresh.work.lane === 'purchases',
            expected: true,
          });
        } finally {
          if (timer) clearTimeout(timer);
          if (activeA) await a`rollback`;
          if (activeB) await b`rollback`;
          if (activeMigration) {
            candidate?.cancel();
            if (observed) await observed;
            await migration`rollback`;
          }
          if (observed) await observed;
          a.release();
          b.release();
          migration.release();
          await fixture.sql`delete from billing_payment_observations where user_id=${second.subject.userId}`;
        }
      }),
    ),
  20_000,
);
