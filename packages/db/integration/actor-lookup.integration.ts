import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('getActorByUserId (ACTOR-1): the realtime and web seam', () => {
  test('resolves the actor id and user id for an onboarded user', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const actorId = await fixture.actor(userId);
      const database = createDatabase({ url, nextActorId: createId });
      let found;
      try {
        found = await database.getActorByUserId(userId);
      } finally {
        await database.close();
      }
      assert({
        given: 'a user with a human actor',
        should: 'return exactly the id and user id columns, nothing else',
        actual: found,
        expected: { id: actorId, userId },
      });
    });
  });

  test('negative control: a user with no actor resolves to null', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const database = createDatabase({ url, nextActorId: createId });
      let found;
      try {
        found = await database.getActorByUserId(userId);
      } finally {
        await database.close();
      }
      assert({
        given: 'a user who has never claimed a username',
        should: 'return null rather than a partial or fabricated row',
        actual: found,
        expected: null,
      });
    });
  });
});
