import { requireTestServices } from '@daisy/config';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { assertRejects } from '@daisy/errors/testing';
import { ballotCategories, type Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { createRoundFinalizationOperations } from '../src/features/round-finalization/operations';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);
const ruling = (winner: Ballot['winner']): Ballot => ({
  rubricVersion: 'speaker-10@1',
  winner,
  reason: 'The decisive clash was answered by this side.',
  feedback: {},
  scores: {
    affirmative: Object.fromEntries(ballotCategories.map((key) => [key, 3])),
    negative: Object.fromEntries(ballotCategories.map((key) => [key, 3])),
  } as Ballot['scores'],
});

test('all actual human judges submit one shared ballot against actual frozen input before the engine completes', async () => {
  await withRoomRuntime(async (f) => {
    const secondJudge = await f.member();
    let room = await f.assemble({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { ...oneOnOneDefinition.seats, judge: 2 },
        },
        config: practiceRoomConfig,
        length: 'full',
        competitionType: 'casual',
      },
    });
    const judges = [f.outsider, secondJudge];
    for (const [slot, judge] of judges.entries())
      room = (
        await f.command(judge, room, {
          type: 'claim-seat',
          role: 'judge',
          slot,
        })
      ).view;
    for (const caller of [f.host, f.guest, ...judges])
      room = (
        await f.consent(
          caller,
          await f.operations.view(caller, room.id),
          'ready',
        )
      ).view;
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
    const finalized = await createRoundFinalizationOperations({
      store: f.store,
      nextSegmentId: createId,
    }).finalize(roundId);
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
    const last = await operation.submit(
      { kind: 'human', actorId: judges[1]!.actorId },
      roundId,
      {
        ...first,
        commandId: createId(),
        judgeParticipantId: seats[1]!.id,
        ballot: ruling('negative'),
      },
    );
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
    await f.sql`update users set username='' where id=${judges[0]!.userId}`;
    await assertRejects({
      given: 'the accepted judge loses canonical membership',
      should: 'refuse exact replay after fresh reauthorization',
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
