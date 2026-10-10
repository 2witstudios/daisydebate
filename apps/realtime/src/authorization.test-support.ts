import type { SocketPrincipal } from './registry';
export const authorizationPrincipal: SocketPrincipal = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: 's'.repeat(24),
};
