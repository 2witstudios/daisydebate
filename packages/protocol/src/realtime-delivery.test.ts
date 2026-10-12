import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isPayloadDeliverableOnTopic } from './realtime-payloads';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const other = 'm8q3w1z7c5n6b4d2k2v9x0f4';

test('delivery preserves topic identity and never forwards inbox control rows', () => {
  const room = { kind: 'room.changed', ids: [id], entityVersion: 3 };
  assert({
    given:
      'valid Room and channel doorbells, mismatched identities and an unknown payload field',
    should: 'deliver only validated matching entity doorbells',
    actual: [
      isPayloadDeliverableOnTopic(`room:${id}`, room),
      isPayloadDeliverableOnTopic(`room:${other}`, room),
      isPayloadDeliverableOnTopic(`room:${id}`, { ...room, title: 'private' }),
      isPayloadDeliverableOnTopic(`channel:${id}`, {
        kind: 'channel.changed',
        channelId: id,
        changeVersion: 3,
      }),
      isPayloadDeliverableOnTopic(`channel:${other}`, {
        kind: 'channel.changed',
        channelId: id,
        changeVersion: 3,
      }),
    ],
    expected: [true, false, false, true, false],
  });
  assert({
    given: 'three valid durable inbox control kinds',
    should: 'keep control handling internal and deliver none of them',
    actual: [
      'session.revoked',
      'access.revoked',
      'actor.presence-preference-changed',
    ].map((kind) =>
      isPayloadDeliverableOnTopic(`user:${id}:inbox`, {
        kind,
        ids: kind === 'access.revoked' ? [id, other] : [id],
        entityVersion: 3,
      }),
    ),
    expected: [false, false, false],
  });
});
