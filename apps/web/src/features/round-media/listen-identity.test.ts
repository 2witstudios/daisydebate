import { idSchema } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { listenIdentity } from './listen-identity';

setupRitewayBun();

test('a bot seat listens under one identity derived from its own', () => {
  const seat = 'a'.repeat(24),
    other = 'b'.repeat(24);
  assert({
    given: 'two grants for one seat and one for another seat',
    should:
      'name the same valid participant twice, distinct from both seat identities and from the other seat',
    actual: {
      stable: listenIdentity(seat) === listenIdentity(seat),
      valid: idSchema.safeParse(listenIdentity(seat)).success,
      distinct: new Set([
        seat,
        other,
        listenIdentity(seat),
        listenIdentity(other),
      ]).size,
    },
    expected: { stable: true, valid: true, distinct: 4 },
  });
});
