import { VideoQuality } from 'livekit-client';
import type { StageSnapshot } from '../../features/stage-capture/stage-access';

type StagePhase = StageSnapshot['phase'];

type Publication = {
  readonly kind: string;
  readonly isMuted: boolean;
  readonly isSubscribed: boolean;
  readonly setSubscribed: (subscribed: boolean) => void;
  readonly setVideoQuality: (quality: VideoQuality) => void;
};

export type StageParticipant = {
  readonly identity: string;
  readonly trackPublications: ReadonlyMap<string, Publication>;
};

/** Only a debater: a human judge's camera and voice never reach the stage. */
export const subscribesTo = (
  debaterIdentities: readonly string[],
  identity: string,
) => debaterIdentities.includes(identity);

/**
 * Only `speech` and `between` are public. Every other phase is private, and so is any
 * phase added later until it is named here: the stage lets go by default.
 */
const privatePhase = (phase: StagePhase) =>
  phase !== 'speech' && phase !== 'between';

/**
 * A voice reaches the stage only while a speech's segment is open. A next speaker's
 * microphone opens before their clock so capture has it, and what they say then is nobody's
 * to keep: it never reaches Egress, so no timing error at a speech's edge can publish it. A
 * paused speech keeps its open segment, so its holder can still be heard here.
 */
const hearsVoices = (phase: StagePhase) => phase === 'speech';

/**
 * Every publication the stage should hold right now. The server's revocation is
 * the privacy boundary. Letting go in a private phase is a second layer for as
 * long as this page can read the phase, as when the sweep that revokes has died.
 * Video asks for the highest layer, because the frame is the broadcast.
 */
export const applyStageSubscriptions = (
  participants: Iterable<StageParticipant>,
  debaterIdentities: readonly string[],
  phase: StagePhase,
) => {
  for (const participant of participants) {
    const wanted =
      subscribesTo(debaterIdentities, participant.identity) &&
      !privatePhase(phase);
    for (const publication of participant.trackPublications.values()) {
      const holds =
        wanted && (publication.kind !== 'audio' || hearsVoices(phase));
      if (publication.isSubscribed !== holds) publication.setSubscribed(holds);
      if (holds && publication.kind === 'video')
        publication.setVideoQuality(VideoQuality.HIGH);
    }
  }
};

/** What a seat's tile can honestly show. */
export type SeatMedia = 'video' | 'camera-off' | 'voice-only' | 'away';

/**
 * Read from what is published, not what is subscribed, so a revoked observer does
 * not call a working camera off.
 */
export const seatMedia = (
  seat: { readonly kind: 'human' | 'bot'; readonly identity: string | null },
  participants: Iterable<StageParticipant>,
): SeatMedia => {
  const present = [...participants].find(
    (participant) => participant.identity === seat.identity,
  );
  if (!present) return 'away';
  if (seat.kind === 'bot') return 'voice-only';
  return [...present.trackPublications.values()].some(
    (publication) => publication.kind === 'video' && !publication.isMuted,
  )
    ? 'video'
    : 'camera-off';
};
