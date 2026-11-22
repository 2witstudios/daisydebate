import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { settingCommand } from '../src/features/tab/operations/settings';
import { setupCommand } from '../src/features/tab/operations/setup';
import {
  readHostingAccount,
  settleHostingPurchase,
  startHostingCheckout,
  type HostingStripePort,
} from '../src/features/hosting-purchases/checkout';
import Stripe from 'stripe';
import { fixedClock } from '@daisy/clock';
import { createBillingWebhook } from '../src/features/billing/webhook-handler';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** Stripe as the checkout sees it: prices, and sessions the test completes. */
const fakeStripe = () => {
  const sessions = new Map<string, Record<string, unknown>>();
  const created: { parameters: Record<string, unknown>; key: string }[] = [];
  const price = (
    id: string,
    unit_amount: number,
    lookup_key: string,
    product: string,
  ) => ({
    id,
    object: 'price',
    active: true,
    currency: 'usd',
    livemode: false,
    type: 'one_time',
    unit_amount,
    lookup_key,
    product,
  });
  const prices: Record<string, unknown> = {
    price_host64: price(
      'price_host64',
      9900,
      'daisy_host_event_usd_99',
      'prod_64',
    ),
    price_hostUnlimited: price(
      'price_hostUnlimited',
      19900,
      'daisy_host_event_usd_199',
      'prod_unlimited',
    ),
  };
  const port: HostingStripePort = {
    retrievePrice: async (id) => prices[id],
    createSession: async (parameters, key) => {
      // Stripe answers a repeated idempotency key with the same session.
      const again = created.findIndex((call) => call.key === key);
      if (again >= 0) {
        const id = `cs_test_${again + 1}`;
        return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
      }
      created.push({ parameters: parameters as Record<string, unknown>, key });
      const id = `cs_test_${created.length}`;
      const line = (parameters.line_items ?? [])[0] as {
        price?: string;
        price_data?: { unit_amount: number };
      };
      const amount =
        line.price_data?.unit_amount ??
        (prices[line.price!] as { unit_amount: number }).unit_amount;
      sessions.set(id, {
        object: 'checkout.session',
        id,
        livemode: false,
        mode: 'payment',
        status: 'open',
        payment_status: 'unpaid',
        client_reference_id: parameters.client_reference_id,
        metadata: parameters.metadata,
        currency: 'usd',
        amount_subtotal: amount,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        payment_intent: null,
      });
      return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
    },
    retrieveSession: async (id) => sessions.get(id),
    expireSession: async (id) => {
      sessions.set(id, { ...sessions.get(id), status: 'expired' });
      return sessions.get(id);
    },
  };
  const pay = (id: string) =>
    sessions.set(id, {
      ...sessions.get(id),
      status: 'complete',
      payment_status: 'paid',
      url: null,
      payment_intent: {
        id: `pi_${id.slice(8)}`,
        latest_charge: { receipt_url: `https://pay.stripe.com/receipts/${id}` },
      },
    });
  return { port, created, pay };
};

