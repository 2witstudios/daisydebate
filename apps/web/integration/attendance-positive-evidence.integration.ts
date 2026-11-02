import { passAttendanceCutoff } from './round-attendance-fixture.test-support';
import { requireTestServices } from '@daisy/config';
import { attendanceTimingPolicy, buildRoundTopic } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withAttendanceRound } from './attendance.test-support';
setupRitewayBun();
requireTestServices(process.env);

type Input = Parameters<Parameters<typeof withAttendanceRound>[0]>[0];

/** The actual first speech's scheduled speaker and that speaker's opponent. */
async function seatsOf({ f, roundId, segmentId }: Input) {
  const round = (await f.store.getRound(roundId))!;
  const segment = round.segments.find((s) => s.id === segmentId)!;
  const rule = round.rules.segments[segment.sequence]!;
  if (rule.type !== 'speech') throw new Error('Expected a speech');
  const speaker = round.participants.find(
    (p) => p.role === rule.side && p.slot === rule.slot,
  )!;
  const opponent = round.participants.find(
    (p) => p.role !== rule.side && p.role !== 'judge',
  )!;
  return { speaker, opponent };
}
const stamp = async (
  { f, roundId, segmentId }: Input,
  seat: { id: string; actorId: string | null },
  afterOpeningMs: number,
) => {
  const commandId = createId();
  await f.sql`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at)
    values(${commandId},${roundId},${seat.actorId},'check_in',${'a'.repeat(64)},${{}},1,statement_timestamp())`;
  await f.sql`insert into round_check_ins(command_id,round_id,segment_id,participant_id,received_at)
    select ${commandId},${roundId},id,${seat.id},started_at+${afterOpeningMs}*interval '1 millisecond' from round_segments where id=${segmentId}`;
};
const adjudications = ({ f, roundId }: Input) =>
  f.sql`select decision,evidence,effective_deadline,settled_horizon,receipt_participant_id from round_attendance_adjudications where round_id=${roundId}`;
/** Age the opening so the window has long closed, with no sample anywhere. */
const ageOpening = async (
  { f, roundId, segmentId }: Input,
  byMs = 10 * 60_000,
) => {
  const by = `${byMs} milliseconds`;
  await f.sql`update rounds set started_at=started_at-${by}::interval where id=${roundId}`;
  await f.sql`update round_segments set started_at=started_at-${by}::interval where id=${segmentId}`;
  await f.sql`update round_speaking_intervals set started_at=started_at-${by}::interval where round_id=${roundId}`;
};
const cleanUp = async ({ f, roundId }: Input) => {
  await f.sql`delete from outbox where topic=${buildRoundTopic(roundId)}`;
  await f.sql`delete from rounds where id=${roundId}`;
};

test('an on-time speaker is credited with no availability history, inventing no horizon', () =>
  withAttendanceRound(async (input) => {
    const { speaker } = await seatsOf(input);
    await stamp(input, speaker, 1000);
    try {
      const resolved = await input.attendance.evaluate(input.roundId);
      const [row] = await adjudications(input);
      const round = (await input.f.store.getRound(input.roundId))!;
      assert({
        given: 'an on-time speaker receipt and no availability samples at all',
        should: 'record attendance from the receipt alone, Round still active',
        actual: {
          decision: resolved?.decision,
          evidence: row.evidence,
          deadline: row.effective_deadline,
          horizon: row.settled_horizon,
          receipt: row.receipt_participant_id,
          status: round.status,
        },
        expected: {
          decision: 'attended',
          evidence: 'on_time_receipt',
          deadline: null,
          horizon: null,
          receipt: speaker.id,
          status: 'active',
        },
      });
    } finally {
      await cleanUp(input);
    }
  }));

test('unknown health forfeits nobody: an absent or late speaker postpones', () =>
  withAttendanceRound(async (input) => {
    const { speaker, opponent } = await seatsOf(input);
    await ageOpening(input);
    await stamp(input, opponent, 1000);
    try {
      const absent = await input.attendance.evaluate(input.roundId);
      await stamp(input, speaker, 41_000);
      const late = await input.attendance.evaluate(input.roundId);
      const round = (await input.f.store.getRound(input.roundId))!;
      assert({
        given:
          'a present opponent with no health evidence, then a speaker receipt past the base window',
        should: 'decide nothing, forfeit nobody and keep the Round active',
        actual: {
          absent,
          late,
          rows: (await adjudications(input)).length,
          status: round.status,
        },
        expected: { absent: null, late: null, rows: 0, status: 'active' },
      });
    } finally {
      await cleanUp(input);
    }
  }));

