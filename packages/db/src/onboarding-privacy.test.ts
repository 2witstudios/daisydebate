import { assert, setupRitewayBun, test } from 'riteway/bun';
import { scriptedTransaction } from './scripted-transaction.test-support';
import { onboardingPrivacyAdopter } from './onboarding-privacy';

setupRitewayBun();
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };

const scripted = (responses: unknown[][]) =>
  scriptedTransaction(responses, () => []);

test('optional answers are exported to and erased with their subject (DEC-106)', async () => {
  const exported = scripted([
    [{ user_id: subject.userId, interest: 'watch' }],
    [{ user_id: subject.userId, topic: 'law' }],
    [{ user_id: subject.userId, club: 'own' }],
  ]);
  const erased = scripted([]);
  const own = await onboardingPrivacyAdopter.export(exported.tx, subject);
  await onboardingPrivacyAdopter.erase(erased.tx, subject, {
    now: '2026-10-26T00:00:00.000Z',
  });
  assert({
    given: 'a member’s interests, topics and single-choice answers',
    should:
      'export each table bound to the subject and delete all three for that subject',
    actual: [
      Object.keys(own),
      exported.queries.every(({ params }) => params[0] === subject.userId),
      erased.queries.map(
        ({ sql: text }) => /^delete from "([a-z_]+)"/.exec(text)?.[1],
      ),
      erased.queries.every(({ params }) => params[0] === subject.userId),
    ],
    expected: [
      ['member_interests', 'member_topics', 'member_onboarding'],
      true,
      ['member_interests', 'member_topics', 'member_onboarding'],
      true,
    ],
  });
});
