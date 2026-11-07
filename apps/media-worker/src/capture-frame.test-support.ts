import { createFrameClock } from '@daisy/media/observation';
/** Synthetic callback basis for clip/batch tests; it grants no capture authority. */
export function clockEvidenceForFrame(atMs: number, precisionMs = 0) {
  const clock = createFrameClock({
    sentAtMs: atMs,
    receivedAtMs: atMs,
    serverNowMs: atMs + 10,
    precisionMs,
  });
  clock.observe({ sequence: atMs / 10, beforeMs: atMs, afterMs: atMs });
  const evidence = clock.evidence();
  if (!evidence) throw new Error('Synthetic clock fixture refused');
  return evidence;
}
