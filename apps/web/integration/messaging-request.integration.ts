import { openMessagingFixture } from './messaging-fixture.test-support';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { requestMessagingDm } from '../src/features/messaging/request';
import { messagingSocialAuthorizationFence } from '../src/features/messaging/social-authorization';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('canonical prospective authorization creates one pending DM and enforces durable actor request limits', async () => {
  const {
    client: client,
    database: db,
    fixture,
    principal,
  } = await openMessagingFixture(databaseUrl);
  let now = fixture.now;
  const clock = { now: () => now };
  const deps = {
    policyRevision: 1,
    clock,
    ids: { next: () => fixture.channelId },
    bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
    limits: {
      windowMs: 86400000,
      maxNewPairs: 10,
      maxPending: 20,
      cooldownMs: 604800000,
    },
    limit: async () => {},
    store: db.messagingSocialStore(
      messagingSocialAuthorizationFence({
        principal,
        clock,
        operation: {
          kind: 'dm',
          policy: {
            state: 'approved',
            decision: 'Explicit fixture only',
            key: 'social.dm',
            revision: 1,
            allowedBandPairs: [['adult', 'adult']],
          },
        },
      }),
    ),
  };
  const command = {
    version: 1,
    requestId: createId(),
    recipientActorId: fixture.otherActorId,
    introduction: 'An introduction',
  };
  try {
    await client.unsafe('delete from messaging_channels where id=$1', [
      fixture.channelId,
    ]);
    const requests = await Promise.all([
      requestMessagingDm(command, principal, deps),
      requestMessagingDm(command, principal, deps),
    ]);
    const [counts] = await client.unsafe(
      `select (select count(*)::int from messaging_dm_pairs where channel_id=$1) as pairs,(select count(*)::int from messaging_messages where channel_id=$1) as messages,(select count(*)::int from messaging_social_commands where actor_id=$2) as receipts`,
      [fixture.channelId, fixture.actorId],
    );
    assert({
      given: 'concurrent equal eligible requests without a friendship producer',
      should:
        'create one text-only pending relationship and no ordinary message grant',
      actual: { requests, counts },
      expected: {
        requests: [
          { channelId: fixture.channelId, state: 'pending' },
          { channelId: fixture.channelId, state: 'pending' },
        ],
        counts: { pairs: 1, messages: 0, receipts: 1 },
      },
    });
    await assertRejects({
      given: 'an introduction mismatch under the same key',
      should: 'refuse without replacing the pending introduction',
      actual: () =>
        requestMessagingDm(
          { ...command, introduction: 'Changed' },
          principal,
          deps,
        ),
      code: 'CONFLICT',
    });
    const extra = await openMessagingFixture(databaseUrl);
    const extraChannel = createId();
    const [extraLow, extraHigh] = [
      fixture.actorId,
      extra.fixture.actorId,
    ].sort();
    try {
      await assertRejects({
        given:
          'an actor at the injected durable pending limit requesting a new pair',
        should: 'refuse and roll back the absent-pair fence',
        actual: () =>
          requestMessagingDm(
            {
              ...command,
              requestId: createId(),
              recipientActorId: extra.fixture.actorId,
            },
            principal,
            {
              ...deps,
              ids: { next: () => extraChannel },
              limits: { ...deps.limits, maxPending: 1 },
            },
          ),
        code: 'RATE_LIMIT',
      });
      const [count] = await client.unsafe(
        'select count(*)::int as pairs from messaging_contact_pairs where low_actor_id=$1 and high_actor_id=$2',
        [extraLow, extraHigh],
      );
      assert({
        given: 'a refused new pair at the pending boundary',
        should: 'leave no materialized contact association',
        actual: count.pairs,
        expected: 0,
      });
    } finally {
      await client.unsafe('delete from messaging_channels where id=$1', [
        extraChannel,
      ]);
      await client.unsafe(
        'delete from messaging_contact_pairs where low_actor_id=$1 and high_actor_id=$2',
        [extraLow, extraHigh],
      );
      await extra.fixture.cleanup();
      await extra.database.close();
      await extra.client.close();
    }
    await client.unsafe(
      "update messaging_dm_pairs set request_state='declined',decided_at=$2 where channel_id=$1",
      [fixture.channelId, fixture.now],
    );
    now = new Date(Date.parse(fixture.now) + 999).toISOString();
    const renewal = { ...command, requestId: createId() };
    const renewalDeps = {
      ...deps,
      limits: { ...deps.limits, cooldownMs: 1000 },
    };
    await assertRejects({
      given: 'a renewal one millisecond before the injected cooldown',
      should: 'refuse without renewing introduction or authority',
      actual: () => requestMessagingDm(renewal, principal, renewalDeps),
      code: 'RATE_LIMIT',
    });
    now = new Date(Date.parse(fixture.now) + 1000).toISOString();
    const renewed = await requestMessagingDm(renewal, principal, renewalDeps);
    assert({
      given: 'the exact injected cooldown boundary',
      should: 'renew explicitly on the same canonical pair and channel',
      actual: renewed,
      expected: { channelId: fixture.channelId, state: 'pending' },
    });
    await client.unsafe(
      'update messaging_contact_pairs set low_blocks_high=true,revision=revision+1 where low_actor_id=$1 and high_actor_id=$2',
      [fixture.low, fixture.high],
    );
    await assertRejects({
      given: 'a request replay after bilateral blocking',
      should: 'reauthorize before revealing the stored request channel',
      actual: () => requestMessagingDm(command, principal, deps),
      code: 'AUTHORIZATION',
    });
  } finally {
    await fixture.cleanup();
    await db.close();
    await client.close();
  }
});
