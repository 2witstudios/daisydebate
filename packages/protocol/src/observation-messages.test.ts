import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  observationClientMessageSchema,
  observationServerMessageSchema,
} from './observation-messages';
setupRitewayBun();
test('snapshot protocol carries bounded replacements without replay positions', () => {
  const resource = { kind: 'channel', id: 'a'.repeat(24) };
  const base = {
    schema: 1,
    resource,
    partition: { kind: 'shared', policyKey: 'v1' },
    disclosureRevision: 1,
    window: { after: null, limit: 50 },
  };
  const request = {
    v: 1,
    type: 'observe',
    id: 'request',
    resource,
    window: base.window,
  };
  const snapshot = {
    v: 1,
    type: 'observation.snapshot',
    id: 'request',
    generation: 1,
    base,
    contentRevision: 1,
    purgeGeneration: 0,
    body: { text: 'complete' },
  };
  assert({
    given: 'valid replacement frames and obsolete replay/oversized bodies',
    should: 'parse only bounded current-state contracts',
    actual: [
      observationClientMessageSchema.safeParse(request).success,
      observationClientMessageSchema.safeParse({ ...request, since: '0:1' })
        .success,
      observationServerMessageSchema.safeParse(snapshot).success,
      observationServerMessageSchema.safeParse({
        ...snapshot,
        body: { text: 'a'.repeat(128 * 1024) },
      }).success,
    ],
    expected: [true, false, true, false],
  });
});
