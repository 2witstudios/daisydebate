import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  observationOverlaySchema,
  observationServerMessageSchema,
} from './observation-messages';
import { observationOverlayBytes } from './observation';
import { clientMessageSchema } from './realtime';
import { observationTestBase } from './observation-fixtures.test-support';
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
      clientMessageSchema.safeParse(request).success,
      clientMessageSchema.safeParse({ ...request, since: '0:1' }).success,
      observationServerMessageSchema.safeParse(snapshot).success,
      observationServerMessageSchema.safeParse({
        ...snapshot,
        body: { text: 'a'.repeat(128 * 1024) },
      }).success,
    ],
    expected: [true, false, true, false],
  });
});

test('ready carries a bounded actor-private overlay alongside the shared base', () => {
  const ready = {
    v: 1,
    type: 'observation.ready',
    id: 'request',
    generation: 1,
    base: observationTestBase(),
    minimumContentRevision: 1,
    validForMs: 4700,
    overlay: { ownReactions: [] },
  };
  const missing: Record<string, unknown> = { ...ready };
  delete missing.overlay;
  assert({
    given:
      'an overlay, an explicit empty overlay, an omitted (unchanged) one and an oversized one',
    should: 'accept omission as unchanged and bound its size',
    actual: [
      observationServerMessageSchema.safeParse(ready).success,
      observationServerMessageSchema.safeParse({ ...ready, overlay: null })
        .success,
      observationServerMessageSchema.safeParse(missing).success,
      observationServerMessageSchema.safeParse({
        ...ready,
        overlay: { text: 'a'.repeat(observationOverlayBytes) },
      }).success,
    ],
    expected: [true, true, true, false],
  });
});

test('the overlay byte bound is exact', () => {
  const sized = (bytes: number) => ({ text: 'a'.repeat(bytes - 11) });
  assert({
    given: 'overlays of exactly the bound and one byte over',
    should: 'accept the bound and refuse one more byte',
    actual: [
      observationOverlaySchema.safeParse(sized(observationOverlayBytes))
        .success,
      observationOverlaySchema.safeParse(sized(observationOverlayBytes + 1))
        .success,
    ],
    expected: [true, false],
  });
});
