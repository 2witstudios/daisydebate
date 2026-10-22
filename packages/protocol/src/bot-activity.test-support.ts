/** Portable raw-frame fixture; callers own deterministic or isolated integration identifiers. */
export function botActivityFixture(
  roundId: string,
  roundParticipantId: string,
) {
  return {
    version: 1 as const,
    roundId,
    roundParticipantId,
    frames: [
      {
        trackId: 'track1',
        sequence: 0,
        pcm: Array<number>(160).fill(1),
        beforeMs: 10,
        afterMs: 11,
        serverWindow: {
          before: '2026-10-22T00:00:00.000Z',
          after: '2026-10-22T00:00:00.011Z',
        },
        receivedAt: '2026-10-22T00:00:00.012Z',
      },
    ],
  };
}
