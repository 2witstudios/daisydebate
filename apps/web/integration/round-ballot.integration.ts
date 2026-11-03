import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import type { Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { finalizeAsWeb } from './round-maintenance.test-support';
import {
  fixtureBallot,
  readBallotAs,
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
    console.error('BALLOTDIAG 1', Math.round(performance.now()));
    const { room, judges } = await readyTwoHumanJudgeRoom(f);
    console.error('BALLOTDIAG 2', Math.round(performance.now()));
    const { roundId } = await startRuntimeRound(f, room);
    console.error('BALLOTDIAG 3', Math.round(performance.now()));
    const initial = (await f.store.getRound(roundId))!;
    console.error('BALLOTDIAG 4', Math.round(performance.now()));
    const seats = judges.map((j) =>
      initial.participants.find((p) => p.actorId === j.actorId)!,
    );
    console.error('BALLOTDIAG 5', Math.round(performance.now()));
    const operation = createRoundBallotOperations({
      store: f.store,
      nextBallotId: createId,
      nextSegmentId: createId,
    });
    console.error('BALLOTDIAG 6', Math.round(performance.now()));
    const envelope = {
      version: 1 as const,
      commandId: createId(),
      expectedVersion: initial.version,
      judgeParticipantId: seats[0]!.id,
      freezeRevision: 1,
      ballot: ruling('affirmative'),
    };
    console.error('BALLOTDIAG 7', Math.round(performance.now()));
    const principal = { kind: 'human' as const, actorId: judges[0]!.actorId };
    console.error('BALLOTDIAG 8', Math.round(performance.now()));
    await assertRejects({
      given: 'an assigned human judge before any actual freeze',
      should: 'refuse submission',
      actual: () => operation.submit(principal, roundId, envelope),
      code: 'CONFLICT',
    });
    console.error('BALLOTDIAG 9', Math.round(performance.now()));
    const elapsedMs = initial.rules.segments.reduce(
      (total, segment) =>
        total + segment.durationMs + initial.rules.countdownMs,
      125_000,
    );
    console.error('BALLOTDIAG 10', Math.round(performance.now()));
    await f.sql`update rounds set started_at=clock_timestamp()-${elapsedMs}*interval '1 millisecond' where id=${roundId}`;
    console.error('BALLOTDIAG 11', Math.round(performance.now()));
    const finalized = await finalizeAsWeb(f, roundId);
    console.error('BALLOTDIAG 12', Math.round(performance.now()));
    if (finalized.status !== 'frozen')
      throw Error('Expected actual finalizer freeze');
    console.error('BALLOTDIAG 13', Math.round(performance.now()));
    const fresh = (await f.store.getRound(roundId))!;
    console.error('BALLOTDIAG 14', Math.round(performance.now()));
    const first = {
      ...envelope,
      expectedVersion: fresh.version,
      freezeRevision: finalized.freeze.revision,
    };
    console.error('BALLOTDIAG 15', Math.round(performance.now()));
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
    console.error('BALLOTDIAG 16', Math.round(performance.now()));
    const ownRead = await readBallotAs(f, judges[0]!, roundId);
    console.error('BALLOTDIAG 17', Math.round(performance.now()));
    const opponentRead = await readBallotAs(f, f.guest, roundId);
    console.error('BALLOTDIAG 18', Math.round(performance.now()));
    assert({
      given: 'actual frozen input read by its assigned judge and a debater',
      should:
        'expose input and own seat only to the assigned judge without hidden judge identifiers in the debater response',
      actual: [
        ownRead.own?.participantId,
        ownRead.freeze?.revision,
        opponentRead.freeze,
        opponentRead.own,
        seats.some(
          (seat) =>
            JSON.stringify(opponentRead).includes(seat.id) ||
            JSON.stringify(opponentRead).includes(seat.actorId),
        ),
      ],
      expected: [seats[0]!.id, first.freezeRevision, null, null, false],
    });
    console.error('BALLOTDIAG 19', Math.round(performance.now()));
    const receipt = await operation.submit(principal, roundId, first);
    console.error('BALLOTDIAG 20', Math.round(performance.now()));
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
    console.error('BALLOTDIAG 21', Math.round(performance.now()));
    const finalEnvelope = {
      ...first,
      commandId: createId(),
      judgeParticipantId: seats[1]!.id,
      ballot: ruling('negative'),
    };
    console.error('BALLOTDIAG 22', Math.round(performance.now()));
    const finalPrincipal = {
      kind: 'human' as const,
      actorId: judges[1]!.actorId,
    };
    console.error('BALLOTDIAG 23', Math.round(performance.now()));
    await assertRejects({
      given:
        'a last judge ballot while earlier actual speech attendance remains unresolved',
      should: 'refuse completion and roll back the final ballot',
      actual: () => operation.submit(finalPrincipal, roundId, finalEnvelope),
      code: 'CONFLICT',
    });
    console.error('BALLOTDIAG 24', Math.round(performance.now()));
    await seedSettledAttendanceLedger(f, roundId);
    console.error('BALLOTDIAG 25', Math.round(performance.now()));
    const attemptId = createId();
    console.error('BALLOTDIAG 26', Math.round(performance.now()));
    await f.sql`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,received_at,backend_pid,backend_started_at) select ${attemptId},${createId()},${roundId},${'b'.repeat(64)},${f.host.actorId},statement_timestamp(),pid,backend_start from pg_stat_activity where pid=pg_backend_pid()`;
    console.error('BALLOTDIAG 27', Math.round(performance.now()));
    await assertRejects({
      given:
        'settled actual speech ledger but a durable pending check-in marker',
      should: 'still refuse the final ballot',
      actual: () => operation.submit(finalPrincipal, roundId, finalEnvelope),
      code: 'CONFLICT',
    });
    console.error('BALLOTDIAG 28', Math.round(performance.now()));
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
    console.error('BALLOTDIAG 29', Math.round(performance.now()));
    await f.sql`update round_check_in_attempts set state='aborted',resolved_at=clock_timestamp() where attempt_id=${attemptId}`;
    console.error('BALLOTDIAG 30', Math.round(performance.now()));
    const [last, replayedLast] = await Promise.all([
      operation.submit(finalPrincipal, roundId, finalEnvelope),
      operation.submit(finalPrincipal, roundId, finalEnvelope),
    ]);
    if (!last) throw Error('Missing committed final ballot receipt');
    console.error('BALLOTDIAG 31', Math.round(performance.now()));
    assert({
      given:
        'concurrent identical final submissions after actual durable settlement',
      should:
        'recover exactly one receipt through the shared global command fence',
      actual: replayedLast,
      expected: last,
    });
    console.error('BALLOTDIAG 32', Math.round(performance.now()));
    const done = (await f.store.getRound(roundId))!;
    console.error('BALLOTDIAG 33', Math.round(performance.now()));
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
    console.error('BALLOTDIAG 34', Math.round(performance.now()));
    const readAs = (caller: { userId: string; actorId: string }) =>
      readBallotAs(f, caller, roundId);
    console.error('BALLOTDIAG 35', Math.round(performance.now()));
    const sideOf = (actorId: string) =>
      done.participants.find((p) => p.actorId === actorId)!.role as
        'affirmative' | 'negative';
    console.error('BALLOTDIAG 36', Math.round(performance.now()));
    const released = await Promise.all(
      [f.host, f.guest, judges[1]!].map(async (caller) => {
        const read = await readAs(caller);
        return {
          judges: read.ballots.map((entry) => entry.judge),
          feedback: read.ballots.map((entry) => entry.ballot.feedback),
          // The ballot read carries no round analysis, for anyone.
          analysis: Object.keys(read).filter((key) =>
            /coach|analysis/i.test(key),
          ),
          transcript: read.transcript === null,
        };
      }),
    );
    console.error('BALLOTDIAG 37', Math.round(performance.now()));
    const own = (actorId: string) => {
      const side = sideOf(actorId);
      return { [side]: notes[side] };
    };
    console.error('BALLOTDIAG 38', Math.round(performance.now()));
    assert({
      given:
        'a completed Round whose two human ballots give both sides feedback, read by each debater and a judge',
      should:
        'label both ballots human, give each debater only their own feedback and the judge none, carry no round analysis, and let every seat read the transcript',
      actual: released,
      expected: [
        {
          judges: ['human', 'human'],
          feedback: [own(f.host.actorId), own(f.host.actorId)],
          analysis: [],
          transcript: false,
        },
        {
          judges: ['human', 'human'],
          feedback: [own(f.guest.actorId), own(f.guest.actorId)],
          analysis: [],
          transcript: false,
        },
        {
          judges: ['human', 'human'],
          feedback: [{}, {}],
          analysis: [],
          transcript: false,
        },
      ],
    });
    console.error('BALLOTDIAG 39', Math.round(performance.now()));
    const before = JSON.stringify(await f.store.getRound(roundId));
    console.error('BALLOTDIAG 40', Math.round(performance.now()));
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
    console.error('BALLOTDIAG 41', Math.round(performance.now()));
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
    console.error('BALLOTDIAG 42', Math.round(performance.now()));
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
    console.error('BALLOTDIAG 43', Math.round(performance.now()));
    await f.sql`update users set username='' where id=${judges[0]!.userId}`;
    console.error('BALLOTDIAG 44', Math.round(performance.now()));
    await assertRejects({
      given: 'the accepted judge loses canonical membership',
      should: 'refuse exact replay after fresh reauthorization',
      actual: () => operation.submit(principal, roundId, first),
      code: 'AUTHORIZATION',
    });
    console.error('BALLOTDIAG 45', Math.round(performance.now()));
    await f.sql`update users set email_verified=false,deleted_at=clock_timestamp() where id=${judges[0]!.userId}`;
    console.error('BALLOTDIAG 46', Math.round(performance.now()));
    await assertRejects({
      given: 'an erased assigned judge retries the accepted ballot',
      should: 'refuse canonical erasure before replay',
      actual: () => operation.submit(principal, roundId, first),
      code: 'AUTHORIZATION',
    });
    console.error('BALLOTDIAG 47', Math.round(performance.now()));
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
}, 40_000);
