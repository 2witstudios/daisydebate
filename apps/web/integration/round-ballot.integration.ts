import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import {
  canReadRound,
  canReadTranscript,
} from '../src/features/round-runtime/reads';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import type { Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { finalizeAsWeb } from './round-maintenance.test-support';
import {
  fixtureBallot,
  readyTwoHumanJudgeRoom,
} from './round-judging.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);
const notes = { affirmative: 'Weigh earlier.', negative: 'Answer the turn.' };
const ruling = (winner: Ballot['winner']): Ballot => ({
  ...fixtureBallot('The decisive clash was answered by this side.', winner),
  feedback: notes,
});

test('all actual human judges submit one shared ballot against actual frozen input before the engine completes', async () => {
  await withRoomRuntime(async (f) => {
    const { room, judges } = await readyTwoHumanJudgeRoom(f);
    const { roundId } = await startRuntimeRound(f, room);
    const initial = (await f.store.getRound(roundId))!;
    const seats = judges.map((j) =>
      initial.participants.find((p) => p.actorId === j.actorId)!,
    );
    const operation = createRoundBallotOperations({
      store: f.store,
      nextBallotId: createId,
      nextSegmentId: createId,
    });
    const envelope = {
      version: 1 as const,
      commandId: createId(),
      expectedVersion: initial.version,
      judgeParticipantId: seats[0]!.id,
      freezeRevision: 1,
      ballot: ruling('affirmative'),
    };
    const principal = { kind: 'human' as const, actorId: judges[0]!.actorId };
    await assertRejects({
      given: 'an assigned human judge before any actual freeze',
      should: 'refuse submission',
      actual: () => operation.submit(principal, roundId, envelope),
      code: 'CONFLICT',
    });
    const elapsedMs = initial.rules.segments.reduce(
      (total, segment) =>
        total + segment.durationMs + initial.rules.countdownMs,
      125_000,
    );
    await f.sql`update rounds set started_at=clock_timestamp()-${elapsedMs}*interval '1 millisecond' where id=${roundId}`;
    const finalized = await finalizeAsWeb(f, roundId);
    if (finalized.status !== 'frozen')
      throw Error('Expected actual finalizer freeze');
    const fresh = (await f.store.getRound(roundId))!;
    const first = {
      ...envelope,
      expectedVersion: fresh.version,
      freezeRevision: finalized.freeze.revision,
    };
    await assertRejects({
      given: 'a vote naming an invented frozen revision',
      should: 'refuse without ballot writes',
      actual: () =>
        operation.submit(principal, roundId, {
          ...first,
          freezeRevision: first.freezeRevision + 1,
        }),
      code: 'CONFLICT',
    });
    const ownRead = await f.store.readRoundBallot({
      authorizeTranscript: (r, a) =>
        canReadTranscript({ userId: a!.userId, actorId: a!.actorId! }, r, a),
      authorizeCoaching: () => true,
      roundId,
      caller: judges[0]!,
      authorize: (round, account) => canReadRound(judges[0]!, round, account),
    });
    const opponentRead = await f.store.readRoundBallot({
      authorizeTranscript: (r, a) =>
        canReadTranscript({ userId: a!.userId, actorId: a!.actorId! }, r, a),
      authorizeCoaching: () => true,
      roundId,
      caller: f.guest,
      authorize: (round, account) => canReadRound(f.guest, round, account),
    });
    assert({
      given: 'actual frozen input read by its assigned judge and a debater',
      should:
        'expose input and own seat only to the assigned judge without hidden judge identifiers in the debater response',
      actual: [
        ownRead.read.own?.participantId,
        ownRead.read.freeze?.revision,
        opponentRead.read.freeze,
        opponentRead.read.own,
        seats.some(
          (seat) =>
            JSON.stringify(opponentRead).includes(seat.id) ||
            JSON.stringify(opponentRead).includes(seat.actorId),
        ),
      ],
      expected: [seats[0]!.id, first.freezeRevision, null, null, false],
    });
    const receipt = await operation.submit(principal, roundId, first);
    assert({
      given: 'the first of two actual judge ballots',
      should: 'persist against the real freeze while leaving outcome pending',
      actual: [
        receipt.outcome,
        receipt.resultingVersion,
        (await f.store.getRound(roundId))?.status,
      ],
      expected: [null, fresh.version, 'active'],
    });
    const finalEnvelope = {
      ...first,
      commandId: createId(),
      judgeParticipantId: seats[1]!.id,
      ballot: ruling('negative'),
    };
    const finalPrincipal = {
      kind: 'human' as const,
      actorId: judges[1]!.actorId,
    };
    await assertRejects({
      given:
        'a last judge ballot while earlier actual speech attendance remains unresolved',
      should: 'refuse completion and roll back the final ballot',
      actual: () => operation.submit(finalPrincipal, roundId, finalEnvelope),
      code: 'CONFLICT',
    });
    await seedSettledAttendanceLedger(f, roundId);
    const attemptId = createId();
    await f.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at) select ${attemptId},${createId()},${roundId},${'b'.repeat(64)},${f.host.actorId},statement_timestamp(),pid,backend_start from pg_stat_activity where pid=pg_backend_pid()`;
    await assertRejects({
      given:
        'settled actual speech ledger but a durable pending check-in marker',
      should: 'still refuse the final ballot',
      actual: () => operation.submit(finalPrincipal, roundId, finalEnvelope),
      code: 'CONFLICT',
    });
    assert({
      given: 'both failed final-ballot transactions',
      should:
        'retain only the first ballot and its command with unchanged Round version',
      actual: [
        (await f.sql`select id from ballots where round_id=${roundId}`).length,
        (
          await f.sql`select command_id from round_commands where command_id=${finalEnvelope.commandId}`
        ).length,
        (await f.store.getRound(roundId))?.version,
      ],
      expected: [1, 0, fresh.version],
    });
    await f.sql`update round_check_in_attempts set state='aborted',resolved_at=clock_timestamp() where attempt_id=${attemptId}`;
    const [last, replayedLast] = await Promise.all([
      operation.submit(finalPrincipal, roundId, finalEnvelope),
      operation.submit(finalPrincipal, roundId, finalEnvelope),
    ]);
    if (!last) throw Error('Missing committed final ballot receipt');
    assert({
      given:
        'concurrent identical final submissions after actual durable settlement',
      should:
        'recover exactly one receipt through the shared global command fence',
      actual: replayedLast,
      expected: last,
    });
    const done = (await f.store.getRound(roundId))!;
    assert({
      given: 'every required judge supplied a valid split ruling',
      should: 'derive draw and complete exactly once through the one engine',
      actual: [
        last.outcome,
        last.resultingVersion,
        done.outcome,
        done.status,
        await operation.submit(principal, roundId, first),
      ],
      expected: ['draw', fresh.version + 1, 'draw', 'completed', receipt],
    });
    // ISSUE-602: each released ballot names its kind of judge and carries
    // only the reader's own side's feedback; the transcript is for seats.
    const readAs = (caller: { userId: string; actorId: string }) =>
      f.store.readRoundBallot({
        authorizeTranscript: (r, a) =>
          canReadTranscript({ userId: a!.userId, actorId: a!.actorId! }, r, a),
        authorizeCoaching: () => true,
        roundId,
        caller,
        authorize: (round, account) => canReadRound(caller, round, account),
      });
    const sideOf = (actorId: string) =>
      done.participants.find((p) => p.actorId === actorId)!.role as
        'affirmative' | 'negative';
    const released = await Promise.all(
      [f.host, f.guest, judges[1]!].map(async (caller) => {
        const { read, coaching } = await readAs(caller);
        return {
          judges: read.ballots.map((entry) => entry.judge),
          feedback: read.ballots.map((entry) => entry.ballot.feedback),
          // Coaching facts go only to a debater, for their own side.
          coaching: coaching
            ? { side: coaching.side, aiBallots: coaching.facts.aiBallots }
            : null,
          transcript: read.transcript === null,
        };
      }),
    );
    const own = (actorId: string) => {
      const side = sideOf(actorId);
      return { [side]: notes[side] };
    };
    assert({
      given:
        'a completed Round whose two human ballots coach both sides, read by each debater and a judge',
      should:
        'label both ballots human, give each debater only their own feedback and coaching facts for their side, and the judge neither; every seat reads the transcript',
      actual: released,
      expected: [
        {
          judges: ['human', 'human'],
          feedback: [own(f.host.actorId), own(f.host.actorId)],
          coaching: { side: sideOf(f.host.actorId), aiBallots: [] },
          transcript: false,
        },
        {
          judges: ['human', 'human'],
          feedback: [own(f.guest.actorId), own(f.guest.actorId)],
          coaching: { side: sideOf(f.guest.actorId), aiBallots: [] },
          transcript: false,
        },
        {
          judges: ['human', 'human'],
          feedback: [{}, {}],
          coaching: null,
          transcript: false,
        },
      ],
    });
    const before = JSON.stringify(await f.store.getRound(roundId));
    await assertRejects({
      given: 'a debater impersonating a judge on replay',
      should: 'refuse fresh seat authority',
      actual: () =>
        operation.submit(
          { kind: 'human', actorId: f.guest.actorId },
          roundId,
          first,
        ),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'a new command trying to submit a second ballot after result',
      should: 'refuse rather than replace any ruling',
      actual: () =>
        operation.submit(principal, roundId, {
          ...first,
          commandId: createId(),
          expectedVersion: done.version,
        }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'the same accepted final command with a changed ballot',
      should: 'reject changed-payload replay without changing result',
      actual: () =>
        operation.submit(finalPrincipal, roundId, {
          ...finalEnvelope,
          ballot: ruling('affirmative'),
        }),
      code: 'CONFLICT',
    });
    await f.sql`update users set username='' where id=${judges[0]!.userId}`;
    await assertRejects({
      given: 'the accepted judge loses canonical membership',
      should: 'refuse exact replay after fresh reauthorization',
      actual: () => operation.submit(principal, roundId, first),
      code: 'AUTHORIZATION',
    });
    await f.sql`update users set username=null,email_verified=false,deleted_at=clock_timestamp() where id=${judges[0]!.userId}`;
    await assertRejects({
      given: 'an erased assigned judge retries the accepted ballot',
      should: 'refuse canonical erasure before replay',
      actual: () => operation.submit(principal, roundId, first),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'every rejected late or unauthorized submission',
      should:
        'preserve runtime, actual history and exactly two immutable frozen ballots',
      actual: [
        JSON.stringify(await f.store.getRound(roundId)),
        (await f.sql`select id from ballots where round_id=${roundId}`).length,
        (
          await f.sql`select command_id from round_commands where round_id=${roundId} and type='submit_ballot'`
        ).length,
      ],
      expected: [before, 2, 2],
    });
  });
});
