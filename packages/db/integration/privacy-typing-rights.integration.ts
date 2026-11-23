import { hostWaits } from '@daisy/worker/host';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { createMessagingTypingPrivacyPort } from '../src/privacy/typing-rights';
import { runPrivacyErasure } from '../src/privacy/operations';
import { bindings, now, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('typing rights bind producer work to the real subject and require a committed tombstone', async () => {
  await withPrivacySubject(async ({ client, userId, actorId, otherId }) => {
    const subject = { userId, actorId };
    const lease = {
      version: 1,
      channelId: createId(),
      actorId,
      authorityRevision: 2,
      relationshipRevision: 3,
      accountRevision: 2,
      ageRevision: 1,
      policyRevision: 1,
      expiresAt: '2000-01-01T00:00:00.000Z',
    };
    const statements: string[] = [];
    const database = drizzle({
      client,
      logger: { logQuery: (query) => statements.push(query) },
    });
    let rawExport: unknown = [lease];
    let outage = false;
    const calls: [string, string][] = [];
    const producer = {
      exportSubject: async (id: string) => {
        calls.push(['export', id]);
        return rawExport;
      },
      eraseSubject: async (id: string) => {
        if (outage) throw new Error('private store detail');
        calls.push(['erase', id]);
      },
    };
    const port = createMessagingTypingPrivacyPort(database, producer);
    const publicDb = createDatabase({
      waits: hostWaits,
      url,
      nextActorId: createId,
    });
    try {
      await assertRejects({
        given: 'a live account',
        should: 'refuse physical erase before calling the producer',
        actual: () => port.erase(userId),
        code: 'AUTHORIZATION',
      });
      await assertRejects({
        given: 'a real actor paired with the wrong user',
        should: 'refuse foreign export before producer I/O',
        actual: () => port.export({ ...subject, userId: otherId }),
        code: 'AUTHORIZATION',
      });
      statements.length = 0;
      await assertRejects({
        given: 'a malformed user identifier',
        should: 'refuse before SQL',
        actual: () => port.erase('invalid'),
        code: 'VALIDATION',
      });
      assert({
        given: 'the invalid and unauthorized calls',
        should:
          'leave the producer untouched and issue no malformed request SQL',
        actual: [calls, statements],
        expected: [[], []],
      });
      const own = await port.export(subject);
      const publicOwn = await publicDb
        .messagingTypingPrivacyPort(producer)
        .export(subject);
      assert({
        given: 'the native bound subject including a retained, expired lease',
        should: 'return its strict lease through both ports',
        actual: [
          own,
          publicOwn,
          statements[0]?.includes('daisy_authorization_accounts'),
        ],
        expected: [[lease], [lease], true],
      });
      for (const invalid of [
        [{ ...lease, actorId: createId() }],
        [{ ...lease, key: 'private-store-key' }],
        [{ ...lease, accountRevision: 0 }],
        null,
      ]) {
        rawExport = invalid;
        await assertRejects({
          given: 'invalid or foreign output from the external port',
          should: 'refuse before exposing it to the reader',
          actual: () => port.export(subject),
          code: 'VALIDATION',
        });
      }
      await runPrivacyErasure(
        database,
        { subject, now, vendors: [], jobIds: [] },
        [],
        bindings,
      );
      await port.erase(userId);
      assert({
        given: 'a new committed tombstone',
        should: 'erase only the bound actor’s leases',
        actual: calls.filter(([operation]) => operation === 'erase'),
        expected: [['erase', actorId]],
      });
      outage = true;
      await assertRejects({
        given: 'a producer outage after committed erasure',
        should: 'leave only the structured retryable error',
        actual: () => port.erase(userId),
        code: 'INFRASTRUCTURE',
      });
    } finally {
      await publicDb.close();
    }
  });
});
