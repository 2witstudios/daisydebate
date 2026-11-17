import { buildUserInboxTopic, type NotificationShell } from '@daisy/protocol';
import type { Scheduler } from '../realtime/connection-store';
import { attachInvalidationTopic } from '../realtime/invalidation-topic';
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

/** How long the shell goes unread when nothing rings: a missed ring heals. */
export const NOTIFICATION_SHELL_BACKSTOP_MS = 60_000;

/**
 * The shell's read carries no version and belongs to whoever is signed in,
 * so every answer is adopted; the driver's single-flight reads keep answers
 * in order.
 */
const identity: ResourceIdentity<NotificationShell> = {
  id: () => 'notification-shell',
  version: () => 0,
};

/** A notification arrived, or the member read some in another tab. */
const ringsShell = (kind: string) =>
  kind === 'user.notification-delivered' || kind === 'user.notifications-read';

const inboxDoorbell =
  (actorId: string) =>
  (
    connection: SyncConnection,
    signal: (version: number | null) => void,
  ): Doorbell =>
    attachInvalidationTopic({
      topic: buildUserInboxTopic(actorId),
      connection,
      matches: (frame) =>
        frame.type === 'event' && ringsShell(frame.payload.kind),
      // A ring missed while the socket was down reads on re-subscribing.
      catchUpOnSubscribe: true,
      invalidate: () => {},
      refetch: () => signal(null),
    });

/** With no connection the driver asks for no doorbell. */
const noDoorbell = (): Doorbell => ({
  authorizedSnapshot: () => {},
  close: () => {},
});

export const seedNotificationShellSync = (
  shell: NotificationShell,
  at: number,
) => seedResourceSync(identity, shell, at);

/**
 * Resource sync for the app shell's notifications (ADR 0143): the member's
 * inbox doorbell and the shell read. A ring asks for a fresh read; the
 * backstop covers one that never comes.
 */
export function createNotificationShellSyncDriver(input: {
  readonly seed: NotificationShell;
  readonly read: () => Promise<ResourceRead<NotificationShell>>;
  /** The member's inbox, or null without realtime. */
  readonly inbox: {
    readonly actorId: string;
    readonly connection: SyncConnection;
  } | null;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
}) {
  return createResourceSyncDriver({
    identity,
    seed: seedNotificationShellSync(input.seed, input.scheduler.now()),
    read: input.read,
    scheduler: input.scheduler,
    visibility: input.visibility,
    connection: input.inbox?.connection ?? null,
    doorbell: input.inbox ? inboxDoorbell(input.inbox.actorId) : noDoorbell,
    pollMs: {
      doorbell: NOTIFICATION_SHELL_BACKSTOP_MS,
      alone: NOTIFICATION_SHELL_BACKSTOP_MS,
    },
  });
}
