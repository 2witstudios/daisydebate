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

test('a judged casual Round completes without a winner only once the database clock reaches its persisted ballot deadline (DEC-201, DEC-207)', async () => {
  await withFixture(databaseUrl, async (f) => {
    const zeroJudge = await rejectedBy(() =>
      f.round({ ...completed, rules_snapshot: zeroRules }),
    );
    const [{ now }] = await f.sql`select clock_timestamp() as now`;
    const future = new Date(now.getTime() + 3_600_000);
    const judgedAt = async (deadline: Date | null, completedAt: Date) => {
      const id = await f.round({
        status: 'active',
        current_stage: 'live',
        started_at: start,
        rules_snapshot: judgedRules,
        ballot_deadline_at: deadline,
      });
      await f.seat(id, 'judge');
      return rejectedBy(() =>
        f.sql.begin(
          (tx) =>
            tx`update rounds set status='completed',current_stage=null,outcome=null,completed_at=${completedAt} where id=${id}`,
        ),
      );
    };
    const repinned = await f.round({
      status: 'active',
      current_stage: 'live',
      started_at: start,
      ballot_deadline_at: end,
    });
    assert({
      given:
        'a zero-judge completion, judged completions with no deadline, a future deadline (even claiming completion at it) and a passed one, and a deadline rewrite',
      should:
        'judge the deadline by the database clock: accept zero judges and a passed deadline, and refuse the rest and the rewrite',
      actual: [
        zeroJudge,
        await judgedAt(null, end),
        await judgedAt(future, end),
        await judgedAt(future, future),
        await judgedAt(end, end),
        await rejectedBy(
          () =>
            f.sql`update rounds set ballot_deadline_at=${future} where id=${repinned}`,
        ),
      ],
      expected: [
        null,
        'rounds_unjudged_participants_check',
        'rounds_unjudged_participants_check',
        'rounds_unjudged_participants_check',
        null,
        'rounds_ballot_deadline_immutable',
      ],
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
