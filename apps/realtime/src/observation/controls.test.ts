import { assert, setupRitewayBun, test } from 'riteway/bun';
import { actorsFencedBy } from './controls';

setupRitewayBun();
const actor = 'a'.repeat(24),
  session = 's'.repeat(24),
  room = 'r'.repeat(24);
test('session revocations fence their actor; nothing else does', () => {
  assert({
    given:
      'two revocations of one actor, a content doorbell and a malformed row',
    should: 'fence that actor once',
    actual: actorsFencedBy([
      {
        payload: {
          kind: 'session.revoked',
          ids: [actor, session],
          entityVersion: 1,
        },
      },
      { payload: { kind: 'session.revoked', ids: [actor], entityVersion: 2 } },
      { payload: { kind: 'room.changed', ids: [room], entityVersion: 1 } },
      { payload: { kind: 'session.revoked' } },
    ]),
    expected: [actor],
  });
});
