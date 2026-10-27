import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { setupRitewayBun, test } from 'riteway/bun';
import { lockMediaRound } from './media-session-authority';
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
