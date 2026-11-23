import { type SpectatorChatStore } from '@daisy/db/stores/spectator-chat';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** Spectator chat goes 180 days after posting, matching transcript retention (point guard ruling 2026-11-03). */
export const spectatorChatRetentionTarget = (
  database: Pick<SpectatorChatStore, 'purgeExpiredSpectatorChat'>,
): RetentionTarget =>
  retentionAfter(
    'spectator_chat',
    180 * DAY_MS,
    (batch) => database.purgeExpiredSpectatorChat(batch),
    { batchSize: 1000 },
  );
