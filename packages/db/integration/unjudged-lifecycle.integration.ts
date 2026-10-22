import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture, rejectedBy } from './constraint-helpers';
import { validRules } from './round-fixtures';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const zeroRules = { ...validRules, seats: { ...validRules.seats, judge: 0 } };
const start = new Date('2026-10-22T10:00:00.000Z');
const end = new Date('2026-10-22T10:01:00.000Z');
const completed = {
  status: 'completed',
  started_at: start,
  completed_at: end,
  current_stage: null,
  outcome: null,
};

test('only casual zero-judge snapshots can persist completed without a winner', async () => {
  await withFixture(databaseUrl, async (f) => {
    let id = '';
    const accepted = await rejectedBy(async () => {
      id = await f.round({ ...completed, rules_snapshot: zeroRules });
    });
    const judged = await rejectedBy(() =>
      f.round({
        ...completed,
        rules_snapshot: {
          ...zeroRules,
          seats: { ...zeroRules.seats, judge: 1 },
        },
      }),
    );
    const missing = await rejectedBy(
      () =>
        f.sql`update rounds set rules_snapshot=rules_snapshot #- '{seats,judge}' where id=${id}`,
    );
    assert({
      given:
        'completed rows with zero-judge, judged or missing frozen judge facts',
      should:
        'permit only the explicit casual zero-judge snapshot and retain null outcome',
      actual: [accepted, judged, missing],
      expected: [null, 'rounds_lifecycle_check', 'rounds_lifecycle_check'],
    });
  });
});

test('actual judge seats cannot bypass or follow unjudged completion', async () => {
  await withFixture(databaseUrl, async (f) => {
    const id = await f.round({ rules_snapshot: zeroRules });
    await f.seat(id, 'judge');
    const withJudge = await rejectedBy(() =>
      f.sql.begin(async (tx) => {
        await tx`update rounds set status='completed',started_at=${start},completed_at=${end},current_stage=null,outcome=null where id=${id}`;
      }),
    );
    await f.sql`delete from round_participants where round_id=${id}`;
    await f.sql`update rounds set status='completed',started_at=${start},completed_at=${end},current_stage=null,outcome=null where id=${id}`;
    const added = await rejectedBy(() => f.seat(id, 'judge'));
    assert({
      given: 'a zero-judge rules snapshot with contradictory actual judge rows',
      should: 'refuse at commit both completion and later judge insertion',
      actual: [withJudge, added],
      expected: [
        'rounds_unjudged_participants_check',
        'rounds_unjudged_participants_check',
      ],
    });
    await f.sql`delete from rounds where id=${id}`;
  });
});

test('ranked and judged completion retain the required outcome', async () => {
  await withFixture(databaseUrl, async (f) => {
    const formatId = await f.format();
    await f.preset(formatId);
    const ranked = await rejectedBy(() =>
      f.round({
        ...completed,
        rules_snapshot: zeroRules,
        competition_type: 'ranked',
        ladder_id: 'ranked',
        preset_version: 1,
        format_id: formatId,
      }),
    );
    const judged = await f.round({
      ...completed,
      outcome: 'affirmative',
      rules_snapshot: { ...zeroRules, seats: { ...zeroRules.seats, judge: 1 } },
    });
    const nulling = await rejectedBy(
      () => f.sql`update rounds set outcome=null where id=${judged}`,
    );
    assert({
      given:
        'ranked zero-judge rows or judged rows with an established outcome',
      should: 'retain the nonnull-outcome lifecycle guard',
      actual: [ranked, nulling],
      expected: ['rounds_lifecycle_check', 'rounds_lifecycle_check'],
    });
  });
});

test('concurrent judge admission cannot commit behind an unjudged completion', async () => {
  await withFixture(databaseUrl, async (f) => {
    const roundId = await f.round({ rules_snapshot: zeroRules });
    const actorId = await f.actor();
    const held = Promise.withResolvers<void>(),
      inserted = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const completing = f.sql.begin(async (tx) => {
      await tx`update rounds set status='completed',started_at=${start},completed_at=${end},current_stage=null,outcome=null where id=${roundId}`;
      held.resolve();
      await finish.promise;
    });
    try {
      await held.promise;
      const adding = rejectedBy(() =>
        f.sql.begin(async (tx) => {
          await tx`insert into round_participants(id,round_id,actor_id,role,slot) values (${actorId},${roundId},${actorId},'judge',0)`;
          inserted.resolve();
        }),
      );
      await inserted.promise;
      finish.resolve();
      await completing;
      assert({
        given:
          'a judge insertion whose FK admits while the Round writer is held',
        should:
          'refuse the deferred contradictory admission after completion commits',
        actual: [
          await adding,
          await f.count('round_participants', 'round_id', roundId),
        ],
        expected: ['rounds_unjudged_participants_check', 0],
      });
    } finally {
      finish.resolve();
      await completing;
    }
  });
});
