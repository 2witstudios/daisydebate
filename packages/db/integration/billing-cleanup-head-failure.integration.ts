import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
import { causeChainMember } from '../src/capacity-refusal';
requireTestServices(process.env);
setupRitewayBun();

test(
  'five ordinary unresolved head reads yield and account once each without being mistaken for completed traversal',
  async () =>
    withClosedPurchase(true, async ({ fixture, cleanup, jobId, renew }) => {
      const outcomes = [],
        turns = [];
      let replay: (() => Promise<unknown>) | null = null;
      for (let index = 0; index < 5; index++) {
        await fixture.sql`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${jobId}`;
        await renew();
        const current = await cleanup.claim(jobId);
        if (
          current.kind !== 'claimed' ||
          current.state.kind === 'acknowledged' ||
          !current.state.claim
        )
          throw Error('Missing current failed-head claim');
        turns.push(current.work.kind === 'scan' && current.work.lane);
        const [clock] = await fixture.sql`select clock_timestamp() as at`;
        const event = {
          kind: 'failure' as const,
          claimId: current.state.claim.id,
          work: current.work,
          retryAt: new Date(clock!.at.getTime() + 500).toISOString(),
        };
        replay = () => cleanup.record(jobId, event);
        try {
          outcomes.push(await cleanup.record(jobId, event));
        } catch (error) {
          const cause = causeChainMember((member) => 'errno' in member, error);
          outcomes.push({
            error: cause && 'errno' in cause ? cause.errno : 'unclassified',
          });
        }
      }
      const [after] =
        await fixture.sql`select status,attempts,billing_cleanup from privacy_jobs where id=${jobId}`;
      assert({
        given:
          'five current-service unresolved reads, with every durable lane still at its initial head',
        should:
          'visit every lane and consume five failures with ordinary backoff, preserving every head and no completion/claim',
        actual: [
          turns,
          outcomes,
          after!.status,
          after!.attempts,
          after!.billing_cleanup.turn,
          after!.billing_cleanup.scans,
          after!.billing_cleanup.claim,
        ],
        expected: [
          ['purchases', 'subscriptions', 'invoices', 'refunds', 'observations'],
          Array(5).fill('failure'),
          'pending',
          5,
          'purchases',
          Object.fromEntries(
            [
              'purchases',
              'subscriptions',
              'invoices',
              'refunds',
              'observations',
            ].map((lane) => [lane, { kind: 'page', afterId: null }]),
          ),
          null,
        ],
      });
      if (!replay) throw Error('Missing consumed head-failure event');
      const stale = await replay();
      const [unchanged] =
        await fixture.sql`select status,attempts,billing_cleanup from privacy_jobs where id=${jobId}`;
      assert({
        given:
          'the fifth successfully consumed failure replays against the next head turn',
        should: 'remain idle with identical attempts, due, claim and work',
        actual: [stale, unchanged],
        expected: ['idle', after],
      });
    }),
  10000,
);
