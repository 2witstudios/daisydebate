import type { MessagingUnread } from '@daisy/protocol';
import type { Scheduler } from '../realtime/connection-store';
import {
  createResourceSyncDriver,
  type Doorbell,
  type ResourceRead,
  type SyncConnection,
  type SyncVisibility,
} from '../resource-sync/driver';
import {
  seedResourceSync,
  type ResourceIdentity,
} from '../resource-sync/resource-sync';
import { attachMessagingInboxDoorbells } from './doorbells';

/** How long the badge goes unread when nothing rings: a missed ring heals. */
export const MESSAGES_BADGE_BACKSTOP_MS = 60_000;

const identity: ResourceIdentity<MessagingUnread> = {
  id: () => 'messaging-unread',
  version: () => 0,
};

export const seedMessagesUnreadSync = (unread: MessagingUnread, at: number) =>
  seedResourceSync(identity, unread, at);

/**
 * Resource sync for the Messages badge (ADR 0144): Messaging's own inbox
 * doorbell and its unread count, never a notification's.
 */
export function createMessagesUnreadSyncDriver(input: {
  readonly seed: MessagingUnread;
  readonly read: () => Promise<ResourceRead<MessagingUnread>>;
  readonly inbox: {
    readonly actorId: string;
    readonly connection: SyncConnection;
  } | null;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
}) {
  const { inbox } = input;
  return createResourceSyncDriver({
    identity,
    seed: seedMessagesUnreadSync(input.seed, input.scheduler.now()),
    read: input.read,
    scheduler: input.scheduler,
    visibility: input.visibility,
    connection: inbox?.connection ?? null,
    doorbell: (connection, signal): Doorbell =>
      inbox
        ? attachMessagingInboxDoorbells({
            actorId: inbox.actorId,
            connection,
            catchUpOnSubscribe: true,
            invalidate: () => {},
            refetch: () => signal(null),
          })
        : { authorizedSnapshot: () => {}, close: () => {} },
    pollMs: {
      doorbell: MESSAGES_BADGE_BACKSTOP_MS,
      alone: MESSAGES_BADGE_BACKSTOP_MS,
    },
  });
}
