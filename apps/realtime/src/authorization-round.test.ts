import { instantMs } from '@daisy/clock';
import type { AuthorityResources } from './authorization';
import {
  authorizationPrincipal as principal,
  refuseAllReading,
} from './authorization.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildRoundTopic, sideSeat } from '@daisy/protocol';
import type { RoundAuthorizationFact } from '@daisy/auth/authorization';
import { createRealtimeAuthorization } from './authorization';
setupRitewayBun();

for (const mode of [
  'public',
  'private-seated',
  'private-outsider',
  'linked-adult',
  'linked-adult-ended',
  'absent',
  'revised-account',
  'late-revision',
  'expired',
] as const)
  test(`Round realtime authorization ${mode}`, async () => {
    let elapsed = 0;
    let sessions = 0;
    let projected: unknown;
    let factReads = 0;
    const epoch = instantMs('2026-10-09T00:00:00.000Z');
    const account = {
      userId: principal.userId,
      actorId: principal.actorId,
      member: true,
      beta: { state: 'approved' as const, revision: 1 },
      ageBand: 'adult' as const,
      restricted: false,
      erased: false,
      revision: 2,
    };
    const resource: RoundAuthorizationFact = {
      kind: 'round',
      roundId: 'r'.repeat(24),
      createdByActorId: null,
      visibility: mode === 'public' ? 'public' : 'private',
      // A running Round, as `rounds.status` stores it: a linked adult watches only then.
      status: 'active',
      revision: 7,
      participants:
        mode === 'private-outsider' ||
        mode === 'linked-adult' ||
        mode === 'linked-adult-ended'
          ? []
          : [{ actorId: principal.actorId, seat: sideSeat('affirmative') }],
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
        // Only the linked-adult Round is a Youth one; its debater's coach asks.
        readRoundYouth: async () =>
          mode === 'linked-adult' || mode === 'linked-adult-ended',
        readYouthRoundPeople: async () => ({
          debaters: [
            {
              actorId: 'd'.repeat(24),
              userId: 'v'.repeat(24),
              linkedAdultActorIds: [principal.actorId],
            },
          ],
        }),
        readRoundAuthorizationFacts: async (id: string, caller: unknown) => {
          projected = [id, caller];
          if (mode === 'expired') elapsed = 1_000;
          factReads += 1;
          return mode === 'absent'
            ? null
            : {
                account: {
                  ...account,
                  revision: mode === 'revised-account' ? 9 : 2,
                },
                // The Round ends while the links are looked up: the re-read sees it over.
                resource:
                  mode === 'linked-adult-ended' && factReads > 1
                    ? { ...resource, status: 'completed' }
                    : resource,
              };
        },
      },
    } as unknown as AuthorityResources;
    const result = await createRealtimeAuthorization({
      readingPolicy: refuseAllReading,
      resources,
      now: () => elapsed,
    }).authorizeTopic(principal, buildRoundTopic(resource.roundId));
    assert({
      given:
        'actual minimal Round projection port and canonical round.read evaluation, and a Youth Round watched by its debater’s coach, also one that ends during the links lookup',
      should:
        'allow only current audience facts, the linked adult watching included (ADR 0155), within durable session expiry',
      actual: [projected, result?.validUntil ?? null],
      expected: [
        [resource.roundId, principal],
        ['public', 'private-seated', 'linked-adult'].includes(mode)
          ? 1_000
          : null,
      ],
    });
  });
