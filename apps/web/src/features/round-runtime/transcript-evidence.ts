import type { TranscriptEvidenceInput } from '@daisy/ai-voice';
import type { FrozenRoundTranscript } from '@daisy/db/frozen-transcript';
import { createAppError } from '@daisy/errors';
import { debateSides } from '@daisy/protocol';
type Round = {
  readonly id: string;
  readonly resolution: string;
  readonly participants: readonly {
    readonly id: string;
    readonly role: string;
    readonly slot: number;
  }[];
  readonly segments: readonly {
    readonly id: string;
    readonly sequence: number;
  }[];
};
/**
 * A Round's frozen transcript as neutral prompt evidence. Only actual
 * immutable captured evidence is mapped; no actor identity/kind or generated
 * phrase enters. AI judging and round analysis both read it; it belongs to
 * neither.
 */
export function transcriptEvidenceInput(input: {
  readonly round: Round;
  readonly frozen: FrozenRoundTranscript;
}): TranscriptEvidenceInput {
  const { round, frozen } = input;
  const changed = () =>
    createAppError('INVARIANT', 'Frozen transcript scope changed');
  if (round.id !== frozen.roundId) throw changed();
  const seatLabel = (participantId: string) => {
    const seat = round.participants.find(
      (candidate) => candidate.id === participantId,
    );
    const side = debateSides.find((candidate) => candidate === seat?.role);
    if (!seat || !side) throw changed();
    return { side, slot: seat.slot };
  };
  const segmentSequence = (segmentId: string) => {
    const segment = round.segments.find(
      (candidate) => candidate.id === segmentId,
    );
    if (!segment) throw changed();
    return segment.sequence;
  };
  return {
    resolution: round.resolution,
    revision: frozen.revision,
    completeness: frozen.completeness,
    coverage: frozen.coverage.map((stream) => {
      if (stream.state === 'open') throw changed();
      return {
        ...seatLabel(stream.roundParticipantId),
        sequence: segmentSequence(stream.segmentId),
        state: stream.state,
        chunkCount: stream.chunkCount,
        sealedChunkCount: stream.sealedChunkCount,
      };
    }),
    utterances: frozen.utterances.map((line) => ({
      ...seatLabel(line.roundParticipantId),
      segmentSequence: segmentSequence(line.segmentId),
      sequence: line.sequence,
      text: line.text,
      complete: line.complete,
    })),
  };
}
