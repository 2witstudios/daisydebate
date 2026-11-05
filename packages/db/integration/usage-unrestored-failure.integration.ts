import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { testLane } from '../src/testing-lane';
import { advanceUsageLocked } from '../src/usage-ledger';
import { causeChainMember } from '../src/capacity-refusal';
import { withBoundedRound } from './bounded-transaction.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';
import { sqlStateOf } from './constraint-helpers';

setupRitewayBun();
requireTestServices(process.env);

test('unrestored known failure stays spent and terminal under daisy_web without synthetic relief', async () => {
  await withBoundedRound(async (f, _run, roundId, client) => {
    const otherRound = await f.round();
    const actorId = await admissionSponsor(f, [roundId, otherRound]);
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
    const admission = testBotAdmission(runtime, 4, 1);
    const original = await admission.reserve({ actorId, roundId });
    await f.sql`update usage_reservations set state=jsonb_build_object('kind','unknown','countBasis','historical_observation','countedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=${original.id}`;
    const basisChange = await sqlStateOf(() =>
      runtime((tx) =>
        tx.execute(
          sql`update usage_reservations set state=jsonb_set(state,'{countBasis}','"dispatch_record"'::jsonb) where id=${original.id}`,
        ),
      ).catch((error) => {
        throw causeChainMember((cause) => 'errno' in cause, error) ?? error;
      }),
    );
    assert({
      given:
        'historical observation on still-unknown usage under the real runtime role',
      should: 'reject relabeling its recognition as exact dispatch evidence',
      actual: basisChange,
      expected: '23514',
    });
    await f.sql`update usage_reservations set state=jsonb_set(state,'{kind}','"definite_failure"'::jsonb) where id=${original.id}`;
    const [before] =
      await f.sql`select source,state from usage_reservations where id=${original.id}`;
    await assertRejects({
      given:
        'known failed counted use with no recorded relief in a capped original source',
      should: 'keep that allowance spent',
      code: 'CONFLICT',
      actual: () => admission.reserve({ actorId, roundId: otherRound }),
    });
    const repeated = await runtime((tx) =>
      advanceUsageLocked(tx, {
        actorId,
        roundId,
        reservationId: original.id,
        authorized: false,
        event: { kind: 'settle', outcome: 'definite_failure' },
      }),
    );
    const rejected = [];
    for (const state of [
      sql`jsonb_set(state,'{kind}','"unknown"'::jsonb)`,
      sql`state || jsonb_build_object('kind','refunded','refundedAt',state->>'countedAt')`,
      sql`jsonb_set(state,'{countedAt}','"2099-01-01T00:00:00.000Z"'::jsonb)`,
      sql`jsonb_set(state,'{countBasis}','"dispatch_record"'::jsonb)`,
      sql`state || '{"refundedAt":"2026-11-01T00:00:00.000Z"}'::jsonb`,
    ])
      rejected.push(
        await sqlStateOf(() =>
          runtime((tx) =>
            tx.execute(
              sql`update usage_reservations set state=${state} where id=${original.id}`,
            ),
          ).catch((error) => {
            throw causeChainMember((cause) => 'errno' in cause, error) ?? error;
          }),
        ),
      );
    assert({
      given:
        'repeated settlement and direct runtime attempts to manufacture a refund, alter count or reopen work',
      should: 'preserve original attribution and failure with no new relief',
      actual: [
        repeated.kind,
        rejected,
        (
          await f.sql`select source,state from usage_reservations where id=${original.id}`
        )[0],
      ],
      expected: [
        'unchanged',
        ['23514', '23514', '23514', '23514', '23514'],
        before,
      ],
    });
  });
});

test('runtime inserts enforce strict count basis and chronology independently of update guards', async () => {
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
    const base = {
      kind: 'definite_failure',
      countedAt: '2026-11-01T00:00:00.000Z',
      countBasis: 'historical_observation',
    };
    const states = [
      { ...base, countBasis: 'invented' },
      { kind: base.kind, countedAt: base.countedAt },
      { ...base, countedAt: '2026-10-01T00:00:00.000Z' },
      { ...base, countedAt: '2099-01-01T00:00:00.000Z' },
      { ...base, refundedAt: base.countedAt },
      base,
    ];
    const results = [];
    for (const state of states)
      results.push(
        await sqlStateOf(() =>
          runtime((tx) =>
            tx.execute(sql`insert into usage_reservations(id,actor_id,round_id,kind,source,state,reserved_at)
      values(${createId()},${actorId},${roundId},'casual_ai_judge','{"kind":"beta","startsAt":"2026-10-01T00:00:00.000Z","endsAt":"2026-11-01T00:00:00.000Z"}'::jsonb,${state}::jsonb,'2026-10-31T23:59:58.000Z')`),
          ).catch((error) => {
            throw causeChainMember((cause) => 'errno' in cause, error) ?? error;
          }),
        ),
      );
    assert({
      given:
        'new runtime rows with invalid or absent basis, pre-admission/future count time, invented refund, and a valid later historical observation',
      should:
        'reject each malformed state through CHECK constraints while allowing truthful cross-month recognition',
      actual: results,
      expected: ['23514', '23514', '23514', '23514', '23514', 'accepted'],
    });
  });
});
