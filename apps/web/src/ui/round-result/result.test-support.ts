import type { RoundBallotRead } from '@daisy/protocol';
import { sampleJudgeBallot } from '../mock/judge.test-support';
import {
  aff,
  at,
  neg,
  ran,
  rules,
  startOf,
} from '../debate-room/live-round.test-support';

const played = ran(2, true);

/** A completed Round read by its affirmative debater: one human and one AI ballot. */
export const completed: RoundBallotRead = {
  round: {
    ...played,
    status: 'completed',
    outcome: 'affirmative',
    completedAt: at(startOf(2)),
  },
  own: null,
  freeze: null,
  ballots: [
    {
      judge: 'human',
      reportableFeedbackId: 'f'.repeat(24),
      ballot: {
        ...sampleJudgeBallot,
        feedback: { affirmative: 'Weigh earlier.' },
      },
    },
    {
      judge: 'ai',
      reportableFeedbackId: null,
      ballot: { ...sampleJudgeBallot, feedback: {} },
    },
  ],
  transcript: {
    completeness: 'incomplete',
    partialStreams: [],
    gaps: [],
    utterances: [
      {
        id: 'u1',
        segmentId: played.segments[0]!.id,
        segmentSequence: 0,
        sequence: 0,
        startOffsetMs: null,
        roundParticipantId: aff.id,
        text: 'Access improves.',
        complete: true,
        interrupted: false,
      },
      {
        id: 'u2',
        segmentId: played.segments[1]!.id,
        segmentSequence: 1,
        sequence: 0,
        startOffsetMs: null,
        roundParticipantId: neg.id,
        text: 'Costs displace services',
        complete: false,
        interrupted: false,
      },
    ],
  },
};
export const speeches = rules.slice(0, 2);
