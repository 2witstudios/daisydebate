import { createBotAudioActivity } from './activity';

const STALE_AFTER_MS = 250;
type Batch = {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly frames: readonly {
    readonly trackId: string;
    readonly sequence: number;
    readonly pcm: readonly number[];
    readonly beforeMs: number;
    readonly afterMs: number;
    readonly serverWindow: { readonly before: string; readonly after: string };
    readonly receivedAt: string;
  }[];
};
type Options = Parameters<typeof createBotAudioActivity>[0];
/**
 * Polls each peer's expendable relay key against fresh PostgreSQL time. Frames
 * already delivered are skipped without renewing their age; stale, missing or
 * unreadable activity is unknown, never silence.
 */
export function createBotActivityFeed(
  input: Omit<Options, 'staleAfterMs'> & {
    readonly read: (
      roundId: string,
      participantId: string,
    ) => Promise<Batch | null>;
    readonly databaseNow: () => Promise<string>;
  },
) {
  const observer = createBotAudioActivity({
    ...input,
    staleAfterMs: STALE_AFTER_MS,
  });
  const delivered = new Map<string, { trackId: string; sequence: number }>();
  const unknown = (participantId: string, trackId = '') => {
    delivered.delete(participantId);
    observer.unknown({
      roundId: input.roundId,
      roundParticipantId: participantId,
      trackId,
    });
  };
  const deliver = (participantId: string, batch: Batch, nowMs: number) => {
    for (const frame of batch.frames) {
      const last = delivered.get(participantId);
      if (last?.trackId === frame.trackId && frame.sequence <= last.sequence)
        continue;
      if (nowMs - Date.parse(frame.serverWindow.before) > STALE_AFTER_MS) {
        unknown(participantId, frame.trackId);
        continue;
      }
      delivered.set(participantId, {
        trackId: frame.trackId,
        sequence: frame.sequence,
      });
      observer.observe({
        ...frame,
        roundId: batch.roundId,
        roundParticipantId: batch.roundParticipantId,
        pcm: Int16Array.from(frame.pcm),
      });
    }
  };
  return {
    async poll() {
      const now = await input.databaseNow();
      const nowMs = Date.parse(now);
      for (const participantId of input.peerParticipantIds) {
        const batch = await input
          .read(input.roundId, participantId)
          .catch(() => null);
        if (batch) deliver(participantId, batch, nowMs);
        else unknown(participantId);
      }
      observer.expire(now);
    },
  };
}
