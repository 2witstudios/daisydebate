import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { DEC_244 } from './account-age';
import type {
  PrivacyAdopter,
  PrivacyFieldDeclaration,
} from './privacy/contracts';
import { accountAge } from './schema/account-age';
import { accountTerms } from './schema/account-terms';
import { verifications } from './schema/auth';
import { emailDeliveries } from './schema/email-delivery';
import { users } from './schema/users';

/** One accepted age-step answer: an already-banded birth month and the Terms accepted. */
export type AgeStepRecord = {
  readonly userId: string;
  /** `YYYY-MM`; the caller has already refused under-13 answers. */
  readonly birthMonth: string;
  readonly termsVersion: string;
  /** Trusted UTC ISO time from the injected clock. */
  readonly now: string;
};

const BIRTH_MONTH = /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/;

/**
 * The age step's writes (WAIT-4.6): the birth month (the canonical age
 * source) and the Terms acceptance, together or not at all, for an
 * unerased account that has not answered yet. The user row is locked
 * first, the same fence correction and erasure take. A second answer
 * changes nothing and reports `already-recorded`: correcting an age is a
 * separate, reviewed flow.
 */
export const ageStepOperations = ({
  database,
  eventSink,
}: {
  readonly database: Pick<BunSQLDatabase, 'transaction'>;
  readonly eventSink: DatabaseEventSink | undefined;
}) => ({
  async recordAgeStep(
    input: AgeStepRecord,
  ): Promise<'recorded' | 'already-recorded'> {
    if (
      !idSchema.safeParse(input.userId).success ||
      !BIRTH_MONTH.test(input.birthMonth) ||
      input.termsVersion.length === 0 ||
      new Date(input.now).toISOString() !== input.now
    )
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'recordAgeStep', () =>
      database.transaction(async (tx) => {
        const [user] = (await tx.execute(
          sql`select deleted_at is not null as erased from users where id=${input.userId} for update`,
        )) as unknown as { erased: boolean }[];
        if (!user || user.erased) throw createAppError('AUTHORIZATION');
        const inserted = await tx
          .insert(accountAge)
          .values({
            userId: input.userId,
            birthMonth: input.birthMonth,
            recordedAt: new Date(input.now),
          })
          .onConflictDoNothing({ target: accountAge.userId })
          .returning({ userId: accountAge.userId });
        if (inserted.length === 0) return 'already-recorded';
        await tx.insert(accountTerms).values({
          userId: input.userId,
          termsVersion: input.termsVersion,
          acceptedAt: new Date(input.now),
        });
        return 'recorded';
      }),
    );
  },

  /** Whether this account has answered the age step; the onboarding entry routes on it. */
  async hasRecordedAge(userId: string): Promise<boolean> {
    if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
    return instrumented(eventSink, 'hasRecordedAge', () =>
      database.transaction(async (tx) => {
        const rows = await tx.execute(
          sql`select 1 from ${accountAge} where user_id=${userId}`,
        );
        return rows.length > 0;
      }),
    );
  },

  /**
   * WAIT-4.7: an under-13 answer deletes the account that gave it, in one
   * transaction, only while it has no username, so a member can never
   * reach the actors restrict. Sessions, accounts and passkeys cascade; the
   * account's emailed links (stored under `signInPurpose`) and its delivery
   * receipts (by the keyed hash `recipientHashOf` computes) go with it;
   * suppressions outlive their deliveries and stay. Writes no
   * `session.revoked` event: the account is gone, not signed out.
   */
  async deleteProvisionalUser(input: {
    readonly userId: string;
    readonly signInPurpose: string;
    /** The caller's keyed recipient hash: @daisy/db never holds the key. */
    readonly recipientHashOf: (email: string) => string;
  }): Promise<'deleted' | 'refused'> {
    if (!idSchema.safeParse(input.userId).success)
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'deleteProvisionalUser', () =>
      database.transaction(async (tx) => {
        const [user] = await tx
          .select({ email: users.email })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.username)))
          .for('update');
        if (!user) return 'refused';
        if (user.email !== null) {
          await tx
            .delete(verifications)
            .where(
              sql`case when starts_with(${verifications.identifier}, ${`${input.signInPurpose}:`}) then lower(${verifications.value}::jsonb ->> 'email') = lower(${user.email}) else false end`,
            );
          await tx
            .delete(emailDeliveries)
            .where(
              eq(
                emailDeliveries.recipientHash,
                input.recipientHashOf(user.email),
              ),
            );
        }
        const deleted = await tx
          .delete(users)
          .where(and(eq(users.id, input.userId), isNull(users.username)))
          .returning({ id: users.id });
        return deleted.length === 1 ? 'deleted' : 'refused';
      }),
    );
  },
});

const accountTermsPrivacyFields: readonly PrivacyFieldDeclaration[] = [
  'user_id',
  'terms_version',
  'accepted_at',
].map((column) => ({
  table: 'account_terms',
  column,
  category: column === 'user_id' ? 'identifier' : 'personal',
  ...(column === 'user_id' ? {} : { visibility: 'private' as const }),
  storage: 'postgres',
  owner: 'WAIT',
  purpose: 'Which Terms version the member accepted, and when',
  lawfulBasis: {
    status: 'approved',
    decision: DEC_244,
    rule: 'legal obligation and contract',
  },
  retention: {
    status: 'approved',
    decision: DEC_244,
    rule: 'life of the account',
  },
  erasure: 'delete',
  exportable: true,
}));

/** The Terms acceptance is exported to its member and deleted with the account (DEC-244). */
export const accountTermsPrivacyAdopter: PrivacyAdopter = {
  id: 'account-terms',
  phase: 'after-scrub',
  fields: accountTermsPrivacyFields,
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from ${accountTerms} where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    account_terms: (await tx.execute(
      sql`select user_id,terms_version,accepted_at from ${accountTerms} where user_id=${subject.userId}`,
    )) as unknown as Record<string, unknown>[],
  }),
};
