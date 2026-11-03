import { assert, setupRitewayBun, test } from 'riteway/bun';
import { view } from '../../ui/debate-room/live-round.test-support';
import { roundMediaSlot } from './media-session';

setupRitewayBun();

test('another account gets another session', () => {
  const keyFor = (actorId: string) =>
    roundMediaSlot({ actorId } as Parameters<typeof roundMediaSlot>[0])(view)
      .key;
  assert({
    given: 'the same Round for two accounts, and twice for one',
    should: 'remount for the other account only',
    actual: [
      keyFor('actor-a') === keyFor('actor-b'),
      keyFor('actor-a') === keyFor('actor-a'),
    ],
    expected: [false, true],
  });
});
