import { assert, setupRitewayBun, test } from 'riteway/bun';
import { attendanceTimingPolicy } from '@daisy/protocol';
import {
  origin,
  ran,
  rules,
  startOf,
} from '../../ui/debate-room/live-round.test-support';
import { ballotOpensInMs, attendanceSettlesAtMs } from './settling';

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
