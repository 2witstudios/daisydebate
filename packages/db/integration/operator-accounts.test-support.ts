import { createId } from '@paralleldrive/cuid2';
import type { createDatabase } from '../src';
import type { Fixture } from './constraint-helpers';

/** A claimed account waiting on the beta list, with a live session. */
export const pendingAccount = async (fixture: Fixture) => {
  const userId = createId();
  const actorId = createId();
  const sessionId = createId();
  await fixture.insert('users', {
    id: userId,
    username: `p-${userId}`,
    email: `${userId}@operator.invalid`,
    email_verified: true,
  });
  await fixture.insert('actors', {
    id: actorId,
    kind: 'human',
    user_id: userId,
  });
  await fixture.sql`insert into account_beta_access (user_id, state, requested_at, provenance)
    values (${userId}, 'pending', now(), 'signup')`;
  await fixture.sql`insert into account_age (user_id, birth_month, version, recorded_at)
    values (${userId}, '2000-01', 1, now())`;
  fixture.track('session', sessionId);
  await fixture.sql`insert into session (id, user_id, token, expires_at)
    values (${sessionId}, ${userId}, ${createId()}, now() + interval '1 hour')`;
  return { userId, actorId, sessionId };
};

const decide =
  (desired: 'approved' | 'revoked', expectedRevision: number) =>
  (
    current: { state: string; revision: number } | null,
    ageBand: string | null,
  ) => {
    if (!current) return { kind: 'refused', reason: 'not-found' } as const;
    if (current.revision !== expectedRevision)
      return { kind: 'refused', reason: 'stale' } as const;
    if (desired === 'approved' && ageBand === null)
      return { kind: 'refused', reason: 'age-required' } as const;
    if (current.state === desired)
      return {
        kind: 'unchanged',
        state: desired,
        revision: current.revision,
      } as const;
    return {
      kind: 'changed',
      from: current.state as 'pending',
      to: desired,
      revision: current.revision + 1,
    } as const;
  };

export const command = (
  userId: string,
  desired: 'approved' | 'revoked',
  expectedRevision: number,
  overrides: Partial<
    Parameters<ReturnType<typeof createDatabase>['runBetaAccessCommand']>[0]
  > = {},
) => ({
  commandId: createId(),
  serviceId: 'daisy-admin',
  operatorRef: 'o'.repeat(24),
  targetUserId: userId,
  desired,
  expectedRevision,
  requestDigest: createId()
    .padEnd(64, '0')
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, 'a'),
  adminAuditHead: 'a'.repeat(64),
  nextId: createId,
  authorize: () => true,
  decide: decide(desired, expectedRevision),
  ...overrides,
});
