import type { ChainVerdict } from './chain';

/**
 * States only what was proven: the verifier's verdict, and how many chain
 * heads the participant app acknowledged storing as anchors. It never claims
 * protection against a coordinated rewrite of both databases.
 */
export function chainBadge(
  verdict: ChainVerdict,
  anchors: number,
): {
  readonly text: string;
  readonly ok: boolean;
} {
  switch (verdict.status) {
    case 'empty':
      return { text: 'No audit events yet', ok: true };
    case 'consistent':
      return {
        text: `Chain consistent (seq ${verdict.first}–${verdict.last}); ${anchors} ${anchors === 1 ? 'anchor' : 'anchors'} sent`,
        ok: true,
      };
    case 'broken':
      return {
        text: `Chain broken at seq ${verdict.seq} (${verdict.reason})`,
        ok: false,
      };
    case 'truncated':
      return {
        text: `Chain truncated: seq ${verdict.expectedSeq} is missing`,
        ok: false,
      };
  }
}
