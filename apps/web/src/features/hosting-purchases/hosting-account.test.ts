import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  TournamentHostingAccount,
  TournamentHostingPurchaseRow,
} from '@daisy/db/tab';
import { hostingAccountView } from './hosting-account';

setupRitewayBun();

const id = (tag: string) => tag.padEnd(24, '0');
const now = '2026-11-18T12:00:00.000Z';
const purchase = (
  overrides: Partial<TournamentHostingPurchaseRow> = {},
): TournamentHostingPurchaseRow => ({
  id: id('purchase'),
  lobbyId: id('lobby'),
  payerUserId: id('maya'),
  payerName: 'Maya Lin',
  tier: 'event_64',
  amount: 9900,
  mode: 'test',
  state: 'paid',
  vendorSessionId: 'cs_test_1',
  receiptUrl: 'https://pay.stripe.com/receipts/1',
  createdAt: '2026-11-17T10:00:00.000Z',
  paidAt: '2026-11-17T10:01:00.000Z',
  ...overrides,
});
const account = (
  overrides: {
    readonly purchases?: TournamentHostingPurchaseRow[];
    readonly ownerOrganizationId?: string | null;
  } = {},
): TournamentHostingAccount =>
  ({
    lobby: { id: id('lobby'), handle: 'friday', name: 'Friday scrimmage' },
    hosting: {
      lobbyId: id('lobby'),
      ownerUserId: overrides.ownerOrganizationId ? null : id('maya'),
      ownerOrganizationId: overrides.ownerOrganizationId ?? null,
      paidTiers: (overrides.purchases ?? [])
        .filter((row) => row.state === 'paid')
        .map((row) => row.tier),
      ownerHosting: null,
    },
    acceptedEntries: 16,
    waitingEntries: 1,
    purchases: overrides.purchases ?? [],
  }) as unknown as TournamentHostingAccount;

test('hostingAccountView', () => {
  const free = hostingAccountView(account(), now);
  assert({
    given: 'a free tournament with 16 accepted and one waiting',
    should: 'offer both paid tiers at full price, with the free cap',
    actual: {
      tier: free.tier,
      cap: free.entryCap,
      upgrades: free.upgrades,
      waiting: free.waitingEntries,
    },
    expected: {
      tier: 'free',
      cap: 16,
      upgrades: [
        { tier: 'event_64', owed: 9900 },
        { tier: 'event_unlimited', owed: 19900 },
      ],
      waiting: 1,
    },
  });
  const paid = hostingAccountView(account({ purchases: [purchase()] }), now);
  assert({
    given: 'a tournament paid at USD 99',
    should: 'offer only the move to unlimited for USD 100, and name its payment',
    actual: {
      tier: paid.tier,
      upgrades: paid.upgrades,
      settled: paid.settled?.payerName,
    },
    expected: {
      tier: 'event_64',
      upgrades: [{ tier: 'event_unlimited', owed: 10000 }],
      settled: 'Maya Lin',
    },
  });
  const league = hostingAccountView(
    account({ ownerOrganizationId: id('league') }),
    now,
  );
  assert({
    given: "a league's tournament",
    should: 'be covered, unlimited and sell nothing',
    actual: [league.covered, league.tier, league.upgrades],
    expected: [true, 'event_unlimited', []],
  });
});
