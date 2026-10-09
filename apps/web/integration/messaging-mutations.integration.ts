import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createDatabase } from '@daisy/db';
import { createMessagingTestFixture } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import {
  socialPolicyEvidence,
  type SocialContactPolicy,
} from '@daisy/auth/social-policy';
import type {
  AuthorizationCapability,
  AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import { messagingAuthorizationFence } from '../src/features/messaging/authorization-fence';
import { sendMessagingMessage } from '../src/features/messaging/send';
import { mutateMessagingMessage } from '../src/features/messaging/mutate';
setupRitewayBun();
const services = requireTestServices(process.env);

test('canonical message mutations serialize retries and scrub removed retry fingerprints', async () => {
  const connection = new SQL(services.databaseUrl);
  const fixture = await createMessagingTestFixture(connection);
  const db = createDatabase({
    url: services.databaseUrl,
    nextActorId: createId,
  });
  const author: AuthorizationPrincipal = {
    kind: 'user',
    actorId: fixture.actorId,
    userId: fixture.userId,
  };
  let now = fixture.now;
  const clock = { now: () => now };
  const posting: SocialContactPolicy = {
    state: 'approved',
    decision: 'Test injection only',
    key: 'social.dm',
    revision: 1,
    allowedBandPairs: [['adult', 'adult']],
  };
  const storeFor = (
    principal: AuthorizationPrincipal,
    capability: AuthorizationCapability,
  ) =>
    db.messagingChannelStore(
      messagingAuthorizationFence({
        principal,
        capability,
        clock,
        postingPolicy: posting,
        readingPolicy: (input) => ({
          ...socialPolicyEvidence(input.channel, input.accounts, input.now),
          allowed: true,
        }),
      }),
    );
  const dependencies = {
    bounds: { messageUnits: 100, pageItems: 10 },
    editWindowMs: 60000,
    clock,
    limit: async () => {},
    store: storeFor(author, 'channel.post'),
  };
  const send = {
    version: 1,
    channelId: fixture.channelId,
    requestId: createId(),
    text: 'Original body',
  };
  const state = async () =>
    (
      await connection.unsafe(
        `select message_sequence::int as sequence,change_version::int as version,
    (select count(*)::int from messaging_receipts where channel_id=$1) as receipts,
    (select count(*)::int from outbox where payload->>'channelId'=$1) as bells from messaging_channels where id=$1`,
        [fixture.channelId],
      )
    )[0];
  try {
    const message = await sendMessagingMessage(send, author, {
      ...dependencies,
      ids: { next: createId },
    });
    const edit = {
      version: 1,
      channelId: fixture.channelId,
      messageId: message.id,
      requestId: createId(),
      text: 'Edited body',
    };
    const edits = await Promise.all([
      mutateMessagingMessage('edit', edit, author, dependencies),
      mutateMessagingMessage('edit', edit, author, dependencies),
    ]);
    assert({
      given: 'concurrent identical author edits',
      should:
        'keep creation sequence and commit one new version, receipt and doorbell',
      actual: {
        versions: edits.map((item) => item.changeVersion),
        state: await state(),
      },
      expected: {
        versions: [2, 2],
        state: { sequence: 1, version: 2, receipts: 2, bells: 2 },
      },
    });
    const peer: AuthorizationPrincipal = {
      kind: 'user',
      actorId: fixture.otherActorId,
      userId: fixture.otherUserId,
    };
    await assertRejects({
      given: 'the entitled peer trying to edit another author',
      should: 'refuse despite valid channel posting authority',
      actual: () =>
        mutateMessagingMessage(
          'edit',
          { ...edit, requestId: createId() },
          peer,
          { ...dependencies, store: storeFor(peer, 'channel.post') },
        ),
      code: 'AUTHORIZATION',
    });
    const before = await state();
    await assertRejects({
      given: 'a different edit under the consumed request',
      should: 'conflict before another mutation',
      actual: () =>
        mutateMessagingMessage(
          'edit',
          { ...edit, text: 'Mismatch' },
          author,
          dependencies,
        ),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'a limiter wait crossing the author edit deadline',
      should: 'recheck the injected clock and refuse atomically',
      actual: () =>
        mutateMessagingMessage(
          'edit',
          { ...edit, requestId: createId() },
          author,
          {
            ...dependencies,
            limit: async () => {
              now = new Date(Date.parse(fixture.now) + 60000).toISOString();
            },
          },
        ),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'conflicting replay and expired edit',
      should: 'leave cursors, receipts and doorbells unchanged',
      actual: await state(),
      expected: before,
    });
    await connection.unsafe(
      'update messaging_contact_pairs set low_blocks_high=true,revision=revision+1 where low_actor_id=$1 and high_actor_id=$2',
      [fixture.low, fixture.high],
    );
    await connection.unsafe(
      "update messaging_channels set lifecycle='archived',authority_revision=authority_revision+1 where id=$1",
      [fixture.channelId],
    );
    await assertRejects({
      given: 'the entitled peer trying to remove another author after archival',
      should: 'refuse despite distinct retained-history removal authority',
      actual: () =>
        mutateMessagingMessage(
          'remove',
          {
            version: 1,
            channelId: fixture.channelId,
            messageId: message.id,
            requestId: createId(),
          },
          peer,
          { ...dependencies, store: storeFor(peer, 'channel.message.remove') },
        ),
      code: 'AUTHORIZATION',
    });
    const removalStore = storeFor(author, 'channel.message.remove');
    const remove = {
      version: 1,
      channelId: fixture.channelId,
      messageId: message.id,
      requestId: createId(),
    };
    const removed = await mutateMessagingMessage('remove', remove, author, {
      ...dependencies,
      store: removalStore,
    });
    const [stored] = await connection.unsafe(
      'select text,removed_at is not null as removed,(select count(*)::int from messaging_receipts where channel_id=$1 and payload_digest is not null) as fingerprints from messaging_messages where id=$2',
      [fixture.channelId, message.id],
    );
    assert({
      given:
        'own removal with retained history permission after blocking and archival',
      should:
        'scrub text and every associated retry fingerprint without changing creation order',
      actual: { sequence: removed.sequence, state: stored },
      expected: {
        sequence: 1,
        state: { text: null, removed: true, fingerprints: 0 },
      },
    });
    await assertRejects({
      given:
        'retry of a removed message through the current removal capability',
      should: 'report unavailable rather than recreate content',
      actual: () =>
        mutateMessagingMessage('remove', remove, author, {
          ...dependencies,
          store: removalStore,
        }),
      code: 'NOT_FOUND',
    });
  } finally {
    await fixture.cleanup();
    await db.close();
    await connection.close();
  }
});
