import { createMailStore } from '../src/stores/mail';
import { openDatabaseResources } from '../src/resources';
import { hostWaits } from '@daisy/worker/host';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import type {
  EmailDeliveryStatus,
  EmailSuppressionReason,
} from '@daisy/protocol/email-delivery';
/** This file's database: the area stores it reads, over one set of resources. */
const openStores = (options: Parameters<typeof openDatabaseResources>[0]) => {
  const resources = openDatabaseResources(options);
  return {
    ...createMailStore(resources),
    close: resources.close,
  };
};

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const at = '2026-09-20T00:00:00.000Z';
const cleanup = async (messageIds: string[], hashes: string[]) => {
  const sql = new SQL(url);
  try {
    for (const id of messageIds) {
      await sql`DELETE FROM email_delivery_event WHERE provider_message_id=${id}`;
      await sql`DELETE FROM email_delivery WHERE provider_message_id=${id}`;
    }
    for (const hash of hashes)
      await sql`DELETE FROM email_suppression WHERE recipient_hash=${hash}`;
  } finally {
    await sql.close();
  }
};

test('delivery events dedupe, never lower status, and suppress only after hard failure', async () => {
  const messageId = `msg-${createId()}`;
  const hash = `hash-${createId()}`;
  const database = openStores({
    waits: hostWaits,
    url,
  });
  try {
    await database.recordEmailDelivery({
      providerMessageId: messageId,
      recipientHash: hash,
      at,
    });
    // Retrying the same provider message (same idempotency key) is a no-op.
    await database.recordEmailDelivery({
      providerMessageId: messageId,
      recipientHash: hash,
      at,
    });
    const suppressedBefore = await database.isRecipientSuppressed(hash);

    const event = (
      eventId: string,
      status: EmailDeliveryStatus,
      rank: number,
      suppress: EmailSuppressionReason | null = null,
    ) =>
      database.applyEmailDeliveryEvent({
        eventId,
        providerMessageId: messageId,
        status,
        rank,
        suppress,
        at,
      });
    const bounced = `evt-${createId()}`;
    // Out of order: the terminal bounce arrives before "delivered".
    const outOfOrder = [
      await event(bounced, 'bounced', 5, 'bounce'),
      await event(`evt-${createId()}`, 'delivered', 3),
    ];
    // Concurrent redelivery of one event ID applies exactly once.
    const duplicate = `evt-${createId()}`;
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => event(duplicate, 'delayed', 2)),
    );
    const redelivered = await event(bounced, 'bounced', 5, 'bounce');
    const probe = new SQL(url);
    const [stored] =
      await probe`SELECT status, status_rank FROM email_delivery WHERE provider_message_id=${messageId}`.finally(
        () => probe.close(),
      );
    assert({
      given:
        'a recorded send, an early bounce, a late delivered, eight concurrent copies of one event and a redelivered bounce',
      should:
        'apply each event ID once, keep the highest status, and suppress only after the bounce',
      actual: {
        suppressedBefore,
        outOfOrder,
        concurrent: [...concurrent].sort(),
        redelivered,
        stored,
        suppressedAfter: await database.isRecipientSuppressed(hash),
      },
      expected: {
        suppressedBefore: false,
        outOfOrder: ['applied', 'applied'],
        concurrent: ['applied', ...Array(7).fill('duplicate')],
        redelivered: 'duplicate',
        stored: { status: 'bounced', status_rank: 5 },
        suppressedAfter: true,
      },
    });
  } finally {
    await database.close();
    await cleanup([messageId], [hash]);
  }
});

test('an event for an unrecorded message is retryable and leaves no dedupe row', async () => {
  const database = openStores({
    waits: hostWaits,
    url,
  });
  const eventId = `evt-${createId()}`;
  const messageId = `msg-${createId()}`;
  const apply = () =>
    database.applyEmailDeliveryEvent({
      eventId,
      providerMessageId: messageId,
      status: 'delivered',
      rank: 3,
      suppress: null,
      at,
    });
  try {
    const beforeSend = await apply();
    await database.recordEmailDelivery({
      providerMessageId: messageId,
      recipientHash: `hash-${createId()}`,
      at,
    });
    // The provider retries the same event ID after the send is recorded.
    assert({
      given: 'an event before its send is recorded, retried after',
      should: 'answer unknown-message first, leaving no dedupe row, then apply',
      actual: [beforeSend, await apply()],
      expected: ['unknown-message', 'applied'],
    });
  } finally {
    await database.close();
    await cleanup([messageId], []);
  }
});

test('permission failures report only the safe delivery operation names', async () => {
  const client = new SQL(url, { max: 1 });
  const telemetry: unknown[] = [];
  const database = openStores({
    waits: hostWaits,
    url,
    client,
    eventSink: (event, fields, message) =>
      telemetry.push({ event, fields, message }),
  });
  const marker = createId();
  try {
    await client`set role daisy_realtime`;
    const denied = (work: Promise<unknown>) =>
      work.then(
        () => 'resolved',
        (error: Error) => Reflect.get(error.cause ?? error, 'errno'),
      );
    const failures = [
      await denied(
        database.recordEmailDelivery({
          providerMessageId: marker,
          recipientHash: marker,
          at,
        }),
      ),
      await denied(database.isRecipientSuppressed(marker)),
      await denied(
        database.applyEmailDeliveryEvent({
          eventId: marker,
          providerMessageId: marker,
          status: 'bounced',
          rank: 5,
          suppress: 'bounce',
          at,
        }),
      ),
    ];
    assert({
      given: 'three real ledger queries made by a role without access',
      should:
        'propagate PostgreSQL’s permission error and report only each operation',
      actual: [failures, telemetry],
      expected: [
        ['42501', '42501', '42501'],
        [
          'recordEmailDelivery',
          'isRecipientSuppressed',
          'applyEmailDeliveryEvent',
        ].map((operation) => ({
          event: 'db.query.failed',
          fields: { operation },
          message: 'Database query failed',
        })),
      ],
    });
  } finally {
    await client`reset role`;
    await database.close();
    await client.close();
  }
});
