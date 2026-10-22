import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('ballots keep immutable scoped frozen provenance while provisional null rows cannot acquire it', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const judge = await fixture.seat(roundId, 'judge');
    const otherRound = await fixture.round();
    const otherJudge = await fixture.seat(otherRound, 'judge');
    await fixture.sql.unsafe(
      "insert into round_transcript_freezes(round_id,revision,frontier,completeness) values($1,1,0,'incomplete')",
      [roundId],
    );
    const insert = (
      seat: string,
      round: string | null,
      revision: number | null,
    ) =>
      fixture.insert('ballots', {
        id: createId(),
        judge_participant_id: seat,
        round_id: round,
        freeze_revision: revision,
        rubric_version: 'speaker-10@1',
        winner: 'affirmative',
        scores: {},
        reason: 'Synthetic integrity fixture',
        status: 'submitted',
        submitted_at: new Date(1000),
      });
    assert({
      given: 'a ballot naming another Round judge',
      should: 'reject cross-Round provenance',
      actual: await rejectedBy(() => insert(otherJudge.id, roundId, 1)),
      expected: 'ballots_judge_round_fk',
    });
    assert({
      given: 'a ballot naming an uncommitted freeze revision',
      should: 'reject absent frozen input',
      actual: await rejectedBy(() => insert(judge.id, roundId, 2)),
      expected: 'ballots_freeze_revision_fk',
    });
    assert({
      given: 'a partially absent provenance pair',
      should: 'reject it',
      actual: await rejectedBy(() => insert(judge.id, roundId, null)),
      expected: 'ballots_freeze_pair_check',
    });
    await insert(judge.id, roundId, 1);
    await insert(otherJudge.id, null, null);
    const rewrite = (
      seat: string,
      round: string | null,
      revision: number | null,
    ) =>
      fixture.sql.unsafe(
        'update ballots set round_id=$1,freeze_revision=$2 where judge_participant_id=$3',
        [round, revision, seat],
      );
    assert({
      given: 'pinned or provisional legacy provenance',
      should: 'refuse clearing or inventing frozen input on every UPDATE',
      actual: await Promise.all([
        rejectedBy(() => rewrite(judge.id, null, null)),
        rejectedBy(() => rewrite(otherJudge.id, roundId, 1)),
      ]),
      expected: ['ballots_freeze_immutable', 'ballots_freeze_immutable'],
    });
    await fixture.sql.unsafe(
      "update ballots set status='voided',voided_at=$1,voided_by_actor_id=$2 where judge_participant_id=$3",
      [new Date(2000), judge.actorId, judge.id],
    );
    assert({
      given: 'a valid provenance-preserving void operation',
      should: 'retain the frozen witness',
      actual: (
        await fixture.sql.unsafe(
          'select round_id,freeze_revision,status from ballots where judge_participant_id=$1',
          [judge.id],
        )
      )[0],
      expected: { round_id: roundId, freeze_revision: 1, status: 'voided' },
    });
    await fixture.insert(
      'round_commands',
      {
        command_id: createId(),
        round_id: roundId,
        actor_id: judge.actorId,
        type: 'submit_ballot',
        payload_digest: 'a'.repeat(64),
        result: { ballotId: createId() },
        resulting_version: 1,
        applied_at: new Date(2000),
      },
      'command_id',
    );
  });
});

test('every judge has a separate job and only owning Round erasure removes frozen ballots', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    try {
      const judges = [
        await fixture.seat(roundId, 'judge'),
        await fixture.seat(roundId, 'judge', 1),
      ];
      await fixture.sql.unsafe(
        "insert into round_transcript_freezes(round_id,revision,frontier,completeness) values($1,1,0,'incomplete')",
        [roundId],
      );
      for (const judge of judges) {
        await fixture.insert('ballots', {
          id: createId(),
          judge_participant_id: judge.id,
          round_id: roundId,
          freeze_revision: 1,
          rubric_version: 'speaker-10@1',
          winner: 'affirmative',
          scores: {},
          reason: 'Synthetic cascade fixture',
          status: 'submitted',
          submitted_at: new Date(1000),
        });
        await fixture.sql.unsafe(
          "insert into round_judging_jobs(round_id,freeze_revision,judge_participant_id,status) values($1,1,$2,'queued')",
          [roundId, judge.id],
        );
      }
      assert({
        given: 'two legally admitted judge seats',
        should: 'keep both independent durable judging intents',
        actual: await fixture.count('round_judging_jobs', 'round_id', roundId),
        expected: 2,
      });
      let reachedFreezeCommit = false;
      const freezeRefusal = await rejectedBy(() =>
        fixture.sql.begin(async (tx) => {
          await tx.unsafe(
            'delete from round_transcript_freezes where round_id=$1',
            [roundId],
          );
          reachedFreezeCommit = true;
        }),
      );
      let reachedSeatCommit = false;
      const seatRefusal = await rejectedBy(() =>
        fixture.sql.begin(async (tx) => {
          await tx.unsafe('delete from round_participants where id=$1', [
            judges[0]!.id,
          ]);
          reachedSeatCommit = true;
        }),
      );
      assert({
        given: 'standalone freeze or submitted judge-seat deletion',
        should: 'defer refusal to commit and roll back the entire deletion',
        actual: {
          reachedFreezeCommit,
          reachedSeatCommit,
          freezeRefusal,
          seatRefusal,
          freezes: await fixture.count(
            'round_transcript_freezes',
            'round_id',
            roundId,
          ),
          seats: await fixture.count('round_participants', 'round_id', roundId),
        },
        expected: {
          reachedFreezeCommit: true,
          reachedSeatCommit: true,
          freezeRefusal: 'ballots_freeze_revision_fk',
          seatRefusal: 'ballots_judge_seat_fk',
          freezes: 1,
          seats: 2,
        },
      });
      const segmentId = createId();
      await fixture.insert('round_segments', {
        id: segmentId,
        round_id: roundId,
        sequence: 0,
        type: 'speech',
        rules_segment_key: 'AC',
        started_at: new Date(1000),
        ended_at: new Date(2000),
        duration_ms: 1000,
      });
      await fixture.insert('utterances', {
        id: createId(),
        round_id: roundId,
        segment_id: segmentId,
        round_participant_id: judges[0]!.id,
        sequence: 0,
        text: 'Synthetic private text',
      });
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
      const tables = [
        'ballots',
        'round_judging_jobs',
        'round_transcript_freezes',
        'round_participants',
        'utterances',
      ];
      assert({
        given: 'the owning Round erased with frozen ballots and captured text',
        should: 'leave no owned aggregate rows',
        actual: await Promise.all(
          tables.map((table) => fixture.count(table, 'round_id', roundId)),
        ),
        expected: [0, 0, 0, 0, 0],
      });
    } finally {
      await fixture.sql.unsafe('delete from ballots where round_id=$1', [
        roundId,
      ]);
      await fixture.sql.unsafe(
        'delete from round_judging_jobs where round_id=$1',
        [roundId],
      );
      await fixture.sql.unsafe(
        'delete from round_transcript_freezes where round_id=$1',
        [roundId],
      );
    }
  });
});
