import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { openMessagingFixture } from './messaging-fixture.test-support';
import { messagingSocialAuthorizationFence } from '../src/features/messaging/social-authorization';
import { blockMessagingContact } from '../src/features/messaging/block';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

for (const [blockFirst, noDm] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
] as const) {
  test(`safety erasure ${blockFirst ? 'block first' : 'erase first'} ${noDm ? 'absent DM' : 'existing DM'}`, async () => {
    const { client, database, fixture, principal } =
      await openMessagingFixture(databaseUrl);
    const clock = { now: () => fixture.now };
    const entered = gate(),
      release = gate();
    let first = blockFirst;
    const canonical = messagingSocialAuthorizationFence({
      principal,
      clock,
      operation: { kind: 'block' },
    });
    const store = database.messagingSocialStore(async (tx, input, facts) => {
      await canonical(tx, input, facts);
      if (first) {
        first = false;
        entered.resolve();
        await release.promise;
      }
    });
    const command = {
      version: 1,
      requestId: createId(),
      otherActorId: fixture.otherActorId,
      blocked: true,
    };
    const dependencies = {
      store,
      clock,
      bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
      limit: async () => {},
    };
    const erase = () => fixture.eraseSubject(fixture.otherActorId);
    let erasing: ReturnType<typeof erase> | undefined;
    try {
      if (noDm)
        await client.unsafe('delete from messaging_channels where id=$1', [
          fixture.channelId,
        ]);
      if (blockFirst) {
        const blocking = blockMessagingContact(
          command,
          principal,
          dependencies,
        );
        await entered.promise;
        const probe = new SQL(databaseUrl, { max: 1 });
        try {
          let lockRefusal: string | null = null;
          try {
            await probe.unsafe('begin');
            await probe.unsafe(
              'select id from users where id=$1 for update nowait',
              [fixture.otherUserId],
            );
          } catch (error) {
            lockRefusal = (error as { errno?: string }).errno ?? 'unknown';
          } finally {
            await probe.unsafe('rollback');
          }
          assert({
            given: 'block owns the sorted account fence before erasure',
            should: 'prevent another transaction from locking the peer account',
            actual: lockRefusal,
            expected: '55P03',
          });
        } finally {
          await probe.close();
        }
        erasing = erase();
        release.resolve();
        await blocking;
        await erasing;
      } else {
        await erase();
        await assertRejects({
          given:
            'peer erasure committed before a new block materializes its absent pair',
          should:
            'deny through canonical current counterparts and roll back the default association',
          actual: () => blockMessagingContact(command, principal, dependencies),
          code: 'AUTHORIZATION',
        });
      }
      const [state] = await client.unsafe(
        `select (select count(*)::int from messaging_contact_pairs where low_actor_id=$1 and high_actor_id=$2) as pairs,(select count(*)::int from messaging_social_commands where actor_id=$3) as commands`,
        [fixture.low, fixture.high, fixture.actorId],
      );
      assert({
        given: `${blockFirst ? 'block first' : 'erasure first'} with ${noDm ? 'no DM' : 'an existing DM'}`,
        should:
          'leave no contact pair or peer-associated command after erasure',
        actual: state,
        expected: { pairs: 0, commands: 0 },
      });
    } finally {
      release.resolve();
      await erasing?.catch(() => {});
      await fixture.cleanup();
      await database.close();
      await client.close();
    }
  });
}
