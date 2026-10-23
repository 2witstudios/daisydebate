import { silentLogger } from '../../server/test-loggers.test-support';

/** An admitted member behind permissive limits, as every Round route gate sees it. */
export const memberGate = (id: string, origin: string) => ({
  logger: silentLogger,
  identify: async () => ({
    state: 'member' as const,
    username: 'Member',
    principal: { kind: 'user' as const, userId: id, actorId: id },
  }),
  origin: () => origin,
  getActorByUserId: async () => ({ id }),
  limiter: () => ({
    consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  }),
  limits: {
    read: { max: 10, windowSeconds: 60 },
    command: { max: 10, windowSeconds: 60 },
  },
  active: () => true,
  maxBodyBytes: 4096,
});
