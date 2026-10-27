import { pgTable } from 'drizzle-orm/pg-core';
import {
  mediaWorkerLeaseColumns,
  positiveEpochCheck,
} from './media-worker-lease-columns';

/**
 * The bot listener's own lease on a media session (ISSUE-764): the role that
 * relays a peer's live audio activity to a bot debater in cross-examination.
 * Apart from the capture lease, so capture authority never admits bot
 * listening. Rotation of the session's vendor room fences it like every
 * other media worker lease.
 */
export const botListenerLeases = pgTable(
  'bot_listener_leases',
  mediaWorkerLeaseColumns(),
  (table) => [positiveEpochCheck('bot_listener_leases', table.epoch)],
);
