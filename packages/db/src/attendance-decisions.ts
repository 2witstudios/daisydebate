import { createRefusal } from '@daisy/errors';

/** A replayed check-in must name the same segment and seat as its receipt. */
export function requireSameCheckIn(
  receipt: { readonly segmentId: string; readonly participantId: string },
  expected: { readonly segmentId: string; readonly participantId: string },
): void {
  if (
    receipt.segmentId !== expected.segmentId ||
    receipt.participantId !== expected.participantId
  )
    throw createRefusal('CONFLICT', 'command-conflict');
}
