import type { ObservationAuthorityDecision } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { allowedObservationAuthority } from './observation-authority-state';
import type {
  ObservationBinding,
  ObservationAuthorityContext,
} from './observation-contracts';
setupRitewayBun();
const databaseNow = '2026-10-12T00:00:00.000Z';
for (const kind of ['room', 'round'] as const)
  test(`public ${kind} cohort identity excludes caller-only subject facts`, () => {
    const resource = { kind, id: 'r'.repeat(24) };
    const results = ['a', 'b'].map((letter) => {
      const principal = {
        actorId: letter.repeat(24),
        userId: (letter === 'a' ? 'u' : 'v').repeat(24),
        sessionId: (letter === 'a' ? 's' : 't').repeat(24),
      };
      const binding: ObservationBinding = {
        principal,
        resource,
        window: { after: null, limit: 1 },
      };
      const account = {
        userId: principal.userId,
        actorId: principal.actorId,
        member: true,
        erased: false,
        revision: 1,
      };
      const session: ObservationAuthorityContext['session'] = {
        ...principal,
        account,
        expiresAt: '2026-10-12T00:00:30.000Z',
      };
      const decision: Extract<
        ObservationAuthorityDecision,
        { status: 'allowed' }
      > = {
        status: 'allowed',
        partition: { kind: 'shared', policyKey: `${kind}-safe` },
        eligibleUntil: null,
        overlay: null,
        dependencies: [
          {
            scope: 'subject',
            key: `account-${principal.actorId}`,
            revision: '1',
            nextBoundary: null,
          },
          {
            scope: 'entitlement',
            key: `${kind}-${resource.id}`,
            revision: '1',
            nextBoundary: null,
          },
        ],
      };
      return allowedObservationAuthority(
        binding,
        session,
        decision,
        {
          resource,
          contentRevision: 5,
          disclosureRevision: 1,
          purgeGeneration: 0,
        },
        databaseNow,
      );
    });
    const allowed = results.filter((result) => result.status === 'allowed');
    assert({
      given:
        'two canonical public viewers with different account/session identities and the same resource facts',
      should:
        'keep subject identity separate and shared cohort/entitlement stable',
      actual: {
        allowed: allowed.length,
        subjects: new Set(allowed.map((r) => r.subject.fingerprint)).size,
        cohorts: new Set(allowed.map((r) => r.cohort.fingerprint)).size,
        entitlements: new Set(allowed.map((r) => r.entitlement.fingerprint))
          .size,
        cohortVectors: allowed.map((r) => r.cohort.dependencies),
        subjectRows: allowed.map((r) => r.subject.dependencies.length),
      },
      expected: {
        allowed: 2,
        subjects: 2,
        cohorts: 1,
        entitlements: 1,
        cohortVectors: [[], []],
        subjectRows: [2, 2],
      },
    });
  });
