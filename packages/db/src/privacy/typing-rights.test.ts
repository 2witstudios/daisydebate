import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { createDatabase } from '../index';
import { createMessagingTypingPrivacyPort } from './typing-rights';
import { planPrivacyErasure } from './planner';
import { messagingTypingSchemas } from '@daisy/protocol';
import { deliverPrivacyJob } from './vendor-jobs';
setupRitewayBun();
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const account = { ...subject, member: true, erased: false, revision: 2 };
const lease = {
  version: 1 as const,
  channelId: 'c'.repeat(24),
  actorId: subject.actorId,
  authorityRevision: 2,
  relationshipRevision: 3,
  accountRevision: 2,
  ageRevision: 1,
  policyRevision: 1,
  expiresAt: '2026-10-10T00:00:00.000Z',
};
function fixture(rows = [account], exported: unknown = [lease]) {
  const fake = fakeSql([rows]);
  const calls: string[] = [];
  const port = createMessagingTypingPrivacyPort(
    drizzle({ client: fake.client }),
    {
      exportSubject: async (actorId) => {
        calls.push(`export:${actorId}`);
        return exported;
      },
      eraseSubject: async (actorId) => {
        calls.push(`erase:${actorId}`);
      },
    },
  );
  return { port, fake, calls };
}
test('typing erasure joins the canonical durable vendor intent planner', () => {
  const result = planPrivacyErasure(
    {
      subject,
      now: lease.expiresAt,
      vendors: ['messaging-typing'],
      jobIds: ['j'.repeat(24)],
    },
    { requiredAdopters: [], adopters: [] },
  );
  assert({
    given: 'a configured typing store',
    should: 'retain a retryable user-bound intent without lease payload',
    actual: result.jobs[0],
    expected: {
      id: 'j'.repeat(24),
      vendor: 'messaging-typing',
      subjectRef: subject.userId,
      createdAt: lease.expiresAt,
    },
  });
});
test('typing export resolves actual own account and includes retained expired personal leases', async () => {
  const f = fixture();
  const result = await f.port.export(subject);
  assert({
    given: 'actual own durable binding and a retained lease',
    should:
      'export only strict own lease data without Redis keys or eligibility grants',
    actual: [
      result,
      f.calls,
      f.fake.queries[0]?.query.includes('daisy_authorization_accounts'),
    ],
    expected: [[lease], [`export:${subject.actorId}`], true],
  });
});
test('typing export refuses forged binding and malformed or foreign output', async () => {
  for (const output of [
    [{ ...lease, actorId: 'b'.repeat(24) }],
    [{ ...lease, key: 'private-key' }],
    [{ ...lease, accountRevision: 0 }],
    null,
  ]) {
    const f = fixture([account], output);
    await assertRejects({
      given: 'untrusted external subject projection',
      should: 'refuse foreign or undeclared data',
      actual: () => f.port.export(subject),
      code: 'VALIDATION',
    });
  }
  const f = fixture([{ ...account, userId: 'b'.repeat(24) }]);
  await assertRejects({
    given: 'foreign durable account',
    should: 'refuse before external I/O',
    actual: () => f.port.export(subject),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'foreign durable binding',
    should: 'invoke no external projection',
    actual: f.calls,
    expected: [],
  });
});
test('typing physical erase requires committed tombstone and retained actual actor binding', async () => {
  const erased = fixture([{ ...account, member: false, erased: true }]);
  await erased.port.erase(subject.userId);
  assert({
    given: 'a committed erased subject',
    should: 'delete all own leases through the real producer',
    actual: erased.calls,
    expected: [`erase:${subject.actorId}`],
  });
  const live = fixture();
  await assertRejects({
    given: 'an uncommitted live account',
    should: 'refuse destructive vendor work',
    actual: () => live.port.erase(subject.userId),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'live account refusal',
    should: 'leave external state unchanged',
    actual: live.calls,
    expected: [],
  });
});
test('invalid subjects refuse before pool I/O and external failures stay structured', async () => {
  const f = fixture();
  await assertRejects({
    given: 'invalid subject ID',
    should: 'reject before SQL',
    actual: () => f.port.erase('invalid'),
    code: 'VALIDATION',
  });
  assert({
    given: 'invalid input',
    should: 'query nothing',
    actual: f.fake.queries,
    expected: [],
  });
  const fake = fakeSql([[{ ...account, member: false, erased: true }]]);
  const port = createMessagingTypingPrivacyPort(
    drizzle({ client: fake.client }),
    {
      exportSubject: async () => [],
      eraseSubject: async () => {
        throw new Error('private vendor detail');
      },
    },
  );
  await assertRejects({
    given: 'physical deletion outage',
    should: 'report a structured failure so the existing job retries',
    actual: () => port.erase(subject.userId),
    code: 'INFRASTRUCTURE',
  });
});

test('typing inventory matches the exact serialized producer, not fictional schema columns', () => {
  const declaration = fixture().port.declaration;
  assert({
    given: 'the portable lease schema and canonical Redis declaration',
    should: 'declare every actual field and retain policy holds',
    actual: [
      Object.keys(declaration.fields).sort(),
      declaration.storage,
      declaration.lawfulBasis.status,
      declaration.retention.status,
      declaration.key.exportable,
    ],
    expected: [
      Object.keys(messagingTypingSchemas.lease.shape).sort(),
      'redis',
      'pending',
      'pending',
      false,
    ],
  });
});

test('typing deletion outage remains a durable retry until physical producer ACK', async () => {
  for (const outage of [true, false]) {
    const fake = fakeSql([
      [{ subjectRef: subject.userId }],
      [{ ...account, member: false, erased: true }],
      [],
    ]);
    const database = drizzle({ client: fake.client });
    const calls: string[] = [];
    const port = createMessagingTypingPrivacyPort(database, {
      exportSubject: async () => [],
      eraseSubject: async (actorId) => {
        calls.push(actorId);
        if (outage) throw new Error('private response');
      },
    });
    const result = await deliverPrivacyJob(
      database,
      {
        jobId: 'j'.repeat(24),
        vendor: 'messaging-typing',
        now: lease.expiresAt,
        retryAt: '2026-10-10T00:01:00.000Z',
      },
      port,
    );
    assert({
      given: outage
        ? 'physical deletion outage after committed local erasure'
        : 'completed physical subject deletion',
      should:
        'mark success only after producer acknowledgement without storing private errors',
      actual: [
        result,
        calls,
        fake.queries.length,
        fake.queries[2]?.query.includes(
          outage ? 'retry_at' : "status = 'succeeded'",
        ),
        JSON.stringify(fake.queries).includes('private response'),
      ],
      expected: [
        outage ? 'retry' : 'succeeded',
        [subject.actorId],
        3,
        true,
        false,
      ],
    });
  }
});

test('public database factory binds typing rights to the existing pool without exposing Drizzle', async () => {
  const fake = fakeSql([[account]]);
  const database = createDatabase({
    url: 'postgresql://unit:unit@127.0.0.1:1/unit',
    client: fake.client,
    nextActorId: () => subject.actorId,
    eventSink: () => {},
  });
  const port = database.messagingTypingPrivacyPort({
    exportSubject: async () => [lease],
    eraseSubject: async () => {},
  });
  assert({
    given: 'the real public factory with an injected wire driver',
    should:
      'read canonical account facts on its original pool and return own lease data',
    actual: [await port.export(subject), fake.queries.length],
    expected: [[lease], 1],
  });
});
