import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  buildChannelTopic,
  isPayloadStorableOnTopic,
  outboxPayloadSchema,
} from '../index';
import { parseTopic } from '../topics';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const payload = { kind: 'channel.changed', channelId, changeVersion: 1 };

test('channel topics carry exactly one validated channel identifier', () => {
  assert({
    given: 'a channel identifier',
    should: 'round-trip through its own topic family',
    actual: parseTopic(buildChannelTopic(channelId)),
    expected: { family: 'channel', channelId },
  });
  for (const topic of [
    `channel:bad`,
    `channel:${channelId}:chat`,
    `channel:${channelId}:`,
    `channel:${channelId.toUpperCase()}`,
  ])
    assert({
      given: topic,
      should: 'refuse invalid channel topic shapes',
      actual: parseTopic(topic),
      expected: undefined,
    });
});

test('the channel topic stores no outbox row: its content is observed (ADR 0089)', () => {
  assert({
    given:
      'the retired channel doorbell and a Round doorbell on a channel topic',
    should: 'refuse both: the channel topic carries only typing hints',
    actual: [
      outboxPayloadSchema.safeParse(payload).success,
      isPayloadStorableOnTopic(`channel:${channelId}`, payload),
      isPayloadStorableOnTopic(`channel:${channelId}`, {
        kind: 'round.phase-changed',
        entityVersion: 1,
        ids: [channelId],
      }),
    ],
    expected: [false, false, false],
  });
});

test('messaging inbox invalidation carries only its owner and contains no private association', () => {
  const actorId = 'a'.repeat(24);
  const payload = { kind: 'messaging.inbox.changed' };
  assert({
    given: 'an owner-only content-free messaging bell',
    should:
      'be storable only on owner inbox family and reject channel/content fields',
    actual: [
      isPayloadStorableOnTopic(`user:${actorId}:inbox`, payload),
      isPayloadStorableOnTopic(`user:${'b'.repeat(24)}:inbox`, payload),
      isPayloadStorableOnTopic(`channel:${actorId}`, payload),
      isPayloadStorableOnTopic(`user:${actorId}:inbox`, {
        ...payload,
        channelId: 'c'.repeat(24),
      }),
    ],
    expected: [true, true, false, false],
  });
});
