import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isPayloadDeliverableOnTopic } from './realtime-payloads';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const other = 'm8q3w1z7c5n6b4d2k2v9x0f4';

test('delivery preserves topic identity and never forwards inbox control rows', () => {
  const room = { kind: 'room.changed', ids: [id], entityVersion: 3 };
  assert({
    given:
      'a valid Room doorbell, mismatched identities, an unknown payload field and the retired channel doorbell',
    should:
      'deliver only validated matching entity doorbells; channel content is observed, never rung (ADR 0089)',
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
    expected: [true, false, false, false, false],
  });
  assert({
    given: 'three valid durable inbox control kinds and one notification delta',
    should: 'deliver only the notification and keep control handling internal',
    actual: [
      'session.revoked',
      'access.revoked',
      'actor.presence-preference-changed',
    ]
      .map((kind) =>
        isPayloadDeliverableOnTopic(`user:${id}:inbox`, {
          kind,
          ids: kind === 'access.revoked' ? [id, other] : [id],
          entityVersion: 3,
        }),
      )
      .concat(
        isPayloadDeliverableOnTopic(`user:${id}:inbox`, {
          kind: 'user.notification-delivered',
          ids: [id],
          entityVersion: 3,
          notificationType: 'test',
          occurredAt: '2026-10-09T00:00:00.000Z',
        }),
      ),
    expected: [false, false, false, true],
  });
});
