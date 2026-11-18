import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  TournamentHostingAccount,
  TournamentHostingPurchaseRow,
  TournamentHostingPurchaseWrites,
} from '@daisy/db/tab';
import { startHostingCheckout, type HostingDependencies } from './checkout';

setupRitewayBun();

const id = (tag: string) => tag.padEnd(24, '0');
const lobbyId = id('lobby');
const host = {
  kind: 'user' as const,
  userId: id('host'),
  actorId: id('actor'),
};

/**
 * A store whose tournament gains a concurrent checkout's open purchase in
 * the moment between this checkout's read and its insert: the insert loses
 * to the one-open-purchase index, as the database would refuse it.
 */
const racedStore = () => {
  const purchases: TournamentHostingPurchaseRow[] = [];
  let raced = false;
  const account = (): TournamentHostingAccount =>
    ({
      lobby: { id: lobbyId, kind: 'tournament', handle: 'cup', name: 'Cup' },
      authorization: { organization: null, account: null, grants: [] },
      ownerActorId: host.actorId,
      checkedAt: '2026-11-18T12:00:00.000Z',
      hosting: {
        lobbyId,
        ownerUserId: host.userId,
        ownerOrganizationId: null,
        paidTiers: [],
        ownerHosting: null,
      },
      acceptedEntries: 16,
      waitingEntries: 1,
      purchases: [...purchases],
    }) as unknown as TournamentHostingAccount;
  const writes: TournamentHostingPurchaseWrites = {
    open: async (row) => {
      if (!raced) {
        raced = true;
        // The other request's row lands first.
        purchases.push({
          ...row,
          id: id('winner'),
          lobbyId,
          payerName: 'Host',
          state: 'open',
          vendorSessionId: 'cs_test_winner',
          receiptUrl: null,
          createdAt: '2026-11-18T12:00:00.000Z',
          paidAt: null,
        });
        throw new Error(
          'duplicate key: tournament_hosting_purchases_open_unique',
        );
      }
      throw new Error('unexpected second insert');
    },
    recordSession: async () => {},
    paid: async () => true,
    expired: async () => {},
  };
  return {
    tournamentHosting: async (_input: unknown, work: never) =>
      (work as (a: unknown, w: unknown) => Promise<unknown>)(account(), writes),
    tournamentHostingSettlement: async (_input: unknown, work: never) =>
      (work as (a: unknown, w: unknown) => Promise<unknown>)(
        purchases[0] ?? null,
        writes,
      ),
    hostedTournaments: async () => {
      throw new Error('not used');
    },
  } as unknown as HostingDependencies['store'];
};

test('startHostingCheckout: a checkout that loses the race resumes the winner', async () => {
  const sessions: string[] = [];
  const dependencies: HostingDependencies = {
    store: racedStore(),
    authorize: () => ({ allow: true }) as never,
    vendor: {
      port: {
        retrievePrice: async () => null,
        createSession: async () => {
          sessions.push('created');
          return null;
        },
        retrieveSession: async (sessionId) => ({
          object: 'checkout.session',
          id: sessionId,
          livemode: false,
          mode: 'payment',
          status: 'open',
          payment_status: 'unpaid',
          client_reference_id: id('winner'),
          metadata: {
            daisy_hosting_purchase_id: id('winner'),
            daisy_lobby_id: lobbyId,
          },
          currency: 'usd',
          amount_subtotal: 9900,
          url: 'https://checkout.stripe.com/c/pay/cs_test_winner',
          payment_intent: null,
        }),
        expireSession: async () => null,
      },
      prices: { event_64: 'price_64', event_unlimited: 'price_unlimited' },
      mode: 'test',
    },
    origin: () => 'https://daisy.test',
    newId: () => id('loser'),
  };
  assert({
    given:
      'a second checkout whose insert loses to a concurrent one for the same move',
    should:
      'resume the open purchase’s session instead of failing, creating no session of its own',
    actual: {
      destination: await startHostingCheckout(dependencies)(
        host,
        lobbyId,
        'event_64',
      ),
      sessions,
    },
    expected: {
      destination: {
        kind: 'redirect',
        url: 'https://checkout.stripe.com/c/pay/cs_test_winner',
      },
      sessions: [],
    },
  });
});
