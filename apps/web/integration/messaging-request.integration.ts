import { openMessagingFixture } from './messaging-fixture.test-support';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { messagingTestReading } from '@daisy/auth/testing';
import { requestMessagingDm } from '../src/features/messaging/request';
import { messageOfferFor } from '../src/features/messaging/request-offer';
import { messagingCreationFence } from '../src/features/messaging/creation-authorization';
import { dec251ContactsPolicy } from '../src/features/contacts/request-policy';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

type Opened = Awaited<ReturnType<typeof openMessagingFixture>>;
/** DM request dependencies over the fixture's real store and canonical fence. */
const requestDeps = (
  { database: db, fixture, principal }: Opened,
  clock: { readonly now: () => string },
  limit: (actorId: string) => Promise<void> = async () => {},
) => ({
  policyRevision: 1,
  clock,
  ids: { next: () => fixture.channelId },
  bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
  limits: dec251ContactsPolicy.requests,
  limit,
  store: db.messagingSocialStore(
    messagingCreationFence({
      principal,
      clock,
      readingPolicy: messagingTestReading,
      operation: {
        kind: 'dm',
        policy: {
          state: 'approved',
          decision: 'Explicit fixture only',
          key: 'social.dm',
          revision: 1,
          earlierRevisions: [],
        },
      },
    }),
  ),
});

test('canonical prospective authorization creates one pending DM and enforces durable actor request limits', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const { client: client, database: db, fixture, principal } = opened;
  let now = fixture.now;
  const clock = { now: () => now };
  const deps = requestDeps(opened, clock);
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
          'an actor who has spent the injected daily request budget asking a new pair',
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
              limits: { ...deps.limits, daily: 1 },
            },
          ),
        code: 'RATE_LIMIT',
      });
      const [count] = await client.unsafe(
        'select count(*)::int as pairs from contact_pairs where low_actor_id=$1 and high_actor_id=$2',
        [extraLow, extraHigh],
      );
      assert({
        given: 'a refused new pair at the daily boundary',
        should: 'leave no materialized contact association',
        actual: count.pairs,
        expected: 0,
      });
    } finally {
      await client.unsafe('delete from messaging_channels where id=$1', [
        extraChannel,
      ]);
      await client.unsafe(
        'delete from contact_pairs where low_actor_id=$1 and high_actor_id=$2',
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
    now = new Date(Date.parse(fixture.now) + 1000).toISOString();
    const renewal = { ...command, requestId: createId() };
    const renewed = await requestMessagingDm(renewal, principal, deps);
    assert({
      given: 'a declined request asked again inside the day budget',
      should: 'renew explicitly on the same canonical pair and channel',
      actual: renewed,
      expected: { channelId: fixture.channelId, state: 'pending' },
    });
    await client.unsafe(
      'update contact_pairs set low_blocks_high=true,revision=revision+1 where low_actor_id=$1 and high_actor_id=$2',
      [fixture.low, fixture.high],
    );
    await assertRejects({
      given: 'a request replay after bilateral blocking',
      should:
        'reauthorize before revealing the stored request channel, refusing as an unknown recipient is (DEC-251)',
      actual: () => requestMessagingDm(command, principal, deps),
      code: 'NOT_FOUND',
    });
  } finally {
    await fixture.cleanup();
    await db.close();
    await client.close();
  }
});

