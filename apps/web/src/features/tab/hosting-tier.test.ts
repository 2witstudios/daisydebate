import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { TournamentHostingFacts } from '@daisy/db/tab';
import type { TournamentHostingGrant } from '@daisy/protocol/tournament-hosting';
import { tournamentHostingTier } from './hosting-tier';

setupRitewayBun();

const id = (tag: string) => tag.padEnd(24, '0');
const now = '2026-11-18T12:00:00.000Z';
const owner = id('owner');
const lobbyId = id('lobby');
const grant = (tournamentIds: string[]): TournamentHostingGrant => ({
  entitlement: 'tournament_hosting',
  source: 'administrative',
  hosting: {
    id: id('version'),
    userId: owner,
    version: 1,
    startsAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    issuer: {
      kind: 'administrative',
      decisionReference: 'DEC-1',
      serviceId: 'daisy-admin',
      operatorRef: id('operator'),
    },
    coverage: {
      tournamentIds,
      sponsorConcurrencyLimit: 1,
      tournamentConcurrencyLimit: 1,
    },
  },
});
const facts = (
  overrides: Partial<TournamentHostingFacts> = {},
): TournamentHostingFacts => ({
  lobbyId,
  ownerUserId: owner,
  ownerOrganizationId: null,
  paidTiers: [],
  ownerHosting: { checkedAt: now, grants: [] },
  ...overrides,
});

test('tournamentHostingTier', () => {
  assert({
    given: 'a personal tournament with nothing paid and no grant',
    should: 'be free',
    actual: tournamentHostingTier(facts(), now),
    expected: 'free',
  });
  assert({
    given: 'a personal tournament paid at USD 99',
    should: 'be the USD 99 tier',
    actual: tournamentHostingTier(facts({ paidTiers: ['event_64'] }), now),
    expected: 'event_64',
  });
  assert({
    given:
      'an administrative grant naming the tournament, and one naming another',
    should: 'be unlimited only for the named tournament',
    actual: [
      tournamentHostingTier(
        facts({ ownerHosting: { checkedAt: now, grants: [grant([lobbyId])] } }),
        now,
      ),
      tournamentHostingTier(
        facts({
          ownerHosting: { checkedAt: now, grants: [grant([id('other')])] },
        }),
        now,
      ),
    ],
    expected: ['event_unlimited', 'free'],
  });
  assert({
    given: "a league's tournament",
    should: 'be covered by the league with no cap',
    actual: tournamentHostingTier(
      facts({
        ownerUserId: null,
        ownerOrganizationId: id('league'),
        ownerHosting: null,
      }),
      now,
    ),
    expected: 'event_unlimited',
  });
});
