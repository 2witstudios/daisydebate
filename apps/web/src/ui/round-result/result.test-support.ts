import type { RoundBallotRead } from '@daisy/protocol';
import { sampleJudgeBallot } from '../mock/judge';
import { aff, neg, ran, rules } from '../debate-room/live-round.test-support';

const played = ran(2, true);

/** A completed Round read by its affirmative debater: one human and one AI ballot. */
export const completed: RoundBallotRead = {
  round: {
    ...played,
    status: 'completed',
    outcome: 'affirmative',
    completedAt: played.segments[1]!.endedAt,
  },
  own: null,
  freeze: null,
  ballots: [
    {
      status: 'submitted',
      judge: 'human',
      ballot: {
        ...sampleJudgeBallot,
        feedback: { affirmative: 'Weigh earlier.' },
      },
    },
    {
      status: 'voided',
      judge: 'ai',
      ballot: { ...sampleJudgeBallot, feedback: {} },
    },
  ],
  transcript: {
    completeness: 'incomplete',
    utterances: [
      {
        id: 'u1',
        segmentId: played.segments[0]!.id,
        segmentSequence: 0,
        sequence: 0,
        roundParticipantId: aff.id,
        text: 'Access improves.',
        complete: true,
      },
      {
        id: 'u2',
        segmentId: played.segments[1]!.id,
        segmentSequence: 1,
        sequence: 0,
        roundParticipantId: neg.id,
        text: 'Costs displace services',
        complete: false,
      },
    ],
  },
};
export const speeches = rules.slice(0, 2);
