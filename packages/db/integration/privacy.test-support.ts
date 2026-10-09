import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import type { PrivacyVerificationBinding } from '../src/privacy';
import { withFixture } from './constraint-helpers';
const { databaseUrl } = requireTestServices(process.env);
export const now = '2026-10-09T18:00:00.000Z';
export const bindings: readonly PrivacyVerificationBinding[] = [
  { purpose: 'sign-in', subject: 'email' },
  { purpose: 'email-change-approve', subject: 'userId' },
  { purpose: 'email-change-verify', subject: 'userId' },
  {
    jsonTypes: ['registration', 'authentication'],
    subjectPath: ['userData', 'id'],
  },
];
export async function withPrivacySubject(
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
        const values =
          'purpose' in binding
            ? [
                binding.subject === 'email'
                  ? { email: `${owner}@privacy.invalid`.toUpperCase() }
                  : {
                      userId: owner,
                      email: `${owner}@privacy.invalid`,
                      newEmail: `${owner}@new.invalid`,
                    },
              ]
            : binding.jsonTypes.map((type) => ({
                type,
                userData: { id: owner },
                expectedChallenge: 'private-challenge',
              }));
        for (const value of values) {
          const id = createId();
          verificationIds.push(id);
          const identifier =
            'purpose' in binding ? `${binding.purpose}:${id}` : id;
          await fixture.sql.unsafe(
            'insert into verification(id,identifier,value,expires_at) values($1,$2,$3,$4)',
            [id, identifier, JSON.stringify(value), now],
          );
        }
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
        `delete from verification where id in (${verificationIds.map((_, index) => `$${index + 1}`).join(',')})`,
        verificationIds,
      );
      for (const table of ['session', 'account', 'passkey'])
        await fixture.sql.unsafe(`delete from ${table} where user_id=$1`, [
          userId,
        ]);
    }
  });
}

export async function subjectVerificationCount(client: SQL, userId: string) {
  const rows = await client.unsafe(
    "select count(*)::int as n from verification where case when value is json object then value::jsonb ->> 'userId'=$1 or value::jsonb #>> '{userData,id}'=$1 or lower(value::jsonb ->> 'email')=$2 else false end",
    [userId, `${userId}@privacy.invalid`],
  );
  return rows[0]?.n;
}
