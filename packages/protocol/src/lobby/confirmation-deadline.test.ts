import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  confirmationDeadline,
  TAB_CONFIRMATION_VALIDITY_MS,
} from './confirmation-deadline';
setupRitewayBun();

test('Tab confirmation deadline comes only from the authoritative UTC issue instant', () => {
  const issuedAt = '2026-11-16T00:00:00.000Z';
  assert({
    given: 'the same server issuance instant, even when a caller retries later',
    should:
      'derive one fixed five-minute deadline and refuse invalid/non-UTC input',
    actual: [
      TAB_CONFIRMATION_VALIDITY_MS,
      confirmationDeadline(issuedAt),
      confirmationDeadline(issuedAt),
      confirmationDeadline('not-time'),
      confirmationDeadline('2026-11-16T00:00:00+01:00'),
    ],
    expected: [
      300_000,
      '2026-11-16T00:05:00.000Z',
      '2026-11-16T00:05:00.000Z',
      null,
      null,
    ],
  });
});
