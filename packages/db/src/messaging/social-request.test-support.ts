export const actorId = 'a'.repeat(24),
  peerId = 'b'.repeat(24),
  channelId = 'c'.repeat(24);
export const now = '2026-10-09T18:00:00.000Z';
export const input = {
  actorId,
  userId: 'u'.repeat(24),
  memberActorIds: [actorId, peerId],
  policyRevision: 1,
};
export const pair = {
  lowActorId: actorId,
  highActorId: peerId,
  lowBlocksHigh: false,
  highBlocksLow: false,
  revision: 1,
};
export const command = {
  channelId,
  requestId: 'r'.repeat(24),
  introduction: 'Private introduction',
  digest: 'd'.repeat(64),
  now,
  policyRevision: 1,
  limits: { windowMs: 60000, maxNewPairs: 5, maxPending: 3, cooldownMs: 1000 },
};
export const request = (state: string, decidedAt: Date | null = null) => [
  actorId,
  peerId,
  channelId,
  'dm',
  actorId,
  state,
  'Old introduction',
  new Date(now),
  decidedAt,
];
