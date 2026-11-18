import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  TournamentHostingAccount,
  TournamentHostingPurchaseRow,
  TournamentHostingPurchaseWrites,
} from '@daisy/db/tab';
import {
  settleHostingPurchase,
  startHostingCheckout,
  type HostingDependencies,
} from './checkout';

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
        // As the driver reports it: Drizzle's error, Postgres's cause.
        throw new Error(
          'Failed query: insert into tournament_hosting_purchases',
          {
            cause: Object.assign(
              new Error(
                'duplicate key value violates unique constraint "tournament_hosting_purchases_open_unique"',
              ),
              {
                errno: '23505',
                constraint: 'tournament_hosting_purchases_open_unique',
              },
            ),
          },
        );
      }
      throw new Error('unexpected second insert');
    },
    recordSession: async () => true,
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

const paidSession = (purchaseId: string, sessionId: string) => ({
  object: 'checkout.session',
  id: sessionId,
  livemode: false,
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  client_reference_id: purchaseId,
  metadata: { daisy_hosting_purchase_id: purchaseId, daisy_lobby_id: lobbyId },
  currency: 'usd',
  amount_subtotal: 9900,
  url: null,
  payment_intent: {
    id: 'pi_late',
    latest_charge: { receipt_url: 'https://pay.stripe.com/receipts/late' },
  },
});

test('settleHostingPurchase: a session paid after Daisy closed the purchase is still credited', async () => {
  const credited: string[] = [];
  const expired: TournamentHostingPurchaseRow = {
    id: id('expired'),
    lobbyId,
    payerUserId: host.userId,
    payerName: 'Host',
    tier: 'event_64',
    amount: 9900,
    mode: 'test',
    state: 'expired',
    vendorSessionId: 'cs_test_late',
    receiptUrl: null,
    createdAt: '2026-11-18T12:00:00.000Z',
    paidAt: null,
  };
  const writes = {
    paid: async (purchaseId: string) => {
      credited.push(purchaseId);
      return true;
    },
    expired: async () => {},
  };
  const dependencies = {
    store: {
      tournamentHostingSettlement: async (
        _input: unknown,
        work: (row: unknown, w: unknown) => Promise<unknown>,
      ) => work(expired, writes),
    },
    vendor: {
      port: {
        retrieveSession: async () => paidSession(expired.id, 'cs_test_late'),
      },
      mode: 'test',
    },
  } as unknown as HostingDependencies;
  const observed = await settleHostingPurchase(dependencies)({
    lobbyId,
    purchaseId: expired.id,
  });
  assert({
    given: 'a purchase Daisy expired whose Stripe session was then paid',
    should: 'credit it as paid rather than drop the payment',
    actual: { kind: observed?.kind, credited },
    expected: { kind: 'paid', credited: [expired.id] },
  });
});

test('startHostingCheckout: a purchase closed while its session was made is never sent to pay', async () => {
  const expiredAtStripe: string[] = [];
  const account = {
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
    waitingEntries: 0,
    purchases: [],
  };
  const writes = {
    open: async () => {},
    // Another request closed the purchase in the meantime.
    recordSession: async () => false,
  };
  const dependencies = {
    store: {
      tournamentHosting: async (
        _input: unknown,
        work: (a: unknown, w: unknown) => Promise<unknown>,
      ) => work(account, writes),
      tournamentHostingSettlement: async (
        _input: unknown,
        work: (a: unknown, w: unknown) => Promise<unknown>,
      ) => work(null, writes),
    },
    authorize: () => ({ allow: true }),
    vendor: {
      port: {
        retrievePrice: async () => ({
          id: 'price_64',
          object: 'price',
          active: true,
          currency: 'usd',
          livemode: false,
          type: 'one_time',
          unit_amount: 9900,
          lookup_key: 'daisy_host_event_usd_99',
          product: 'prod_64',
        }),
        createSession: async () => ({
          id: 'cs_test_orphan',
          url: 'https://checkout.stripe.com/c/pay/cs_test_orphan',
        }),
        retrieveSession: async () => null,
        expireSession: async (sessionId: string) => {
          expiredAtStripe.push(sessionId);
          return null;
        },
      },
      prices: { event_64: 'price_64', event_unlimited: 'price_unlimited' },
      mode: 'test',
    },
    origin: () => 'https://daisy.test',
    newId: () => id('orphan'),
  } as unknown as HostingDependencies;
  assert({
    given:
      'a new session whose purchase stopped being open before it was recorded',
    should: 'expire the session at Stripe and answer unavailable',
    actual: {
      destination: await startHostingCheckout(dependencies)(
        host,
        lobbyId,
        'event_64',
      ),
      expiredAtStripe,
    },
    expected: {
      destination: { kind: 'unavailable' },
      expiredAtStripe: ['cs_test_orphan'],
    },
  });
});

