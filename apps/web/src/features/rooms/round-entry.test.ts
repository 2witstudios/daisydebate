import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol';
import { roundEntry } from './round-entry';
setupRitewayBun();
const seat = {
  id: 'seat',
  actorId: 'member',
  label: 'Member',
  kind: 'human',
  role: 'negative',
  slot: 0,
  consentVersion: 1,
  needsReady: true,
  ready: 'ready',
  eligible: true,
} as const;
const view = (status: NonNullable<RoomView['roundRef']>['status']) => ({
  participants: [seat],
  roundRef: { id: 'round', status },
});
test('only scheduled or active Rounds automatically admit seated members', () => {
  for (const status of [
    'scheduled',
    'active',
    'completed',
    'abandoned',
  ] as const)
    assert({
      given: `a seated member and ${status} shared Round`,
      should:
        'auto-enter only live Rounds and retain terminal Room/rematch access',
      actual: roundEntry(view(status), 'member', null).href,
      expected:
        status === 'scheduled' || status === 'active'
          ? '/rounds/round/room'
          : null,
    });
});
test('judges retain their own authorized route while spectators never auto-enter', () => {
  assert({
    given:
      'the seated judge, an unseated member and an anonymous judge projection',
    should: 'auto-enter only the explicitly named own seat',
    actual: [
      roundEntry(
        { ...view('active'), participants: [{ ...seat, role: 'judge' }] },
        'member',
        null,
      ).href,
      roundEntry(view('active'), 'other', null).href,
      roundEntry({ ...view('active'), participants: [] }, 'member', null).href,
    ],
    expected: ['/rounds/round/room', null, null],
  });
});
test('observed terminal Rounds cannot be reopened by delayed nonmonotonic snapshots', () => {
  for (const terminal of ['completed', 'abandoned'] as const) {
    const held = roundEntry(view(terminal), 'member', null);
    assert({
      given: `${terminal} observed before stale scheduled or active snapshots`,
      should: 'never redirect back into that Round after terminal observation',
      actual: ['scheduled', 'active'].map(
        (status) =>
          roundEntry(
            view(status as 'scheduled' | 'active'),
            'member',
            held.terminalRoundId,
          ).href,
      ),
      expected: [null, null],
    });
  }
});

test('refresh and a fresh rematch retain independent entry lifetimes', () => {
  const terminal = roundEntry(view('completed'), 'member', null);
  assert({
    given:
      'a fresh live entry, a terminal Room reload and a distinct rematch Round',
    should: 'enter live Rounds while keeping terminal Room accessible',
    actual: [
      roundEntry({ ...view('active'), roundRef: null }, 'member', null).href,
      roundEntry(view('active'), 'member', null).href,
      roundEntry(view('completed'), 'member', null).href,
      roundEntry(
        {
          ...view('active'),
          roundRef: { id: 'next-round', status: 'scheduled' },
        },
        'member',
        terminal.terminalRoundId,
      ).href,
    ],
    expected: [null, '/rounds/round/room', null, '/rounds/next-round/room'],
  });
});
