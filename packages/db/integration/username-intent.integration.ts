import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { actorOperations } from '../src/actor-operations';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('public username intent follows verified human binding and account erasure', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { userId, actorId } = await createAuthorizationSubject(fixture);
    const database = createDatabase({
      url: databaseUrl,
      client: fixture.sql,
      nextActorId: createId,
    });
    const statements: string[] = [];
    const actor = actorOperations({
      database: drizzle({
        client: fixture.sql,
        logger: { logQuery: (query) => statements.push(query) },
      }),
    });
    await assertRejects({
      given: 'a username with a non-ASCII character',
      should: 'reject it before persistence',
      actual: () => actor.lookupHumanActorByUsername('Kelvin'),
      code: 'VALIDATION',
    });
    assert({
      given: 'validation refusal',
      should: 'send no SQL',
      actual: statements,
      expected: [],
    });
    const binding = [
      await actor.getActiveHumanUserIdByActorId(actorId),
      await actor.getActiveHumanUserIdByActorId(createId()),
    ];
    const actual = [
      await database.lookupHumanActorByUsername(` ${userId.toUpperCase()} `),
      await database.lookupHumanActorByUsername(createId()),
    ];
    await fixture.sql`update users set email_verified=false,version=version+1 where id=${userId}`;
    actual.push(await database.lookupHumanActorByUsername(userId));
    await fixture.sql`update users set email_verified=true,version=version+1 where id=${userId}`;
    await fixture.sql`update actors set kind='bot',version=version+1 where id=${actorId}`;
    actual.push(await database.lookupHumanActorByUsername(userId));
    await fixture.sql`update actors set kind='human',version=version+1 where id=${actorId}`;
    await fixture.sql`update users set email_verified=false,deleted_at='2026-10-09T00:00:00Z',version=version+1 where id=${userId}`;
    actual.push(await database.lookupHumanActorByUsername(userId));
    binding.push(await actor.getActiveHumanUserIdByActorId(actorId));
    assert({
      given:
        'normalized discovery, absence, unverified email, bot binding and erasure',
      should:
        'return only the initially live human identifier and then refuse each unavailable intent',
      actual: [actual, binding],
      expected: [
        [actorId, null, null, null, null],
        [userId, null, null],
      ],
    });
  });
});
