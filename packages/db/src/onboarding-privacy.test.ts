import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AuthorizationTransaction } from './authorization';
import { onboardingPrivacyAdopter } from './onboarding-privacy';

setupRitewayBun();
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };

function scripted(responses: unknown[][]) {
  const remaining = [...responses];
  const queries: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (statement: SQL) => {
      queries.push(dialect.sqlToQuery(statement));
      return remaining.shift() ?? [];
    },
  } as unknown as AuthorizationTransaction;
  return { tx, queries };
}

test('optional answers are personal/private, exported to and erased with their subject (DEC-106)', async () => {
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
  const answers = onboardingPrivacyAdopter.fields.filter(
    ({ category }) => category === 'personal',
  );
  assert({
    given: 'a member’s interests, topics and single-choice answers',
    should:
      'export each table bound to the subject, delete all three for that subject, and classify every answer personal/private under contract for the account’s life',
    actual: [
      Object.keys(own),
      exported.queries.every(({ params }) => params[0] === subject.userId),
      erased.queries.map(
        ({ sql: text }) => /^delete from "([a-z_]+)"/.exec(text)?.[1],
      ),
      erased.queries.every(({ params }) => params[0] === subject.userId),
      answers.map(({ table, column }) => `${table}.${column}`),
      answers.every(
        (field) =>
          field.visibility === 'private' &&
          field.lawfulBasis.status === 'approved' &&
          field.retention.status === 'approved' &&
          field.erasure === 'delete' &&
          field.exportable,
      ),
    ],
    expected: [
      ['member_interests', 'member_topics', 'member_onboarding'],
      true,
      ['member_interests', 'member_topics', 'member_onboarding'],
      true,
      [
        'member_interests.interest',
        'member_topics.topic',
        'member_onboarding.club',
        'member_onboarding.experience',
        'member_onboarding.formats',
      ],
      true,
    ],
  });
});
