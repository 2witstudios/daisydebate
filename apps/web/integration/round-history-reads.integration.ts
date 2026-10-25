import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
import {
  oneOnOneDefinition,
  oneOnOneRoomConfig,
} from '@daisy/db/reference-formats';
import { canReadRound } from '../src/features/round-runtime/reads';
import { everyoneReady } from './round-judging.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('accepted engine commands persist speaking grants and historical closure without replay duplication', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { affirmative: 1, negative: 1, judge: 0 },
        },
        competitionType: 'casual',
        config: {
          ...oneOnOneRoomConfig,
          speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
        },
      },
    });
    const { roundId, operations, principal } = await startRuntimeRound(f, room);

    // Seed the durable elapsed anchor; command authority still samples the real post-lock DB instant.
    await f.sql`update rounds set started_at=clock_timestamp()-interval '1 second' where id=${roundId}`;
    const hydrated = (await f.store.getRound(roundId))!;
    const hostSeat = hydrated.participants.find(
      (p) => p.actorId === f.host.actorId,
    )!;
    const envelope = {
      version: 1 as const,
      commandId: createId(),
      expectedVersion: 2,
      command: { type: 'yield' as const, participantId: hostSeat.id },
    };
    await operations.command(principal, roundId, envelope);
    await operations.command(principal, roundId, envelope);
    const [speech] =
      await f.sql`select * from round_speaking_intervals where round_id=${roundId}`;
    assert({
      given: 'accepted yield after the clock opens a speech, retried once',
      should:
        'commit one closed historical grant with command/version provenance',
      actual: {
        count: (
          await f.sql`select id from round_speaking_intervals where round_id=${roundId}`
        ).length,
        seat: speech.round_participant_id,
        startCommand: speech.started_command_id,
        endCommand: speech.ended_command_id,
        version: speech.ended_version,
      },
      expected: {
        count: 1,
        seat: hostSeat.id,
        startCommand: envelope.commandId,
        endCommand: envelope.commandId,
        version: 3,
      },
    });
    const query = {
      roundId,
      segmentId: speech.segment_id,
      roundParticipantId: hostSeat.id,
      expectedVersion: 3,
      before: new Date(speech.started_at).toISOString(),
      after: new Date(new Date(speech.started_at).getTime() + 1).toISOString(),
    };
    assert({
      given:
        'a conservative bracket wholly inside the committed speech interval',
      should: 'prove historical eligibility after segment closure',
      actual: (await f.store.readRoundSpeakingEligibility(query)).eligible,
      expected: true,
    });
    assert({
      given: 'uncertainty reaching the exact closed boundary',
      should: 'refuse the straddling bracket',
      actual: (
        await f.store.readRoundSpeakingEligibility({
          ...query,
          after: new Date(speech.ended_at).toISOString(),
        })
      ).eligible,
      expected: false,
    });
    const before = JSON.stringify(
      await f.sql`select * from round_speaking_intervals where round_id=${roundId} order by id`,
    );
    await assertRejects({
      given: 'a nonholder yield at the next CX floor',
      should: 'roll back its automatic opening and all speaking evidence',
      actual: () =>
        operations.command(principal, roundId, {
          ...envelope,
          commandId: createId(),
          expectedVersion: 3,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'engine refusal after automatic clock advancement',
      should: 'leave committed history unchanged',
      actual: JSON.stringify(
        await f.sql`select * from round_speaking_intervals where round_id=${roundId} order by id`,
      ),
      expected: before,
    });
    const ended = await operations.command(principal, roundId, {
      version: 1,
      commandId: createId(),
      expectedVersion: 3,
      command: { type: 'forfeit', participantId: hostSeat.id },
    });
    assert({
      given: 'terminal Round with an earlier valid capture bracket',
      should: 'retain history for cutoff-fenced late publication',
      actual: (
        await f.store.readRoundSpeakingEligibility({
          ...query,
          expectedVersion: ended.resultingVersion,
        })
      ).eligible,
      expected: true,
    });
  });
});

test('protected Round reads preserve hidden judges and keep transcript content private after terminal completion', async () => {
  await withRoomRuntime(async (f) => {
    let room = await f.assemble({
      selection: {
        kind: 'custom',
        definition: oneOnOneDefinition,
        competitionType: 'casual',
        config: {
          ...oneOnOneRoomConfig,
          speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
        },
      },
    });
    room = (
      await f.command(f.outsider, room, {
        type: 'claim-seat',
        role: 'judge',
        slot: 0,
      })
    ).view;
    room = await everyoneReady(f, room, [f.host, f.guest, f.outsider]);
    const { roundId, operations } = await startRuntimeRound(f, room);

    const raw = (await f.store.getRound(roundId))!;
    const seat = raw.participants.find((p) => p.actorId === f.guest.actorId)!;
    await operations.command(
      { kind: 'human', actorId: f.guest.actorId },
      roundId,
      {
        version: 1,
        commandId: createId(),
        expectedVersion: 2,
        command: { type: 'forfeit', participantId: seat.id },
      },
    );
    const view = await f.operations.roundView(f.guest, roundId);
    const judge = raw.participants.find((p) => p.role === 'judge')!;
    assert({
      given: 'a terminal Round read by its debater',
      should: 'retain live timing history and hide human judge identity',
      actual: {
        segments: view.segments.length,
        status: view.status,
        leaks:
          JSON.stringify(view).includes(judge.id) ||
          JSON.stringify(view).includes(judge.actorId),
        hostField: 'hostActorId' in view,
      },
      expected: {
        segments: 1,
        status: 'completed',
        leaks: false,
        hostField: false,
      },
    });
    const segment = view.segments[0]!;
    const speaker = raw.participants.find((p) => p.role === 'affirmative')!;
    // Private-reader storage fixture, not a capture or generation producer.
    await f.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text,complete) values(${createId()},${roundId},${segment.id},${speaker.id},0,'Private transcript',true)`;
    const read = (caller: typeof f.host, segmentId = segment.id) =>
      f.store.readRoundSegmentUtterances({
        caller,
        roundId,
        segmentId,
        authorize: (r, a) => canReadRound(caller, r, a),
      });
    assert({
      given: 'a seated debater and the hidden judge',
      should: 'read the same protected transcript without writer credentials',
      actual: await Promise.all(
        [f.guest, f.outsider].map(async (c) =>
          (await read(c)).utterances.map((l) => l.text),
        ),
      ),
      expected: [['Private transcript'], ['Private transcript']],
    });
    const spectator = await f.member();
    await assertRejects({
      given: 'an eligible public spectator',
      should: 'read timing but not private transcript content',
      actual: () => read(spectator),
      code: 'NOT_FOUND',
    });
    await assertRejects({
      given: 'a seated caller naming a foreign segment',
      should: 'refuse the cross-Round subresource',
      actual: () => read(f.guest, createId()),
      code: 'NOT_FOUND',
    });
    await f.sql`update users set username='' where id=${f.guest.userId}`;
    await assertRejects({
      given:
        'a formerly seated member whose canonical account became ineligible',
      should: 'refuse fresh private transcript reads',
      actual: () => read(f.guest),
      code: 'NOT_FOUND',
    });
  });
});
