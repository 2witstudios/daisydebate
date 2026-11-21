import { accountAgePrivacyAdopter } from '../src/account-age';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { assertRejects } from '@daisy/errors/testing';
import { runPrivacyErasure, runPrivacyExport } from '../src/privacy/operations';
import type { PrivacyAdopter, PrivacyExport } from '../src/privacy/contracts';
import {
  bindings,
  now,
  withPrivacySubject,
  subjectVerificationCount,
} from './privacy.test-support';
setupRitewayBun();
requireTestServices(process.env);
const adoption: readonly PrivacyAdopter[] = [];
test('erasure fences the account, runs its adopters in phase and queues the vendor last', async () => {
  await withPrivacySubject(async ({ client, userId, actorId, otherId }) => {
    const statements: string[] = [];
    const database = drizzle({
      client,
      logger: { logQuery: (query) => statements.push(query.trim()) },
    });
    const subject = { userId, actorId };
    const jobId = createId();
    const input = { subject, now, vendors: ['posthog'], jobIds: [jobId] };
    const phase = (name: PrivacyAdopter['phase']): PrivacyAdopter => ({
      id: name,
      phase: name,
      export: async () => ({}),
      erase: async (tx) => {
        const [state] = await tx.execute(
          sql`select deleted_at is not null as erased from users where id = ${userId}`,
        );
        const [session] = await tx.execute(
          sql`select count(*)::int as found from session where user_id = ${userId}`,
        );
        const [jobs] = await tx.execute(
          sql`select count(*)::int as found from privacy_jobs where subject_ref = ${userId}`,
        );
        assert({
          given: `the ${name} adopter`,
          should:
            'see its phase’s account and auth state before vendor jobs exist',
          actual: [state?.erased, session?.found, jobs?.found],
          expected: name === 'before-auth' ? [false, 1, 0] : [true, 0, 0],
        });
      },
    });
    const adopted = [phase('before-auth'), phase('after-close')];
    for (const refusedSubject of [
      { ...subject, userId: otherId },
      { ...subject, actorId: createId() },
    ]) {
      statements.length = 0;
      await assertRejects({
        given: 'a real account and an invalid user-actor relationship',
        should: 'refuse before cleanup',
        actual: () =>
          runPrivacyErasure(
            database,
            { ...input, subject: refusedSubject },
            adopted,
            bindings,
          ),
        code: 'AUTHORIZATION',
      });
      assert({
        given: 'the refused canonical erasure',
        should: 'issue only the account fence',
        actual: [
          statements.length,
          statements[0]?.includes('daisy_authorization_accounts'),
        ],
        expected: [1, true],
      });
    }
    statements.length = 0;
    try {
      const first = await runPrivacyErasure(database, input, adopted, bindings);
      const firstReads = statements.splice(0);
      const replay = await runPrivacyErasure(
        database,
        input,
        adopted,
        bindings,
      );
      assert({
        given: 'successful canonical erasure and its replay',
        should:
          'fence first, preserve the guarded verification query, queue one vendor last, then return the erased replay with no further cleanup',
        actual: [
          first.alreadyErased,
          first.jobs.length,
          firstReads[0]?.includes('daisy_authorization_accounts'),
          firstReads.some((query) => query.includes('value is json object')),
          firstReads.at(-1)?.includes('insert into privacy_jobs'),
          replay,
          statements.length,
        ],
        expected: [
          false,
          1,
          true,
          true,
          true,
          { alreadyErased: true, jobs: [] },
          1,
        ],
      });
    } finally {
      await client`delete from privacy_jobs where id = ${jobId}`;
    }
  });
});
test('local erasure is atomic and removes only bound auth subjects', async () => {
  await withPrivacySubject(
    async ({ client, database, userId, actorId, otherId }) => {
      await client.unsafe('update users set username=$1 where id=$2', [
        `closed${userId.slice(0, 8)}`,
        userId,
      ]);
      const result = await runPrivacyErasure(
        database,
        { subject: { userId, actorId }, now, vendors: [], jobIds: [] },
        adoption,
        bindings,
      );
      const users = await client.unsafe(
        'select username,email,name,image,email_verified,version,deleted_at is not null as erased from users where id=$1',
        [userId],
      );
      const ownVerifications = await subjectVerificationCount(client, userId);
      const otherVerifications = await subjectVerificationCount(
        client,
        otherId,
      );
      const opaque = await client.unsafe(
        "select count(*)::int as n from verification where value='opaque-non-json'",
      );
      const counts = await Promise.all(
        ['session', 'account', 'passkey'].map((table) =>
          client.unsafe(
            `select count(*)::int as n from ${table} where user_id=$1`,
            [userId],
          ),
        ),
      );
      const actors = await client.unsafe(
        'select user_id from actors where id=$1',
        [actorId],
      );
      assert({
        given:
          'subject and unrelated auth tokens, including opaque verification',
        should:
          'clear private fields, keep the username, remove auth binding, retain unrelated tokens and actor',
        actual: [
          result,
          users[0],
          ownVerifications,
          otherVerifications,
          opaque[0]?.n,
          counts.map((rows) => rows[0]?.n),
          actors[0]?.user_id,
        ],
        expected: [
          { alreadyErased: false, jobs: [] },
          {
            username: `closed${userId.slice(0, 8)}`,
            email: null,
            name: '',
            image: null,
            email_verified: false,
            version: 2,
            erased: true,
          },
          0,
          5,
          1,
          [0, 0, 0],
          userId,
        ],
      });
    },
  );
});

