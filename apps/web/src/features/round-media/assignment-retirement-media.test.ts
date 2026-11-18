import { assert, setupRitewayBun, test } from 'riteway/bun';
import { admissionRevoked, ownSeatRevoked } from './projection';
setupRitewayBun();
const retiredId = 'j'.repeat(24);
test('a retired bound identity revokes its signed old-room authority', () => {
  assert({
    given:
      'an issued binding whose immutable identity is absent from the current assignment roster',
    should:
      'require ordinary room rotation and refuse that old identity, while an unbound departure creates no rotation obligation',
    actual: [
      admissionRevoked({
        participants: [],
        bindings: [{ roundParticipantId: retiredId }],
      }),
      ownSeatRevoked({ participants: [] }, retiredId),
      admissionRevoked({ participants: [], bindings: [] }),
    ],
    expected: [true, true, false],
  });
});
