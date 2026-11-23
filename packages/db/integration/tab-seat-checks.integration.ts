import { judgedRound } from './judged-round.test-support';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { daisyBallotDefinitions } from '@daisy/protocol/ballot-definition';
import { rejectedBy, withFixture } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';
import { insertRow, refusedBy, withSample } from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

/** A rubric's categories, every one at `score`. */
const scored = (score: number) => {
  const criteria = daisyBallotDefinitions['speaker-10@2'].points?.criteria;
  const categories =
    criteria?.kind === 'grid'
      ? criteria.groups.flatMap((group) => group.categories.map(({ id }) => id))
      : [];
  return Object.fromEntries(categories.map((category) => [category, score]));
};

test('the new seat, outcome, ballot and capture CHECKs refuse what the shapes cannot say', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await judgedRound(fixture);
    const seatRow = (columns: Record<string, unknown>) => ({
      id: createId(),
      round_id: roundId,
      slot: 0,
      ...columns,
    });
    const judge = (await fixture.seat(roundId, 'judge')).id;
    await fixture.freeze(roundId);
    assert({
      given:
        'a side seat without its side, a judge seat with one, a side spelled outside the key pattern, a Round with both a winner and a ranking, places that are not groups, and a ballot with neither a Daisy identity nor a stored definition',
      should: 'refuse each with its named CHECK',
      actual: [
        await fixture.rejectedBy(
          'round_participants',
          seatRow({
            actor_id: await fixture.actor(),
            seat_kind: 'side',
            side: null,
          }),
        ),
        await fixture.rejectedBy(
          'round_participants',
          seatRow({
            actor_id: await fixture.actor(),
            seat_kind: 'judge',
            side: 'negative',
          }),
        ),
        await fixture.rejectedBy(
          'round_participants',
          seatRow({
            actor_id: await fixture.actor(),
            seat_kind: 'side',
            side: 'Aff',
          }),
        ),
        await rejectedBy(
          () =>
            fixture.sql`update rounds set status = 'completed', started_at = now() - interval '1 hour',
            completed_at = now(), winning_side = 'affirmative', ranking = ${[['affirmative']]}
            where id = ${roundId}`,
        ),
        await rejectedBy(
          () =>
            fixture.sql`update rounds set status = 'completed', started_at = now() - interval '1 hour',
            completed_at = now(), ranking = ${['affirmative']} where id = ${roundId}`,
        ),
        await fixture.rejectedBy('ballots', {
          id: createId(),
          judge_participant_id: judge,
          round_id: roundId,
          freeze_revision: 1,
          rubric_version: 'missing-definition@1',
          winner: 'affirmative',
          scores: { affirmative: scored(3), negative: scored(3) },
          reason: 'A reason.',
          submitted_at: new Date(),
        }),
      ],
      expected: [
        'round_participants_side_check',
        'round_participants_side_check',
        'round_participants_side_check',
        'rounds_outcome_check',
        'rounds_ranking_shape_check',
        'ballots_daisy_definition_check',
      ],
    });
  });
});

test('a stored ranking is a non-empty list of non-empty places of keys (TAB-6.18)', async () => {
  await withFixture(url, async (f) => {
    const roundId = await f.round();
    const rank = (ranking: unknown) =>
      f.sql`update rounds set status = 'completed', started_at = now() - interval '1 hour',
          completed_at = now(), ranking = ${ranking} where id = ${roundId}`;
    assert({
      given: 'a completed Round ranked in places, then malformed rankings',
      should:
        'store the places, and refuse an empty place, a key that is not text, a place that is not a list, and no places',
      actual: [
        await rank([['a'], ['b', 'c'], ['d']]).then(() => 'stored'),
        await rejectedBy(() => rank([['a'], []])),
        await rejectedBy(() => rank([['a'], [1]])),
        await rejectedBy(() => rank([['a'], 'b'])),
        await rejectedBy(() => rank([])),
      ],
      expected: [
        'stored',
        'rounds_ranking_shape_check',
        'rounds_ranking_shape_check',
        'rounds_ranking_shape_check',
        'rounds_ranking_shape_check',
      ],
    });
  });
}, 60_000);

test('an event Room never releases its Recording, and a fixture side is a side key', async () => {
  await withSample(url, async (sql, ids) => {
    const draft = createId();
    const ancestry = {
      lobby_id: ids.lobby,
      event_id: ids.debate,
      tab_round_id: ids.round1,
    };
    await insertRow(sql, 'fixtures', {
      id: draft,
      ...ancestry,
      kind: 'pairing',
    });
    assert({
      given:
        "the sample tournament's event Room set to a released Recording, and a fixture entry on a side spelled outside the key pattern",
      should: 'refuse each with its named CHECK',
      actual: [
        await refusedBy(
          sql,
          () =>
            sql`update rooms set capture = ${{ broadcast: null, recordingPolicy: 'released' }}
            where id = ${ids.room}`,
        ),
        await refusedBy(
          sql,
          () => sql`update rooms set capture = null where id = ${ids.room}`,
        ),
        await refusedBy(sql, () =>
          insertRow(sql, 'fixture_entries', {
            fixture_id: draft,
            ...ancestry,
            entry_id: ids.teams[0],
            position: 0,
            side: 'Opening Gov',
          }),
        ),
      ],
      expected: [
        'rooms_event_recording',
        'rooms_event_recording',
        'fixture_entries_side_key',
      ],
    });
  });
});
