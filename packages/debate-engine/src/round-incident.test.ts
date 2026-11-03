import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { HydratedSegment, RuntimeCheckpoint } from '@daisy/protocol';
import { mediaGrants } from './media-grants';
import { createRoundRuntime } from './round-runtime';
import { settleOpening, strikeOpening } from './round-opening';
import { roundCommandRefusal } from './round-command-legality';
import { normalizeRoundClock } from './round-clock-state';
import {
  emptyCheckpoint,
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
} from './runtime.test-support';
setupRitewayBun();

const rules = oneOnOneRules();
const first = rules.segments[0]!;
const secondMs = 1_000;
const START = 10 * secondMs;

const speech = (over: Partial<HydratedSegment> = {}): HydratedSegment => ({
  id: 'segment-1',
  sequence: 0,
  type: first.type,
  rulesSegmentKey: first.key,
  startedAt: roundAt(START),
  endedAt: null,
  durationMs: first.durationMs,
  returnedMs: 0,
  ...over,
});
const runtimeOf = (
  segments: readonly HydratedSegment[],
  checkpoint: unknown = emptyCheckpoint,
  status: 'active' | 'opening' = 'active',
) =>
  createRoundRuntime({
    round: {
      id: 'round',
      status,
      currentStage: null,
      startedAt: status === 'active' ? roundAt(0) : null,
      completedAt: null,
      outcome: null,
    },
    rules,
    participants: oneOnOneSeats,
    checkpoint,
    segments,
    nextSegmentId: () => 'segment-new',
  });
const pause = (atMs: number, confirmedUntilMs: number | null) =>
  ({
    kind: 'pause',
    atMs: Date.parse(roundAt(atMs)),
    cause: 'room_emptied',
    confirmedUntilMs:
      confirmedUntilMs === null ? null : Date.parse(roundAt(confirmedUntilMs)),
  }) as const;
const beginResume = (atMs: number) =>
  ({
    kind: 'begin_resume',
    atMs: Date.parse(roundAt(atMs)),
    countdownMs: 5 * secondMs,
  }) as const;

test('pausing a live speech', () => {
  const runtime = runtimeOf([speech()]);
  const projection = runtime.applyIncident(pause(40_000, 37_000));
  assert({
    given: 'an outage seen 3 s after the last confirmed audio',
    should: 'hold the clock with that resume point, and close speaking there',
    actual: {
      incident: runtime.checkpoint().incident,
      speaking: projection.speakingChanges,
      closes: projection.segmentCloses,
    },
    expected: {
      incident: {
        phase: 'paused',
        since: roundAt(40_000),
        cause: 'room_emptied',
        resume_point: roundAt(37_000),
      },
      speaking: [
        { kind: 'close', segmentId: 'segment-1', at: roundAt(37_000) },
      ],
      closes: [],
    },
  });
});

test('the resume point is bounded', () => {
  const pointOf = (confirmed: number | null) => {
    const runtime = runtimeOf([speech()]);
    runtime.applyIncident(pause(40_000, confirmed));
    const { incident } = runtime.checkpoint();
    return incident.phase === 'paused' ? incident.resume_point : 'not paused';
  };
  assert({
    given: 'no confirmed audio in this speech',
    should: 'resume from the speech start',
    actual: pointOf(null),
    expected: roundAt(START),
  });
  assert({
    given: 'confirmed audio from before the speech',
    should: 'never resume before the speech start',
    actual: pointOf(1_000),
    expected: roundAt(START),
  });
  assert({
    given: 'an observation past the pause',
    should: 'never resume after the pause',
    actual: pointOf(90_000),
    expected: roundAt(40_000),
  });
});

