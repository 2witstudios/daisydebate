import { requireTestServices } from '@daisy/config';
import { runtimeCheckpointSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const started = new Date('2026-11-01T05:30:00.123Z');

test('due_at follows returned airtime, in any session time zone', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const id = createId();
    await fixture.insert('round_segments', {
      id,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: 'AC',
      started_at: started,
      duration_ms: 90_000_000,
    });
    const dueMs = async () => {
      const [row] = await fixture.sql.unsafe(
        'select due_at from round_segments where id = $1',
        [id],
      );
      return new Date(row.due_at).getTime() - started.getTime();
    };
    const fresh = await dueMs();
    await fixture.sql.unsafe(
      'update round_segments set returned_ms = 18000 where id = $1',
      [id],
    );
    assert({
      given: 'a segment crossing a daylight saving change, then returned 18 s',
      should: 'be due exactly its duration, then 18 s later',
      actual: { fresh, returned: await dueMs() },
      expected: { fresh: 90_000_000, returned: 90_018_000 },
    });
    assert({
      given: 'a negative return',
      should: 'be refused',
      actual: await rejectedBy(() =>
        fixture.sql.unsafe(
          'update round_segments set returned_ms = -1 where id = $1',
          [id],
        ),
      ),
      expected: 'round_segments_returned_check',
    });
  });
});

test('round_incidents holds one open incident and one ending', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const open = (id = createId()) =>
      fixture.insert('round_incidents', {
        id,
        round_id: roundId,
        cause: 'room_retired',
        detected_at: started,
      });
    const first = createId();
    await open(first);
    assert({
      given: 'a second incident while one is open',
      should: 'be refused',
      actual: await rejectedBy(() => open()),
      expected: 'round_incidents_single_open',
    });
    assert({
      given: 'an incident both resumed and ended',
      should: 'be refused',
      actual: await rejectedBy(() =>
        fixture.sql.unsafe(
          'update round_incidents set resumed_at = $2, ended_at = $2 where id = $1',
          [first, started],
        ),
      ),
      expected: 'round_incidents_one_ending_check',
    });
    assert({
      given: 'an unknown cause',
      should: 'be refused',
      actual: await rejectedBy(() =>
        fixture.sql.unsafe(
          'update round_incidents set cause = $2 where id = $1',
          [first, 'player_request'],
        ),
      ),
      expected: 'round_incidents_cause_check',
    });
    await fixture.sql.unsafe(
      'update round_incidents set resumed_at = $2 where id = $1',
      [first, started],
    );
    await open();
    assert({
      given: 'a new incident once the first has resumed',
      should: 'be kept, so the rate counts both',
      actual: await fixture.count('round_incidents', 'round_id', roundId),
      expected: 2,
    });
  });
});

test('a fresh Round reads the strict checkpoint', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const [row] = await fixture.sql.unsafe(
      'select runtime_state from rounds where id = $1',
      [roundId],
    );
    assert({
      given: 'the column default',
      should: 'parse with no incident and no stops',
      actual: (({ incident, clock_stops }) => ({ incident, clock_stops }))(
        runtimeCheckpointSchema.parse(row.runtime_state),
      ),
      expected: { incident: { phase: 'none' }, clock_stops: [] },
    });
  });
});