/** A store holding one sessionless open purchase, made `ageMs` before the read. */
const sessionlessStore = (ageMs: number, onOpen: () => Promise<void>) => {
  const purchases: TournamentHostingPurchaseRow[] = [
    {
      id: id('stale'),
      lobbyId,
      payerUserId: id('comanager'),
      payerName: 'Co-manager',
      tier: 'event_64',
      amount: 9900,
      mode: 'test',
      state: 'open',
      vendorSessionId: null,
      receiptUrl: null,
      createdAt: new Date(
        Date.parse('2026-11-18T12:00:00.000Z') - ageMs,
      ).toISOString(),
      paidAt: null,
    },
  ];
  const account = () => ({
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
    waitingEntries: 0,
    purchases: [...purchases],
  });
  const writes = {
    open: onOpen,
    recordSession: async () => true,
    expired: async (purchaseId: string) => {
      const at = purchases.findIndex((row) => row.id === purchaseId);
      if (at >= 0) purchases.splice(at, 1);
    },
  };
  const store = {
    tournamentHosting: async (
      _input: unknown,
      work: (a: unknown, w: unknown) => Promise<unknown>,
    ) => work(account(), writes),
    tournamentHostingSettlement: async (
      _input: unknown,
      work: (a: unknown, w: unknown) => Promise<unknown>,
    ) => work(purchases[0] ?? null, writes),
  };
  return { store, purchases };
};
const vendorFor = (sessions: string[]) => ({
  port: {
    retrievePrice: async () => ({
      id: 'price_unlimited',
      object: 'price',
      active: true,
      currency: 'usd',
      livemode: false,
      type: 'one_time',
      unit_amount: 19900,
      lookup_key: 'daisy_host_event_usd_199',
      product: 'prod_unlimited',
    }),
    createSession: async () => {
      sessions.push('created');
      return {
        id: 'cs_test_fresh',
        url: 'https://checkout.stripe.com/c/pay/cs_test_fresh',
      };
    },
    retrieveSession: async () => null,
    expireSession: async () => null,
  },
  prices: { event_64: 'price_64', event_unlimited: 'price_unlimited' },
  mode: 'test',
});

test('startHostingCheckout: an abandoned sessionless purchase blocks no one; a fresh one waits', async () => {
  const sessions: string[] = [];
  const stale = sessionlessStore(5 * 60_000, async () => {});
  const fresh = sessionlessStore(30_000, async () => {});
  const dependencies = (store: unknown) =>
    ({
      store,
      authorize: () => ({ allow: true }),
      vendor: vendorFor(sessions),
      origin: () => 'https://daisy.test',
      newId: () => id('fresh'),
    }) as unknown as HostingDependencies;
  assert({
    given:
      'another payer’s purchase left without a session for five minutes, and one made 30 seconds ago',
    should:
      'expire the abandoned one and sell the new move; answer unavailable while the fresh one may still be in flight',
    actual: [
      await startHostingCheckout(dependencies(stale.store))(
        host,
        lobbyId,
        'event_unlimited',
      ),
      stale.purchases.length,
      await startHostingCheckout(dependencies(fresh.store))(
        host,
        lobbyId,
        'event_unlimited',
      ),
      fresh.purchases.length,
    ],
    expected: [
      {
        kind: 'redirect',
        url: 'https://checkout.stripe.com/c/pay/cs_test_fresh',
      },
      0,
      { kind: 'unavailable' },
      1,
    ],
  });
});

test('startHostingCheckout: an insert failure other than the open-purchase race is not swallowed', async () => {
  const { store } = sessionlessStore(5 * 60_000, async () => {
    throw new Error('Failed query', {
      cause: Object.assign(new Error('check constraint violated'), {
        errno: '23514',
        constraint: 'tournament_hosting_purchases_amount_check',
      }),
    });
  });
  let thrown = 'none';
  try {
    await startHostingCheckout({
      store,
      authorize: () => ({ allow: true }),
      vendor: vendorFor([]),
      origin: () => 'https://daisy.test',
      newId: () => id('fresh'),
    } as unknown as HostingDependencies)(host, lobbyId, 'event_unlimited');
  } catch (error) {
    thrown = (error as Error).message;
  }
  assert({
    given: 'an insert refused by a check constraint',
    should: 'throw it rather than answer a silent unavailable',
    actual: thrown,
    expected: 'Failed query',
  });
});