test('a catch-up tick during a pause moves nothing', () => {
  const due = START + first.durationMs;
  const table: readonly [string, () => ReturnType<typeof runtimeOf>][] = [
    [
      'a live speech',
      () => {
        const runtime = runtimeOf([speech()]);
        runtime.applyIncident(pause(START + 1_000, START + 1_000));
        return runtime;
      },
    ],
    [
      'a countdown',
      () => {
        const runtime = runtimeOf([]);
        runtime.applyIncident(pause(1_000, null));
        return runtime;
      },
    ],
    [
      'in-round prep',
      () => {
        const runtime = runtimeOf([], {
          ...emptyCheckpoint,
          active_prep: { side: 'affirmative', started_at: roundAt(500) },
        });
        runtime.applyIncident(pause(1_000, null));
        return runtime;
      },
    ],
  ];
  for (const [given, build] of table) {
    const runtime = build();
    const before = runtime.checkpoint();
    // Far past every deadline in the Round: a backdating clock would close it all.
    const projection = runtime.tick(roundAt(due * 40));
    assert({
      given: `${given} held by an incident, ticked long past every deadline`,
      should: 'open nothing, close nothing and change nothing',
      actual: {
        inserts: projection.segmentInserts,
        closes: projection.segmentCloses,
        speaking: projection.speakingChanges,
        checkpoint: runtime.checkpoint(),
      },
      expected: {
        inserts: [],
        closes: [],
        speaking: [],
        checkpoint: before,
      },
    });
  }
});

test('resuming gives the speech its time back', () => {
  const runtime = runtimeOf([speech()]);
  runtime.applyIncident(pause(40_000, 37_000));
  const remainingBefore = runtime.position(roundAt(41_000)).openSegment
    ?.remainingMs;
  runtime.applyIncident(beginResume(50_000));
  assert({
    given: 'a resume begun, during the countdown',
    should: 'still hold the clock and the same remaining time',
    actual: {
      phase: runtime.checkpoint().incident.phase,
      remaining: runtime.position(roundAt(54_000)).openSegment?.remainingMs,
    },
    expected: { phase: 'resuming', remaining: remainingBefore },
  });
  // A tick arrives 2 s late: the resume stands at the countdown's own end.
  const projection = runtime.tick(roundAt(57_000));
  const returnedMs = 55_000 - 37_000;
  assert({
    given: 'the first tick after the countdown, late',
    should: 'return the time from the resume point to the countdown end',
    actual: {
      returns: projection.segmentReturns,
      speaking: projection.speakingChanges,
      incident: runtime.checkpoint().incident,
      stops: runtime.checkpoint().clock_stops,
      remaining: runtime.position(roundAt(57_000)).openSegment?.remainingMs,
    },
    expected: {
      returns: [{ id: 'segment-1', returnedMs }],
      speaking: [
        {
          kind: 'open',
          segmentId: 'segment-1',
          at: roundAt(55_000),
          participantIds: [
            oneOnOneSeats.find((seat) => seat.role === first.side)!.id,
          ],
        },
      ],
      incident: { phase: 'none' },
      stops: [{ from: roundAt(40_000), to: roundAt(55_000) }],
      remaining: remainingBefore! - 2_000,
    },
  });
  assert({
    given: 'the resumed speech reaching its new due instant',
    should: 'close there, with its full airtime spoken',
    actual: runtime.tick(roundAt(START + first.durationMs + returnedMs))
      .segmentCloses,
    expected: [
      {
        id: 'segment-1',
        endedAt: roundAt(START + first.durationMs + returnedMs),
      },
    ],
  });
});

test('a countdown and in-round prep owe the stop back', () => {
  const gap = runtimeOf([]);
  gap.applyIncident(pause(1_000, null));
  gap.applyIncident(beginResume(21_000));
  gap.tick(roundAt(26_000));
  assert({
    given: 'a 25 s stop 1 s into the opening countdown',
    should: 'open the speech 25 s later than it was due',
    actual: {
      before: gap.tick(roundAt(rules.countdownMs + 24_999)).segmentInserts,
      at: gap
        .tick(roundAt(rules.countdownMs + 25_000))
        .segmentInserts.map((row) => row.startedAt),
    },
    expected: { before: [], at: [roundAt(rules.countdownMs + 25_000)] },
  });
});

