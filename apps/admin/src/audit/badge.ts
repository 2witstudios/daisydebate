import type { ChainVerdict } from './chain';

/** States only what the verifier proved: no claim about outside anchors yet. */
export function chainBadge(verdict: ChainVerdict): {
  readonly text: string;
  readonly ok: boolean;
} {
  switch (verdict.status) {
    case 'empty':
      return { text: 'No audit events yet', ok: true };
    case 'consistent':
      return {
        text: `Chain consistent (seq ${verdict.first}–${verdict.last})`,
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
