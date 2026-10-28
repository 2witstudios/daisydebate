import type { RealtimeReadingPolicy } from './authorization';
import type { SocketPrincipal } from './registry';
export const authorizationPrincipal: SocketPrincipal = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: 's'.repeat(24),
};

/**
 * An explicit deny-all reading policy for compositions a test runs without
 * channels: a reading policy is required, so a refusal is always chosen.
 */
export const refuseAllReading: RealtimeReadingPolicy = () => undefined;
