import { eraseBetaPreapprovals } from './beta-preapproval-erasure';
import { claimBetaPreapproval } from './beta-preapproval-claim';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { exportRows } from './privacy/export-rows';
import type { PrivacyAdopter } from './privacy/contracts';
import { accountAge } from './schema/account-age';
import { accountTerms } from './schema/account-terms';
import {
  clearProvisionalMail,
  type ProvisionalMailCleanup,
} from './provisional-cleanup';
import { users } from './schema/users';
import { lockOpenAccount } from './lock-open-account';
import { inTransaction, type TxOpener } from './tx';
import { run, query } from './raw-rows';
import { z } from 'zod';
import { ageBand } from '@daisy/auth';
import {
  claimChildAccount,
  lockChildAccountRequest,
  readChildAccountRequest,
} from './guardians/claim';

/** One accepted age-step answer: an already-banded birth month and the Terms accepted. */
export type AgeStepRecord = {
  readonly userId: string;
  /** `YYYY-MM`; the caller has already refused under-13 answers. */
  readonly birthMonth: string;
  readonly parentalControls?: {
    readonly linkId: string;
    readonly pendingBetaEventId: string;
    readonly requestId: string | null;
  };
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
  readonly database: TxOpener;
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
      inTransaction(database, async (tx) => {
        const now = new Date(input.now);
        const invitation = input.parentalControls
          ? await lockChildAccountRequest(tx, input.userId, now)
          : (await lockOpenAccount(tx, input.userId), null);
        const band = invitation ? ageBand(invitation.birthMonth, now) : null;
        const claim = band === '13-15' || band === '16-17' ? invitation : null;
        if (
          input.parentalControls &&
          (claim?.id ?? null) !== input.parentalControls.requestId
        )
          throw createAppError('VALIDATION');
        const inserted = await tx
          .insert(accountAge)
          .values({
            userId: input.userId,
            birthMonth: claim?.birthMonth ?? input.birthMonth,
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
        if (claim && input.parentalControls)
          await claimChildAccount(
            tx,
            claim,
            input.userId,
            input.parentalControls,
            now,
          );
        await claimBetaPreapproval(tx, input.userId);
        return 'recorded';
      }),
    );
  },

  async childAccountBinding(
    userId: string,
    now: string,
  ): Promise<{
    readonly requestId: string;
    readonly birthMonth: string;
  } | null> {
    return instrumented(eventSink, 'childAccountBinding', () =>
      inTransaction(database, async (tx) => {
        const at = new Date(now);
        const request = await readChildAccountRequest(tx, userId, at);
        if (!request) return null;
        const band = ageBand(request.birthMonth, at);
        return band === '13-15' || band === '16-17'
          ? { requestId: request.id, birthMonth: request.birthMonth }
          : null;
      }),
    );
  },

  /** Whether this account has answered the age step; the onboarding entry routes on it. */
  async hasRecordedAge(userId: string): Promise<boolean> {
    if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
    return instrumented(eventSink, 'hasRecordedAge', () =>
      inTransaction(database, async (tx) => {
        const rows = await query(
          tx,
          z.object({ present: z.literal(1) }),
          sql`select 1 as present from ${accountAge} where user_id=${userId}`,
        );
        return rows.length > 0;
      }),
    );
  },

  /**
   * WAIT-4.7: an under-13 answer deletes the account that gave it, in one
   * transaction, only while it has no username and no recorded age, so a
   * member can never reach the actors restrict and a first accepted answer
   * stands. Sessions, accounts and passkeys cascade; the
   * account's emailed links (its sign-in and email-change purposes) and its delivery
   * receipts (by the keyed hash `recipientHashOf` computes) go with it;
   * suppressions outlive their deliveries and stay. Writes no
   * `session.revoked` event: the account is gone, not signed out.
   */
  async deleteProvisionalUser(
    input: { readonly userId: string } & ProvisionalMailCleanup,
  ): Promise<'deleted' | 'refused'> {
    if (!idSchema.safeParse(input.userId).success)
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'deleteProvisionalUser', () =>
      inTransaction(database, async (tx) => {
        const [user] = await tx
          .select({ email: users.email })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.username)))
          .for('update');
        if (!user) return 'refused';
        // The first answer stands: an account that already recorded an age
        // (under this same row lock) is not deleted by a later answer.
        const [answered] = await tx
          .select({ userId: accountAge.userId })
          .from(accountAge)
          .where(eq(accountAge.userId, input.userId));
        if (answered) return 'refused';
        await eraseBetaPreapprovals(tx, input.userId);
        await clearProvisionalMail(
          tx,
          { id: input.userId, email: user.email },
          input,
        );
        const deleted = await tx
          .delete(users)
          .where(and(eq(users.id, input.userId), isNull(users.username)))
          .returning({ id: users.id });
        return deleted.length === 1 ? 'deleted' : 'refused';
      }),
    );
  },
});

/** The Terms acceptance is exported to its member and deleted with the account (DEC-244). */
export const accountTermsPrivacyAdopter: PrivacyAdopter = {
  id: 'account-terms',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await run(
      tx,
      sql`delete from ${accountTerms} where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    account_terms: exportRows(
      await query(
        tx,
        z.object({
          user_id: z.string(),
          terms_version: z.string(),
          accepted_at: z.date(),
        }),
        sql`select user_id,terms_version,accepted_at from ${accountTerms} where user_id=${subject.userId}`,
      ),
    ),
  }),
};