test('free hosting caps entries and paid features; one payment unlocks that tournament only', async () => {
  const debaters = Array.from({ length: 66 }, (_, n) => `Debater ${n + 1}`);
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Host', 'Stranger', ...debaters]),
    work: async (database, bots, sql) => {
      const bot = Object.fromEntries(bots.map((one) => [one.name, one]));
      const host = bot.Host!;
      const clock = scriptClock();
      const store = createTabStore(database);
      const common = { store, authorize, now: clock.now, newId: createId };
      const created = await lobbyAdministrationCommand(common)(as(host), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-lobby',
          owner: { kind: 'self' },
          name: 'Friday scrimmage',
          handle: `friday-${createId()}`,
          lobby: {
            kind: 'tournament',
            eligibility: { kind: 'own', ageRule: 'adults' },
          },
        },
      });
      if (created.kind !== 'accepted') throw new Error('free hosting refused');
      const lobbyId = created.receipt.aggregate.id;
      const added = await setupCommand(common)(as(host), {
        version: 1,
        commandId: createId(),
        expected: { lobby: created.receipt.resultingVersion },
        command: {
          type: 'add-event',
          lobbyId,
          name: 'Freestyle',
          label: 'FS',
          entry: { kind: 'person' },
          pin: {
            kind: 'format',
            formatId: 'freestyle',
            formatVersion: 1,
            ballotDefinition: null,
          },
        },
      });
      if (added.kind !== 'accepted') throw new Error('event refused');
      const [event] =
        await sql`select id from events where lobby_id=${lobbyId}`;
      const eventId = String(event!.id);
      const settings = settingCommand(common);
      const versionOf = async (kind: 'event' | 'lobby') =>
        Number(
          (kind === 'event'
            ? await sql`select settings_version v from events where id=${eventId}`
            : await sql`select settings_version v from lobbies where id=${lobbyId}`)[0]!
            .v,
        );
      const set = async (
        scope: 'event' | 'lobby',
        key: string,
        value: unknown,
      ) =>
        settings(as(host), {
          version: 1,
          commandId: createId(),
          expected: { settings: await versionOf(scope) },
          command: {
            type: 'set-setting',
            scope: { kind: scope, id: scope === 'event' ? eventId : lobbyId },
            key,
            value,
            hold: 'default',
          },
        });
      await set('event', 'entry.registration', { state: 'open' });
      await set('event', 'entry.approval', { value: 'automatic' });
      const entries = entryEnrollmentCommand(common);
      const entriesVersion = async () =>
        Number(
          (
            await sql`select entries_version v from events where id=${eventId}`
          )[0]!.v,
        );
      const enter = async (name: string) => {
        const person = bot[name]!;
        const answer = await entries(as(person), lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { entries: await entriesVersion() },
          command: {
            type: 'submit-entry',
            eventId,
            name,
            memberActorIds: [person.actorId],
            responsible: { kind: 'self' },
            division: null,
          },
        });
        if (answer.kind !== 'accepted')
          throw new Error(`${name}: ${JSON.stringify(answer)}`);
        const [row] =
          await sql`select id, status from entries where name=${name} and lobby_id=${lobbyId}`;
        return { id: String(row!.id), status: String(row!.status) };
      };
      const accept = async (entryId: string) =>
        entries(as(host), lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { entries: await entriesVersion() },
          command: { type: 'accept-entry', entryId },
        });
      const refusal = (answer: { kind: string; refusal?: string }) =>
        answer.kind === 'refused' ? answer.refusal : answer.kind;

      const first16 = [];
      for (const name of debaters.slice(0, 16)) first16.push(await enter(name));
      const seventeenth = await enter('Debater 17');
      assert({
        given: 'automatic approval on a free tournament, 16 entries and a 17th',
        should: 'accept 16 and hold the 17th, and refuse accepting it',
        actual: {
          accepted: first16.every((row) => row.status === 'accepted'),
          seventeenth: seventeenth.status,
          accept: refusal(await accept(seventeenth.id)),
        },
        expected: {
          accepted: true,
          seventeenth: 'pending',
          accept: 'hosting-upgrade-required',
        },
      });
      assert({
        given: 'a free tournament switching on each paid feature',
        should: 'refuse each with hosting-upgrade-required',
        actual: [
          refusal(await set('lobby', 'recording.capture', { value: 'on' })),
          refusal(await set('lobby', 'judging.ai_judge', { value: 'on' })),
          refusal(await set('lobby', 'broadcast.live', { value: 'on' })),
        ],
        expected: Array(3).fill('hosting-upgrade-required'),
      });

      const stripe = fakeStripe();
      const hosting = {
        store,
        authorize,
        vendor: {
          port: stripe.port,
          prices: {
            event_64: 'price_host64',
            event_unlimited: 'price_hostUnlimited',
          },
          mode: 'test' as const,
        },
        origin: () => 'https://daisy.test',
        newId: createId,
      };
      const checkout = startHostingCheckout(hosting);
      const settle = settleHostingPurchase(hosting);
      const strangerSees = await readHostingAccount(hosting)(
        as(bot.Stranger!),
        lobbyId,
      );
      let strangerRefused = false;
      try {
        await checkout(as(bot.Stranger!), lobbyId, 'event_64');
      } catch {
        strangerRefused = true;
      }
      const first = await checkout(as(host), lobbyId, 'event_64');
      const resumed = await checkout(as(host), lobbyId, 'event_64');
      const [open] =
        await sql`select id, amount, state, vendor_session_id from tournament_hosting_purchases where lobby_id=${lobbyId}`;
      assert({
        given: 'a stranger, then the host buying USD 99 twice before paying',
        should:
          'show and sell the stranger nothing, open one USD 99 session and resume it',
        actual: {
          strangerSees,
          strangerRefused,
          first,
          resumed,
          open: {
            amount: open!.amount,
            state: open!.state,
            session: open!.vendor_session_id,
          },
          sessions: stripe.created.length,
          key: stripe.created[0]!.key,
        },
        expected: {
          strangerSees: null,
          strangerRefused: true,
          first: {
            kind: 'redirect',
            url: 'https://checkout.stripe.com/c/pay/cs_test_1',
          },
          resumed: {
            kind: 'redirect',
            url: 'https://checkout.stripe.com/c/pay/cs_test_1',
          },
          open: { amount: 9900, state: 'open', session: 'cs_test_1' },
          sessions: 1,
          key: `daisy-hosting-purchase-${open!.id}`,
        },
      });

      stripe.pay('cs_test_1');
      const purchaseId = String(open!.id);
      const secret = 'whsec_hosting_fixture';
      const deliveredAt = Date.now();
      const webhook = createBillingWebhook({
        config: {
          kind: 'stripe',
          mode: 'test',
          secretKey: 'sk_test_unused',
          webhookSecret: secret,
          premiumPriceId: 'price_unused',
          portalConfigurationId: 'bpc_unused',
          hostEventPrices: hosting.vendor.prices,
          club: null,
        },
        clock: fixedClock(new Date(deliveredAt).toISOString()),
        deadline: () => AbortSignal.timeout(5_000),
        receive: async () => {
          throw new Error('a hosting event never reaches the customer inbox');
        },
        settleHosting: settle,
        failed: () => {},
      });
      const deliver = async () => {
        const payload = JSON.stringify({
          id: 'evt_hostingPaid',
          object: 'event',
          type: 'checkout.session.completed',
          livemode: false,
          // Only these ids are read from the payload; the amount and state come from Stripe.
          data: {
            object: {
              object: 'checkout.session',
              mode: 'payment',
              amount_subtotal: 1,
              metadata: {
                daisy_hosting_purchase_id: purchaseId,
                daisy_lobby_id: lobbyId,
              },
            },
          },
        });
        return (
          await webhook(
            new Request('https://daisy.test/api/webhooks/stripe', {
              method: 'POST',
              body: payload,
              headers: {
                'stripe-signature':
                  await Stripe.webhooks.generateTestHeaderStringAsync({
                    payload,
                    secret,
                    timestamp: Math.floor(deliveredAt / 1000),
                  }),
              },
            }),
          )
        ).status;
      };
      const settled = { kind: (await deliver()) === 204 ? 'paid' : 'failed' };
      const again = (await deliver()) === 204 ? null : 'failed';
      const [paid] =
        await sql`select state, vendor_payment_intent_id, receipt_url from tournament_hosting_purchases where id=${purchaseId}`;
      assert({
        given:
          'Stripe completing the session, and its signed webhook delivered twice',
        should:
          'settle the purchase paid once and change nothing the second time',
        actual: { settled: settled?.kind, again, paid: { ...paid } },
        expected: {
          settled: 'paid',
          again: null,
          paid: {
            state: 'paid',
            vendor_payment_intent_id: 'pi_1',
            receipt_url: 'https://pay.stripe.com/receipts/cs_test_1',
          },
        },
      });
      assert({
        given: 'the tournament paid at USD 99',
        should:
          'accept the waiting 17th and allow recording, AI judging and broadcast',
        actual: [
          refusal(await accept(seventeenth.id)),
          refusal(await set('lobby', 'recording.capture', { value: 'on' })),
          refusal(await set('lobby', 'judging.ai_judge', { value: 'on' })),
          refusal(await set('lobby', 'broadcast.live', { value: 'on' })),
        ],
        expected: Array(4).fill('accepted'),
      });

      for (const name of debaters.slice(17, 64)) await enter(name);
      const sixtyFifth = await enter('Debater 65');
      assert({
        given: 'a USD 99 tournament with 64 accepted entries and a 65th',
        should: 'hold the 65th and refuse accepting it',
        actual: {
          accepted: Number(
            (
              await sql`select count(*)::int n from entries where lobby_id=${lobbyId} and status='accepted'`
            )[0]!.n,
          ),
          status: sixtyFifth.status,
          accept: refusal(await accept(sixtyFifth.id)),
        },
        expected: {
          accepted: 64,
          status: 'pending',
          accept: 'hosting-upgrade-required',
        },
      });

      const view = await readHostingAccount(hosting)(as(host), lobbyId);
      const move = await checkout(as(host), lobbyId, 'event_unlimited');
      const moveLine = stripe.created[1]!.parameters.line_items;
      stripe.pay('cs_test_2');
      const [movePurchase] =
        await sql`select id, amount from tournament_hosting_purchases where lobby_id=${lobbyId} and tier='event_unlimited'`;
      await settle({ lobbyId, purchaseId: String(movePurchase!.id) });
      assert({
        given: 'the host moving the USD 99 tournament to unlimited',
        should:
          'offer and charge only USD 100 against the unlimited product, then accept the 65th',
        actual: {
          offered: view?.upgrades,
          move: move.kind,
          amount: movePurchase!.amount,
          line: moveLine,
          accept: refusal(await accept(sixtyFifth.id)),
          held: await checkout(as(host), lobbyId, 'event_unlimited'),
        },
        expected: {
          offered: [{ tier: 'event_unlimited', owed: 10000 }],
          move: 'redirect',
          amount: 10000,
          line: [
            {
              price_data: {
                currency: 'usd',
                product: 'prod_unlimited',
                unit_amount: 10000,
              },
              quantity: 1,
            },
          ],
          accept: 'accepted',
          held: { kind: 'held' },
        },
      });
    },
  });
}, 180_000);
