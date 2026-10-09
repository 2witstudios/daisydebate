import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import {
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import type {
  PrivacyExport,
  PrivacyFieldDeclaration,
  PrivacySubject,
} from './contracts';
import { corePrivacyFields } from './core-declarations';
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
  const facts = await lockAuthorizationActors(tx, [subject.actorId]);
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
  const schemas = z.union([
    z
      .object({
        purpose: z.string().trim().min(1),
        subject: z.enum(['email', 'userId']),
      })
      .strict(),
    z
      .object({
        jsonTypes: z.array(z.string().trim().min(1)).min(1),
        subjectPath: z.array(z.string().trim().min(1)).min(1),
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
  phase: 'before-auth' | 'after-scrub',
) {
  for (const required of adoption.requiredAdopters.filter(
    (item) => item.phase === phase,
  )) {
    const adopter = adoption.adopters.find((item) => item.id === required.id)!;
    await adopter.erase(tx, subject, { now });
  }
}

/** Owns transaction commit; external calls cannot participate in local erasure. */
export async function erasePrivacySubject(
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
    await tx.execute(sql`update users set username = null, email = null, image = null,
      name = '', email_verified = false, deleted_at = ${plan.now}::timestamptz,
      updated_at = ${plan.now}::timestamptz, version = version + 1
      where id = ${plan.subject.userId}`);
    await eraseAdopters(tx, plan.subject, plan.now, adoption, 'after-scrub');
    for (const job of plan.jobs)
      await tx.execute(sql`insert into privacy_jobs
      (id, subject_ref, vendor, status, attempts, created_at, retry_at)
      values (${job.id}, ${job.subjectRef}, ${job.vendor}, 'pending', 0,
        ${job.createdAt}::timestamptz, ${job.createdAt}::timestamptz)`);
    return { alreadyErased: false, jobs: plan.jobs };
  });
}

function checkExportRow(
  row: Readonly<Record<string, unknown>>,
  columns: Set<string>,
) {
  if (
    !z.record(z.string(), z.json()).safeParse(row).success ||
    Object.keys(row).length !== columns.size ||
    Object.keys(row).some((column) => !columns.has(column))
  )
    throw createAppError('VALIDATION');
}

function checkedExport(
  fields: readonly PrivacyFieldDeclaration[],
  result: PrivacyExport,
) {
  const allowed = new Map<string, Set<string>>();
  for (const field of fields)
    if (field.exportable) {
      const columns = allowed.get(field.table) ?? new Set<string>();
      columns.add(field.column);
      allowed.set(field.table, columns);
    }
  if (Object.keys(result).length !== allowed.size)
    throw createAppError('VALIDATION');
  for (const [table, columns] of allowed) {
    const rows = result[table];
    if (!Array.isArray(rows)) throw createAppError('VALIDATION');
    for (const row of rows) checkExportRow(row, columns);
  }
  return result;
}

/** Locked snapshot: providers return declared own-subject rows, never arbitrary history. */
export async function exportPrivacySubject(
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
      {
        ...checkedExport(corePrivacyFields, {
          users: rows as unknown as PrivacyExport[string],
        }),
      };
    for (const id of plan.adopterIds) {
      const adopter = adoption.adopters.find((item) => item.id === id)!;
      const exported = checkedExport(
        adopter.fields,
        await adopter.export(tx, plan.subject),
      );
      for (const [table, records] of Object.entries(exported)) {
        if (Object.hasOwn(result, table)) throw createAppError('VALIDATION');
        result[table] = records;
      }
    }
    return result;
  });
}
