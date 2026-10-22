import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundControlIntents } from './control-intents';
import {
  view,
  aff,
  neg,
  ran,
  at,
  startOf,
} from '../../ui/debate-room/live-round.test-support';
setupRitewayBun();
test('Round controls follow existing runtime position and preserve floor command ownership', () => {
  assert({
    given: 'a scheduled seated participant',
    should: 'offer a server-authorized start intent',
    actual: roundControlIntents(view, aff.actorId, Date.parse(at(0))).map(
      (c) => c.type,
    ),
    expected: ['start'],
  });
  const active = ran(1);
  assert({
    given: 'an own speech with permitted early yield',
    should: 'offer a confirmed server yield',
    actual: roundControlIntents(
      active,
      aff.actorId,
      Date.parse(at(startOf(0) + 1000)),
    ).find((c) => c.type === 'yield')?.confirm,
    expected: true,
  });
  const cx = ran(2);
  const controls = roundControlIntents(
    cx,
    aff.actorId,
    Date.parse(at(startOf(1) + 1000)),
  );
  assert({
    given: 'the responder during ordered CX',
    should: 'offer interruption without claiming floor-holder yield',
    actual: controls
      .filter((c) => c.enabled && c.type !== 'forfeit')
      .map((c) => c.type),
    expected: ['interrupt'],
  });
  assert({
    given: 'a bot actor represented in the viewer projection',
    should: 'never create human control intents for that service seat',
    actual: roundControlIntents(
      cx,
      neg.actorId,
      Date.parse(at(startOf(1) + 1000)),
    ),
    expected: [],
  });
});
