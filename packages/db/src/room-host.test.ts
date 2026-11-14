import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { hostPersonOf } from './room-host';

setupRitewayBun();

describe('hostPersonOf', () => {
  test('returns the host of a hosted Room and refuses an event Room', () => {
    const refusal = (() => {
      try {
        return hostPersonOf({ id: 'room-1', hostActorId: null });
      } catch (error) {
        return isAppError(error) ? error.code : 'untyped';
      }
    })();
    assert({
      given: 'a Room with a host person, and a Room in a tournament lobby',
      should:
        'return the host, and refuse the hostless Room as an invariant breach',
      actual: [hostPersonOf({ id: 'room-1', hostActorId: 'actor-1' }), refusal],
      expected: ['actor-1', 'INVARIANT'],
    });
  });
});
