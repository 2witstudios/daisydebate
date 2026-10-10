import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildRoomTopic, parseTopic } from './topics';
import { isPayloadStorableOnTopic } from './realtime-payloads';
setupRitewayBun();
const id = 'abcdefghijklmnopqrstuvwx';
test('Room doorbell binds exactly one room identity and carries no view content', () => {
  const topic = buildRoomTopic(id);
  const payload = { kind: 'room.changed', entityVersion: 1, ids: [id] };
  assert({
    given: 'matching, mismatched and content-bearing Room invalidations',
    should: 'store only the strict matching doorbell',
    actual: [
      parseTopic(topic),
      ...[
        payload,
        { ...payload, ids: ['zyxwvutsrqponmlkjihgfedc'] },
        { ...payload, title: 'Private title' },
      ].map((value) => isPayloadStorableOnTopic(topic, value)),
    ],
    expected: [{ family: 'room', roomId: id }, true, false, false],
  });
});
