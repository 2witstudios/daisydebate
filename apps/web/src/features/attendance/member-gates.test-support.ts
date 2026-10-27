import { silentLogger } from '../../server/test-loggers.test-support';

/** Shared member ingress for attendance route tests; callers supply their own limiter and writes. */
export const attendanceMemberGates = (
  origin: string,
  actorId: () => string,
) => ({
  logger: silentLogger,
  origin: () => origin,
  active: () => true,
  identify: async () => ({
    state: 'member' as const,
    username: 'Fixture',
    principal: { kind: 'user' as const, userId: actorId(), actorId: actorId() },
  }),
  getActorByUserId: async () => ({ id: actorId() }),
});
