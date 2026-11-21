import { requireTranscriptUnfrozen } from './transcript-unfrozen';
import type { Tx } from './tx';
/** Read-only competitive frontier fact; caller already owns the evidence Round fence. */
export const requireEvidenceFrontierOpen = (tx: Tx, roundId: string) =>
  requireTranscriptUnfrozen(tx, roundId);
