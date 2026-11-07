import { createFrameClock } from '@daisy/media/observation';
import { canonicalCaptureEvidenceBody } from '@daisy/protocol';
export function originalBodies(count = 2, framesPerBody = 1) {
  const at = 1800000000100;
  const clock = createFrameClock({
    sentAtMs: 0,
    receivedAtMs: 0,
    serverNowMs: at,
    precisionMs: 0,
  });
  return Array.from({ length: count }, (_, index) => {
    const frames = Array.from({ length: framesPerBody }, (_, offset) => {
      const sequence = index * framesPerBody + offset;
      clock.observe({
        sequence,
        beforeMs: 10 + sequence * 10,
        afterMs: 10 + sequence * 10,
      });
      const evidence = clock.evidence()!;
      const pcm = Buffer.alloc(320);
      pcm.writeInt16LE(sequence === 0 ? -1 : 1, 0);
      return { pcmS16le: pcm.toString('base64'), clock: evidence };
    });
    const first = frames[0]!.clock,
      last = frames.at(-1)!.clock;
    const encoded = canonicalCaptureEvidenceBody({
      version: 1,
      evidenceId: `e${index.toString(36).padStart(23, '0')}`,
      roundId: 'r'.repeat(24),
      sessionId: 's'.repeat(24),
      workerId: 'w'.repeat(24),
      epoch: 1,
      segmentId: 'g'.repeat(24),
      roundParticipantId: 'p'.repeat(24),
      trackId: 'track',
      intervalId: 'i'.repeat(24),
      historyVersion: 2,
      historyReadAt: new Date(at + 100000).toISOString(),
      segmentStartedAtMs: at - 100,
      startOffsetMs: 100 + index * framesPerBody * 10,
      durationMs: framesPerBody * 10,
      before: new Date(Math.floor(first.window.beforeMs)).toISOString(),
      after: new Date(Math.ceil(last.window.afterMs)).toISOString(),
      frames,
    });
    if (encoded.kind !== 'encoded')
      throw new Error('Invalid original audio fixture');
    return encoded.body;
  });
}
