import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  buildChannelTopic,
  isPayloadStorableOnTopic,
  outboxPayloadSchema,
} from '../index';
import { parseTopic } from '../topics';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const otherId = 'o'.repeat(24);
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

test('channel activity is a content-free, topic-bound doorbell', () => {
  for (const [patch, expected] of [
    [{}, true],
    [{ changeVersion: 0 }, false],
    [{ changeVersion: 1.5 }, false],
    [{ changeVersion: Number.MAX_SAFE_INTEGER + 1 }, false],
    [{ channelId: 'bad' }, false],
    [{ text: 'private' }, false],
    [{ authorActorId: otherId }, false],
    [{ filename: 'private.pdf' }, false],
    [{ ids: [channelId] }, false],
  ] as const)
    assert({
      given: JSON.stringify(patch),
      should: 'accept only channel ID and safe positive change version',
      actual: outboxPayloadSchema.safeParse({ ...payload, ...patch }).success,
      expected,
    });
  for (const [topic, body, expected] of [
    [`channel:${channelId}`, payload, true],
    [`channel:${otherId}`, payload, false],
    [`debate:${channelId}`, payload, false],
    [`user:${channelId}:inbox`, payload, false],
    [
      `channel:${channelId}`,
      { kind: 'debate.phase-changed', entityVersion: 1, ids: [channelId] },
      false,
    ],
  ] as const)
    assert({
      given: topic,
      should: 'bind stored kind and channel identity to the parsed topic',
      actual: isPayloadStorableOnTopic(topic, body),
      expected,
    });
});
