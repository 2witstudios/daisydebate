import type { App } from '../../server/app';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import { consumeWindowsOrThrow } from '../../server/rate-limit';
import { handleOperation, readJson } from '../../server/http';
import {
  memberHttpBoundary,
  type MemberBoundary,
} from '../../server/member-handler';
export type MessagingHandlerPort<T> = {
  readonly boundary: MemberBoundary;
  readonly maxBodyBytes: number;
  readonly consume: (actorId: string) => Promise<void>;
  readonly store: (principal: AuthorizationPrincipal) => T;
};
/** Preferences and typing accept native channel scope only, never query-selected actor authority. */
export function readMessagingScope(
  request: Request,
  write: boolean,
  maxBodyBytes: number,
  channelId?: string,
) {
  if (write) return readJson(request, maxBodyBytes);
  if (new URL(request.url).search) throw createAppError('VALIDATION');
  return Promise.resolve({ version: 1, channelId });
}

/**
 * DEC-251's one per-account read budget (120 per minute): every content
 * read (history, changes, search, inbox, a channel's entry, reactions,
 * preferences, retained) spends from the same bucket, so no surface
 * multiplies it. The typing poll is transport, not a content read, and has
 * its own bucket (`consumeTypingTraffic`).
 */
export const consumeMessagingRead = (app: App, actorId: string) =>
  consumeWindowsOrThrow(
    app.limiter,
    `messaging:read:${actorId}`,
    app.messagingPolicy.limits.read,
  );

/**
 * Typing reads and writes: polled every few seconds per open conversation,
 * so they spend their own bucket (same windows) and never starve content
 * reads. Signals additionally spend DEC-251's one-per-3-s rule.
 */
export const consumeTypingTraffic = (app: App, actorId: string) =>
  consumeWindowsOrThrow(
    app.limiter,
    `messaging:typing:${actorId}`,
    app.messagingPolicy.limits.read,
  );

/** Two channel-metadata handlers share the participant boundary; each names its budget. */
export function messagingActorHandlerPort(
  app: App,
  consume: (actorId: string) => Promise<void> = (actorId) =>
    consumeMessagingRead(app, actorId),
) {
  return {
    boundary: memberHttpBoundary(app),
    maxBodyBytes: app.messagingPolicy.maxBodyBytes,
    consume,
  };
}
export function unavailableMessagingHandler(
  app: App,
  request: Request,
  name = 'messaging.unavailable',
) {
  return handleOperation(
    app.logger,
    request,
    name,
    async () => {
      throw createAppError('INFRASTRUCTURE');
    },
    app.reporter,
  );
}
