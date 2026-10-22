import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture, rejectedBy } from './constraint-helpers';
import { validRules } from './round-fixtures';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const zeroRules = { ...validRules, seats: { ...validRules.seats, judge: 0 } };
const judgedRules = { ...zeroRules, seats: { ...zeroRules.seats, judge: 1 } };
const start = new Date('2026-10-22T10:00:00.000Z');
const end = new Date('2026-10-22T10:01:00.000Z');
const completed = {
  status: 'completed',
  started_at: start,
  completed_at: end,
  current_stage: null,
  outcome: null,
};

test('a casual Round completes without a winner whether it had no judges or its judges did not rule (DEC-201)', async () => {
  await withFixture(databaseUrl, async (f) => {
    const zeroJudge = await rejectedBy(() =>
      f.round({ ...completed, rules_snapshot: zeroRules }),
    );
    const judgedId = await f.round({
      ...completed,
      rules_snapshot: judgedRules,
    });
    await f.seat(judgedId, 'judge');
    assert({
      given:
        'a completed casual zero-judge row, and a judged one whose seated judge gave no ruling',
      should: 'persist both with a null outcome',
      actual: [
        zeroJudge,
        (await f.sql`select outcome from rounds where id=${judgedId}`)[0],
      ],
      expected: [null, { outcome: null }],
    });
  });
});

test('ranked and practice completion retain the required outcome', async () => {
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
    const practice = await rejectedBy(() =>
      f.round({
        ...completed,
        rules_snapshot: judgedRules,
        competition_type: 'practice',
      }),
    );
    assert({
      given: 'completed ranked and practice rows without an outcome',
      should: 'refuse both with the lifecycle guard',
      actual: [ranked, practice],
      expected: ['rounds_lifecycle_check', 'rounds_lifecycle_check'],
    });
  });
});