test('a decline block refuses a new DM request before the limiter, yet an existing DM still converges (DEC-251)', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const { client, database: db, fixture, principal } = opened;
  const clock = { now: () => fixture.now };
  const spends: string[] = [];
  const deps = requestDeps(opened, clock, async (actorId) => {
    spends.push(actorId);
  });
  const ask = () =>
    requestMessagingDm(
      {
        version: 1,
        requestId: createId(),
        recipientActorId: fixture.otherActorId,
        introduction: 'Hello again',
      },
      principal,
      deps,
    );
  const [low, high] = [fixture.actorId, fixture.otherActorId].sort();
  try {
    await client.unsafe(
      "insert into social_request_declines(decliner_actor_id,requester_actor_id,low_actor_id,high_actor_id,declined_count,last_declined_at,blocked_until,expires_at) values($1,$2,$3,$4,0,$5,greatest($5::timestamptz, statement_timestamp()) + interval '1 day',greatest($5::timestamptz, statement_timestamp()) + interval '1 day')",
      [fixture.otherActorId, fixture.actorId, low, high, fixture.now],
    );
    const converged = await ask();
    const existingOffer = await messageOfferFor(
      { database: db, clock },
      principal,
      fixture.otherUserId,
    );
    await client.unsafe('delete from messaging_channels where id=$1', [
      fixture.channelId,
    ]);
    const blockedOffer = await messageOfferFor(
      { database: db, clock },
      principal,
      fixture.otherUserId,
    );
    const reverseOffer = await messageOfferFor(
      { database: db, clock },
      {
        kind: 'user',
        userId: fixture.otherUserId,
        actorId: fixture.otherActorId,
      },
      fixture.userId,
    );
    await client.unsafe(
      "update social_request_declines set blocked_until=statement_timestamp() - interval '1 second' where decliner_actor_id=$1 and requester_actor_id=$2",
      [fixture.otherActorId, fixture.actorId],
    );
    const expiredOffer = await messageOfferFor(
      { database: db, clock },
      principal,
      fixture.otherUserId,
    );
    await client.unsafe(
      'update social_request_declines set blocked_until=expires_at where decliner_actor_id=$1 and requester_actor_id=$2',
      [fixture.otherActorId, fixture.actorId],
    );
    await assertRejects({
      given: 'the decline-blocked requester asking once the DM is gone',
      should: 'refuse the new request as an unknown recipient is',
      actual: ask,
      code: 'NOT_FOUND',
    });
    const [pairs] = await client.unsafe(
      'select count(*)::int as n from messaging_dm_pairs where low_actor_id=$1 and high_actor_id=$2',
      [low, high],
    );
    assert({
      given:
        'a requester decline-blocked by the recipient, asking first while their accepted DM exists, then after it is gone',
      should:
        'converge on the accepted DM, then spend the limiter for neither request and write no pair',
      actual: {
        converged,
        existingOffer,
        blockedOffer,
        reverseOffer,
        expiredOffer,
        spends,
        pairs: pairs.n,
      },
      expected: {
        converged: { channelId: fixture.channelId, state: 'accepted' },
        existingOffer: 'message',
        blockedOffer: 'none',
        reverseOffer: 'message',
        expiredOffer: 'message',
        spends: [],
        pairs: 0,
      },
    });
    // The application clock is still before this deadline. PostgreSQL has
    // already crossed it, and the request and offer must agree.
    await client.unsafe(
      "update social_request_declines set blocked_until=statement_timestamp() - interval '1 second' where decliner_actor_id=$1 and requester_actor_id=$2",
      [fixture.otherActorId, fixture.actorId],
    );
    const afterExpiry = await ask();
    const [budget] = await client.unsafe(
      "select count(*)::int as n from social_requests where actor_id=$1 and kind='dm'",
      [fixture.actorId],
    );
    assert({
      given:
        'a decline block expired at the database instant but active at the earlier application instant',
      should:
        'allow the offered request to create one pending DM and spend once',
      actual: { afterExpiry, spends, budget: budget.n },
      expected: {
        afterExpiry: { channelId: fixture.channelId, state: 'pending' },
        spends: [fixture.actorId],
        budget: 1,
      },
    });
  } finally {
    await fixture.cleanup();
    await db.close();
    await client.close();
  }
});

test('only active declined or cancelled DMs can offer a new request', async () => {
  const opened = await openMessagingFixture(databaseUrl);
  const { client, database, fixture, principal } = opened;
  const clock = { now: () => fixture.now };
  const offer = () =>
    messageOfferFor({ database, clock }, principal, fixture.otherUserId);
  const ask = () =>
    requestMessagingDm(
      {
        version: 1,
        requestId: createId(),
        recipientActorId: fixture.otherActorId,
      },
      principal,
      requestDeps(opened, clock),
    );
  try {
    for (const state of ['declined', 'cancelled']) {
      await client.unsafe(
        'update messaging_dm_pairs set request_state=$2,decided_at=requested_at where channel_id=$1',
        [fixture.channelId, state],
      );
      await client.unsafe(
        "update messaging_channels set lifecycle='archived' where id=$1",
        [fixture.channelId],
      );
      const archived = await offer();
      await assertRejects({
        given: `a ${state} DM with an archived channel`,
        should: 'mask the refusal as an unknown recipient',
        actual: ask,
        code: 'NOT_FOUND',
      });
      await client.unsafe(
        "update messaging_channels set lifecycle='active' where id=$1",
        [fixture.channelId],
      );
      const active = await offer();
      assert({
        given: `a ${state} DM with an archived or active channel`,
        should: 'offer a new message only when the channel can reopen',
        actual: { archived, active },
        expected: { archived: 'none', active: 'message' },
      });
    }
  } finally {
    await fixture.cleanup();
    await database.close();
    await client.close();
  }
});
