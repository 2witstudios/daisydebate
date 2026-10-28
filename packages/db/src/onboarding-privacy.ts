import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import {
  memberInterests,
  memberOnboarding,
  memberTopics,
} from './schema/onboarding';

/**
 * Optional onboarding answers are personal/private (DEC-106): exported to
 * their subject and deleted with the account, in the caller's transaction.
 */
export const onboardingPrivacyAdopter: PrivacyAdopter = {
  id: 'onboarding',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from ${memberInterests} where user_id=${subject.userId}`,
    );
    await tx.execute(
      sql`delete from ${memberTopics} where user_id=${subject.userId}`,
    );
    await tx.execute(
      sql`delete from ${memberOnboarding} where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    member_interests: (await tx.execute(
      sql`select user_id,interest from ${memberInterests} where user_id=${subject.userId} order by interest`,
    )) as unknown as Record<string, unknown>[],
    member_topics: (await tx.execute(
      sql`select user_id,topic from ${memberTopics} where user_id=${subject.userId} order by topic`,
    )) as unknown as Record<string, unknown>[],
    member_onboarding: (await tx.execute(
      sql`select user_id,club,experience,formats,completed_at,created_at,updated_at,version from ${memberOnboarding} where user_id=${subject.userId}`,
    )) as unknown as Record<string, unknown>[],
  }),
};
