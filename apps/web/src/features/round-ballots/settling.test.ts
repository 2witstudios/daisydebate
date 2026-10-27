import { assert, setupRitewayBun, test } from 'riteway/bun';
import { attendanceTimingPolicy } from '@daisy/protocol';
import {
  origin,
  ran,
  rules,
  startOf,
} from '../../ui/debate-room/live-round.test-support';
import {
  ballotOpensInMs,
  attendanceSettlesAtMs,
  countdownNowMs,
} from './settling';

setupRitewayBun();

const { graceMs, finalizationBufferMs } = attendanceTimingPolicy;
const speeches = rules
  .map((rule, sequence) => ({ rule, sequence }))
  .filter(({ rule }) => rule.type === 'speech');
const lastNonFinal = speeches.at(-2)!.sequence;
const settles = origin + startOf(lastNonFinal) + graceMs + finalizationBufferMs;

test('attendance settles after the last non-final speech’s grace and buffer', () => {
  assert({
    given:
      'every segment run, then none run, then only the final speech left unrun',
    should:
      'settle at the last non-final speech’s start plus grace and buffer, null with no speech run, the same with the final one unrun',
    actual: [
      attendanceSettlesAtMs(ran(rules.length, true)),
      attendanceSettlesAtMs(ran(0)),
      attendanceSettlesAtMs(ran(speeches.at(-1)!.sequence)),
    ],
    expected: [settles, null, settles],
  });
});

test('how long until the ballot can be submitted', () => {
  const round = ran(rules.length, true);
  assert({
    given: '12 seconds before attendance settles, at it, and after it',
    should: 'count the 12 seconds down, then report nothing to wait for',
    actual: [
      ballotOpensInMs(round, settles - 12_000),
      ballotOpensInMs(round, settles),
      ballotOpensInMs(round, settles + 5_000),
    ],
    expected: [12_000, null, null],
  });
});

test('the countdown runs on the server render time, never on the device clock', () => {
  const renderedAtMs = Date.parse('2026-10-22T12:00:00.000Z');
  // A phone ten minutes slow: its wall clock reads far behind the server.
  const slow = renderedAtMs - 10 * 60_000;
  assert({
    given:
      'a device ten minutes slow, five seconds after mount; a device that slept 30 s (monotonic clock paused); and a wall clock set back an hour',
    should:
      'advance from the server render time by the time actually elapsed, never by the device’s absolute time or a backwards jump',
    actual: [
      countdownNowMs({
        renderedAtMs,
        mounted: { wallMs: slow, monotonicMs: 1_000 },
        current: { wallMs: slow + 5_000, monotonicMs: 6_000 },
      }),
      countdownNowMs({
        renderedAtMs,
        mounted: { wallMs: slow, monotonicMs: 1_000 },
        current: { wallMs: slow + 30_000, monotonicMs: 1_000 },
      }),
      countdownNowMs({
        renderedAtMs,
        mounted: { wallMs: slow, monotonicMs: 1_000 },
        current: { wallMs: slow - 3_600_000, monotonicMs: 3_000 },
      }),
    ],
    expected: [
      renderedAtMs + 5_000,
      renderedAtMs + 30_000,
      renderedAtMs + 2_000,
    ],
  });
});
