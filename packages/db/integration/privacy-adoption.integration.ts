import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { assertRejects } from '@daisy/errors/testing';
import {
  deliverPrivacyJob,
  erasePrivacySubject,
  exportPrivacySubject,
  type PrivacyAdopter,
  type PrivacyVerificationBinding,
} from '../src/privacy';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const now = '2026-10-09T18:00:00.000Z';
const bindings: readonly PrivacyVerificationBinding[] = [
  { purpose: 'sign-in', subject: 'email' },
  { purpose: 'email-change-approve', subject: 'userId' },
  { purpose: 'email-change-verify', subject: 'userId' },
  {
    jsonTypes: ['registration', 'authentication'],
    subjectPath: ['userData', 'id'],
  },
];
const adoption = { requiredAdopters: [], adopters: [] };

async function withSubject(
  run: (input: {
    client: SQL;
    userId: string;
    actorId: string;
    otherId: string;
    email: string;
    database: ReturnType<typeof drizzle>;
  }) => Promise<void>,
) {
  await withFixture(databaseUrl, async (fixture) => {
    const userId = await fixture.user();
    const actorId = await fixture.actor(userId);
    const otherId = await fixture.user();
    const email = `${userId}@privacy.invalid`;
    await fixture.sql.unsafe(
      "update users set email=$1, name='Private name', image='private-image', email_verified=true where id=$2",
      [email, userId],
    );
    const verificationIds: string[] = [];
    for (const owner of [userId, otherId]) {
      for (const binding of bindings) {
        const id = createId();
        verificationIds.push(id);
        const identifier =
          'purpose' in binding ? `${binding.purpose}:${id}` : id;
        const value =
          'purpose' in binding
            ? {
                userId: owner,
                email: `${owner}@privacy.invalid`,
                newEmail: `${owner}@new.invalid`,
              }
            : {
                type: 'registration',
                userData: { id: owner },
                expectedChallenge: 'private-challenge',
              };
        await fixture.sql.unsafe(
          'insert into verification(id,identifier,value,expires_at) values($1,$2,$3,$4)',
          [id, identifier, JSON.stringify(value), now],
        );
      }
    }
    const opaque = createId();
    verificationIds.push(opaque);
    await fixture.sql.unsafe(
      "insert into verification(id,identifier,value,expires_at) values($1,$1,'opaque-non-json',$2)",
      [opaque, now],
    );
    await fixture.sql.unsafe(
      'insert into session(id,token,user_id,expires_at) values($1,$2,$3,$4)',
      [createId(), createId(), userId, now],
    );
    await fixture.sql.unsafe(
      "insert into account(id,account_id,provider_id,user_id,password) values($1,$2,'credential',$2,'private-password')",
      [createId(), userId],
    );
    await fixture.sql.unsafe(
      "insert into passkey(id,public_key,user_id,credential_id,counter,device_type,backed_up) values($1,'private-key',$2,$3,0,'singleDevice',false)",
      [createId(), userId, createId()],
    );
    try {
      await run({
        client: fixture.sql,
        userId,
        actorId,
        otherId,
        email,
        database: drizzle({ client: fixture.sql }),
      });
    } finally {
      await fixture.sql.unsafe(
        'delete from verification where id in ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        verificationIds,
      );
      for (const table of ['session', 'account', 'passkey'])
        await fixture.sql.unsafe(`delete from ${table} where user_id=$1`, [
          userId,
        ]);
    }
  });
}

test('local erasure is atomic and removes only bound auth subjects', async () => {
  await withSubject(async ({ client, database, userId, actorId, otherId }) => {
    const result = await erasePrivacySubject(
      database,
      { subject: { userId, actorId }, now, vendors: [], jobIds: [] },
      adoption,
      bindings,
    );
    const users = await client.unsafe(
      'select username,email,name,image,email_verified,version,deleted_at is not null as erased from users where id=$1',
      [userId],
    );
    const remaining = await client.unsafe(
      "select count(*)::int as n from verification where case when value is json object then value::jsonb ->> 'userId'=$1 or value::jsonb #>> '{userData,id}'=$1 else false end",
      [otherId],
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
      given: 'subject and unrelated auth tokens, including opaque verification',
      should:
        'scrub subject, remove auth binding, retain unrelated tokens and actor',
      actual: [
        result,
        users[0],
        remaining[0]?.n,
        counts.map((rows) => rows[0]?.n),
        actors[0]?.user_id,
      ],
      expected: [
        { alreadyErased: false, jobs: [] },
        {
          username: null,
          email: null,
          name: '',
          image: null,
          email_verified: false,
          version: 2,
          erased: true,
        },
        4,
        [0, 0, 0],
        userId,
      ],
    });
  });
});

