import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoundView } from '@daisy/protocol';
import { round as launched } from '../../features/room-runtime/operations.test-support';
import { isLiveDebater, liveRoundOf } from './live-round';

setupRitewayBun();

const aff = launched.participants[0]!;
const neg = {
  id: 'n4n6p8r2t4v6x8z1k3b5c7d9',
  actorId: 'o4n6p8r2t4v6x8z1k3b5c7d9',
  kind: 'bot',
  label: 'Practice bot',
  role: 'negative',
  slot: 0,
} as const;
const judge = {
  id: 'j4n6p8r2t4v6x8z1k3b5c7d9',
  actorId: 'k4n6p8r2t4v6x8z1k3b5c7d9',
  kind: 'human',
  label: 'Riley Judge',
  role: 'judge',
  slot: 0,
} as const;
const view: RoundView = {
  ...launched,
  participants: [{ ...aff, label: 'Sam Reyes' }, neg, judge],
};

describe('isLiveDebater', () => {
  test('who the round room is for', () => {
    assert({
      given: 'a debater, the judge, a stranger, and the debater once ended',
      should: 'admit only the debater of a round that has not ended',
      actual: [
        isLiveDebater(view, aff.actorId),
        isLiveDebater(view, judge.actorId),
        isLiveDebater(view, 'x'.repeat(24)),
        isLiveDebater({ ...view, status: 'completed' }, aff.actorId),
        isLiveDebater({ ...view, status: 'abandoned' }, aff.actorId),
      ],
      expected: [true, false, false, false, false],
    });
  });
});

describe('liveRoundOf', () => {
  const room = liveRoundOf(view, 'practice', aff.actorId);
  const first = view.rules.segments[0]!;

  test('the debaters and the anonymous judge', () => {
    assert({
      given: 'a scheduled round against a bot with a human judge',
      should:
        'seat you and the bot opposite, and list the judge without a name',
      actual: {
        self: room?.self,
        opponent: room?.opponent.side,
        judge: room?.judge,
        names: room?.people.map((p) => `${p.role}:${p.name}:${p.bot}`),
        leaked: JSON.stringify(room).includes('Riley'),
      },
      expected: {
        self: {
          id: aff.actorId,
          name: 'Sam Reyes',
          initials: 'SR',
          side: 'aff',
          rating: null,
          bot: null,
        },
        opponent: 'neg',
        judge: 'human',
        names: [
          'aff:Sam Reyes:false',
          'neg:Practice bot:true',
          'judge:Judge:false',
        ],
        leaked: false,
      },
    });
  });

  test('a bot opponent', () => {
    assert({
      given: 'a bot in the opposite seat, in a read that carries no level',
      should: 'mark the opponent as a bot with no level',
      actual: room?.opponent.bot,
      expected: { level: null },
    });
  });

  test('a waiting round', () => {
    assert({
      given: 'the durable read, which carries no live position',
      should:
        'light no speech, show the first speech’s length, close the mic and record nothing',
      actual: {
        phase: room?.phase,
        liveIndex: room?.liveIndex,
        speeches: room?.speeches.length,
        clock: room?.clock,
        micLive: room?.micLive,
        voiceLevel: room?.voiceLevel,
        recording: room?.recording,
      },
      expected: {
        phase: 'waiting',
        liveIndex: -1,
        speeches: view.rules.segments.length,
        clock: {
          label: `${first.key} · ${first.label}`,
          remainingMs: first.durationMs,
        },
        micLive: false,
        voiceLevel: 0,
        recording: false,
      },
    });
  });

  test('a running round', () => {
    assert({
      given: 'an active round the room cannot read the position of',
      should: 'show no clock and no prep rather than a guess',
      actual: (({ clock, prepMs }) => ({ clock, prepMs }))(
        liveRoundOf({ ...view, status: 'active' }, 'practice', aff.actorId)!,
      ),
      expected: { clock: null, prepMs: null },
    });
  });

  test('ranked and practice', () => {
    assert({
      given: 'the same round, ranked and then practice',
      should: 'give the ranked round no agents and the practice round one',
      actual: [
        liveRoundOf(view, 'ranked', aff.actorId)?.agents.length,
        room?.agents.map((a) => a.title),
      ],
      expected: [0, ['Assistant']],
    });
  });

  test('outside the room', () => {
    assert({
      given: 'the judge, and a round with no opponent seated',
      should: 'give no room',
      actual: [
        liveRoundOf(view, 'practice', judge.actorId),
        liveRoundOf(
          { ...view, participants: [view.participants[0]!] },
          'practice',
          aff.actorId,
        ),
      ],
      expected: [null, null],
    });
  });
});
