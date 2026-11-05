import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  canReleaseFreeJudgeBinding,
  canUseAiAllowance,
} from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { sql } from 'drizzle-orm';
import { assertRejects } from '@daisy/errors/testing';
import { createUsageRelease } from '../src/usage-release';
import {
  lockBotAdmission,
  markLockedRoundBotModelCall,
} from '../src/round-bot-admission';
import { finishedOrBlockedBehind } from '../src/testing';
import { withHeldCommit, withFreeBundle } from './usage-ledger.test-support';

setupRitewayBun();
requireTestServices(process.env);
const before = '2099-01-01T00:00:00.000Z';

test('release commits before a stale dispatcher and preserves terminal old identities', async () => {
  await withFreeBundle(
    async ({ f, run, roundId, replacement, actorId, admission, judge }) => {
      await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`;
      await withHeldCommit(run, async (held) => {
        const release = createUsageRelease({
          run: held.run,
          releaseBinding: canReleaseFreeJudgeBinding,
        });
        const releasing = held.observe(release({ actorId, roundId }));
        const pid = await held.entered;
        const dispatch = held.observe(
          run(async (tx) => {
            await lockBotAdmission(tx);
            return markLockedRoundBotModelCall(tx, {
              roundId,
              before,
              accountEligible: canUseAiAllowance,
            });
          }),
        );
        const observed = held.observe(Promise.allSettled([dispatch]));
        try {
          assert({
            given:
              'an uncommitted whole-bundle release holding the canonical account fence',
            should: 'make a real stale first-model dispatcher wait',
            actual: await finishedOrBlockedBehind(dispatch, f.sql, pid, {
              now: performance.now,
              deadlineMs: 1000,
            }),
            expected: 'blocked',
          });
        } finally {
          held.release();
        }
        await releasing;
        await observed;
        await assertRejects({
          given: 'the released old Round after the wait',
          should: 'refuse stale dispatch',
          code: 'CONFLICT',
          actual: () => dispatch,
        });
        const next = await admission.reserve({ actorId, roundId: replacement });
        await assertRejects({
          given: 'a stale optional-judge admission for the old Round',
          should: 'refuse rather than create an old bound judge',
          code: 'CONFLICT',
          actual: () =>
            run((tx) => judge.reserveLocked(tx, { actorId, roundId })),
        });
        const rows =
          await f.sql`select round_id,state->>'kind' as state from usage_reservations where actor_id=${actorId} order by round_id,kind`;
        assert({
          given: 'a fresh replacement after the release committed',
          should:
            'keep two terminal old identities and one fresh two-job bundle',
          actual: [
            next.roundId === replacement,
            rows.filter((r: { state: string }) => r.state === 'released')
              .length,
            rows.filter((r: { state: string }) => r.state === 'reserved')
              .length,
          ],
          expected: [true, 2, 2],
        });
      });
    },
  );
});

for (const contender of ['replacement', 'judge'] as const) {
  test(`whole-bundle release serializes concurrent ${contender} admission`, async () => {
    await withFreeBundle(
      async ({ f, run, roundId, replacement, actorId, admission, judge }) => {
        await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`;
        await withHeldCommit(run, async (held) => {
          const release = createUsageRelease({
            run: held.run,
            releaseBinding: canReleaseFreeJudgeBinding,
          });
          const releasing = held.observe(release({ actorId, roundId }));
          const pid = await held.entered;
          const competing =
            contender === 'replacement'
              ? admission.reserve({ actorId, roundId: replacement })
              : run((tx) => judge.reserveLocked(tx, { actorId, roundId }));
          const observed = held.observe(Promise.allSettled([competing]));
          try {
            assert({
              given: `an uncommitted release and a concurrent ${contender} admission`,
              should: 'wait on the canonical account fence',
              actual: await finishedOrBlockedBehind(competing, f.sql, pid, {
                now: performance.now,
                deadlineMs: 1000,
              }),
              expected: 'blocked',
            });
          } finally {
            held.release();
          }
          await releasing;
          const [result] = await observed;
          const [rows] =
            await f.sql`select count(*) filter(where state->>'kind'='reserved')::int as reserved,
        count(*) filter(where state->>'kind'='released')::int as released from usage_reservations where actor_id=${actorId}`;
          assert({
            given: 'the committed release and the newly observed facts',
            should:
              'admit only a fresh replacement; never resurrect the old optional judge',
            actual: [result!.status, rows.reserved, rows.released],
            expected: [
              contender === 'replacement' ? 'fulfilled' : 'rejected',
              contender === 'replacement' ? 2 : 0,
              2,
            ],
          });
        });
      },
    );
  });
}

test('a dispatched bot wins the fence and abandonment cannot erase its original judge binding', async () => {
  await withFreeBundle(
    async ({ f, run, roundId, replacement, actorId, admission, release }) => {
      await withHeldCommit(run, async (held) => {
        const dispatch = held.run(async (tx) => {
          await lockBotAdmission(tx);
          await markLockedRoundBotModelCall(tx, {
            roundId,
            before,
            accountEligible: canUseAiAllowance,
          });
          await tx.execute(
            sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`,
          );
        });
        const pid = await held.entered;
        const releasing = held.observe(release({ actorId, roundId }));
        const observed = held.observe(Promise.allSettled([releasing]));
        try {
          assert({
            given:
              'a dispatched bot and abandonment in the writer that holds the account fence',
            should: 'serialize release behind durable dispatch',
            actual: await finishedOrBlockedBehind(releasing, f.sql, pid, {
              now: performance.now,
              deadlineMs: 1000,
            }),
            expected: 'blocked',
          });
        } finally {
          held.release();
        }
        await dispatch;
        await observed;
        const result = await releasing;
        const rows =
          await f.sql`select kind,state->>'kind' as state,binding_released_at is null as bound from usage_reservations where actor_id=${actorId} order by kind`;
        assert({
          given: 'the release after durable dispatch',
          should:
            'release only the undispatched judge and retain the bot and original binding',
          actual: [
            result.bindingReleased,
            rows.map((r: { kind: string; state: string; bound: boolean }) => [
              r.kind,
              r.state,
              r.bound,
            ]),
          ],
          expected: [
            false,
            [
              ['ai_round', 'dispatched', true],
              ['casual_ai_judge', 'released', true],
            ],
          ],
        });
        await assertRejects({
          given: 'a replacement free bundle after that abandonment',
          should: 'refuse the existing original binding',
          code: 'CONFLICT',
          actual: () => admission.reserve({ actorId, roundId: replacement }),
        });
      });
    },
  );
});
