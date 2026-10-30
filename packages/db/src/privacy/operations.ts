import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import {
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import type {
  PrivacyAdopter,
  PrivacyExport,
  PrivacySubject,
} from './contracts';
import {
  planPrivacyErasure,
  planPrivacyExport,
  type PrivacyAdoption,
  type PrivacyErasureInput,
} from './planner';

/** Supplied by the actual token producer, never inferred from token text. */
export type PrivacyVerificationBinding =
  | {
      readonly purpose: string;
      readonly subject: 'email' | 'userId';
    }
  | {
      readonly jsonTypes: readonly string[];
      readonly subjectPath: readonly string[];
    };
type PrivacyDatabase = Pick<BunSQLDatabase, 'transaction'>;

async function lockSubject(
  tx: AuthorizationTransaction,
  subject: PrivacySubject,
) {
  const facts = await lockAuthorizationActors(tx, [subject.actorId], {
    maxActors: 1,
  });
  const fact = facts[0];
  if (
    facts.length !== 1 ||
    !fact ||
    fact.userId !== subject.userId ||
    fact.actorId !== subject.actorId
  )
    throw createAppError('AUTHORIZATION');
  return fact;
}

function checkBindings(bindings: readonly PrivacyVerificationBinding[]) {
  const canonical = z
    .string()
    .min(1)
    .refine((value) => value === value.trim());
  const schemas = z.union([
    z
      .object({
        purpose: canonical,
        subject: z.enum(['email', 'userId']),
      })
      .strict(),
    z
      .object({
        jsonTypes: z.array(canonical).min(1),
        subjectPath: z.array(canonical).min(1),
      })
      .strict(),
  ]);
  if (
    bindings.length === 0 ||
    bindings.some((binding) => !schemas.safeParse(binding).success)
  )
    throw createAppError('VALIDATION');
  const keys = bindings.map((binding) => JSON.stringify(binding));
  if (new Set(keys).size !== keys.length) throw createAppError('VALIDATION');
}

async function eraseAdopters(
  tx: AuthorizationTransaction,
  subject: PrivacySubject,
  now: string,
  adoption: PrivacyAdoption,
  phase: PrivacyAdopter['phase'],
) {
  for (const adopter of adoption.filter((item) => item.phase === phase))
    await adopter.erase(tx, subject, { now });
}

/**
 * Owns transaction commit; external calls cannot participate in local
 * erasure. The account closes: its email, name, image and sign-in rows go,
 * its username stays on the competitive record and stays reserved (ADR 0087).
 */
export async function runPrivacyErasure(
  database: PrivacyDatabase,
  input: PrivacyErasureInput,
  adoption: PrivacyAdoption,
  verificationBindings: readonly PrivacyVerificationBinding[],
) {
  const plan = planPrivacyErasure(input, adoption);
  checkBindings(verificationBindings);
  return database.transaction(async (tx) => {
    const account = await lockSubject(tx, plan.subject);
    if (account.erased) return { alreadyErased: true, jobs: [] };
    await eraseAdopters(tx, plan.subject, plan.now, adoption, 'before-auth');
    for (const binding of verificationBindings) {
      if ('purpose' in binding) {
        const condition =
          binding.subject === 'userId'
            ? sql`value::jsonb ->> 'userId' = ${plan.subject.userId}`
            : sql`lower(value::jsonb ->> 'email') = (select lower(email) from users where id = ${plan.subject.userId})`;
        await tx.execute(sql`delete from verification where case
          when starts_with(identifier, ${`${binding.purpose}:`}) then ${condition}
          else false end`);
      } else {
        await tx.execute(sql`delete from verification where case
          when value is json object then case
            when value::jsonb ->> 'type' in (${sql.join(
              binding.jsonTypes.map((type) => sql`${type}`),
              sql`, `,
            )})
              then value::jsonb #>> ARRAY[${sql.join(
                binding.subjectPath.map((key) => sql`${key}`),
                sql`, `,
              )}]::text[] = ${plan.subject.userId}
            else false end
          else false end`);
      }
    }
    for (const table of ['session', 'account', 'passkey'])
      await tx.execute(
        sql`delete from ${sql.identifier(table)} where user_id = ${plan.subject.userId}`,
      );
    await tx.execute(sql`update users set email = null, image = null,
      name = '', email_verified = false, deleted_at = ${plan.now}::timestamptz,
      updated_at = ${plan.now}::timestamptz, version = version + 1
      where id = ${plan.subject.userId}`);
    await eraseAdopters(tx, plan.subject, plan.now, adoption, 'after-close');
    for (const job of plan.jobs)
      await tx.execute(sql`insert into privacy_jobs
      (id, subject_ref, vendor, status, attempts, created_at, retry_at)
      values (${job.id}, ${job.subjectRef}, ${job.vendor}, 'pending', 0,
        ${job.createdAt}::timestamptz, ${job.createdAt}::timestamptz)
      on conflict (subject_ref, vendor) do update set id=excluded.id,
        status='pending', attempts=0, created_at=excluded.created_at,
        retry_at=excluded.retry_at, succeeded_at=null`);
    return { alreadyErased: false, jobs: plan.jobs };
  });
}

const exportShape = z.record(
  z.string(),
  z.array(z.record(z.string(), z.json())),
);

/** Every adopter returns its own tables as plain JSON rows, never another's. */
function checkedExport(result: PrivacyExport) {
  if (!exportShape.safeParse(result).success)
    throw createAppError('VALIDATION');
  return result;
}

/** Locked snapshot: each adopter returns its own subject rows, never arbitrary history. */
export async function runPrivacyExport(
  database: PrivacyDatabase,
  subject: PrivacySubject,
  adoption: PrivacyAdoption,
): Promise<PrivacyExport> {
  const plan = planPrivacyExport(subject, adoption);
  return database.transaction(async (tx) => {
    await lockSubject(tx, plan.subject);
    const rows =
      await tx.execute(sql`select id, username, email, email_verified, name, image,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
      to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
      version, to_char(deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as deleted_at
      from users where id = ${plan.subject.userId}`);
    const result: Record<string, readonly Readonly<Record<string, unknown>>[]> =
      { ...checkedExport({ users: rows as unknown as PrivacyExport[string] }) };
    for (const adopter of adoption) {
      const exported = checkedExport(await adopter.export(tx, plan.subject));
      for (const [table, records] of Object.entries(exported)) {
        if (Object.hasOwn(result, table)) throw createAppError('VALIDATION');
        result[table] = records;
      }
    }
    return result;
  });
}
