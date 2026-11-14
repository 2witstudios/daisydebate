import {
  decidePanelCompletion,
  deriveRoundOutcome,
  participatingRulings,
} from '@daisy/debate-engine';
import type { JudgeRuling, JudgingPanel } from '@daisy/protocol';
import { attempt } from './refusal';
import { corpusAt, corpusStartMs } from './corpus-seats';

const ruling = (
  judgeParticipantId: string,
  winner: 'affirmative' | 'negative',
): JudgeRuling => ({ judgeParticipantId, winner });
const at = (ms: number) => corpusStartMs + ms;
const human = (ids: readonly [string, ...string[]], deadlineMs: number) => ({
  deadlineAt: corpusAt(deadlineMs),
  seatIds: ids,
});

/** Hand-built panels and the decision each yields at a fixed instant. */
const panelDecisions = () => {
  const cases: readonly {
    readonly name: string;
    readonly completeness: 'complete' | 'incomplete';
    readonly panel: JudgingPanel;
    readonly ballots: readonly JudgeRuling[];
    readonly nowMs: number;
  }[] = [
    {
      name: 'unjudged',
      completeness: 'complete',
      panel: { humanWindow: null, aiSeats: [] },
      ballots: [],
      nowMs: at(0),
    },
    {
      name: 'ruled',
      completeness: 'complete',
      panel: { humanWindow: human(['h1'], 1_000), aiSeats: [] },
      ballots: [ruling('h1', 'negative')],
      nowMs: at(0),
    },
    {
      name: 'split',
      completeness: 'complete',
      panel: { humanWindow: human(['h1', 'h2'], 1_000), aiSeats: [] },
      ballots: [ruling('h1', 'affirmative'), ruling('h2', 'negative')],
      nowMs: at(0),
    },
    {
      name: 'majority',
      completeness: 'complete',
      panel: { humanWindow: human(['h1', 'h2', 'h3'], 1_000), aiSeats: [] },
      ballots: [
        ruling('h1', 'affirmative'),
        ruling('h2', 'negative'),
        ruling('h3', 'affirmative'),
      ],
      nowMs: at(0),
    },
    {
      name: 'pending-human-window',
      completeness: 'complete',
      panel: { humanWindow: human(['h1', 'h2'], 1_000), aiSeats: [] },
      ballots: [ruling('h1', 'affirmative')],
      nowMs: at(0),
    },
    {
      name: 'partial',
      completeness: 'complete',
      panel: { humanWindow: human(['h1', 'h2', 'h3'], 1_000), aiSeats: [] },
      ballots: [ruling('h1', 'affirmative')],
      nowMs: at(2_000),
    },
    {
      name: 'partial-split',
      completeness: 'complete',
      panel: { humanWindow: human(['h1', 'h2', 'h3'], 1_000), aiSeats: [] },
      ballots: [ruling('h1', 'affirmative'), ruling('h2', 'negative')],
      nowMs: at(2_000),
    },
    {
      name: 'judges-did-not-rule',
      completeness: 'complete',
      panel: { humanWindow: human(['h1'], 1_000), aiSeats: [] },
      ballots: [],
      nowMs: at(2_000),
    },
    {
      name: 'foreign-ballot-ignored',
      completeness: 'complete',
      panel: { humanWindow: human(['h1'], 1_000), aiSeats: [] },
      ballots: [ruling('stranger', 'affirmative')],
      nowMs: at(2_000),
    },
    {
      name: 'transcript-incomplete',
      completeness: 'incomplete',
      panel: {
        humanWindow: null,
        aiSeats: [{ id: 'ai1', standing: { state: 'not_dispatched' } }],
      },
      ballots: [],
      nowMs: at(0),
    },
    {
      name: 'judging-failed',
      completeness: 'complete',
      panel: {
        humanWindow: null,
        aiSeats: [{ id: 'ai1', standing: { state: 'ended' } }],
      },
      ballots: [],
      nowMs: at(0),
    },
    {
      name: 'ai-generating',
      completeness: 'complete',
      panel: {
        humanWindow: null,
        aiSeats: [
          {
            id: 'ai1',
            standing: { state: 'generating', deadlineAt: corpusAt(5_000) },
          },
        ],
      },
      ballots: [],
      nowMs: at(0),
    },
    {
      name: 'ai-recovering',
      completeness: 'complete',
      panel: {
        humanWindow: null,
        aiSeats: [{ id: 'ai1', standing: { state: 'recovering' } }],
      },
      ballots: [],
      nowMs: at(0),
    },
    {
      name: 'ai-blocked',
      completeness: 'complete',
      panel: {
        humanWindow: null,
        aiSeats: [{ id: 'ai1', standing: { state: 'blocked' } }],
      },
      ballots: [],
      nowMs: at(0),
    },
    {
      name: 'ai-holding-ballot',
      completeness: 'complete',
      panel: {
        humanWindow: null,
        aiSeats: [{ id: 'ai1', standing: { state: 'holding_ballot' } }],
      },
      ballots: [],
      nowMs: at(0),
    },
    {
      name: 'ai-succeeded',
      completeness: 'complete',
      panel: {
        humanWindow: null,
        aiSeats: [{ id: 'ai1', standing: { state: 'succeeded' } }],
      },
      ballots: [ruling('ai1', 'negative')],
      nowMs: at(0),
    },
    {
      name: 'human-and-failed-ai',
      completeness: 'complete',
      panel: {
        humanWindow: human(['h1'], 1_000),
        aiSeats: [{ id: 'ai1', standing: { state: 'ended' } }],
      },
      ballots: [ruling('h1', 'affirmative')],
      nowMs: at(2_000),
    },
  ];
  return cases.map((input) => ({
    ...input,
    decision: decidePanelCompletion(input),
  }));
};

/** The majority rule and the partial finalizer's filter over hand-built rulings. */
const outcomeRules = () => {
  const judges = ['j1', 'j2', 'j3'].map((id) => ({ id, role: 'judge' }));
  const cases: readonly {
    readonly name: string;
    readonly seats: readonly { readonly id: string; readonly role: string }[];
    readonly ballots: readonly JudgeRuling[];
  }[] = [
    {
      name: 'single',
      seats: judges.slice(0, 1),
      ballots: [ruling('j1', 'negative')],
    },
    {
      name: 'majority',
      seats: judges,
      ballots: [
        ruling('j1', 'affirmative'),
        ruling('j2', 'negative'),
        ruling('j3', 'affirmative'),
      ],
    },
    {
      name: 'tie',
      seats: judges.slice(0, 2),
      ballots: [ruling('j1', 'affirmative'), ruling('j2', 'negative')],
    },
    { name: 'missing', seats: judges, ballots: [ruling('j1', 'affirmative')] },
    {
      name: 'duplicate',
      seats: judges.slice(0, 2),
      ballots: [ruling('j1', 'affirmative'), ruling('j1', 'affirmative')],
    },
    {
      name: 'foreign',
      seats: judges.slice(0, 1),
      ballots: [ruling('x9', 'affirmative')],
    },
    { name: 'no-judges', seats: [], ballots: [] },
  ];
  return cases.map((input) => ({
    ...input,
    outcome: attempt(() => deriveRoundOutcome(input.seats, input.ballots)),
    participating: participatingRulings(
      input.seats.map((s) => s.id),
      input.ballots,
    ),
  }));
};

/** The panel and outcome decision cases, by corpus file name. */
export const panelCases = (): readonly (readonly [string, unknown])[] => [
  ['panel-decisions', panelDecisions()],
  ['round-outcomes', outcomeRules()],
];
