import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  adjudicateAttendance,
  attendancePolicy,
  type AttendanceWindow,
} from './attendance';
import { deriveOutageIntervals, withClockStops } from './availability';
setupRitewayBun();

const OPENED = 1_000_000;
const { graceMs, finalizationBufferMs, leadMs } = attendancePolicy;
const iso = (ms: number) => new Date(ms).toISOString();
const window: AttendanceWindow = {
  segmentId: 'segment',
  openedAtMs: OPENED,
  speakerId: 'speaker',
  speakerSide: 'affirmative',
  eligibleSeats: [
    { id: 'speaker', side: 'affirmative' },
    { id: 'opponent', side: 'negative' },
  ],
  lastSpeech: false,
};
/** Healthy samples throughout, as the availability sampler really reports an outage of LiveKit alone. */
const healthyUntil = (untilMs: number) => {
  const samples = [];
  for (let atMs = OPENED - 1_000; atMs <= untilMs; atMs += 1_000)
    samples.push({ atMs, healthy: true });
  return deriveOutageIntervals(samples);
};
const decide = (
  stops: readonly { readonly from: string; readonly to: string | null }[],
  nowMs: number,
  checkIns = [{ participantId: 'opponent', receivedAtMs: OPENED }],
) =>
  adjudicateAttendance({
    window,
    availability: withClockStops(healthyUntil(nowMs), stops),
    checkIns,
    botSeatIds: [],
    finalized: false,
    cutoffAtMs: null,
    nowMs,
  });

test('an incident never forfeits an absent speaker', () => {
  const settled = graceMs + finalizationBufferMs;
  const stop = { from: iso(OPENED + 1_000), to: iso(OPENED + 61_000) };
  const table: readonly [
    string,
    readonly (typeof stop | { from: string; to: null })[],
    number,
    Record<string, unknown> | null,
  ][] = [
    [
      'no incident, just inside the settled grace',
      [],
      OPENED + settled - 1_000,
      null,
    ],
    [
      'no incident, past the settled grace (the existing rule still forfeits)',
      [],
      OPENED + settled + 1_000,
      {
        evidence: 'settled_availability',
        decision: 'forfeit',
        winner: 'negative',
        effectiveDeadlineMs: OPENED + graceMs,
      },
    ],
    [
      'an incident still open, long past any grace',
      [{ from: iso(OPENED + 1_000), to: null }],
      OPENED + settled * 50,
      null,
    ],
    [
      'a finished 60 s incident, with the wall-clock grace passed',
      [stop],
      OPENED + settled + 1_000,
      null,
    ],
    [
      'a finished 60 s incident, just short of grace in healthy time',
      [stop],
      OPENED + 60_000 + settled - 1_000,
      null,
    ],
    [
      'a finished 60 s incident, the grace then spent in healthy time',
      [stop],
      OPENED + 60_000 + settled + 1_000,
      {
        evidence: 'settled_availability',
        decision: 'forfeit',
        winner: 'negative',
        effectiveDeadlineMs: OPENED + 60_000 + graceMs,
      },
    ],
    [
      'an incident before the speech, which costs this window nothing',
      [{ from: iso(OPENED - 90_000), to: iso(OPENED - 30_000) }],
      OPENED + settled + 1_000,
      {
        evidence: 'settled_availability',
        decision: 'forfeit',
        winner: 'negative',
        effectiveDeadlineMs: OPENED + graceMs,
      },
    ],
  ];
  for (const [given, stops, nowMs, expected] of table)
    assert({
      given,
      should:
        expected === null ? 'keep waiting' : 'decide on healthy time only',
      actual: decide(stops, nowMs) as unknown,
      // Health was known to the instant of the decision: that is its horizon.
      expected: expected && { ...expected, settledHorizonMs: nowMs },
    });
});

test('a seat that returned during the incident attended', () => {
  const stop = { from: iso(OPENED + 1_000), to: iso(OPENED + 61_000) };
  const late = OPENED + graceMs + 30_000;
  assert({
    given: 'a speaker whose check-in arrived past the base grace, in the span',
    should: 'attend, because the deadline moved',
    actual: decide(
      stop ? [stop] : [],
      OPENED + 60_000 + graceMs + finalizationBufferMs + 1_000,
      [
        { participantId: 'opponent', receivedAtMs: OPENED },
        { participantId: 'speaker', receivedAtMs: late },
      ],
    ),
    expected: {
      evidence: 'settled_availability',
      decision: 'attended',
      effectiveDeadlineMs: OPENED + 60_000 + graceMs,
      settledHorizonMs:
        OPENED + 60_000 + graceMs + finalizationBufferMs + 1_000,
    },
  });
  assert({
    given: 'the policy the windows are read with',
    should: 'keep a lead shorter than a grace',
    actual: leadMs < graceMs,
    expected: true,
  });
});
