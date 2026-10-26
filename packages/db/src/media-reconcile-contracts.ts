export type MediaVendorIntent =
  | {
      readonly kind: 'create' | 'delete';
      readonly identity: null;
      readonly payload: Record<string, never>;
    }
  | {
      readonly kind: 'permissions';
      readonly identity: string;
      readonly payload: {
        readonly publish: ('camera' | 'microphone')[];
        readonly subscribe: boolean;
        readonly hidden: boolean;
        readonly capture: false;
      };
    };
export type MediaReconcileFence = {
  readonly sessionId: string;
  readonly owner: string;
  readonly epoch: number;
};
export type MediaAbsenceProof = MediaReconcileFence & {
  readonly settledMutationCount: number;
};
export const proofMatches = (
  proof: MediaAbsenceProof | null,
  fence: MediaReconcileFence,
  mutations: number,
) =>
  proof !== null &&
  proof.sessionId === fence.sessionId &&
  proof.owner === fence.owner &&
  proof.epoch === fence.epoch &&
  proof.settledMutationCount === mutations;
