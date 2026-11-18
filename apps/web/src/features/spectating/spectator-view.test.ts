import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol';
import {
  asAbandoned,
  asCompleted,
  ran,
  view,
} from '../../ui/debate-room/live-round.test-support';
import { spectatorKindOf, watchingRoomOf } from './spectator-view';

setupRitewayBun();

const hosted = (round: RoundView): RoundView => ({
  ...round,
  viewerIsHost: true,
  viewerIsUndelayedObserver: true,
});

describe('spectatorKindOf', () => {
  test('who watches as a spectator today', () => {
    assert({
      given:
        'a seatless host of a live Round, the same host once it ended or was abandoned, a seated host, and a member who does not host (ISSUE-673)',
      should: 'admit only the seatless host of a Round that has not ended',
      actual: [
        spectatorKindOf(hosted(ran(1))),
        spectatorKindOf(hosted(view)),
        spectatorKindOf(hosted(asCompleted(view))),
        spectatorKindOf(hosted(asAbandoned(view))),
        spectatorKindOf({
          ...hosted(ran(1)),
          viewerIsUndelayedObserver: false,
        }),
        spectatorKindOf(ran(1)),
      ],
      expected: [
        'host',
        'host',
        null,
        null,
        null,
        null,
      ],
    });
  });
});

describe('spectatorKindOf, a linked adult', () => {
  test("a youth debater's linked coach or parent (ADR 0155)", () => {
    const linked = (round: RoundView): RoundView => ({
      ...round,
      viewerIsHost: false,
      viewerIsUndelayedObserver: true,
    });
    assert({
      given:
        'an undelayed observer who does not host, on a live Round and on one that ended',
      should: 'watch as a linked adult while it is live, and not after',
      actual: [
        spectatorKindOf(linked(ran(1))),
        spectatorKindOf(linked(asCompleted(view))),
      ],
      expected: ['linked-adult', null],
    });
  });
});

describe('watchingRoomOf', () => {
  test('the room route sends a host who also judges to the judge room (ISSUE-673)', () => {
    const judging = ran(1);
    assert({
      given:
        'a seatless host assigned as the live judge, the same once the Round ended, a seatless host who does not judge, and a member with neither',
      should:
        'judge first, then fall back to the receipt; watch as a spectator; and otherwise show the receipt',
      actual: [
        watchingRoomOf({
          judgeRound: judging,
          spectatorKind: spectatorKindOf(hosted(judging)),
        }).kind,
        watchingRoomOf({
          judgeRound: { ...judging, status: 'completed' },
          spectatorKind: 'host',
        }).kind,
        watchingRoomOf({
          judgeRound: null,
          spectatorKind: spectatorKindOf(hosted(judging)),
        }).kind,
        watchingRoomOf({ judgeRound: null, spectatorKind: null }).kind,
      ],
      expected: ['judge', 'receipt', 'spectator', 'receipt'],
    });
  });
});
