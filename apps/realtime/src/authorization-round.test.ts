import { authorizationPrincipal as principal } from './authorization.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildDebateTopic } from '@daisy/protocol';
import type { RoundAuthorizationFact } from '@daisy/auth/authorization';
import type { RealtimeApp } from './app';
import { createRealtimeAuthorization } from './authorization';
setupRitewayBun();

for (const mode of [
  'public',
  'private-seated',
  'private-outsider',
  'absent',
  'revised-account',
  'late-revision',
  'expired',
] as const)
  test(`Round realtime authorization ${mode}`, async () => {
    let elapsed = 0;
    let sessions = 0;
    let projected: unknown;
    const epoch = Date.parse('2026-10-09T00:00:00.000Z');
    const account = {
      userId: principal.userId,
      actorId: principal.actorId,
      member: true,
      erased: false,
      revision: 2,
    };
    const resource: RoundAuthorizationFact = {
      kind: 'round',
      roundId: 'r'.repeat(24),
      createdByActorId: null,
      visibility: mode === 'public' ? 'public' : 'private',
      status: 'live',
      revision: 7,
      participants:
        mode === 'private-outsider'
          ? []
          : [{ actorId: principal.actorId, role: 'debater', slot: 0 }],
    };
    const resources = {
      clock: { now: () => new Date(epoch + elapsed).toISOString() },
      database: {
        readAuthorizationSession: async () => ({
          ...principal,
          account: {
            ...account,
            revision: ++sessions > 1 && mode === 'late-revision' ? 9 : 2,
          },
          expiresAt: new Date(epoch + 1_000).toISOString(),
        }),
        readRoundAuthorizationFacts: async (id: string, caller: unknown) => {
          projected = [id, caller];
          if (mode === 'expired') elapsed = 1_000;
          return mode === 'absent'
            ? null
            : {
                account: {
                  ...account,
                  revision: mode === 'revised-account' ? 9 : 2,
                },
                resource,
              };
        },
      },
    } as unknown as RealtimeApp;
    const result = await createRealtimeAuthorization({
      resources,
      now: () => elapsed,
    }).authorizeTopic(principal, buildDebateTopic(resource.roundId));
    assert({
      given:
        'actual minimal Round projection port and canonical round.read evaluation',
      should: 'allow only current audience facts within durable session expiry',
      actual: [projected, result?.validUntil ?? null],
      expected: [
        [resource.roundId, principal],
        ['public', 'private-seated'].includes(mode) ? 1_000 : null,
      ],
    });
  });
