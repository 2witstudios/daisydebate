import type { CaptureTx } from './media-capture-context';
import { requireTranscriptUnfrozen } from './transcript-unfrozen';
/** Read-only competitive frontier fact; caller already owns the evidence Round fence. */
export const requireEvidenceFrontierOpen = (tx: CaptureTx, roundId: string) =>
  requireTranscriptUnfrozen(tx, roundId);
