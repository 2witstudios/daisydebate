import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingDmStore } from '../src/messaging/dm-store';
import { createMessagingTestFixture } from '../src/testing';
import { socialLimits } from './contact-pair-store.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('a DM preview and result use distinct current grants, and decisions require a matching observation', async () => {
  const client = new SQL(url);
  const fixture = await createMessagingTestFixture(client);
  const { userId, actorId, otherUserId, otherActorId, channelId, now } =
    fixture;
  const sender = { userId, actorId, channelId };
  const recipient = { userId: otherUserId, actorId: otherActorId, channelId };
  const intro = 'Private proof introduction';
  const request = { requestId: createId(), decision: 'accept' as const };
  const decision = {
    ...request,
    digest: 'd'.repeat(64),
    now,
    limits: socialLimits,
  };
  const statements: string[] = [];
  const modes: string[] = [];
  const db = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query.trim()) },
  });
  const store = createMessagingDmStore({
    database: db,
    authorize: (mode) => async () => {
      modes.push(mode);
    },
  });
  const denied = createMessagingDmStore({
    database: db,
    authorize: () => async () => {
      throw createAppError('AUTHORIZATION');
    },
  });
  try {
    await client`update messaging_dm_pairs set request_sender_actor_id=${actorId},request_state='pending',requested_at=${now},introduction=${intro},decided_at=null where channel_id=${channelId}`;
    const preview = await store.readRequest(recipient);
    const previewSteps = statements.splice(0);
    assert({
      given: 'the real pending request',
      should:
        'project only sender, introduction and request time behind shared fences',
      actual: [
        preview,
        modes.splice(0),
        previewSteps.some((query) =>
          query.includes('daisy_authorization_read_accounts_v2('),
        ),
        previewSteps.some((query) =>
          query.includes('daisy_messaging_channel_read_fence('),
        ),
        previewSteps.some((query) =>
          query.includes('daisy_messaging_channel_fence('),
        ),
      ],
      expected: [
        {
          channelId,
          senderActorId: actorId,
          introduction: intro,
          requestedAt: now,
        },
        ['read'],
        true,
        true,
        false,
      ],
    });
    await assertRejects({
      given: 'refused preview',
      should: 'refuse before protected request reads',
      actual: () => denied.readRequest(recipient),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'refused decision capability',
      should: 'refuse before reconstructing the receipt',
      actual: () =>
        denied.withChannel(recipient, (frame) =>
          frame.readDecisionState(request),
        ),
      code: 'AUTHORIZATION',
    });
    const deniedQueries = statements.splice(0);
    assert({
      given: 'both denied paths',
      should: 'read neither the introduction row nor receipt',
      actual: deniedQueries.some((query) =>
        /from "messaging_(dm_pairs|social_commands)"/.test(query),
      ),
      expected: false,
    });
    const agreed = await store.withChannel(recipient, async (frame) => {
      const refuse = (
        command:
          | typeof decision
          | (Omit<typeof decision, 'decision'> & { decision: 'decline' }),
      ) =>
        assertRejects({
          given: 'a blind, mismatched, or consumed decision observation',
          should: 'refuse the write',
          actual: () => frame.commitDecision(command),
          code: 'CONFLICT',
        });
      await refuse(decision);
      const state = await frame.readDecisionState(request);
      await refuse({ ...decision, decision: 'decline' });
      const accepted = await frame.commitDecision(decision);
      await refuse(decision);
      return [state, accepted, modes.splice(0)];
    });
    const own = await store.withChannel(recipient, (frame) =>
      frame.readDecisionState(request),
    );
    const foreign = await store.withChannel(sender, (frame) =>
      frame.readDecisionState(request),
    );
    const [committed] =
      await client`select result_channel_id,actor_id,counterpart_actor_id from messaging_social_commands where request_id=${request.requestId}`;
    const [bells] =
      await client`select count(*)::int as count from outbox where topic=${`channel:${channelId}`}`;
    assert({
      given: 'one accepted transition and two closed retry reads',
      should:
        'persist one counterpart-bound result and show the receipt only to its actor under result capability, with no channel doorbell',
      actual: [
        agreed,
        own.receipt,
        foreign.receipt,
        modes.splice(0),
        committed,
        bells?.count,
      ],
      expected: [
        [
          { channelId, state: 'pending', requestedAt: now, receipt: null },
          { channelId, state: 'accepted' },
          ['accept', 'accept'],
        ],
        { kind: 'dm.decide', digest: decision.digest, channelId },
        null,
        ['result', 'result'],
        {
          result_channel_id: channelId,
          actor_id: otherActorId,
          counterpart_actor_id: actorId,
        },
        0,
      ],
    });
    await client`delete from messaging_dm_pairs where channel_id=${channelId}`;
    await assertRejects({
      given: 'the channel without its stored request association',
      should: 'not reconstruct a preview from earlier discovery',
      actual: () => store.readRequest(recipient),
      code: 'NOT_FOUND',
    });
    assert({
      given: 'the absent request',
      should: 'never open its protected preview grant',
      actual: modes,
      expected: [],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
