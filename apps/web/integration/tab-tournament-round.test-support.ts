import { finalSpeechKey } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { leadSeatOf } from '@daisy/protocol/format-seating';
import { sameSeat } from '@daisy/protocol/seats';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import { finalizeAsWeb } from './round-maintenance.test-support';
import type { withRoomRuntime } from './room-runtime.test-support';
import type { ScriptClock } from './tab-tournament.test-support';
type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** Explicit trusted UTC time, real tick/check-in/yield/freeze owners and original competition rules; no seeded attendance or captured text. */
export async function playTournamentRound(
  f: Runtime,
  roundId: string,
  clock: ScriptClock,
) {
  const operations = createRoundRuntimeOperations({
    store: f.store,
    nextSegmentId: createId,
  });
  const instanceId = createId();
  await f.store.renewServiceInstance({ instanceId, role: 'web' });
  const attendance = createAttendanceFeature({
    checkIns: f.store,
    evaluate: f.store.evaluateRoundAttendance,
    nextId: createId,
    instanceId,
  });
  try {
    const initial = (await f.store.getRound(roundId))!;
    // The pinned public template's real prep and microphone countdown run unchanged.
    if (initial.status === 'opening')
      clock.advance((initial.opening?.state.prepMs ?? 0) / 60000);
    clock.advance(1 / 60);
    await operations.tick(roundId);
    for (let step = 0; step < initial.rules.segments.length; step += 1) {
      let round = (await f.store.getRound(roundId))!;
      if (!round.segments.some((segment) => segment.endedAt === null)) {
        clock.advance(round.rules.countdownMs / 60000);
        await operations.tick(roundId);
        round = (await f.store.getRound(roundId))!;
      }
      const open = round.segments.find((segment) => segment.endedAt === null);
      if (!open)
        throw new Error(
          `Actual scripted segment ${step} did not open: ${JSON.stringify({ status: round.status, stage: round.currentStage, segments: round.segments, now: clock.now() })}`,
        );
      const rule = round.rules.segments[open.sequence]!;
      const lead = leadSeatOf(rule.speak);
      const speaker = round.participants.find(
        (person) => lead && sameSeat(person.seat, lead),
      );
      if (!speaker?.actorId)
        throw new Error('Actual format segment has no scheduled bot caller');
      if (open.type === 'speech') {
        await attendance.checkIn(
          { kind: 'human', actorId: speaker.actorId },
          roundId,
          { version: 1, commandId: createId(), segmentId: open.id },
        );
        await f.store.renewServiceInstance({ instanceId, role: 'web' });
        const evaluated = await attendance.evaluate(roundId);
        if (open.rulesSegmentKey === finalSpeechKey(round.rules.segments)) {
          assert({
            given: 'the actual final speech receipt',
            should:
              'need no later attendance adjudication under the canonical last-speech rule',
            actual: evaluated,
            expected: { kind: 'undecided' },
          });
        } else if (
          evaluated.kind !== 'decided' ||
          evaluated.resolution.decision !== 'attended'
        )
          throw new Error(
            `Actual speaker receipt did not settle attendance at segment ${step}: ${JSON.stringify(evaluated)}`,
          );
      }
      // Speakers themselves yield through the ordinary allowed command, with no changed duration or timestamp rewrite.
      await operations.command(
        { kind: 'human', actorId: speaker.actorId },
        roundId,
        {
          version: 1,
          commandId: createId(),
          expectedVersion: round.version,
          command: {
            type: 'yield',
            participantId: speaker.id,
            sequence: open.sequence,
          },
        },
      );
    }
    const ended = (await f.store.getRound(roundId))!;
    const before = await finalizeAsWeb(f, roundId);
    assert({
      given:
        'the actual fully yielded speech timeline before the canonical transcript admission cutoff',
      should:
        'retain real receipts and refuse premature freeze rather than fabricate capture',
      actual: [
        ended.segments.length,
        ended.segments.every((segment) => segment.endedAt !== null),
        before.status,
      ],
      expected: [initial.rules.segments.length, true, 'pending'],
    });
    clock.advance(121 / 60);
    const frozen = await finalizeAsWeb(f, roundId);
    if (frozen.status !== 'frozen')
      throw new Error(
        `Actual scripted freeze refused: ${JSON.stringify(frozen)}`,
      );
    assert({
      given:
        'the actual cutoff with no native capture in this explicitly controlled-time command script',
      should:
        'freeze incomplete without invented transcript or seeded attendance decisions',
      actual: [
        frozen.freeze.completeness,
        (
          await f.sql`select distinct evidence from round_attendance_adjudications where round_id=${roundId}`
        ).map((row: { evidence: string }) => row.evidence),
      ],
      expected: ['incomplete', ['on_time_receipt']],
    });
    return frozen.freeze;
  } finally {
    await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }
}
