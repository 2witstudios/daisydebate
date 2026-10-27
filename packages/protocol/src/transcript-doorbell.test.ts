import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildDebateTopic } from './topics';
import { isPayloadStorableOnTopic } from './realtime-payloads';
setupRitewayBun();
test('transcript invalidation carries only its Round and independent revision', () => {
  const id = 'r'.repeat(24);
  const payload = {
    kind: 'debate.transcript-changed',
    entityVersion: 2,
    ids: [id],
  };
  assert({
    given:
      'a transcript doorbell, a content-bearing doorbell and a foreign topic',
    should: 'admit only the content-free Round invalidation',
    actual: [
      isPayloadStorableOnTopic(buildDebateTopic(id), payload),
      isPayloadStorableOnTopic(buildDebateTopic(id), {
        ...payload,
        text: 'Private speech',
      }),
      isPayloadStorableOnTopic(`user:${id}:inbox`, payload),
    ],
    expected: [true, false, false],
  });
});
