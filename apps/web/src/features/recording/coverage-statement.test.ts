import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  coverageStatement,
  explainGaps,
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

  test('the designed cut at a speech edge is not a missing part', () => {
    assert({
      given:
        'a first clip opening 1.3 s into the speech and a tail cut 1.1 s short',
      should: 'state no late start and no early end',
      actual: statement({
        ...none,
        segments: [{ startedAtMs: real(-1300), endedAtMs: real(61_100) }],
      }),
      expected: { gaps: [], unrecorded: [] },
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

/** SMU Prep on staging: turnovers that end ~1.5 s into the next speech. */
const twoSpeeches = {
  ...none,
  segments: [
    { startedAtMs: real(0), endedAtMs: real(20_000) },
    { startedAtMs: real(30_000), endedAtMs: real(50_000) },
  ],
};
const notPublic = (startMs: number, endMs: number) =>
  ({ startMs, endMs, reason: 'not_public' }) as const;

describe('explainGaps', () => {
  test('a turnover between two speeches is not lost', () => {
    assert({
      given:
        'a not_public gap from the end of one speech to 1.5 s into the next',
      should: 'state it as between speeches',
      actual: explainGaps(
        [notPublic(20_015, 31_500)],
        twoSpeeches,
        startedAtMs,
      ),
      expected: [
        { startMs: 20_015, endMs: 31_500, reason: 'between_speeches' },
      ],
    });
  });

  test('a long turnover with nothing private committed in it', () => {
    assert({
      given: 'a 40 s wait between speeches and no prep',
      should: 'still be between speeches',
      actual: explainGaps(
        [notPublic(20_000, 61_400)],
        {
          ...none,
          segments: [
            { startedAtMs: real(0), endedAtMs: real(20_000) },
            { startedAtMs: real(60_000), endedAtMs: real(90_000) },
          ],
        },
        startedAtMs,
      ),
      expected: [
        { startMs: 20_000, endMs: 61_400, reason: 'between_speeches' },
      ],
    });
  });

  test('a prep is private, never lost', () => {
    assert({
      given: 'a not_public gap over a prep that starts as the speech ends',
      should: 'state the prep and the next opening as private',
      actual: explainGaps(
        [notPublic(19_300, 31_500)],
        { ...twoSpeeches, prepStartsAtMs: [real(20_000)] },
        startedAtMs,
      ),
      expected: [{ startMs: 19_300, endMs: 31_500, reason: 'private_phase' }],
    });
    assert({
      given: 'a turnover before a prep that starts a while after the speech',
      should: 'state the turnover as between and the prep as private',
      actual: explainGaps(
        [notPublic(20_000, 31_500)],
        { ...twoSpeeches, prepStartsAtMs: [real(24_000)] },
        startedAtMs,
      ),
      expected: [
        { startMs: 20_000, endMs: 24_000, reason: 'between_speeches' },
        { startMs: 24_000, endMs: 31_500, reason: 'private_phase' },
      ],
    });
  });

  test('a gap reaching into a speech past its opening is lost from there', () => {
    assert({
      given: 'a not_public gap running 10 s into the next speech',
      should: 'keep the part past the opening margin as not public',
      actual: explainGaps(
        [notPublic(20_000, 40_000)],
        twoSpeeches,
        startedAtMs,
      ),
      expected: [
        { startMs: 20_000, endMs: 32_500, reason: 'between_speeches' },
        { startMs: 32_500, endMs: 40_000, reason: 'not_public' },
      ],
    });
  });

  test('a stretch inside a speech stays not public', () => {
    assert({
      given: 'a not_public gap in the middle of a speech',
      should: 'leave it as it is',
      actual: explainGaps([notPublic(5000, 8000)], twoSpeeches, startedAtMs),
      expected: [notPublic(5000, 8000)],
    });
  });

  test('a sliver beyond a window is clock disagreement', () => {
    assert({
      given: 'a turnover gap starting 400 ms before the speech ends',
      should: 'not state the sliver as lost',
      actual: explainGaps(
        [notPublic(19_600, 31_500)],
        twoSpeeches,
        startedAtMs,
      ),
      expected: [
        { startMs: 19_600, endMs: 31_500, reason: 'between_speeches' },
      ],
    });
  });

  test('every other reason stands, and the answer is stable', () => {
    const stated = [
      { startMs: 1000, endMs: 3000, reason: 'capture_restart' },
      { startMs: 20_000, endMs: 31_500, reason: 'between_speeches' },
      { startMs: 40_000, endMs: 45_000, reason: 'room_rotation' },
    ] as const;
    assert({
      given: 'gaps already stated',
      should: 'return them unchanged',
      actual: explainGaps(stated, twoSpeeches, startedAtMs),
      expected: stated,
    });
  });

  test('touching stretches of one reason are told once', () => {
    assert({
      given: 'a worker gap over a prep next to the stated rest of that prep',
      should: 'state one private stretch',
      actual: explainGaps(
        [
          notPublic(20_000, 25_000),
          { startMs: 25_000, endMs: 30_000, reason: 'private_phase' },
        ],
        { ...twoSpeeches, prepStartsAtMs: [real(20_000)] },
        startedAtMs,
      ),
      expected: [{ startMs: 20_000, endMs: 30_000, reason: 'private_phase' }],
    });
  });

  test('a Round with no record explains nothing', () => {
    assert({
      given: 'no segments',
      should: 'keep the worker gap as not public',
      actual: explainGaps([notPublic(1000, 5000)], none, startedAtMs),
      expected: [notPublic(1000, 5000)],
    });
  });
});

describe('coverageStatement with worker turnovers', () => {
  test('the stored statement is already explained', () => {
    assert({
      given: "the worker's not_public gap at a turnover",
      should: 'store it as between speeches',
      actual: statement(twoSpeeches, {
        restartGaps: [notPublic(20_015, 31_500)],
        durationMs: 50_000,
      }).gaps,
      expected: [
        { startMs: 20_015, endMs: 31_500, reason: 'between_speeches' },
      ],
    });
  });

  test('a prep is stated private where the worker said not public', () => {
    assert({
      given: "the worker's not_public gap over part of a prep",
      should: 'state the whole prep as one private stretch',
      actual: statement(
        { ...twoSpeeches, prepStartsAtMs: [real(20_000)] },
        { restartGaps: [notPublic(19_300, 26_000)], durationMs: 50_000 },
      ).gaps,
      expected: [{ startMs: 19_300, endMs: 30_000, reason: 'private_phase' }],
    });
  });
});
