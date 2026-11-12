import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  noPostRoundCall,
  postRoundCallPolicy,
  roundMediaPolicy,
  type PostRoundCallFacts,
  type RoundStatus,
} from '@daisy/protocol';
import {
  mediaPhase,
  mediaWindowClosed,
  mediaWindowEndsAt,
} from './media-window';

setupRitewayBun();

const end = '2026-10-22T12:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(end) + ms).toISOString();
const facts = (
  status: RoundStatus,
  now: string,
  finalSegmentEndedAt: string | null,
  postRoundCall: PostRoundCallFacts = noPostRoundCall(status),
) => ({ status, now, finalSegmentEndedAt, postRoundCall });
const chosen: PostRoundCallFacts = {
  optedIn: true,
  status: 'completed',
  sessionOpen: true,
  roundEndedAt: end,
  openedAt: null,
  vacantSince: null,
};

test('mediaWindowClosed()', () => {
  assert({
    given: 'live and finished Rounds around the final end',
    should: 'close for finished Rounds and from exactly the window after',
    actual: [
      mediaWindowClosed(facts('opening', end, null)),
      mediaWindowClosed(facts('active', '2026-10-22T12:29:59.999Z', end)),
      mediaWindowClosed(facts('active', '2026-10-22T12:30:00.000Z', end)),
      mediaWindowClosed(facts('completed', end, null)),
      mediaWindowClosed(facts('abandoned', end, null)),
    ],
    expected: [false, false, true, true, true],
  });
});

test('mediaPhase()', () => {
  const cases: readonly (readonly [
    string,
    RoundStatus,
    number,
    PostRoundCallFacts,
    string,
  ])[] = [
    [
      'a running Round',
      'active',
      0,
      { ...chosen, status: 'active', roundEndedAt: null },
      'round',
    ],
    [
      'a completed Round whose host did not choose the call',
      'completed',
      1,
      { ...chosen, optedIn: false },
      'closed',
    ],
    [
      'an abandoned Round whose host chose the call',
      'abandoned',
      1,
      { ...chosen, status: 'abandoned' },
      'closed',
    ],
    [
      'a completed Round whose media session ended earlier, or never began',
      'completed',
      1,
      { ...chosen, sessionOpen: false },
      'closed',
    ],
    [
      'a completed Round before the call has its room',
      'completed',
      1,
      chosen,
      'post-round-call-opening',
    ],
    [
      'a call with its room',
      'completed',
      2_000,
      { ...chosen, openedAt: at(1_000) },
      'post-round-call',
    ],
    [
      'a call just under its cap',
      'completed',
      postRoundCallPolicy.maxMs - 1,
      { ...chosen, openedAt: at(1_000) },
      'post-round-call',
    ],
    [
      'a call at its cap',
      'completed',
      postRoundCallPolicy.maxMs,
      { ...chosen, openedAt: at(1_000) },
      'closed',
    ],
    [
      'a call still opening at its cap',
      'completed',
      postRoundCallPolicy.maxMs,
      chosen,
      'closed',
    ],
    [
      'a call empty for less than the grace',
      'completed',
      10_000 + postRoundCallPolicy.vacantGraceMs - 1,
      { ...chosen, openedAt: at(1_000), vacantSince: at(10_000) },
      'post-round-call',
    ],
    [
      'a call empty for the grace',
      'completed',
      10_000 + postRoundCallPolicy.vacantGraceMs,
      { ...chosen, openedAt: at(1_000), vacantSince: at(10_000) },
      'closed',
    ],
  ];
  for (const [given, status, afterMs, call, expected] of cases)
    assert({
      given,
      should: `be ${expected}`,
      actual: mediaPhase(facts(status, at(afterMs), null, call)),
      expected,
    });
});

test('mediaWindowEndsAt()', () => {
  assert({
    given: 'a final segment end',
    should: 'add the media policy window',
    actual: mediaWindowEndsAt(end) - Date.parse(end),
    expected: roundMediaPolicy.windowAfterFinalSegmentMs,
  });
});
