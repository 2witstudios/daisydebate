import { createId } from '@paralleldrive/cuid2';
import type { Fixture } from './constraint-helpers';

/**
 * The same tracked live human account for account, role and minimal-age
 * proofs, approved for the beta (ADR 0075) unless `beta` says otherwise.
 */
export async function createAuthorizationSubject(
  fixture: Fixture,
  beta: 'approved' | 'pending' = 'approved',
) {
  const userId = createId();
  const actorId = createId();
  await fixture.insert('users', {
    id: userId,
    username: userId,
    email_verified: true,
  });
  await fixture.insert('actors', {
    id: actorId,
    kind: 'human',
    user_id: userId,
  });
  // An adult age record: participant access needs one at the 16+ floor.
  await fixture.sql`insert into account_age (user_id, birth_month, version, recorded_at)
    values (${userId}, '2000-01', 1, now())`;
  // The users cleanup cascades to these rows.
  await fixture.sql`insert into account_beta_access (user_id, state, requested_at, decided_at, provenance)
    values (${userId}, ${beta}, now(), ${beta === 'approved' ? new Date() : null}, 'signup')`;
  return { userId, actorId };
}

/** The account fact the canonical function returns for such a subject. */
export const subjectFact = (
  subject: { readonly userId: string; readonly actorId: string },
  overrides: {
    readonly member?: boolean;
    readonly erased?: boolean;
    readonly revision?: number;
    readonly ageBand?: 'adult' | null;
  } = {},
) => ({
  userId: subject.userId,
  actorId: subject.actorId,
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as 'adult' | null,
  ...overrides,
});
