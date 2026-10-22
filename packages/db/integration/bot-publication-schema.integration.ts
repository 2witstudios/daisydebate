import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('a bot publication claim preserves its epoch and exact scoped run identity', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const seat = await fixture.seat(roundId, 'affirmative');
    const segmentId = createId();
    const runId = createId();
    await fixture.insert('round_segments', {
      id: segmentId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: 'AC',
      started_at: new Date(),
      duration_ms: 1000,
    });
    await fixture.insert('agent_runs', {
      id: runId,
      round_participant_id: seat.id,
      kind: 'speech',
      provider: 'synthetic',
      started_at: new Date(),
    });
    try {
      await fixture.sql.unsafe(
        "insert into round_bot_publications(round_id,round_participant_id,segment_id,agent_run_id,service_id,publication_epoch,lease_token_digest,lease_expires_at) values($1,$2,$3,$4,$5,1,$6,clock_timestamp()+interval '1 minute')",
        [
          roundId,
          seat.id,
          segmentId,
          runId,
          `agent-run:${runId}`,
          'a'.repeat(64),
        ],
      );
      const mutate = (set: string, parameters: unknown[] = []) =>
        fixture.sql.unsafe(
          `update round_bot_publications set ${set} where round_id=$1 and round_participant_id=$2`,
          [roundId, seat.id, ...parameters],
        );
      assert({
        given: 'an existing per-seat publication claim',
        should: 'refuse epoch decrease and same-epoch identity replacement',
        actual: await Promise.all([
          rejectedBy(() => mutate('publication_epoch=0')),
          rejectedBy(() => mutate('lease_token_digest=$3', ['b'.repeat(64)])),
        ]),
        expected: [
          'round_bot_publications_epoch_immutable',
          'round_bot_publications_epoch_immutable',
        ],
      });
      await mutate("lease_expires_at=clock_timestamp()-interval '1 second'");
      assert({
        given: 'a revoked or expired publication claim',
        should: 'refuse resurrection by renewal at the same epoch',
        actual: await rejectedBy(() =>
          mutate("lease_expires_at=clock_timestamp()+interval '1 minute'"),
        ),
        expected: 'round_bot_publications_lease_revoked',
      });
      const nextRun = createId();
      await fixture.insert('agent_runs', {
        id: nextRun,
        round_participant_id: seat.id,
        kind: 'speech',
        provider: 'synthetic',
        started_at: new Date(),
      });
      await mutate(
        "publication_epoch=2,agent_run_id=$3,service_id=$4,lease_token_digest=$5,lease_expires_at=clock_timestamp()+interval '1 minute'",
        [nextRun, `agent-run:${nextRun}`, 'b'.repeat(64)],
      );
      assert({
        given: 'a new run and digest taking over a revoked claim',
        should: 'retain exactly the next durable epoch',
        actual: (
          await fixture.sql.unsafe(
            'select publication_epoch,agent_run_id from round_bot_publications where round_id=$1',
            [roundId],
          )
        )[0],
        expected: { publication_epoch: 2, agent_run_id: nextRun },
      });
      const otherRound = await fixture.round();
      const otherSeat = await fixture.seat(otherRound, 'affirmative');
      assert({
        given: 'a claim attempting to move its Round/seat identity',
        should: 'refuse mutation even at a new epoch',
        actual: await rejectedBy(() =>
          mutate('publication_epoch=3,round_participant_id=$3', [otherSeat.id]),
        ),
        expected: 'round_bot_publications_identity_immutable',
      });
      const otherRun = createId();
      const otherSegment = createId();
      await fixture.insert('agent_runs', {
        id: otherRun,
        round_participant_id: otherSeat.id,
        kind: 'speech',
        provider: 'synthetic',
        started_at: new Date(),
      });
      await fixture.insert('round_segments', {
        id: otherSegment,
        round_id: otherRound,
        sequence: 0,
        type: 'speech',
        rules_segment_key: 'AC',
        started_at: new Date(),
        duration_ms: 1000,
      });
      const insertForeign = (segment: string, run: string) =>
        fixture.sql.unsafe(
          "insert into round_bot_publications(round_id,round_participant_id,segment_id,agent_run_id,service_id,publication_epoch,lease_token_digest,lease_expires_at) values($1,$2,$3,$4,$5,1,$6,clock_timestamp()+interval '1 minute')",
          [
            otherRound,
            otherSeat.id,
            segment,
            run,
            `agent-run:${run}`,
            'c'.repeat(64),
          ],
        );
      assert({
        given: 'a publication claim naming a foreign segment',
        should: 'reject the mismatched Round witness',
        actual: await rejectedBy(() => insertForeign(segmentId, otherRun)),
        expected: 'round_bot_publications_segment_round_fk',
      });
      assert({
        given: 'a publication claim naming another seat AgentRun',
        should: 'reject the mismatched run witness',
        actual: await rejectedBy(() => insertForeign(otherSegment, nextRun)),
        expected: 'round_bot_publications_run_seat_fk',
      });
      let reachedCommit = false;
      const runRefusal = await rejectedBy(() =>
        fixture.sql.begin(async (tx) => {
          await tx.unsafe('delete from agent_runs where id=$1', [nextRun]);
          reachedCommit = true;
        }),
      );
      assert({
        given: 'direct deletion of the active claim run',
        should: 'refuse at commit and roll back',
        actual: { reachedCommit, runRefusal },
        expected: {
          reachedCommit: true,
          runRefusal: 'round_bot_publications_run_seat_fk',
        },
      });
      await fixture.sql.unsafe('delete from rounds where id=$1', [roundId]);
      assert({
        given: 'owning Round erasure across seats, runs and claims',
        should: 'remove its publication claim',
        actual: await fixture.count(
          'round_bot_publications',
          'round_id',
          roundId,
        ),
        expected: 0,
      });
    } finally {
      const [table] =
        await fixture.sql`select to_regclass('public.round_bot_publications') as name`;
      if (table?.name)
        await fixture.sql.unsafe(
          'delete from round_bot_publications where round_id=$1',
          [roundId],
        );
    }
  });
});
