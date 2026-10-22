import {
  streamKey,
  type ExpectedTranscriptStream,
} from './transcript-finalization-streams';

type StreamState = { readonly state: string } & ExpectedTranscriptStream;

/**
 * Before the admission cutoff, keep capturing until every expected stream is
 * closed. Complete only when every expected and every observed stream sealed
 * complete; any partial, missing or open stream freezes incomplete.
 */
export function finalizationState(
  facts: {
    readonly streams: readonly StreamState[];
    readonly expected: readonly ExpectedTranscriptStream[];
  },
  now: string,
  cutoff: string,
): 'capture' | 'complete' | 'incomplete' {
  const states = new Map(
    facts.streams.map((stream) => [streamKey(stream), stream.state]),
  );
  const allClosed =
    facts.expected.length > 0 &&
    facts.expected.every((stream) =>
      ['complete', 'partial'].includes(states.get(streamKey(stream)) ?? 'open'),
    );
  if (!allClosed && now < cutoff) return 'capture';
  return facts.expected.length > 0 &&
    facts.expected.every(
      (stream) => states.get(streamKey(stream)) === 'complete',
    ) &&
    facts.streams.every((stream) => stream.state === 'complete')
    ? 'complete'
    : 'incomplete';
}
