import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationAuthorityReader } from './observation-authority';
import type {
  ObservationAuthorityResult,
  ObservationBinding,
} from '@daisy/db/observation';
setupRitewayBun();
test('named authority reader preserves original queue start and independent evidence deadlines', async () => {
  const binding: ObservationBinding = {
    principal: {
      userId: 'a'.repeat(24),
      actorId: 'b'.repeat(24),
      sessionId: 'c'.repeat(24),
    },
    resource: { kind: 'round', id: 'd'.repeat(24) },
    window: { after: null, limit: 1 },
  };
  const evidence = (remainingMs: number) => ({
    remainingMs,
    fingerprint: 'facts',
    dependencies: [],
  });
  const result: ObservationAuthorityResult = {
    status: 'allowed',
    subject: evidence(5000),
    cohort: evidence(1000),
    entitlement: evidence(3000),
    base: {
      schema: 1,
      resource: binding.resource,
      window: binding.window,
      partition: { kind: 'shared', policyKey: 'round-clock-v1' },
      disclosureRevision: 1,
    },
    minimumContentRevision: 2,
    purgeGeneration: 0,
    databaseNow: '2026-10-12T00:00:00.000Z',
    overlay: null,
  };
  let now = 0,
    delay = 400;
  const calls: string[] = [];
  const reader = createObservationAuthorityReader({
    now: () => now,
    operations: {
      admitObservationAuthorityBatch: async () => {
        calls.push('admission');
        now += delay;
        return [result];
      },
      renewObservationAuthorityBatch: async () => {
        calls.push('renewal');
        now += delay;
        return [result];
      },
    },
  });
  const first = await reader.admit([binding]);
  delay = 1000;
  const late = await reader.renew([binding]);
  assert({
    given:
      'one canonical batch returns after queue/locks then another arrives after cohort expiry',
    should:
      'use fixed owning operations and original independently bounded evidence deadlines, refusing late results',
    actual: {
      calls,
      deadlines:
        first[0]?.status === 'allowed'
          ? [
              first[0].grant.subject.expiresAt,
              first[0].grant.cohort.expiresAt,
              first[0].grant.entitlement.expiresAt,
            ]
          : [],
      late: late[0]?.status,
    },
    expected: {
      calls: ['admission', 'renewal'],
      deadlines: [4700, 700, 2700],
      late: 'unavailable',
    },
  });
});
