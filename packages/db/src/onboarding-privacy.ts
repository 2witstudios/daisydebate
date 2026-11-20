import { sql } from 'drizzle-orm';
import { exportRows } from './privacy/export-rows';
import type { PrivacyAdopter } from './privacy/contracts';
import {
  memberInterests,
  memberLeagues,
  memberOnboarding,
  memberTopics,
} from './schema/onboarding';
import { run, query } from './raw-rows';
import { z } from 'zod';

/**
 * Optional onboarding answers are personal/private (DEC-106): exported to
 * their subject and deleted with the account, in the caller's transaction.
 */
export const onboardingPrivacyAdopter: PrivacyAdopter = {
  id: 'onboarding',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await run(
      tx,
      sql`delete from ${memberInterests} where user_id=${subject.userId}`,
    );
    await run(
      tx,
      sql`delete from ${memberTopics} where user_id=${subject.userId}`,
    );
    await run(
      tx,
      sql`delete from ${memberLeagues} where user_id=${subject.userId}`,
    );
    await run(
      tx,
      sql`delete from ${memberOnboarding} where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => ({
    member_interests: await query(
      tx,
      z.object({ user_id: z.string(), interest: z.string() }),
      sql`select user_id,interest from ${memberInterests} where user_id=${subject.userId} order by interest`,
    ),
    member_topics: await query(
      tx,
      z.object({ user_id: z.string(), topic: z.string() }),
      sql`select user_id,topic from ${memberTopics} where user_id=${subject.userId} order by topic`,
    ),
    member_leagues: await query(
      tx,
      z.object({ user_id: z.string(), league: z.string() }),
      sql`select user_id,league from ${memberLeagues} where user_id=${subject.userId} order by league`,
    ),
    member_onboarding: exportRows(
      await query(
        tx,
        z.object({
          user_id: z.string(),
          club: z.string().nullable(),
          club_name: z.string().nullable(),
          experience: z.string().nullable(),
          completed_at: z.date().nullable(),
          created_at: z.date(),
          updated_at: z.date(),
          version: z.int(),
        }),
        sql`select user_id,club,club_name,experience,completed_at,created_at,updated_at,version from ${memberOnboarding} where user_id=${subject.userId}`,
      ),
    ),
  }),
};
