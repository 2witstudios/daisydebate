import { judgingPanelOf } from '@daisy/debate-engine';
import { corpusAt, corpusStartMs } from './corpus-seats';

const at = (ms: number) => corpusStartMs + ms;

/** Frozen panel facts read into a panel, including a human seat with no deadline. */
export const panelsFromFacts = () => {
  const held = {
    attendanceCutoffAt: corpusAt(3_600_000),
    lastAttendanceDecisionAt: null,
    lastWriterResolvedAt: null,
  };
  const job = (
    status: 'queued' | 'failed' | 'succeeded',
    holdsBallot = false,
  ) => ({
    judgeParticipantId: 'ai1',
    status,
    generationDeadlineAt: corpusAt(5_000),
    holdsBallot,
  });
  const facts = [
    {
      name: 'human-with-deadline',
      humanJudgeSeatIds: ['h1'],
      aiJudgeSeatIds: [],
      ballotDeadlineAt: corpusAt(1_000),
      jobs: [],
    },
    {
      name: 'human-without-deadline',
      humanJudgeSeatIds: ['h1'],
      aiJudgeSeatIds: [],
      ballotDeadlineAt: null,
      jobs: [],
    },
    {
      name: 'ai-not-dispatched',
      humanJudgeSeatIds: [],
      aiJudgeSeatIds: ['ai1'],
      ballotDeadlineAt: null,
      jobs: [],
    },
    {
      name: 'ai-queued',
      humanJudgeSeatIds: [],
      aiJudgeSeatIds: ['ai1'],
      ballotDeadlineAt: null,
      jobs: [job('queued')],
    },
    {
      name: 'ai-holding',
      humanJudgeSeatIds: [],
      aiJudgeSeatIds: ['ai1'],
      ballotDeadlineAt: null,
      jobs: [job('queued', true)],
    },
    {
      name: 'ai-failed',
      humanJudgeSeatIds: [],
      aiJudgeSeatIds: ['ai1'],
      ballotDeadlineAt: null,
      jobs: [job('failed')],
    },
    {
      name: 'ai-succeeded',
      humanJudgeSeatIds: [],
      aiJudgeSeatIds: ['ai1'],
      ballotDeadlineAt: null,
      jobs: [job('succeeded')],
    },
  ] as const;
  return facts.map(({ name, ...rest }) => {
    const input = {
      ...rest,
      completeness: 'complete' as const,
      held,
      ballots: [],
    };
    return {
      name,
      input,
      atStart: judgingPanelOf(input, at(0)),
      afterDeadlines: judgingPanelOf(input, at(10_000)),
    };
  });
};
