import { sql } from 'drizzle-orm';
import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';
import type { PrivacyAdopter } from './privacy/contracts';
import {
  memberInterests,
  memberOnboarding,
  memberTopics,
} from './schema/onboarding';

/** DEC-106: the owner's classification of optional onboarding answers. */
const DEC_106 = 'n0mjjjivt3nz4rx3rq0qq1jz';

const policy = {
  storage: 'postgres',
  owner: 'ONB',
  lawfulBasis: { status: 'approved', decision: DEC_106, rule: 'contract' },
  retention: {
    status: 'approved',
    decision: DEC_106,
    rule: 'life of the account',
  },
  erasure: 'delete',
  exportable: true,
} as const;

/** An answer the member gave: personal and private. */
const answer = (table: string, column: string): PrivacyFieldDeclaration => ({
  ...policy,
  table,
  column,
  category: 'personal',
  visibility: 'private',
  purpose: 'Personalisation from optional onboarding answers (16+ only)',
});

/** A key or timestamp that ties the answers to their account. */
const bookkeeping = (
  table: string,
  column: string,
): PrivacyFieldDeclaration => ({
  ...policy,
  table,
  column,
  category: column === 'user_id' ? 'identifier' : 'none',
  purpose: 'Ties optional onboarding answers to their account',
});

const onboardingPrivacyFields: readonly PrivacyFieldDeclaration[] = [
  answer('member_interests', 'interest'),
  bookkeeping('member_interests', 'user_id'),
  answer('member_topics', 'topic'),
  bookkeeping('member_topics', 'user_id'),
  answer('member_onboarding', 'club'),
  answer('member_onboarding', 'experience'),
  answer('member_onboarding', 'formats'),
  bookkeeping('member_onboarding', 'user_id'),
  bookkeeping('member_onboarding', 'completed_at'),
  bookkeeping('member_onboarding', 'created_at'),
  bookkeeping('member_onboarding', 'updated_at'),
  bookkeeping('member_onboarding', 'version'),
];

/**
 * Optional onboarding answers are personal/private (DEC-106): exported to
 * their subject and deleted with the account, in the caller's transaction.
 */
export const onboardingPrivacyAdopter: PrivacyAdopter = {
  id: 'onboarding',
  phase: 'after-scrub',
  fields: onboardingPrivacyFields,
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
