import { createId } from '@paralleldrive/cuid2';
import { assertRejects } from '@daisy/errors/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

test('a statement that cannot get its lock in time is retryable overload, not an internal failure', async () => {
  await withFixture(url, async (fixture) => {
    const userId = await fixture.user();
    await fixture.actor(userId);
    const database = createDatabase({ url, nextActorId: createId });
    try {
      // Another session holds the table past the runtime 200 ms lock_timeout.
      await fixture.sql.begin(async (holder) => {
        await holder`lock table actors in access exclusive mode`;
        await assertRejects({
          given: 'a read whose lock wait exceeds lock_timeout (55P03)',
          should: 'refuse it as INFRASTRUCTURE, a retryable 503',
          actual: () => database.getActorByUserId(userId),
          code: 'INFRASTRUCTURE',
        });
      });
    } finally {
      await database.close();
    }
  });
});
