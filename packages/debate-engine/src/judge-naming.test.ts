import { assert, setupRitewayBun, test } from 'riteway/bun';
import { namesHumanJudge } from './room-assembly-facts';

setupRitewayBun();
const room = {
  hostActorId: 'host',
  hostInherited: false,
  participants: [{ actorId: 'judge' }, { actorId: 'debater' }],
};

test('who may name a human judge', () => {
  assert({
    given:
      'the judge themselves, a debater, a seatless host, a host who inherited the Room and a host who holds a seat',
    should:
      'name the judge only to themselves and the seatless host who seated them',
    actual: [
      namesHumanJudge(room, 'judge', 'judge'),
      namesHumanJudge(room, 'debater', 'judge'),
      namesHumanJudge(room, 'host', 'judge'),
      namesHumanJudge({ ...room, hostInherited: true }, 'host', 'judge'),
      namesHumanJudge(
        { ...room, participants: [...room.participants, { actorId: 'host' }] },
        'host',
        'judge',
      ),
    ],
    expected: [true, false, true, false, false],
  });
});