test('every event from every phase is defined', () => {
  const phases = {
    none: () => runtimeOf([speech()]),
    paused: () => {
      const runtime = runtimeOf([speech()]);
      runtime.applyIncident(pause(40_000, 37_000));
      return runtime;
    },
    resuming: () => {
      const runtime = runtimeOf([speech()]);
      runtime.applyIncident(pause(40_000, 37_000));
      runtime.applyIncident(beginResume(41_000));
      return runtime;
    },
  };
  const events = {
    pause: pause(42_000, 38_000),
    begin_resume: beginResume(42_000),
    end: { kind: 'end', atMs: Date.parse(roundAt(42_000)) } as const,
  };
  const expected: Record<string, string> = {
    'none/pause': 'paused',
    'none/begin_resume': 'none',
    'none/end': 'none',
    'paused/pause': 'paused',
    'paused/begin_resume': 'resuming',
    'paused/end': 'none',
    'resuming/pause': 'paused',
    'resuming/begin_resume': 'resuming',
    'resuming/end': 'none',
  };
  for (const [from, build] of Object.entries(phases))
    for (const [name, event] of Object.entries(events)) {
      const runtime = build();
      runtime.applyIncident(event);
      assert({
        given: `${name} from ${from}`,
        should: `leave the Round ${expected[`${from}/${name}`]}`,
        actual: runtime.checkpoint().incident.phase,
        expected: expected[`${from}/${name}`],
      });
    }
});

test('a second failure in the countdown keeps the first resume point', () => {
  const runtime = runtimeOf([speech()]);
  runtime.applyIncident(pause(40_000, 37_000));
  runtime.applyIncident(beginResume(41_000));
  runtime.applyIncident(pause(43_000, 42_000));
  const { incident } = runtime.checkpoint();
  assert({
    given: 'a pause during the countdown',
    should: 'hold the same incident from the same instants',
    actual: incident,
    expected: {
      phase: 'paused',
      since: roundAt(40_000),
      cause: 'room_emptied',
      resume_point: roundAt(37_000),
    },
  });
});

test('ending for an incident', () => {
  const runtime = runtimeOf([speech()]);
  runtime.applyIncident(pause(40_000, 37_000));
  const projection = runtime.applyIncident({
    kind: 'end',
    atMs: Date.parse(roundAt(130_000)),
  });
  assert({
    given: 'no recovery within the bound',
    should: 'abandon with no outcome, closing the speech at its resume point',
    actual: {
      round: {
        status: projection.round?.status,
        outcome: projection.round?.outcome,
        completedAt: projection.round?.completedAt,
      },
      closes: projection.segmentCloses,
      finalEnd: projection.finalSegmentEndedAt,
      effects: projection.effects.filter(
        (effect) => effect.kind === 'round_completed',
      ),
    },
    expected: {
      round: {
        status: 'abandoned',
        outcome: null,
        completedAt: roundAt(130_000),
      },
      closes: [{ id: 'segment-1', endedAt: roundAt(37_000) }],
      finalEnd: roundAt(37_000),
      effects: [],
    },
  });
  const opening = runtimeOf([], emptyCheckpoint, 'opening');
  opening.applyIncident(pause(1_000, null));
  assert({
    given: 'an opening held and past the bound',
    should: 'abandon with no start',
    actual: opening.applyIncident({
      kind: 'end',
      atMs: Date.parse(roundAt(100_000)),
    }).round?.startedAt,
    expected: null,
  });
});

test('a finished debate has nothing to pause', () => {
  const closed = rules.segments.map((segment, sequence) =>
    speech({
      id: `segment-${sequence}`,
      sequence,
      type: segment.type,
      rulesSegmentKey: segment.key,
      startedAt: roundAt(START + sequence),
      endedAt: roundAt(START + sequence + 1),
      durationMs: segment.durationMs,
    }),
  );
  const runtime = runtimeOf(closed);
  runtime.applyIncident(pause(START + 100, null));
  assert({
    given: 'an outage once every segment has closed',
    should: 'not hold the Round',
    actual: runtime.checkpoint().incident,
    expected: { phase: 'none' },
  });
});

test('commands are refused while held', () => {
  const held: RuntimeCheckpoint = {
    ...emptyCheckpoint,
    prep_consumed_ms: { affirmative: 0, negative: 0 },
    clock_stops: [],
    incident: {
      phase: 'paused',
      since: roundAt(40_000),
      cause: 'room_retired',
      resume_point: roundAt(37_000),
    },
  };
  const state = normalizeRoundClock({
    round: {
      status: 'active',
      startedAt: roundAt(0),
      completedAt: null,
      outcome: null,
    },
    segments: [speech()],
    checkpoint: held,
    rules,
  });
  for (const type of [
    'start_prep',
    'start_speech',
    'yield',
    'interrupt',
    'forfeit',
  ] as const)
    assert({
      given: `${type} from a seated debater during an incident`,
      should: 'be refused, so no player can act on or end the hold',
      actual: roundCommandRefusal(
        {
          rules,
          state,
          participants: oneOnOneSeats,
          seat: oneOnOneSeats[0]!,
          nowMs: Date.parse(roundAt(41_000)),
        },
        type,
      ),
      expected: {
        kind: 'conflict',
        message: 'A platform incident holds this round',
      },
    });
});

