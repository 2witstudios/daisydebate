import { sql } from 'drizzle-orm';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { assertRejects } from '@daisy/errors/testing';
import {
  erasePrivacySubject,
  exportPrivacySubject,
  type PrivacyAdopter,
} from '../src/privacy';
import { bindings, now, withPrivacySubject } from './privacy.test-support';
setupRitewayBun();
requireTestServices(process.env);
const adoption = { requiredAdopters: [], adopters: [] };
test('local erasure is atomic and removes only bound auth subjects', async () => {
  await withPrivacySubject(
    async ({ client, database, userId, actorId, otherId }) => {
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
        given:
          'subject and unrelated auth tokens, including opaque verification',
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
    },
  );
});

test('late adopter failure rolls back scrub auth deletion and earlier cleanup', async () => {
  await withPrivacySubject(
    async ({ client, database, userId, actorId, email }) => {
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
    },
  );
});

test('export returns only bound subject data and rejects a mismatched principal', async () => {
  await withPrivacySubject(
    async ({ database, userId, actorId, otherId, email }) => {
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
          exportPrivacySubject(
            database,
            { userId: otherId, actorId },
            adoption,
          ),
        code: 'AUTHORIZATION',
      });
    },
  );
});
