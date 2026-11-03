/** A frozen Round and transcript any prompt evidence or claim can be built from. */
export const round = {
  id: 'round',
  resolution: 'Transit should be free',
  participants: [{ id: 'seat', role: 'affirmative' as const, slot: 1 }],
  segments: [{ id: 'segment', sequence: 0 }],
};
export const frozen = {
  roundId: 'round',
  revision: 1,
  frontier: 0,
  frozenAt: '2026-10-22T00:00:00.000Z',
  completeness: 'incomplete' as const,
  expectedSpeechMs: 0,
  captureGapMs: 0,
  captureGaps: { gaps: [] },
  coverage: [
    {
      segmentId: 'segment',
      roundParticipantId: 'seat',
      state: 'partial' as const,
      partialReasons: ['frames-lost' as const],
      chunkCount: 1,
      sealedChunkCount: null,
      sealedAt: null,
    },
  ],
  utterances: [
    {
      id: 'line',
      segmentId: 'segment',
      segmentSequence: 0,
      sequence: 0,
      startOffsetMs: null,
      roundParticipantId: 'seat',
      text: 'Access improves.',
      complete: false,
    },
  ],
};
