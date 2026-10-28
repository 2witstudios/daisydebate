/** A member reading their own collection, and the locked account row the fence reads first. */
export const ownReader = (actorId: string, userId: string) => ({
  actorId,
  userId,
  member: true,
  betaState: 'approved',
  betaRevision: 1,
  ageBand: 'adult',
  erased: false,
  revision: 2,
});
