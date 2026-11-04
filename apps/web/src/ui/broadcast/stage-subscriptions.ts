import { VideoQuality } from 'livekit-client';

type StagePhase = 'speech' | 'prep' | 'judging' | 'between' | 'slate';

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

/** Nothing on the audience's stage is wanted here: `speech` and `between` are public. */
const privatePhase = (phase: StagePhase) =>
  phase === 'prep' || phase === 'judging' || phase === 'slate';

/**
 * A voice reaches the stage only while a speech's clock runs. A next speaker's microphone
 * opens before their clock so capture has it, and what they say then is nobody's to keep:
 * it never reaches Egress, so no timing error at a speech's edge can publish it.
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
