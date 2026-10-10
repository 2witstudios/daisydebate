/** Two adapter suites use the same serialized lease fixture; it never grants authority. */
const actorId = 'a'.repeat(24),
  channelId = 'c'.repeat(24);
export const typingLease = {
  version: 1 as const,
  channelId,
  actorId,
  authorityRevision: 2,
  relationshipRevision: 3,
  accountRevision: 4,
  ageRevision: 5,
  policyRevision: 1,
  expiresAt: '2026-10-10T12:00:01.000Z',
};
