import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { sql } from 'drizzle-orm';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { testLane } from '../src/testing-lane';
import {
  lockBotAdmission,
  markLockedRoundBotModelCall,
} from '../src/round-bot-admission';
import { advanceUsageLocked } from '../src/usage-ledger';
import { withBoundedRound } from './bounded-transaction.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';
import { sqlStateOf } from './constraint-helpers';
import { causeChainMember } from '../src/capacity-refusal';

setupRitewayBun();
requireTestServices(process.env);

test('daisy_web admits and settles usage while direct attribution and original-count mutations fail', async () => {
  await withBoundedRound(async (f, _run, roundId, client) => {
    const actorId = await admissionSponsor(f, [roundId]);
    const reserve = client.reserve.bind(client);
    client.reserve = async (options) => {
      const connection = await reserve(options);
      await connection`set role daisy_web`;
      return connection;
    };
    const runtime = createBoundedTransaction({
      lane: testLane(client, 4),
      now: performance.now,
    });
    const role = await runtime(
      async (tx) =>
        (await tx.execute(sql`select current_user as role`))[0]?.role,
    );
    assert({
      given:
        'every reserved connection installed as the runtime role before the bounded facade',
      should: 'execute as daisy_web',
      actual: role,
      expected: 'daisy_web',
    });
    const admission = testBotAdmission(runtime);
    const reservation = await admission.reserve({ actorId, roundId });
    await runtime(async (tx) => {
      await lockBotAdmission(tx);
      await markLockedRoundBotModelCall(tx, {
        roundId,
        before: '2099-01-01T00:00:00.000Z',
        accountEligible: canUseAiAllowance,
      });
    });
    const [original] =
      await f.sql`select source,state from usage_reservations where id=${reservation.id}`;
    const rejected = [];
    for (const mutation of [
      sql`source='{"kind":"lifetime"}'::jsonb`,
      sql`source=jsonb_set(source,'{endsAt}','"2099-01-01T00:00:00.000Z"'::jsonb)`,
      sql`state=jsonb_set(state,'{countedAt}','"2099-01-01T00:00:00.000Z"'::jsonb)`,
      sql`state='{"kind":"reserved"}'::jsonb`,
    ])
      rejected.push(
        await sqlStateOf(() =>
          runtime((tx) =>
            tx.execute(
              sql`update usage_reservations set ${mutation} where id=${reservation.id}`,
            ),
          ).catch((error) => {
            throw causeChainMember((cause) => 'errno' in cause, error) ?? error;
          }),
        ),
      );
    const [unchanged] =
      await f.sql`select source,state from usage_reservations where id=${reservation.id}`;
    assert({
      given:
        'direct runtime attempts to rewrite source, period, count or counted identity',
      should:
        'reject every mutation with the immutable database constraint and retain original data',
      actual: [rejected, unchanged],
      expected: [['23514', '23514', '23514', '23514'], original],
    });
    const settled = await runtime((tx) =>
      advanceUsageLocked(tx, {
        reservationId: reservation.id,
        actorId,
        roundId,
        authorized: false,
        event: { kind: 'settle', outcome: 'definite_failure' },
      }),
    );
    assert({
      given:
        'the real runtime role using production bounded admission/first dispatch/settlement and direct adversarial updates',
      should:
        'allow its legitimate ledger lifecycle, reject every source/period/count rewrite and retain original attribution',
      actual: settled.kind === 'changed' && settled.state.kind,
      expected: 'refunded',
    });
  });
});
