import { createId } from '@paralleldrive/cuid2';
import type { Fixture } from './constraint-helpers';

/** The same tracked live human account for account, role and minimal-age proofs. */
export async function createAuthorizationSubject(fixture: Fixture) {
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
  return { userId, actorId };
}
