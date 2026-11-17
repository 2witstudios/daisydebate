import { assert, setupRitewayBun, test } from 'riteway/bun';
import { timeLeft } from './held-until';

setupRitewayBun();

test('how long a held seat has left', () => {
  const now = '2026-11-16T10:00:00.000Z';
  assert({
    given:
      'an invitation ending in five hours, in forty minutes, and in seconds',
    should: 'say hours, then minutes, then under a minute',
    actual: [
      timeLeft('2026-11-16T15:00:00.000Z', now),
      timeLeft('2026-11-16T10:40:00.000Z', now),
      timeLeft('2026-11-16T10:00:30.000Z', now),
    ],
    expected: ['5 h left', '40 min left', 'under a minute left'],
  });
});
