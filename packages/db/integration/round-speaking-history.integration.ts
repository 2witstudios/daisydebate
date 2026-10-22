import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture, sqlStateOf } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('historical speaking authority excludes overlapping seat intervals but permits simultaneous CX', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const firstSeat = await fixture.seat(roundId, 'affirmative');
    const secondSeat = await fixture.seat(roundId, 'negative');
    const segmentId = createId();
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'cross_ex',
      rules_segment_key: 'CX',
      started_at: new Date('2026-10-22T05:00:00Z'),
      duration_ms: 60_000,
    });
    const insert = (participantId: string, start: number, end: number | null) =>
      fixture.sql.unsafe(
        'insert into round_speaking_intervals (id, round_id, segment_id, round_participant_id, started_at, ended_at, started_version, ended_version) values ($1,$2,$3,$4,$5,$6,1,$7)',
        [
          createId(),
          roundId,
          segmentId,
          participantId,
          new Date(start),
          end === null ? null : new Date(end),
          end === null ? null : 2,
        ],
      );
    try {
      await insert(firstSeat.id, 1000, 2000);
      const overlap = await rejectedBy(() => insert(firstSeat.id, 1500, 2500));
      await insert(firstSeat.id, 2000, 3000);
      await insert(firstSeat.id, 2000, 2000);
      await insert(secondSeat.id, 1000, 3000);
      assert({
        given:
          'adjacent intervals for one speaker and simultaneous cross-examination speakers',
        should: 'reject only same-seat overlap and preserve half-open history',
        actual: {
          overlap,
          rows: await fixture.count(
            'round_speaking_intervals',
            'round_id',
            roundId,
          ),
        },
        expected: { overlap: 'round_speaking_intervals_no_overlap', rows: 4 },
      });
      const otherRoundId = await fixture.round();
      const otherSeat = await fixture.seat(otherRoundId, 'affirmative');
      assert({
        given: 'a historical interval referencing another Round seat',
        should: 'refuse mismatched authority',
        actual: await rejectedBy(() => insert(otherSeat.id, 4000, 5000)),
        expected: 'round_speaking_intervals_participant_round_fk',
      });
    } finally {
      const [table] =
        await fixture.sql`select to_regclass('public.round_speaking_intervals') as name`;
      if (table?.name)
        await fixture.sql.unsafe(
          'delete from round_speaking_intervals where round_id = $1',
          [roundId],
        );
    }
  });
});

test('Round deletion cascades history before checking its scoped command references', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const seat = await fixture.seat(roundId, 'affirmative');
    const segmentId = createId();
    const commandId = createId();
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: 'AC',
      started_at: new Date(1000),
      duration_ms: 1000,
    });
    await fixture.insert(
      'round_commands',
      {
        command_id: commandId,
        round_id: roundId,
        actor_id: seat.actorId,
        type: 'start',
        payload_digest: 'a'.repeat(64),
        result: {},
        resulting_version: 1,
        applied_at: new Date(1000),
      },
      'command_id',
    );
    await fixture.sql.unsafe(
      'insert into round_speaking_intervals (id, round_id, segment_id, round_participant_id, started_at, ended_at, started_version, ended_version, started_command_id, ended_command_id) values ($1,$2,$3,$4,$5,$6,1,2,$7,$7)',
      [
        createId(),
        roundId,
        segmentId,
        seat.id,
        new Date(1000),
        new Date(2000),
        commandId,
      ],
    );
    try {
      assert({
        given: 'a command still referenced by accepted speaking history',
        should:
          'refuse a direct deletion even though aggregate cascades are allowed',
        actual: await sqlStateOf(() =>
          fixture.sql.unsafe('delete from round_commands where command_id=$1', [
            commandId,
          ]),
        ),
        expected: '23503',
      });
      assert({
        given:
          'a Round with scoped speaking history naming an accepted command',
        should:
          'allow the parent cascade while retaining child reference integrity',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe('delete from rounds where id=$1', [roundId]),
        ),
        expected: null,
      });
    } finally {
      await fixture.sql.unsafe(
        'delete from round_speaking_intervals where round_id=$1',
        [roundId],
      );
    }
  });
});
