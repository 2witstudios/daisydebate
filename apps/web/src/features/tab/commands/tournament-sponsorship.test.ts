import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  decideTournamentSponsorship,
  type TournamentSponsorshipFacts,
} from './tournament-sponsorship';
setupRitewayBun();
const id = (value: string) => value.repeat(24),
  now = '2026-11-15T00:00:00.000Z';
const facts: TournamentSponsorshipFacts = {
  now,
  senderUserId: id('o'),
  newId: id('p'),
  lobby: {
    id: id('l'),
    version: 1,
    ownerOrganizationId: id('g'),
    closedAt: null,
  },
  current: null,
  proposedAccountExists: true,
  grants: [],
};
const proposal = {
  type: 'propose-tournament-sponsorship',
  lobbyId: id('l'),
  sponsorUserId: id('s'),
} as const;
test('organization sponsorship records a proposal without giving it funding power', () => {
  const result = decideTournamentSponsorship(facts, proposal);
  assert({
    given: 'an authorized organization proposal',
    should:
      'append only proposed direction, require a real target, and forbid synthetic personal sponsorship',
    actual: [
      result.kind === 'accepted' ? result.writes[0].sponsorship : null,
      decideTournamentSponsorship(
        { ...facts, proposedAccountExists: false },
        proposal,
      ),
      decideTournamentSponsorship(
        { ...facts, lobby: { ...facts.lobby, ownerOrganizationId: null } },
        proposal,
      ),
    ],
    expected: [
      {
        id: id('p'),
        lobbyId: id('l'),
        version: 1,
        actedByUserId: id('o'),
        actedAt: now,
        kind: 'proposed',
        sponsorUserId: id('s'),
        previousVersionId: null,
      },
      { kind: 'refused', refusal: 'sponsorship-unavailable' },
      { kind: 'refused', refusal: 'sponsorship-unavailable' },
    ],
  });
});
test('acceptance binds only the actual current proposal and exact current account coverage', () => {
  const current = {
    id: id('p'),
    lobbyId: id('l'),
    version: 1,
    sponsorUserId: id('s'),
    actedByUserId: id('o'),
    actedAt: now,
    authority: { kind: 'owner' },
    kind: 'proposed',
    previousVersionId: null,
  } as const;
  const grant = {
    entitlement: 'tournament_hosting',
    source: 'administrative',
    hosting: {
      id: id('h'),
      userId: id('s'),
      version: 1,
      startsAt: '2026-11-01T00:00:00.000Z',
      expiresAt: '2026-12-01T00:00:00.000Z',
      issuer: {
        kind: 'administrative',
        serviceId: 'daisy-admin',
        operatorRef: id('i'),
        decisionReference: 'Unit operator',
      },
      coverage: {
        tournamentIds: [id('l')],
        sponsorConcurrencyLimit: 1,
        tournamentConcurrencyLimit: 1,
      },
    },
  } as const;
  const accepting = {
    ...facts,
    senderUserId: id('s'),
    newId: id('a'),
    current,
    grants: [
      {
        ...grant,
        hosting: {
          ...grant.hosting,
          coverage: { ...grant.hosting.coverage, tournamentIds: [id('l')] },
        },
      },
    ],
  };
  const accept = {
    type: 'accept-tournament-sponsorship',
    lobbyId: id('l'),
    proposalId: id('p'),
    hostingVersionId: id('h'),
  } as const;
  const result = decideTournamentSponsorship(accepting, accept);
  assert({
    given:
      'actual own consent, but also attempted foreign, missing, expired and uncovered sources',
    should:
      'bind exact proposal/version only for the consenting account’s covered finite source',
    actual: [
      result.kind === 'accepted' ? result.writes[0].sponsorship : null,
      ...[
        { ...accepting, senderUserId: id('x') },
        { ...accepting, grants: [] },
        { ...accepting, now: grant.hosting.expiresAt },
        {
          ...accepting,
          grants: [
            {
              ...grant,
              hosting: {
                ...grant.hosting,
                coverage: { ...grant.hosting.coverage, tournamentIds: [] },
              },
            },
          ],
        },
      ].map((value) => decideTournamentSponsorship(value, accept).kind),
    ],
    expected: [
      {
        id: id('a'),
        lobbyId: id('l'),
        version: 2,
        actedByUserId: id('s'),
        actedAt: now,
        kind: 'active',
        sponsorUserId: id('s'),
        previousVersionId: id('p'),
        hostingVersionId: id('h'),
      },
      'refused',
      'refused',
      'refused',
      'refused',
    ],
  });
});
