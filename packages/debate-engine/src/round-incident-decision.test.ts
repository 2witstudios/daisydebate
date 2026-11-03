import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundIncidentPolicy, type RoundIncident } from '@daisy/protocol';
import {
  incidentDecision,
  observationMatters,
  type IncidentFacts,
  type MediaObservation,
} from './round-incident-decision';
setupRitewayBun();

const SINCE = Date.parse('2026-11-03T10:00:00.000Z');
const since = new Date(SINCE).toISOString();
const paused: RoundIncident = {
  phase: 'paused',
  since,
  cause: 'room_emptied',
  resume_point: null,
};
const resuming: RoundIncident = {
  ...paused,
  phase: 'resuming',
  until: new Date(SINCE + 50_000).toISOString(),
};
const room = (
  over: Partial<Extract<MediaObservation, { kind: 'room' }>> = {},
) =>
  ({
    kind: 'room',
    empty: false,
    captureListed: true,
    seatsListed: true,
    speakerHeard: null,
    ...over,
  }) as const;
const facts = (over: Partial<IncidentFacts>): IncidentFacts => ({
  incident: { phase: 'none' },
  nowMs: SINCE,
  observation: room(),
  roomRetired: false,
  sawCapture: true,
  unreachableSinceMs: null,
  captureExpected: true,
  ...over,
});
const { recoveryBoundMs, seatGraceMs, vendorUnreachableMs } =
  roundIncidentPolicy;

test('what server evidence means', () => {
  const table: readonly [string, Partial<IncidentFacts>, unknown][] = [
    ['a healthy room', {}, null],
    [
      'one seat dropping while capture and the other seat remain',
      { observation: room({ seatsListed: false }) },
      null,
    ],
    [
      'a room that empties having held the capture agent',
      { observation: room({ empty: true, captureListed: false }) },
      { kind: 'pause', cause: 'room_emptied' },
    ],
    [
      'a room empty that never held the capture agent',
      {
        observation: room({ empty: true, captureListed: false }),
        sawCapture: false,
      },
      null,
    ],
    [
      'the vendor unreachable just inside the bound',
      {
        observation: { kind: 'unreachable' },
        unreachableSinceMs: SINCE - vendorUnreachableMs + 1,
      },
      null,
    ],
    [
      'the vendor unreachable past the bound',
      {
        observation: { kind: 'unreachable' },
        unreachableSinceMs: SINCE - vendorUnreachableMs,
      },
      { kind: 'pause', cause: 'vendor_unreachable' },
    ],
    [
      'an uncertain room retired',
      { roomRetired: true },
      { kind: 'pause', cause: 'room_retired' },
    ],
    [
      'a pause with the platform and every seat back',
      { incident: paused, nowMs: SINCE + 1_000 },
      { kind: 'begin_resume' },
    ],
    [
      'a pause with a seat missing, inside the grace',
      {
        incident: paused,
        nowMs: SINCE + seatGraceMs - 1,
        observation: room({ seatsListed: false }),
      },
      null,
    ],
    [
      'a pause with a seat missing, at the end of the grace',
      {
        incident: paused,
        nowMs: SINCE + seatGraceMs,
        observation: room({ seatsListed: false }),
      },
      { kind: 'begin_resume' },
    ],
    [
      'a pause with every seat back but no capture yet',
      {
        incident: paused,
        nowMs: SINCE + seatGraceMs,
        observation: room({ captureListed: false }),
      },
      null,
    ],
    [
      'an opening pause, which has no capture to wait for',
      {
        incident: paused,
        nowMs: SINCE + 1_000,
        observation: room({ captureListed: false }),
        captureExpected: false,
      },
      { kind: 'begin_resume' },
    ],
    [
      'a pause just inside the bound with the platform still down',
      {
        incident: paused,
        nowMs: SINCE + recoveryBoundMs - 1,
        observation: { kind: 'unreachable' },
      },
      null,
    ],
    [
      'a pause at the bound with the platform still down',
      {
        incident: paused,
        nowMs: SINCE + recoveryBoundMs,
        observation: { kind: 'unreachable' },
      },
      { kind: 'end' },
    ],
    [
      'the platform back at the very bound',
      { incident: paused, nowMs: SINCE + recoveryBoundMs },
      { kind: 'begin_resume' },
    ],
    [
      'a healthy countdown',
      { incident: resuming, nowMs: SINCE + 49_000 },
      null,
    ],
    [
      'a second failure in the countdown',
      {
        incident: resuming,
        nowMs: SINCE + 49_000,
        observation: room({ empty: true, captureListed: false }),
      },
      { kind: 'pause', cause: 'room_emptied' },
    ],
    [
      'a second failure in the countdown past the bound',
      {
        incident: resuming,
        nowMs: SINCE + recoveryBoundMs,
        observation: room({ empty: true, captureListed: false }),
      },
      { kind: 'end' },
    ],
  ];
  for (const [given, over, expected] of table)
    assert({
      given,
      should: `decide ${JSON.stringify(expected)}`,
      actual: incidentDecision(facts(over)),
      expected,
    });
});

test('the bound leaves room for the seats and the countdown', () => {
  assert({
    given: 'the provisional bounds',
    should: 'let the seat grace end before the recovery bound',
    actual: seatGraceMs < recoveryBoundMs,
    expected: true,
  });
});

test('an ordinary pass costs no Round lock', () => {
  const table: readonly [string, Partial<IncidentFacts>, boolean][] = [
    ['a healthy Round with capture, as last seen', {}, false],
    ['a pass that read nothing', { observation: { kind: 'unread' } }, false],
    ['capture newly listed', { sawCapture: false }, true],
    [
      'capture newly gone',
      { observation: room({ captureListed: false }) },
      true,
    ],
    ['an empty room', { observation: room({ empty: true }) }, true],
    ['the vendor failing', { observation: { kind: 'unreachable' } }, true],
    ['the vendor back', { unreachableSinceMs: SINCE - 1 }, true],
    ['a retirement', { roomRetired: true }, true],
    ['a pause under way', { incident: paused }, true],
  ];
  for (const [given, over, expected] of table)
    assert({
      given,
      should: expected ? 'take the transaction' : 'skip it',
      actual: observationMatters(facts(over)),
      expected,
    });
});

test('the Round waits for capture to hear the speaker before it counts down', () => {
  const held = {
    incident: {
      phase: 'paused' as const,
      since: new Date(1_000_000).toISOString(),
      cause: 'room_retired' as const,
      resumePoint: null,
    },
    roomRetired: false,
    sawCapture: true,
    unreachableSinceMs: null,
    captureExpected: true,
  };
  const at = (heldMs: number, speakerHeard: boolean | null) =>
    incidentDecision({
      ...held,
      nowMs: 1_000_000 + heldMs,
      observation: {
        kind: 'room',
        empty: false,
        captureListed: true,
        seatsListed: true,
        speakerHeard,
      },
    } as never)?.kind ?? null;
  assert({
    given:
      'seats and capture back, capture not yet hearing the speaker; then hearing; then no human speech held; then not heard past the grace',
    should:
      'wait, then begin, then begin, then begin rather than hold the Round for a dead microphone',
    actual: [
      at(5_000, false),
      at(5_000, true),
      at(5_000, null),
      at(roundIncidentPolicy.seatGraceMs, false),
    ],
    expected: [null, 'begin_resume', 'begin_resume', 'begin_resume'],
  });
});
