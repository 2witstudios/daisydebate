import { assert, setupRitewayBun, test } from 'riteway/bun';
import { chainBadge } from './badge';

setupRitewayBun();
test('chainBadge', () => {
  assert({
    given: 'each verifier verdict',
    should: 'claim exactly what was proven',
    actual: [
      chainBadge({ status: 'consistent', first: 1, last: 9 }),
      chainBadge({ status: 'empty' }),
      chainBadge({ status: 'broken', seq: 4, reason: 'hash' }),
      chainBadge({ status: 'truncated', expectedSeq: 12 }),
    ],
    expected: [
      { text: 'Chain consistent (seq 1–9)', ok: true },
      { text: 'No audit events yet', ok: true },
      { text: 'Chain broken at seq 4 (hash)', ok: false },
      { text: 'Chain truncated: seq 12 is missing', ok: false },
    ],
  });
});
