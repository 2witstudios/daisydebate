/** One speaker's stream in one segment, by its identity. */
type TranscriptStreamRef = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
};

const streamKey = (stream: TranscriptStreamRef) =>
  `${stream.segmentId}:${stream.roundParticipantId}`;

/**
 * Whether a Round's transcript may freeze now. A partial seal does not close
 * admission for evidence still arriving: only a wholly complete stream set
 * with no pending recovery freezes before the admission cutoff; at the cutoff
 * an incomplete set freezes as incomplete. The store applies it to the
 * streams it read under the Round's finalization lock.
 */
export function finalizationState(
  facts: {
    readonly streams: readonly (TranscriptStreamRef & {
      readonly state: string;
    })[];
    readonly expected: readonly TranscriptStreamRef[];
  },
  now: string,
  cutoff: string,
  recoveryPending = false,
): 'capture' | 'complete' | 'incomplete' {
  if (recoveryPending) return 'capture';
  const states = new Map(
    facts.streams.map((stream) => [streamKey(stream), stream.state]),
  );
  const complete =
    facts.expected.length > 0 &&
    facts.expected.every(
      (stream) => states.get(streamKey(stream)) === 'complete',
    ) &&
    facts.streams.every((stream) => stream.state === 'complete');
  if (complete) return 'complete';
  return now < cutoff ? 'capture' : 'incomplete';
}
