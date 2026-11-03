import { EgressStatus, type EgressInfo } from 'livekit-server-sdk';

export type EgressFact =
  | { readonly kind: 'none' }
  | { readonly kind: 'starting' | 'active'; readonly id: string }
  | { readonly kind: 'failed'; readonly id: string }
  | { readonly kind: 'complete' };

/** What a lifecycle decides on. Anything unrecognised counts as failed, never running. */
export const egressFact = (
  info: Pick<EgressInfo, 'egressId' | 'status'>,
): EgressFact => {
  const id = info.egressId;
  switch (info.status) {
    case EgressStatus.EGRESS_STARTING:
      return { kind: 'starting', id };
    case EgressStatus.EGRESS_ACTIVE:
    case EgressStatus.EGRESS_ENDING:
      return { kind: 'active', id };
    case EgressStatus.EGRESS_COMPLETE:
      return { kind: 'complete' };
    default:
      return { kind: 'failed', id };
  }
};
