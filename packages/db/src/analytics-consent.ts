import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  analyticsConsentSchema,
  idSchema,
  type AnalyticsConsent,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { consentRecord } from './schema/consent-record';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';

export const analyticsConsentOperations = (
  database: Pick<BunSQLDatabase, 'transaction'>,
) => ({
  async readAnalyticsConsent(userId: string): Promise<AnalyticsConsent | null> {
    if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(consentRecord)
        .where(eq(consentRecord.userId, userId));
      return row
        ? analyticsConsentSchema.parse({
            version: row.version,
            necessary: row.necessary,
            analytics: row.analytics,
            replay: row.replay,
          })
        : null;
    });
  },
  async saveAnalyticsConsent(input: {
    readonly userId: string;
    readonly consent: AnalyticsConsent;
    readonly now: string;
    readonly adopt?: boolean;
    readonly deletionJobId?: string;
  }) {
    const result = analyticsConsentSchema.safeParse(input.consent);
    if (
      !result.success ||
      !idSchema.safeParse(input.userId).success ||
      !Number.isFinite(Date.parse(input.now)) ||
      (input.deletionJobId !== undefined &&
        (!idSchema.safeParse(input.deletionJobId).success ||
          input.consent.analytics !== 'denied' ||
          input.adopt))
    )
      throw createAppError('VALIDATION');
    await database.transaction(async (tx) => {
      const [user] = (await tx.execute(
        sql`select deleted_at is not null as erased from users where id=${input.userId} for update`,
      )) as unknown as { erased: boolean }[];
      if (!user || user.erased) throw createAppError('AUTHORIZATION');
      const values = { ...result.data, recordedAt: new Date(input.now) };
      const insert = tx
        .insert(consentRecord)
        .values({ userId: input.userId, ...values });
      if (input.adopt)
        await insert.onConflictDoNothing({ target: consentRecord.userId });
      else
        await insert.onConflictDoUpdate({
          target: consentRecord.userId,
          set: values,
        });
      if (input.deletionJobId)
        await tx.execute(sql`insert into privacy_jobs
        (id,subject_ref,vendor,status,attempts,created_at,retry_at)
        values (${input.deletionJobId},${input.userId},'posthog','pending',0,${input.now}::timestamptz,${input.now}::timestamptz)
        on conflict (subject_ref,vendor) do update set id=excluded.id,status='pending',attempts=0,
        created_at=excluded.created_at,retry_at=excluded.retry_at,succeeded_at=null`);
    });
  },
});

export const analyticsConsentPrivacyAdopter: PrivacyAdopter = {
  id: 'analytics-consent',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from ${consentRecord} where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    consent_record: exportRows(
      (await tx.execute(
        sql`select * from ${consentRecord} where user_id=${subject.userId}`,
      )) as unknown as Record<string, unknown>[],
    ),
  }),
};