test("only the speaker's microphone stays open, for capture to confirm", () => {
  const runtime = runtimeOf([speech()]);
  const seat = oneOnOneSeats.find((row) => row.role === first.side)!;
  const other = oneOnOneSeats.find(
    (row) => row.role !== first.side && row.role !== 'judge',
  )!;
  const publish = (now: string, participantId = seat.id) =>
    mediaGrants({
      participants: oneOnOneSeats.map((row) => ({
        ...row,
        eligible: true,
        kind: 'human' as const,
      })),
      participantId,
      rules,
      position: runtime.position(now),
      now,
      finalSegmentEndedAt: null,
      inPreRoundPrep: false,
    }).publish;
  const before = publish(roundAt(30_000));
  runtime.applyIncident(pause(40_000, 37_000));
  assert({
    given:
      'the speaker before and during an incident, and the other debater during it',
    should: 'keep the speaker open and the other closed',
    actual: [
      before,
      publish(roundAt(41_000)),
      publish(roundAt(41_000), other.id),
    ],
    expected: [['camera', 'microphone'], ['camera', 'microphone'], ['camera']],
  });
});

test("the speaker's microphone opens for the countdown, so it is ready when the clock restarts", () => {
  const runtime = runtimeOf([speech()]);
  const seat = oneOnOneSeats.find((row) => row.role === first.side)!;
  runtime.applyIncident(pause(40_000, 37_000));
  runtime.applyIncident(beginResume(50_000));
  const now = roundAt(50_000 + 1_000);
  assert({
    given: 'the speaker during the resume countdown',
    should: 'hold the microphone again',
    actual: mediaGrants({
      participants: oneOnOneSeats.map((row) => ({
        ...row,
        eligible: true,
        kind: 'human' as const,
      })),
      participantId: seat.id,
      rules,
      position: runtime.position(now),
      now,
      finalSegmentEndedAt: null,
      inPreRoundPrep: false,
    }).publish,
    expected: ['camera', 'microphone'],
  });
});

test('hydration refuses an impossible hold', () => {
  const read = () =>
    normalizeRoundClock({
      round: {
        status: 'active',
        startedAt: roundAt(0),
        completedAt: null,
        outcome: null,
      },
      segments: [speech()],
      checkpoint: {
        ...emptyCheckpoint,
        incident: {
          phase: 'paused',
          since: roundAt(40_000),
          cause: 'room_retired',
          resume_point: null,
        },
      },
      rules,
    });
  let message = '';
  try {
    read();
  } catch (error) {
    message = (error as Error).message;
  }
  assert({
    given: 'a paused checkpoint with an open speech and no resume point',
    should: 'refuse it as corruption',
    actual: message,
    expected:
      'A paused Round names a resume point exactly when a segment is open',
  });
});

test('opening strikes and prep obey the same stop', () => {
  const STARTED = roundAt(0);
  const opening = {
    startedAt: STARTED,
    draw: null,
    prepMs: 60_000,
    stops: [{ from: roundAt(10_000), to: null }],
  };
  assert({
    given: 'opening prep held by an open stop, long past its end',
    should: 'stay in prep',
    actual: settleOpening(opening, null, roundAt(600_000)).step.step,
    expected: 'prep',
  });
  assert({
    given: 'opening prep with a finished 20 s stop',
    should: 'complete 20 s later than it would have',
    actual: settleOpening(
      { ...opening, stops: [{ from: roundAt(10_000), to: roundAt(30_000) }] },
      null,
      roundAt(90_000),
    ).step,
    expected: { step: 'complete', at: roundAt(80_000) },
  });
  assert({
    given: 'a strike attempted while the opening is held',
    should: 'be refused',
    actual: strikeOpening(
      opening,
      [
        {
          actorId: 'actor',
          role: 'affirmative',
          kind: 'human',
          eligible: true,
        },
      ],
      {
        actorId: 'actor',
        commandId: 'command',
        ordinal: 0,
        position: 0,
        now: roundAt(20_000),
      },
    ),
    expected: { ok: false, refusal: 'platform-incident' },
  });
});
