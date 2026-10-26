import { roundJudgeMessages } from '@daisy/ai-voice';
import type { createRoundJudgingJobs } from '@daisy/db/round-judging-jobs';
import { createAppError } from '@daisy/errors';
type Claim = Awaited<
  ReturnType<ReturnType<typeof createRoundJudgingJobs>['claim']>
>;
type Round = {
  readonly id: string;
  readonly resolution: string;
  readonly participants: readonly Pick<
    Claim['round']['participants'][number],
    'id' | 'role' | 'slot'
  >[];
  readonly segments: readonly Pick<
    Claim['round']['segments'][number],
    'id' | 'sequence'
  >[];
};
/**
 * Only actual immutable captured evidence is mapped. No actor identity/kind
 * or generated phrase enters. The judge and the coach (ADR 0071) read it.
 */
export function frozenPromptInput(input: {
  readonly round: Round;
  readonly frozen: Claim['frozen'];
}) {
  const { round, frozen } = input;
  const changed = () =>
    createAppError('INVARIANT', 'Frozen judging scope changed');
  if (round.id !== frozen.roundId) throw changed();
  const seatLabel = (participantId: string) => {
    const seat = round.participants.find(
      (candidate) => candidate.id === participantId,
    );
    if (!seat || seat.role === 'judge') throw changed();
    return { side: seat.role, slot: seat.slot };
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

export const frozenJudgingMessages = (
  input: Parameters<typeof frozenPromptInput>[0],
) => roundJudgeMessages(frozenPromptInput(input));
