import { type RoomStore } from '@daisy/db/stores/rooms';
import { type TranscriptStore } from '@daisy/db/stores/transcripts';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** ADR 0059: accepted Round command receipts dedupe for 24 hours. */
export const roundCommandRetentionTarget = (
  database: Pick<RoomStore, 'purgeExpiredRoundCommands'>,
): RetentionTarget =>
  retentionAfter('round_commands', DAY_MS, (batch) =>
    database.purgeExpiredRoundCommands(batch),
  );

/** DEC-101 and DEC-89 (ISSUE-498): private transcript lines are kept 180 days. Ranked Round transcripts are kept under their waiver. */
export const transcriptRetentionTarget = (
  database: Pick<TranscriptStore, 'purgeExpiredUtterances'>,
): RetentionTarget =>
  retentionAfter('utterances', 180 * DAY_MS, (batch) =>
    database.purgeExpiredUtterances(batch),
  );