test('late adopter failure rolls back scrub auth deletion and earlier cleanup', async () => {
  await withSubject(async ({ client, database, userId, actorId, email }) => {
    const early: PrivacyAdopter = {
      id: 'early',
      phase: 'before-auth',
      fields: [],
      export: async () => ({}),
      erase: async (tx) => {
        await tx.execute(sql`delete from session where user_id=${userId}`);
      },
    };
    const late: PrivacyAdopter = {
      ...early,
      id: 'late',
      phase: 'after-scrub',
      erase: async () => {
        throw new Error('adopter failed');
      },
    };
    const adopted = {
      requiredAdopters: [early, late].map((item) => ({
        id: item.id,
        phase: item.phase,
        expectedColumns: {},
      })),
      adopters: [early, late],
    };
    await expect(
      erasePrivacySubject(
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
      actual: [rows[0], sessions[0]?.n],
      expected: [{ email, version: 1, deleted_at: null }, 1],
    });
  });
});

test('export returns only bound subject data and rejects a mismatched principal', async () => {
  await withSubject(async ({ database, userId, actorId, otherId, email }) => {
    const result = await exportPrivacySubject(
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
        exportPrivacySubject(database, { userId: otherId, actorId }, adoption),
      code: 'AUTHORIZATION',
    });
  });
});

test('configured vendor outage cannot reverse committed local erasure', async () => {
  await withSubject(async ({ client, database, userId, actorId }) => {
    const jobId = createId();
    const subject = { userId, actorId };
    const retryAt = '2026-10-09T18:01:00.000Z';
    const observer = new SQL(databaseUrl, { max: 1 });
    try {
      const result = await erasePrivacySubject(
        database,
        { subject, now, vendors: ['posthog'], jobIds: [jobId] },
        adoption,
        bindings,
      );
      let observedCommit = false;
      const retry = await deliverPrivacyJob(
        database,
        { jobId, vendor: 'posthog', now, retryAt },
        {
          erase: async (subjectRef) => {
            const rows = await observer.unsafe(
              'select email, deleted_at is not null as erased from users where id=$1',
              [subjectRef],
            );
            observedCommit =
              rows[0]?.erased === true && rows[0]?.email === null;
            throw new Error('private vendor outage payload');
          },
        },
      );
      const pending = await client.unsafe(
        'select subject_ref,vendor,status,attempts from privacy_jobs where id=$1',
        [jobId],
      );
      const success = await deliverPrivacyJob(
        database,
        {
          jobId,
          vendor: 'posthog',
          now: retryAt,
          retryAt: '2026-10-09T18:02:00.000Z',
        },
        { erase: async () => {} },
      );
      const finished = await client.unsafe(
        'select status,attempts,succeeded_at is not null as acknowledged from privacy_jobs where id=$1',
        [jobId],
      );
      assert({
        given: 'a committed subject tombstone and configured vendor failure',
        should:
          'retain a durable retry, then acknowledge without restoring local data',
        actual: [
          result.jobs.length,
          observedCommit,
          retry,
          pending[0],
          success,
          finished[0],
        ],
        expected: [
          1,
          true,
          'retry',
          {
            subject_ref: userId,
            vendor: 'posthog',
            status: 'pending',
            attempts: 1,
          },
          'succeeded',
          { status: 'succeeded', attempts: 2, acknowledged: true },
        ],
      });
    } finally {
      await client.unsafe('delete from privacy_jobs where subject_ref=$1', [
        userId,
      ]);
      await observer.close();
    }
  });
});