test('the persisted cutoff ends an unprovable window with no winner, and a pending writer holds it', () =>
  withAttendanceRound(async (input) => {
    const { f, roundId } = input;
    const { opponent } = await seatsOf(input);
    await ageOpening(input);
    await stamp(input, opponent, 1000);
    const attemptId = createId();
    try {
      await passAttendanceCutoff(f.sql, roundId);
      await f.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at,state)
        values(${attemptId},${createId()},${roundId},${'b'.repeat(64)},${opponent.actorId},statement_timestamp(),1,'2026-10-22 00:00:00+00','pending')`;
      const held = await input.attendance.evaluate(roundId);
      const whileHeld = (await f.store.getRound(roundId))!.status;
      await f.sql`update round_check_in_attempts set state='aborted',resolved_at=statement_timestamp() where attempt_id=${attemptId}`;
      const ended = await input.attendance.evaluate(roundId);
      const [row] = await adjudications(input);
      const round = (await f.store.getRound(roundId))!;
      const [ratings] =
        await f.sql`select count(*)::int as n from rating_changes where round_id=${roundId}`;
      assert({
        given:
          'a window settled evidence cannot resolve, past its cutoff (DEC-276)',
        should:
          'hold while a writer is uncertain, then abandon with no winner and no rating',
        actual: {
          held: held?.decision,
          whileHeld,
          ended: ended?.decision,
          evidence: row.evidence,
          horizon: row.settled_horizon,
          status: round.status,
          outcome: round.outcome,
          ratings: ratings.n,
        },
        expected: {
          held: 'held',
          whileHeld: 'active',
          ended: 'abandoned',
          evidence: 'infrastructure_unresolved',
          horizon: null,
          status: 'abandoned',
          outcome: null,
          ratings: 0,
        },
      });
    } finally {
      await f.sql`delete from round_check_in_attempts where attempt_id=${attemptId}`;
      await cleanUp(input);
    }
  }));

test('an on-time speaker leaves the window open: a later receipt is taken, not refused', () =>
  withAttendanceRound(async (input) => {
    const { f, attendance, roundId, segmentId } = input;
    const { speaker } = await seatsOf(input);
    await stamp(input, speaker, 1000);
    try {
      await attendance.evaluate(roundId);
      const opponent = f.guest;
      const answer = await attendance.checkIn(
        { kind: 'human', actorId: opponent.actorId },
        roundId,
        { version: 1, commandId: createId(), segmentId },
      );
      assert({
        given: 'the opponent checking in just after the speaker was credited',
        should: 'record it rather than refuse it as finalized',
        actual: answer.segmentId,
        expected: segmentId,
      });
    } finally {
      await cleanUp(input);
    }
  }));

test('a long-outage evaluation at the read cap stays inside its transaction budget', () =>
  withAttendanceRound(async (input) => {
    const { f, attendance, roundId, segmentId } = input;
    const { opponent } = await seatsOf(input);
    // Past the read cap, so this is the most one evaluation can ever read. Every
    // sample falls after the opening, or the read would skip it.
    const samples = 11_000;
    await ageOpening(input, (samples + 400) * 1000);
    await stamp(input, opponent, 1000);
    await f.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(59003)`;
      await tx`insert into availability_samples(at,healthy,cause)
        select s.started_at+n*interval '1 second',false,'public_probe_failed'
        from generate_series(1,${samples}::int) n, round_segments s where s.id=${segmentId}`;
    });
    try {
      const [{ read }] =
        await f.sql`select count(*)::int as read from availability_samples a, round_segments s where s.id=${segmentId} and a.at>=s.started_at`;
      assert({
        given: 'the history this evaluation reads from',
        should: 'hold more samples after the opening than the read cap',
        actual: read >= samples,
        expected: true,
      });
      const began = performance.now();
      const undecided = await attendance.evaluate(roundId);
      const elapsedMs = performance.now() - began;
      assert({
        given: `${samples} unhealthy samples since the window opened, under the Round lock`,
        should: `decide nothing inside the ${attendanceTimingPolicy.transactionSliceMs} ms slice`,
        actual: {
          undecided,
          inBudget: elapsedMs < attendanceTimingPolicy.transactionSliceMs,
        },
        expected: { undecided: null, inBudget: true },
      });
      await passAttendanceCutoff(f.sql, roundId);
      const ended = await attendance.evaluate(roundId);
      assert({
        given: 'that history past the cutoff',
        should: 'end the Round with no winner',
        actual: ended?.decision,
        expected: 'abandoned',
      });
    } finally {
      await f.sql`delete from availability_samples where at>=clock_timestamp()-interval '5 hours' and cause='public_probe_failed'`;
      await cleanUp(input);
    }
  }));

test('past the cutoff a provable absence is still decided, not abandoned', () =>
  withAttendanceRound(async (input) => {
    const { f, attendance, roundId, segmentId } = input;
    const { opponent } = await seatsOf(input);
    await f.sql`update rounds set started_at=started_at-interval '50 seconds' where id=${roundId}`;
    await f.sql`update round_segments set started_at=started_at-interval '50 seconds' where id=${segmentId}`;
    await stamp(input, opponent, 1000);
    await f.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(59003)`;
      await tx`insert into availability_samples(at,healthy,cause)
        select s.started_at+n*interval '1 second',true,null
        from round_segments s, generate_series(-3,47) n where s.id=${segmentId}`;
    });
    await passAttendanceCutoff(f.sql, roundId);
    try {
      const resolved = await attendance.evaluate(roundId);
      assert({
        given: 'healthy history proving the absence, read after the cutoff',
        should: 'forfeit on the evidence',
        actual: resolved?.decision,
        expected: 'forfeit',
      });
    } finally {
      await f.sql`delete from availability_samples where at>=clock_timestamp()-interval '3 hours'`;
      await cleanUp(input);
    }
  }));
