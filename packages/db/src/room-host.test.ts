import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { hostPersonOf } from './room-host';

setupRitewayBun();

const refusalOf = (read: () => unknown) => {
  try {
    return read();
  } catch (error) {
    return isAppError(error) ? error.code : 'untyped';
  }
};

describe('hostPersonOf', () => {
  test('reads a hosted Room, a hostless event Room, and refuses a mismatch', () => {
    assert({
      given:
        'a standing Room with a host, a tournament Room without one, a standing Room without one and a tournament Room with one',
      should:
        'return the host, return null for the event Room, and refuse both mismatches as invariant breaches',
      actual: [
        hostPersonOf({
          id: 'room-1',
          hostActorId: 'actor-1',
          lobbyKind: 'standing',
        }),
        hostPersonOf({
          id: 'room-2',
          hostActorId: null,
          lobbyKind: 'tournament',
        }),
        refusalOf(() =>
          hostPersonOf({
            id: 'room-3',
            hostActorId: null,
            lobbyKind: 'standing',
          }),
        ),
        refusalOf(() =>
          hostPersonOf({
            id: 'room-4',
            hostActorId: 'actor-1',
            lobbyKind: 'tournament',
          }),
        ),
      ],
      expected: ['actor-1', null, 'INVARIANT', 'INVARIANT'],
    });
  });
});
