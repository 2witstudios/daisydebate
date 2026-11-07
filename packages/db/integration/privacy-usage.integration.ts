import { assert, setupRitewayBun, test } from 'riteway/bun';
import { usageStateSchema } from '@daisy/protocol/billing';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { usagePrivacyAdopter } from '../src/usage-privacy';
import {
  markLockedRoundBotModelCall,
  lockBotAdmission,
  refundUnservedPracticeLocked,
} from '../src/round-bot-admission';
import { exportThenErase } from './privacy.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';

setupRitewayBun();
requireTestServices(process.env);

for (const historical of [false, true])
  test(`usage export and closure preserve privacy and count meaning (historical=${historical})`, async () => {
    await withBoundedRound(async (f, run, roundId) => {
      const actorId = await admissionSponsor(f, [roundId]);
      const [{ user_id: userId }] =
        await f.sql`select user_id from actors where id=${actorId}`;
      const admission = testBotAdmission(run);
      const reservation = await admission.reserve({ actorId, roundId });
      if (historical)
        await f.sql`update usage_reservations set state=jsonb_build_object('kind','unknown','countBasis','historical_observation','countedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=${reservation.id}`;
      const other = await f.actor();
      const otherId = createId();
      await f.insert('usage_reservations', {
        id: otherId,
        actor_id: other,
        round_id: roundId,
        kind: 'ai_round',
        source: { kind: 'lifetime' },
        state: { kind: 'reserved' },
      });
      const exported = await exportThenErase(
        drizzle({ client: f.sql }),
        { userId, actorId },
        [usagePrivacyAdopter],
      );
      const remaining =
        await f.sql`select id from usage_reservations where round_id=${roundId}`;
      assert({
        given: 'two accounts with private allowance records on the same Round',
        should:
          'export and erase only the closing account, leaving the other identity untouched',
        actual: [
          exported.usage_reservations!.map((row) => row.id),
          remaining.map((row: { id: string }) => row.id),
        ],
        expected: [[reservation.id], [otherId]],
      });
      const exportedState = usageStateSchema.parse(
        exported.usage_reservations![0]!.state,
      );
      assert({
        given: 'the subject export of its own original count evidence',
        should:
          'retain historical recognition meaning without manufacturing a dispatch timestamp',
        actual:
          'countBasis' in exportedState
            ? exportedState.countBasis
            : exportedState.kind,
        expected: historical ? 'historical_observation' : 'reserved',
      });
      await assertRejects({
        given: 'the closed sponsor and an old admission identity',
        should: 'refuse recovery',
        code: 'AUTHORIZATION',
        actual: () => admission.reserve({ actorId, roundId }),
      });
      await assertRejects({
        given: 'a stale first-model caller after closure',
        should:
          'refuse current account authority before writing provider or allowance state',
        code: 'AUTHORIZATION',
        actual: () =>
          run(async (tx) => {
            await lockBotAdmission(tx);
            await markLockedRoundBotModelCall(tx, {
              roundId,
              before: '2099-01-01T00:00:00.000Z',
              accountEligible: canUseAiAllowance,
            });
          }),
      });
      await f.sql`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`;
      await run((tx) => refundUnservedPracticeLocked(tx, roundId));
      assert({
        given: 'late accounting after local erasure',
        should: 'never recreate the erased reservation',
        actual: await f.count('usage_reservations', 'actor_id', actorId),
        expected: 0,
      });
    });
  });
