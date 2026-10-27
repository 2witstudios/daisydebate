import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { lockMediaRound, unseatedRefusal } from './media-session-authority';
import { fakeSql } from './scripted-bun-wire';

setupRitewayBun();

for (const actorId of [undefined, 'a'.repeat(24)])
  test(`missing media Round with ${actorId ? 'human' : 'internal'} authority (ISSUE-505)`, async () => {
    const { client } = fakeSql([[], []]);
    await assertRejects({
      given: actorId
        ? 'a human requesting a nonexistent Round'
        : 'an internal producer requesting a nonexistent Round',
      should: actorId
        ? 'match the refusal for an existing unseated Round'
        : 'retain internal absence semantics',
      code: actorId ? 'AUTHORIZATION' : 'NOT_FOUND',
      actual: () =>
        lockMediaRound(drizzle({ client }), 'r'.repeat(24), actorId),
    });
  });

test('a human gets the same refusal for a missing Round as for an unseated one (ISSUE-505)', async () => {
  const { client } = fakeSql([[], []]);
  const refusal = await lockMediaRound(
    drizzle({ client }),
    'r'.repeat(24),
    'a'.repeat(24),
  ).then(
    () => null,
    (error: Error & { code?: string }) => [error.code, error.message],
  );
  const unseated = unseatedRefusal();
  assert({
    given: 'a human asking for a Round that does not exist',
    should: 'refuse with exactly the unseated refusal, code and message',
    actual: refusal,
    expected: [unseated.code, unseated.message],
  });
});
