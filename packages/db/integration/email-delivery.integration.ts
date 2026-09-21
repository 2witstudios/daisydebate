import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src';
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

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
  const database = createDatabase({ url });
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
    expect(await database.isRecipientSuppressed(hash)).toBe(false);

    const event = (
      eventId: string,
      status: string,
      rank: number,
      suppress: 'bounce' | 'complaint' | null = null,
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
    expect(await event(bounced, 'bounced', 4, 'bounce')).toBe('applied');
    expect(await event(`evt-${createId()}`, 'delivered', 3)).toBe('applied');
    // Concurrent redelivery of one event ID applies exactly once.
    const duplicate = `evt-${createId()}`;
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => event(duplicate, 'delayed', 2)),
    );
    expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(
      7,
    );
    expect(await event(bounced, 'bounced', 4, 'bounce')).toBe('duplicate');

    const probe = new SQL(url);
    try {
      const [row] =
        await probe`SELECT status, status_rank FROM email_delivery WHERE provider_message_id=${messageId}`;
      expect(row).toEqual({ status: 'bounced', status_rank: 4 });
    } finally {
      await probe.close();
    }
    expect(await database.isRecipientSuppressed(hash)).toBe(true);
  } finally {
    await database.close();
    await cleanup([messageId], [hash]);
  }
});

test('an event for an unrecorded message is retryable and leaves no dedupe row', async () => {
  const database = createDatabase({ url });
  const eventId = `evt-${createId()}`;
  const messageId = `msg-${createId()}`;
  try {
    expect(
      await database.applyEmailDeliveryEvent({
        eventId,
        providerMessageId: messageId,
        status: 'delivered',
        rank: 3,
        suppress: null,
        at,
      }),
    ).toBe('unknown-message');
    await database.recordEmailDelivery({
      providerMessageId: messageId,
      recipientHash: `hash-${createId()}`,
      at,
    });
    // The provider retries the same event ID after the send is recorded.
    expect(
      await database.applyEmailDeliveryEvent({
        eventId,
        providerMessageId: messageId,
        status: 'delivered',
        rank: 3,
        suppress: null,
        at,
      }),
    ).toBe('applied');
  } finally {
    await database.close();
    await cleanup([messageId], []);
  }
});