test('late adopter failure rolls back scrub auth deletion and earlier cleanup', async () => {
  await withPrivacySubject(
    async ({ client, database, userId, actorId, email }) => {
      const early: PrivacyAdopter = {
        id: 'early',
        phase: 'before-auth',
        export: async () => ({}),
        erase: async (tx) => {
          await tx.execute(sql`delete from session where user_id=${userId}`);
        },
      };
      const late: PrivacyAdopter = {
        ...early,
        id: 'late',
        phase: 'after-close',
        erase: async () => {
          throw new Error('adopter failed');
        },
      };
      const adopted = [early, late];
      await expect(
        runPrivacyErasure(
          database,
          { subject: { userId, actorId }, now, vendors: [], jobIds: [] },
          adopted,
          bindings,
        ),
      ).rejects.toThrow('adopter failed');
      const rows = await client.unsafe(
        'select email,version,deleted_at from users where id=$1',
        [userId],
      );
      const sessions = await client.unsafe(
        'select count(*)::int as n from session where user_id=$1',
        [userId],
      );
      assert({
        given:
          'failure after scrub and auth cleanup in the same real transaction',
        should: 'restore original user and session',
        actual: [
          rows[0],
          sessions[0]?.n,
          await subjectVerificationCount(client, userId),
        ],
        expected: [{ email, version: 1, deleted_at: null }, 1, 5],
      });
    },
  );
});

test('export returns only bound subject data and rejects a mismatched principal', async () => {
  await withPrivacySubject(
    async ({ database, userId, actorId, otherId, email }) => {
      const result = await runPrivacyExport(
        database,
        { userId, actorId },
        adoption,
      );
      assert({
        given: 'two users and one requesting subject',
        should: 'return the requesting account alone',
        actual: [
          result.users?.length,
          result.users?.[0]?.id,
          result.users?.[0]?.email,
        ],
        expected: [1, userId, email],
      });
      await assertRejects({
        given: 'another user ID paired with the subject actor',
        should: 'refuse subject impersonation',
        actual: () =>
          runPrivacyExport(database, { userId: otherId, actorId }, adoption),
        code: 'AUTHORIZATION',
      });
    },
  );
});

test('canonical export refuses duplicate tables and non-JSON values', async () => {
  await withPrivacySubject(async ({ database, userId, actorId }) => {
    const invalidExports: unknown[] = [
      { users: [] },
      { account_age: null },
      { account_age: [{ birth_month: new Date(now) }] },
    ];
    for (const invalid of invalidExports) {
      await assertRejects({
        given: 'an adopter exporting a duplicate table or malformed JSON',
        should: 'refuse the complete export',
        actual: () =>
          runPrivacyExport(database, { userId, actorId }, [
            {
              ...accountAgePrivacyAdopter,
              export: async () => invalid as PrivacyExport,
            },
          ]),
        code: 'VALIDATION',
      });
    }
  });
});
