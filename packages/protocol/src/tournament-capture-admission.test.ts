import { assert, setupRitewayBun, test } from 'riteway/bun';
import { tournamentCaptureAdmissionSchema } from './tournament-capture-admission';

setupRitewayBun();

const id = (tag: string) => tag.padEnd(24, '0');
const lobbyId = id('lobby');
const owner = id('owner');
const admittedAt = '2026-11-18T12:00:00.000Z';
const common = {
  id: id('admission'),
  roundId: id('round'),
  roomId: id('room'),
  lobbyId,
  eventId: id('event'),
  fixtureId: id('fixture'),
  commandId: id('command'),
  funding: { kind: 'personal-owner', ownerUserId: owner },
  official: {
    userId: owner,
    actorId: id('actor'),
    authority: { kind: 'owner', scope: { kind: 'lobby', lobbyId } },
  },
  admittedAt,
  deadlineAt: '2026-11-18T13:00:00.000Z',
  executionBudgetMs: 3_600_000,
};
const purchase = (overrides: Record<string, unknown> = {}) => ({
  ...common,
  basis: {
    kind: 'hosting-purchase',
    purchase: {
      id: id('purchase'),
      lobbyId,
      tier: 'event_64',
      paidAt: '2026-11-17T10:00:00.000Z',
    },
  },
  capacity: {
    kind: 'nonranked-egress',
    fleetLimit: 1,
    sponsorLimit: 32,
    tournamentLimit: 32,
  },
  ...overrides,
});
const grant = {
  ...common,
  basis: {
    kind: 'grant',
    grant: {
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
          tournamentIds: [lobbyId],
          sponsorConcurrencyLimit: 2,
          tournamentConcurrencyLimit: 3,
        },
      },
    },
  },
  capacity: {
    kind: 'nonranked-egress',
    fleetLimit: 1,
    sponsorLimit: 2,
    tournamentLimit: 3,
  },
};
const parses = (value: unknown) =>
  tournamentCaptureAdmissionSchema.safeParse(value).success;

test('tournament capture admission bases (ADR 0149)', () => {
  assert({
    given:
      'a covering hosting grant, and a paid hosting purchase at its tier limits',
    should: 'admit both',
    actual: [parses(grant), parses(purchase())],
    expected: [true, true],
  });
  assert({
    given:
      'a purchase for another tournament, paid after admission, at the wrong tier limits, or funding a league tournament',
    should: 'refuse each',
    actual: [
      parses(
        purchase({
          basis: {
            kind: 'hosting-purchase',
            purchase: {
              id: id('purchase'),
              lobbyId: id('other'),
              tier: 'event_64',
              paidAt: '2026-11-17T10:00:00.000Z',
            },
          },
        }),
      ),
      parses(
        purchase({
          basis: {
            kind: 'hosting-purchase',
            purchase: {
              id: id('purchase'),
              lobbyId,
              tier: 'event_64',
              paidAt: '2026-11-18T12:30:00.000Z',
            },
          },
        }),
      ),
      parses(
        purchase({
          capacity: {
            kind: 'nonranked-egress',
            fleetLimit: 1,
            sponsorLimit: 64,
            tournamentLimit: 64,
          },
        }),
      ),
      parses(
        purchase({
          funding: {
            kind: 'organization-sponsor',
            organizationId: id('league'),
            sponsorshipVersionId: id('sponsorship'),
          },
        }),
      ),
    ],
    expected: [false, false, false, false],
  });
});
