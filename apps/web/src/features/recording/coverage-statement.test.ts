import { startEdgeLagMs } from '@daisy/protocol';
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
        { startMs: 20_000, endMs: 32_503, reason: 'between_speeches' },
        { startMs: 32_503, endMs: 40_000, reason: 'not_public' },
      ],
    });
  });

  test('speeches back to back still have their opening', () => {
    assert({
      given:
        'the next speech starting as the last ends, and a gap from 30 ms after',
      should: 'state the opening as between speeches (Watch check on staging)',
      actual: explainGaps(
        [notPublic(20_030, 21_306)],
        {
          ...none,
          segments: [
            { startedAtMs: real(0), endedAtMs: real(20_000) },
            { startedAtMs: real(20_000), endedAtMs: real(50_000) },
          ],
        },
        startedAtMs,
      ),
      expected: [
        { startMs: 20_030, endMs: 21_306, reason: 'between_speeches' },
      ],
    });
  });

  test('public media stopping short of a speech end is not lost', () => {
    assert({
      given:
        'a prep at the end of a speech and a worker gap from 1.1 s before it',
      should: 'state the whole stretch as private',
      actual: explainGaps(
        [notPublic(18_900, 31_500)],
        { ...twoSpeeches, prepStartsAtMs: [real(20_000)] },
        startedAtMs,
      ),
      expected: [{ startMs: 18_900, endMs: 31_500, reason: 'private_phase' }],
    });
    assert({
      given: 'a turnover whose worker gap starts 1.1 s before the speech ends',
      should: 'state the whole stretch as between speeches',
      actual: explainGaps(
        [notPublic(18_900, 31_500)],
        twoSpeeches,
        startedAtMs,
      ),
      expected: [
        { startMs: 18_900, endMs: 31_500, reason: 'between_speeches' },
      ],
    });
    assert({
      given: 'a gap near a speech end that does not reach the slate',
      should: 'stay not public',
      actual: explainGaps(
        [notPublic(17_000, 19_500)],
        twoSpeeches,
        startedAtMs,
      ),
      expected: [notPublic(17_000, 19_500)],
    });
  });

  test('a gap opening inside a speech is lost, however early', () => {
    assert({
      given:
        'a not_public gap from 2.0 s to 4.0 s into a speech, past no slate',
      should: 'state all of it as not public',
      actual: explainGaps(
        [notPublic(32_000, 34_000)],
        twoSpeeches,
        startedAtMs,
      ),
      expected: [notPublic(32_000, 34_000)],
    });
    assert({
      given: 'a not_public gap from 2.0 s to 3.4 s into a speech',
      should: 'not lend it to the turnover before that speech',
      actual: explainGaps(
        [notPublic(32_000, 33_400)],
        twoSpeeches,
        startedAtMs,
      ),
      expected: [notPublic(32_000, 33_400)],
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

  test('the opening covers the real stamp lag at any capture age', () => {
    // Past a fixed 2.5 s opening by more than the 1 s sliver at 3 hours, so only an
    // opening derived from the real lag covers it.
    const probeSlackMs = 1150;
    for (const [age, nextStartMs] of [
      ['80 minutes', 80 * 60_000],
      ['3 hours', 180 * 60_000],
    ] as const) {
      const endMs =
        nextStartMs +
        startEdgeLagMs(real(nextStartMs), startedAtMs) +
        probeSlackMs;
      assert({
        given: `a turnover whose next speech starts ${age} into the capture`,
        should: 'state the whole stretch as between speeches',
        actual: explainGaps(
          [notPublic(nextStartMs - 10_000, endMs)],
          {
            ...none,
            segments: [
              {
                startedAtMs: real(nextStartMs - 60_000),
                endedAtMs: real(nextStartMs - 10_000),
              },
              { startedAtMs: real(nextStartMs), endedAtMs: null },
            ],
          },
          startedAtMs,
        ),
        expected: [
          {
            startMs: nextStartMs - 10_000,
            endMs,
            reason: 'between_speeches',
          },
        ],
      });
    }
  });

  test('what history does not close fails closed', () => {
    const open = {
      ...none,
      segments: [
        { startedAtMs: real(0), endedAtMs: null },
        { startedAtMs: real(30_000), endedAtMs: real(50_000) },
      ],
    };
    assert({
      given: 'a not_public gap after a segment still open',
      should: 'stay not public',
      actual: explainGaps([notPublic(20_000, 29_000)], open, startedAtMs),
      expected: [notPublic(20_000, 29_000)],
    });
    assert({
      given: 'a not_public gap after the last committed segment',
      should: 'stay not public',
      actual: explainGaps(
        [notPublic(52_000, 58_000)],
        twoSpeeches,
        startedAtMs,
      ),
      expected: [notPublic(52_000, 58_000)],
    });
    assert({
      given: 'a not_public gap in a prep no segment follows',
      should: 'stay not public',
      actual: explainGaps(
        [notPublic(52_000, 58_000)],
        { ...twoSpeeches, prepStartsAtMs: [real(51_000)] },
        startedAtMs,
      ),
      expected: [notPublic(52_000, 58_000)],
    });
  });

  test('its own answer comes back unchanged', () => {
    const facts = { ...twoSpeeches, prepStartsAtMs: [real(24_000)] };
    const once = explainGaps(
      [
        notPublic(5000, 8000),
        notPublic(20_000, 40_000),
        { startMs: 45_000, endMs: 46_000, reason: 'capture_restart' },
      ],
      facts,
      startedAtMs,
    );
    assert({
      given: 'gaps already explained',
      should: 'explain them the same way again',
      actual: explainGaps(once, facts, startedAtMs),
      expected: once,
    });
  });

  test('stretches of different reasons are never merged, and none is lost', () => {
    const gaps = [
      notPublic(19_600, 40_000),
      { startMs: 40_000, endMs: 41_000, reason: 'capture_restart' },
    ] as const;
    const explained = explainGaps(gaps, twoSpeeches, startedAtMs);
    assert({
      given: 'a turnover running into a lost stretch and a restart',
      should: 'keep each reason apart and cover exactly the same time',
      actual: [
        explained.map((gap) => gap.reason),
        explained.every(
          (gap, index) =>
            index === 0 || explained[index - 1]?.endMs === gap.startMs,
        ),
        [explained[0]?.startMs, explained.at(-1)?.endMs],
      ],
      expected: [
        ['between_speeches', 'not_public', 'capture_restart'],
        true,
        [19_600, 41_000],
      ],
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
