import { assert, setupRitewayBun, test } from 'riteway/bun';
import { chainBadge } from './badge';

setupRitewayBun();
test('chainBadge', () => {
  assert({
    given:
      'each verifier verdict and the anchors the participant app acknowledged',
    should: 'claim exactly what was proven',
    actual: [
      chainBadge({ status: 'consistent', first: 1, last: 9 }, 3),
      chainBadge({ status: 'consistent', first: 1, last: 2 }, 1),
      chainBadge({ status: 'empty' }, 0),
      chainBadge({ status: 'broken', seq: 4, reason: 'hash' }, 3),
      chainBadge({ status: 'truncated', expectedSeq: 12 }, 3),
    ],
    expected: [
      { text: 'Chain consistent (seq 1–9); 3 anchors sent', ok: true },
      { text: 'Chain consistent (seq 1–2); 1 anchor sent', ok: true },
      { text: 'No audit events yet', ok: true },
      { text: 'Chain broken at seq 4 (hash)', ok: false },
      { text: 'Chain truncated: seq 12 is missing', ok: false },
    ],
  });
});
