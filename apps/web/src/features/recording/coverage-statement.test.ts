import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  coverageStatement,
  ROOM_ROTATION_DROPOUT_MS,
} from './coverage-statement';

setupRitewayBun();

const startedAtMs = 1_000_000;
const real = (ms: number) => startedAtMs + ms;
const none = { segments: [], prepStartsAtMs: [], rotationsAtMs: [] };
const whole = {
  ...none,
  segments: [{ startedAtMs: real(0), endedAtMs: real(60_000) }],
};
const statement = (
  facts: Parameters<typeof coverageStatement>[0]['facts'],
  over: {
    durationMs?: number;
    restartGaps?: Parameters<
      typeof coverageStatement
    >[0]['capture']['restartGaps'];
    broadcastStopped?: boolean;
  } = {},
) =>
  coverageStatement({
    facts,
    capture: {
      startedAtMs,
      durationMs: over.durationMs ?? 60_000,
      restartGaps: over.restartGaps ?? [],
    },
    broadcastStopped: over.broadcastStopped ?? false,
  });

describe('coverageStatement', () => {
  test('a video of the whole debate states nothing', () => {
    assert({
      given: 'capture spanning every segment',
      should: 'say nothing is missing',
      actual: statement(whole),
      expected: { gaps: [], unrecorded: [] },
    });
  });

  test('a Round with no record states only what the worker found', () => {
    const restart = {
      startMs: 10_000,
      endMs: 20_000,
      reason: 'capture_restart',
    } as const;
    assert({
      given: 'no segments',
      should: 'keep the restart and claim nothing else',
      actual: statement(none, { restartGaps: [restart] }),
      expected: { gaps: [restart], unrecorded: [] },
    });
  });

  test('a private phase is stated where the slate shows', () => {
    assert({
      given:
        'capture before the first segment, a prep, and time after the last',
      should: 'state each private stretch in video time',
      actual: statement({
        ...none,
        segments: [
          { startedAtMs: real(5000), endedAtMs: real(20_000) },
          { startedAtMs: real(30_000), endedAtMs: real(50_000) },
        ],
        prepStartsAtMs: [real(20_000)],
      }).gaps,
      expected: [
        { startMs: 0, endMs: 5000, reason: 'private_phase' },
        { startMs: 20_000, endMs: 30_000, reason: 'private_phase' },
        { startMs: 50_000, endMs: 60_000, reason: 'private_phase' },
      ],
    });
  });

  test('a room rotation is a stated dropout, and no moment is told twice', () => {
    assert({
      given: 'a rotation mid-segment',
      should: 'state the dropout at its place',
      actual: statement({ ...whole, rotationsAtMs: [real(10_000)] }).gaps,
      expected: [
        {
          startMs: 10_000,
          endMs: 10_000 + ROOM_ROTATION_DROPOUT_MS,
          reason: 'room_rotation',
        },
      ],
    });
    assert({
      given: 'a rotation inside a capture restart',
      should: 'leave the restart to say it',
      actual: statement(
        { ...whole, rotationsAtMs: [real(10_000)] },
        {
          restartGaps: [
            { startMs: 9000, endMs: 30_000, reason: 'capture_restart' },
          ],
        },
      ).gaps,
      expected: [{ startMs: 9000, endMs: 30_000, reason: 'capture_restart' }],
    });
  });

  test('a late start and a truncated tail are stated apart', () => {
    const facts = {
      ...none,
      segments: [{ startedAtMs: real(-30_000), endedAtMs: real(90_000) }],
    };
    assert({
      given: 'capture starting late and ending early',
      should: 'say how much of the debate each end lost',
      actual: statement(facts).unrecorded,
      expected: [
        { part: 'start', durationMs: 30_000, reason: 'late_start' },
        { part: 'end', durationMs: 30_000, reason: 'ended_early' },
      ],
    });
  });

  test('the rest of a stopped Broadcast is named for the stop', () => {
    assert({
      given: 'a Broadcast stopped with the debate still to run',
      should: 'name the stop, not a capture fault',
      actual: statement(
        {
          ...none,
          segments: [{ startedAtMs: real(0), endedAtMs: real(90_000) }],
        },
        { broadcastStopped: true },
      ).unrecorded,
      expected: [
        { part: 'end', durationMs: 30_000, reason: 'broadcast_stopped' },
      ],
    });
  });

  test('clock disagreement is not a missing part', () => {
    assert({
      given: 'capture off by half a second at each end',
      should: 'state nothing',
      actual: statement({
        ...none,
        segments: [{ startedAtMs: real(-500), endedAtMs: real(60_500) }],
      }),
      expected: { gaps: [], unrecorded: [] },
    });
  });
});
