import {
  streamKey,
  type ExpectedTranscriptStream,
} from './transcript-finalization-streams';

type StreamState = { readonly state: string } & ExpectedTranscriptStream;

/**
 * A partial seal does not close admission for evidence still arriving. Only a
 * wholly complete stream set with no pending recovery may freeze before the admission cutoff.
 */
export function finalizationState(
  facts: {
    readonly streams: readonly StreamState[];
    readonly expected: readonly ExpectedTranscriptStream[];
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
