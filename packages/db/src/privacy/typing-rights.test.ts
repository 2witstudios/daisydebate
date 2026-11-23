import { assert, setupRitewayBun, test } from 'riteway/bun';
import { planPrivacyErasure } from './operations';

setupRitewayBun();
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const now = '2026-10-10T00:00:00.000Z';

test('typing erasure joins the canonical durable vendor intent planner', () => {
  const result = planPrivacyErasure(
    {
      subject,
      now: now,
      vendors: ['messaging-typing'],
      jobIds: ['j'.repeat(24)],
    },
    [],
  );
  assert({
    given: 'a configured typing store',
    should: 'retain a retryable user-bound intent without lease payload',
    actual: result.jobs[0],
    expected: {
      id: 'j'.repeat(24),
      vendor: 'messaging-typing',
      subjectRef: subject.userId,
      createdAt: now,
    },
  });
});
