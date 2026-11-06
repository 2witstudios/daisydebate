import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { loseTransactionCommitReply } from './bounded-transaction.test-support';
import { withSelectedInvoice } from './billing-invoice-retention.test-support';
import { causeChainMember } from '../src/capacity-refusal';
requireTestServices(process.env);
setupRitewayBun();

test(
  'foreign routing and forged generic retention cannot move an owned invoice cursor',
  async () =>
    withSelectedInvoice(
      async ({ fixture, subject, cleanup, jobId, current, read }) => {
        const [before] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        const variants = [
          { ...read, mode: 'live' },
          { ...read, customerId: 'cus_foreign' },
          { ...read, invoiceId: 'in_foreign' },
          { ...read, source: null },
        ];
        const results = [];
        for (const variant of variants)
          results.push(
            await cleanup.retainInvoice(
              jobId,
              current.claimId,
              current.work,
              variant,
            ),
          );
        results.push(
          await Reflect.apply(cleanup.record, cleanup, [
            jobId,
            {
              kind: 'retained',
              claimId: current.claimId,
              work: current.work,
              observation: { ...read, kind: 'invoice' },
            },
          ]),
        );
        const [after] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        const rows =
          await fixture.sql`select id from billing_payment_observations where user_id=${subject.userId}`;
        assert({
          given:
            'foreign vendor routing, a malformed source or a forged pure retention event through the generic recorder',
          should:
            'refuse without persistence, cursor advancement, attempts or due mutation',
          actual: [results, rows.length, after],
          expected: [variants.concat([read]).map(() => 'idle'), 0, before],
        });
      },
    ),
  15000,
);

test(
  'failure after invoice insertion rolls back both retained identity and cleanup progress',
  async () =>
    withSelectedInvoice(
      async ({ fixture, subject, cleanup, jobId, current, read }) => {
        const [before] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        // The disposable run database keeps every production guard enabled. This
        // extra fault fires only after the new witness is visible to this transaction.
        await fixture.sql`create function daisy_test_invoice_progress_failure() returns trigger language plpgsql as $$
        begin
          if new.vendor='stripe' and new.billing_cleanup->'claim'='null'::jsonb then
            if not exists(select 1 from billing_payment_observations where user_id=new.subject_ref and kind='invoice') then
              raise exception 'missing retained witness' using errcode='22000';
            end if;
            raise exception 'injected progress failure after retention' using errcode='23514';
          end if;
          return new;
        end $$`;
        await fixture.sql`create trigger daisy_test_invoice_progress_failure before update on privacy_jobs for each row execute function daisy_test_invoice_progress_failure()`;
        let code: unknown;
        try {
          await cleanup.retainInvoice(
            jobId,
            current.claimId,
            current.work,
            read,
          );
        } catch (error) {
          const failure = causeChainMember(
            (member) => 'errno' in member,
            error,
          );
          code = failure && 'errno' in failure ? failure.errno : null;
        } finally {
          await fixture.sql`drop trigger daisy_test_invoice_progress_failure on privacy_jobs`;
          await fixture.sql`drop function daisy_test_invoice_progress_failure()`;
        }
        const rows =
          await fixture.sql`select id from billing_payment_observations where user_id=${subject.userId}`;
        const [after] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        assert({
          given:
            'a real PostgreSQL failure after the inserted witness is visible but before progress commits',
          should:
            'roll back the exact witness and preserve the original claim, due and attempts',
          actual: [code, rows.length, after],
          expected: ['23514', 0, before],
        });
      },
    ),
  15000,
);

test(
  'racing invoice retention consumes one claim with exact owed identity and selected remainder',
  async () =>
    withSelectedInvoice(
      async ({ fixture, subject, cleanup, jobId, current, read, laterId }) => {
        const [before] =
          await fixture.sql`select attempts from privacy_jobs where id=${jobId}`;
        const results = await Promise.all([
          cleanup.retainInvoice(jobId, current.claimId, current.work, read),
          cleanup.retainInvoice(jobId, current.claimId, current.work, read),
        ]);
        const [after] =
          await fixture.sql`select attempts,billing_cleanup from privacy_jobs where id=${jobId}`;
        const rows =
          await fixture.sql`select vendor_invoice_id,source,state from billing_payment_observations where user_id=${subject.userId}`;
        assert({
          given:
            'two actual current-service transactions retain the same selected invoice',
          should:
            'commit one owed witness and one exact remainder advance without failure accounting',
          actual: [
            results.sort(),
            rows.map((r: Record<string, unknown>) => [
              r.vendor_invoice_id,
              r.source,
              r.state,
            ]),
            after!.attempts,
            after!.billing_cleanup.claim,
            after!.billing_cleanup.scans.invoices.id,
          ],
          expected: [
            ['idle', 'progress'],
            [
              [
                read.invoiceId,
                read.source,
                { kind: 'owed', reason: 'enumeration_unavailable' },
              ],
            ],
            before!.attempts,
            null,
            laterId,
          ],
        });
        const replay = await cleanup.retainInvoice(
          jobId,
          current.claimId,
          current.work,
          read,
        );
        const [unchanged] =
          await fixture.sql`select attempts,billing_cleanup from privacy_jobs where id=${jobId}`;
        assert({
          given: 'the old exact claim replays',
          should: 'remain idle without refreshing due, identity or cursor',
          actual: [replay, unchanged],
          expected: ['idle', after],
        });
      },
    ),
  15000,
);

test(
  'retained invoice and cursor commit together despite a lost COMMIT reply',
  async () =>
    withSelectedInvoice(
      async ({
        fixture,
        pool,
        subject,
        cleanup,
        jobId,
        current,
        read,
        laterId,
      }) => {
        const restore = loseTransactionCommitReply(pool, 2);
        try {
          await assertRejects({
            given: 'the atomic retention commits but its reply is lost',
            should: 'report uncertainty without claiming no effect',
            code: 'INFRASTRUCTURE',
            actual: () =>
              cleanup.retainInvoice(jobId, current.claimId, current.work, read),
          });
        } finally {
          restore();
        }
        const [committed] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        const replay = await cleanup.retainInvoice(
          jobId,
          current.claimId,
          current.work,
          read,
        );
        const [after] =
          await fixture.sql`select attempts,retry_at,billing_cleanup from privacy_jobs where id=${jobId}`;
        const rows =
          await fixture.sql`select id from billing_payment_observations where user_id=${subject.userId}`;
        assert({
          given:
            'the caller recovers using the original claim and invoice identity',
          should:
            'observe one retained obligation and consumed cursor, with replay idle',
          actual: [
            rows.length,
            committed!.billing_cleanup.scans.invoices.id,
            committed!.billing_cleanup.claim,
            replay,
            after,
          ],
          expected: [1, laterId, null, 'idle', committed],
        });
      },
    ),
  15000,
);
