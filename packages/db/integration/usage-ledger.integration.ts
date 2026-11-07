import { canUseAiAllowance } from '@daisy/auth/authorization';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { canReleaseFreeJudgeBinding } from '@daisy/auth/authorization';
import { withBoundedRound } from './bounded-transaction.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';
import { createUsageRelease } from '../src/usage-release';
import {
  lockBotAdmission,
  markLockedRoundBotModelCall,
} from '../src/round-bot-admission';

setupRitewayBun();
requireTestServices(process.env);

test('the final beta bot use admits one racing Round and same-attempt recovery never creates another debit', async () => {
  await withBoundedRound(async (f, run, firstRound) => {
    const secondRound = await f.round();
    const actorId = await admissionSponsor(f, [firstRound, secondRound]);
    const admission = testBotAdmission(run, 4, 1);
    const results = await Promise.allSettled(
      [firstRound, secondRound].map((roundId) =>
        admission.reserve({ actorId, roundId }),
      ),
    );
    const winner = results.find(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof admission.reserve>>
      > => r.status === 'fulfilled',
    )!;
    const recovered = await admission.reserve({
      actorId,
      roundId: winner.value.roundId,
    });
    const [row] =
      await f.sql`select count(*)::int as n from usage_reservations where actor_id=${actorId}`;
    assert({
      given:
        'two concurrent admissions at a one-use beta cap, then the winner retries',
      should: 'commit one original reservation and recover its exact identity',
      actual: [
        results.filter((r) => r.status === 'fulfilled').length,
        row.n,
        recovered.id === winner.value.id,
      ],
      expected: [1, 1, true],
    });
    await f.sql`update account_beta_access set state='revoked',revision=revision+1
      where user_id=(select user_id from actors where id=${actorId})`;
    await assertRejects({
      given: 'that same attempt after participant revocation',
      should: 'refuse recovery from the old reservation identity',
      code: 'AUTHORIZATION',
      actual: () =>
        admission.reserve({ actorId, roundId: winner.value.roundId }),
    });
  });
});

test('abandoned undispatched free bundle releases together and stale original identity cannot dispatch or rebind', async () => {
  await withBoundedRound(async (f, run, roundId) => {
    const replacement = await f.round();
    const actorId = await admissionSponsor(f, [roundId, replacement]);
    await f.sql`delete from account_entitlement_grants where user_id=(select user_id from actors where id=${actorId})`;
    const judgeActor = createId();
    await f.insert('actors', { id: judgeActor, kind: 'bot', user_id: null });
    await f.seat(roundId, 'judge', 0, judgeActor);
    await f.seat(replacement, 'judge', 0, judgeActor);
    const admission = testBotAdmission(run);
    await admission.reserve({ actorId, roundId });
    await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`;
    const release = createUsageRelease({
      run,
      releaseBinding: canReleaseFreeJudgeBinding,
    });
    const released = await release({ actorId, roundId });
    const next = await admission.reserve({ actorId, roundId: replacement });
    const rows =
      await f.sql`select kind,state->>'kind' as state,binds_free_judge,binding_released_at is not null as retired
      from usage_reservations where actor_id=${actorId} and round_id=${roundId} order by kind`;
    assert({
      given:
        'the selected free bot/judge bundle, abandoned with no model dispatch',
      should:
        'release both old reservations and binding atomically, allowing a fresh bundle on a fresh Round',
      actual: [
        released.bindingReleased,
        rows.map((r: { kind: string; state: string; retired: boolean }) => [
          r.kind,
          r.state,
          r.retired,
        ]),
        next.roundId === replacement,
      ],
      expected: [
        true,
        [
          ['ai_round', 'released', true],
          ['casual_ai_judge', 'released', false],
        ],
        true,
      ],
    });
    await assertRejects({
      given: 'the released original request retried after replacement',
      should: 'remain terminal',
      code: 'CONFLICT',
      actual: () => admission.reserve({ actorId, roundId }),
    });
    await assertRejects({
      given: 'a stale dispatcher for the original Round',
      should: 'refuse despite its old reservation identity',
      code: 'CONFLICT',
      actual: () =>
        run(async (tx) => {
          await lockBotAdmission(tx);
          return markLockedRoundBotModelCall(tx, {
            roundId,
            before: '2099-01-01T00:00:00.000Z',
            accountEligible: canUseAiAllowance,
          });
        }),
    });
  });
});
