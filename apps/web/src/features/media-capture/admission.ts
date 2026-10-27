/** The signed media-worker identity under one capture lease epoch. */
export type CaptureIdentity = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly epoch: number;
};
export type CaptureRead = {
  readonly serverNow: string;
  readonly segment: {
    readonly id: string;
    readonly endedAt: string | null;
  } | null;
  readonly participants: readonly {
    readonly roundParticipantId: string;
    readonly kind: string;
    readonly identity: string | null;
  }[];
};
export type LeaseRead = (
  identity: CaptureIdentity & { readonly segmentId: string },
) => Promise<{ readonly serverNow: string }>;
