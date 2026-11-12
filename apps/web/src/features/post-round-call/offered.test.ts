import { assert, setupRitewayBun, test } from 'riteway/bun';
import { postRoundCallPolicy } from '@daisy/protocol';
import {
  postRoundCallChosen,
  postRoundCallEndsAtMs,
  postRoundCallOffered,
} from './offered';

setupRitewayBun();

const completedAt = '2026-11-12T12:00:00.000Z';
const endedMs = Date.parse(completedAt);
const chosen = {
  status: 'completed',
  postRoundCall: true,
  completedAt,
} as const;

test('postRoundCallChosen()', () => {
  assert({
    given:
      'a completed Round with the call, one without, a running and an abandoned one',
    should: 'be chosen only for the completed Round with the call',
    actual: [
      postRoundCallChosen(chosen),
      postRoundCallChosen({ ...chosen, postRoundCall: false }),
      postRoundCallChosen({ ...chosen, status: 'active', completedAt: null }),
      postRoundCallChosen({ ...chosen, status: 'abandoned' }),
    ],
    expected: [true, false, false, false],
  });
});

test('postRoundCallOffered()', () => {
  assert({
    given: 'the instants around the call’s cap',
    should: 'keep the room until the cap and not from it',
    actual: [
      postRoundCallOffered(chosen, endedMs),
      postRoundCallOffered(chosen, endedMs + postRoundCallPolicy.maxMs - 1),
      postRoundCallOffered(chosen, endedMs + postRoundCallPolicy.maxMs),
      postRoundCallOffered({ ...chosen, postRoundCall: false }, endedMs),
    ],
    expected: [true, true, false, false],
  });
  assert({
    given: 'a Round with the call and one without',
    should: 'name the cap, or nothing',
    actual: [
      postRoundCallEndsAtMs(chosen),
      postRoundCallEndsAtMs({ ...chosen, postRoundCall: false }),
    ],
    expected: [endedMs + postRoundCallPolicy.maxMs, null],
  });
});
