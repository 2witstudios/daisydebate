import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { catalogFormats } from '../src/catalog-formats';
import { rejectedBy, withFixture } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();

const freestyle = catalogFormats.find(({ id }) => id === 'freestyle')!;
const compiled = resolveRoomConfiguration(
  freestyle.definition,
  freestyle.preset,
);
if (!compiled.ok) throw new Error('Freestyle did not compile');
const rules = compiled.rules;

test('a Round’s judge seats and frozen judge count refuse invented history and incomplete endings', async () => {
  await withFixture(databaseUrl, async (f) => {
    const round = () =>
      f.round({
        format_id: freestyle.id,
        format_version: 1,
        rules_snapshot: rules,
      });
    const markerRound = await round();
    const markerActor = await f.actor();
    assert({
      given: 'a new judge seat claiming historical rating provenance',
      should: 'refuse the legacy marker',
      actual: await rejectedBy(
        () =>
          f.sql`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot,legacy_rating_participant) values(${createId()},${markerRound},${markerActor},'judge',null,0,true)`,
      ),
      expected: 'round_participants_legacy_rating_marker',
    });
    const count = (judges: unknown) => {
      const seats: Record<string, unknown> = { ...rules.seats };
      if (judges === undefined) delete seats['judges'];
      else seats['judges'] = judges;
      const snapshot = { ...rules, seats };
      return rejectedBy(
        () => f.sql`select daisy_round_judge_slot_count(${snapshot}::jsonb)`,
      );
    };
    assert({
      given:
        'rules snapshots missing their judge count or carrying an invalid one, and valid counts',
      should:
        'refuse every invalid count by the frozen-count rule and accept 0 and 1',
      actual: [
        await count(undefined),
        await count('not-a-count'),
        await count(-1),
        await count(257),
        await count(1.5),
        await count(0),
        await count(1),
      ],
      expected: [
        'round_judge_slots_frozen_count',
        'round_judge_slots_frozen_count',
        'round_judge_slots_frozen_count',
        'round_judge_slots_frozen_count',
        'round_judge_slots_frozen_count',
        null,
        null,
      ],
    });
    const future = await round();
    const at = new Date('2026-11-01T10:00:00Z');
    const refusal = await rejectedBy(() =>
      f.sql.begin(async (tx) => {
        await tx`set local role daisy_web`;
        await tx`update rounds set status='completed',
          started_at=${at},completed_at=${at},winning_side='negative' where id=${future}`;
      }),
    );
    const [futureState] =
      await f.sql`select status from rounds where id=${future}`;
    assert({
      given:
        'a Round with an unfilled required judge slot completed by the web role',
      should: 'refuse the ending and leave the Round unchanged',
      actual: [refusal, futureState?.status],
      expected: ['rounds_judge_slots_complete', 'opening'],
    });
  });
});
