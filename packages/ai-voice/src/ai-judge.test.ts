import { assertRejects } from '@daisy/errors/testing';
import { ballotSchemaFor } from '@daisy/protocol/ballot-schema';
import {
  daisyBallotDefinitions,
  daisyWinnerBallot,
  type BallotDefinition,
} from '@daisy/protocol/ballot-definition';
import {
  fourTeams,
  twoSides,
  type SeatRef,
  sideSeat,
  judgeSeat,
} from '@daisy/protocol/seats';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { aiJudgeFor } from './ai-judge';
import {
  transcriptEvidence,
  transcriptLines,
  type TranscriptEvidenceInput,
} from './transcript-evidence';

setupRitewayBun();

const evidence = (seat: SeatRef): TranscriptEvidenceInput => ({
  resolution: 'Transit should be free',
  revision: 1,
  completeness: 'complete',
  coverage: [],
  gaps: [],
  utterances: [
    {
      segmentSequence: 0,
      sequence: 0,
      seat,
      text: 'Access improves.',
      complete: true,
      interrupted: false,
    },
  ],
});
const contentOf = (messages: { content: string }[]) =>
  messages.map((message) => message.content).join('\n');
const answer = (value: unknown) => ({
  text: JSON.stringify(value),
  finish: 'stop' as const,
  refused: false,
});
type Wire = {
  properties: Record<string, Wire>;
  required?: string[];
  items?: Wire;
  enum?: unknown[];
};

const teamKeys = fourTeams.map((team) => team.key);
const rankSides = aiJudgeFor(daisyBallotDefinitions['rank-sides@1'], {
  sides: fourTeams,
  segments: [],
});
const subjects = { sides: teamKeys, speakers: [], segments: [] };

describe('aiJudgeFor: a ranking of four sides', () => {
  const wire = rankSides.ballotWireSchema as unknown as Wire;
  test('the wire schema asks for a ranking of the four side keys', () => {
    assert({
      given: 'rank-sides@1 over the four-team preset',
      should:
        'require a ranking whose places hold the four side keys, and no winner or scores',
      actual: {
        required: [...(wire.required ?? [])].sort(),
        places: wire.properties.ranking!.items!.items!.enum,
        feedback: Object.keys(wire.properties.feedback!.properties),
      },
      expected: {
        required: ['feedback', 'ranking', 'reason', 'rubricVersion'],
        places: teamKeys,
        feedback: teamKeys,
      },
    });
  });
  test('the messages name the four sides by label', () => {
    const content = contentOf(
      rankSides.stageMessages(
        evidence({ kind: 'side', side: teamKeys[0]!, slot: 0 }),
        {
          stage: 'first',
        },
      ),
    );
    assert({
      given: 'the first-stage messages',
      should:
        'name every label, ask for a ranking best first, and give no scoring anchors',
      actual: {
        labels: fourTeams.every((team) => content.includes(team.label)),
        ranking: content.includes(
          '"ranking": [["opening_government"], ["opening_opposition"], ["closing_government"], ["closing_opposition"]]',
        ),
        rule: content.includes('every side exactly once, best first'),
        anchors: content.includes('against these anchors'),
      },
      expected: { labels: true, ranking: true, rule: true, anchors: false },
    });
  });
  test('the coherency stages are two-sided only', async () => {
    assert({
      given: 'a four-team Round',
      should: 'judge by the first stage alone',
      actual: rankSides.coherency,
      expected: false,
    });
    await assertRejects({
      given: 'a case-map stage asked of a four-team Round',
      should: 'refuse it: the case map is a two-sided contract',
      actual: () =>
        rankSides.stageMessages(
          evidence({ kind: 'side', side: teamKeys[0]!, slot: 0 }),
          { stage: 'map' },
        ),
      code: 'INVARIANT',
      invariantId: 'ai-judge-coherency-two-sided',
    });
  });
});

describe('aiJudgeFor: answers held to the frozen definition', () => {
  const ballot = {
    rubricVersion: 'rank-sides@1',
    ranking: [
      ['closing_government'],
      ['opening_government'],
      ['closing_opposition'],
      ['opening_opposition'],
    ],
    reason: 'Closing Government extended the case furthest.',
    feedback: {},
  };
  test('a ballot that fits the definition is accepted', () => {
    const judged = rankSides.judgeAnswer(answer(ballot));
    assert({
      given: 'an AI ranking of all four sides',
      should: 'be accepted, and be a ballot the frozen definition accepts',
      actual: {
        judged: judged.ok,
        contract: ballotSchemaFor(
          daisyBallotDefinitions['rank-sides@1'],
          subjects,
        ).safeParse(judged.ok ? judged.ballot : null).success,
      },
      expected: { judged: true, contract: true },
    });
  });
  test('a ballot that does not fit is refused', () => {
    const misfits = [
      { ...ballot, ranking: ballot.ranking.slice(0, 3) },
      {
        ...ballot,
        ranking: [
          ['closing_government', 'opening_government'],
          ...ballot.ranking.slice(2),
        ],
      },
      { ...ballot, winner: 'closing_government' },
      { ...ballot, rubricVersion: 'speaker-10@2' },
    ];
    assert({
      given:
        'a ranking missing a side, a shared place, a winner, another definition',
      should: 'refuse each as the contract rejects it',
      actual: misfits.map((misfit) => {
        const judged = rankSides.judgeAnswer(answer(misfit));
        return judged.ok ? 'accepted' : judged.diagnostic.category;
      }),
      expected: misfits.map(() => 'schema_rejected'),
    });
  });
});

describe('aiJudgeFor: a half-point grid', () => {
  const winner = daisyWinnerBallot;
  const halfPoint: BallotDefinition = {
    ...winner,
    key: 'half-point',
    revision: 1,
    points: {
      ...winner.points!,
      scale: { min: 1, max: 5, step: 0.5 },
    },
  };
  const judge = aiJudgeFor(halfPoint, { sides: twoSides, segments: [] });
  test('the messages and the wire schema show the scale', () => {
    const content = contentOf(
      judge.stageMessages(
        evidence({ kind: 'side', side: twoSides[0].key, slot: 0 }),
        { stage: 'first' },
      ),
    );
    const wire = judge.ballotWireSchema as unknown as Wire;
    const category = Object.values(
      wire.properties.scores!.properties[twoSides[0].key]!.properties,
    )[0]!;
    assert({
      given: 'a speaker grid scored 1 to 5 in half points',
      should: 'state the step, anchor on it, and enumerate every half point',
      actual: {
        scale: content.includes(
          'Score every category for both sides, 1 to 5 in steps of 0.5, against these anchors',
        ),
        rule: content.includes(
          'Every category score is 1 to 5 in steps of 0.5 against the anchors.',
        ),
        anchors: content.includes('- Thesis: 1 = '),
        values: category.enum,
      },
      expected: {
        scale: true,
        rule: true,
        anchors: true,
        values: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
      },
    });
  });
});

describe('aiJudgeFor: refusals', () => {
  test('an unsided format or an absent frozen speaker cast is refused', async () => {
    await assertRejects({
      given: 'a format of unsided speakers',
      should: 'refuse to build an AI judge',
      actual: () =>
        aiJudgeFor(daisyBallotDefinitions['rank-sides@1'], {
          sides: [],
          segments: [],
        }),
      code: 'INVARIANT',
      invariantId: 'ai-judge-unsided-format',
    });
    await assertRejects({
      given: 'a speaker-ranking definition without its frozen cast',
      should: 'refuse to build an AI judge',
      actual: () =>
        aiJudgeFor(daisyBallotDefinitions['rank-speakers@1'], {
          sides: twoSides,
          segments: [],
        }),
      code: 'INVARIANT',
      invariantId: 'ai-judge-frozen-subjects',
    });
  });
});

describe('transcript evidence of an unsided seat', () => {
  test('states the seat by its kind and slot', () => {
    const input = evidence({ kind: 'speaker', slot: 2 });
    assert({
      given: 'an utterance from an unsided speaker',
      should: 'state the seat as its kind and slot, never throw',
      actual: {
        json: transcriptEvidence(input).utterances[0],
        line: transcriptLines(input).split('\n')[1],
      },
      expected: {
        json: {
          segmentSequence: 0,
          sequence: 0,
          seat: 'speaker',
          slot: 2,
          text: 'Access improves.',
          complete: true,
          interrupted: false,
        },
        line: '[0.0] speaker 2: Access improves.',
      },
    });
  });
});

test('AI speaker subjects are the actual immutable cast, with no transcript-derived roster or actor identities', () => {
  const participants = [
    { id: 'actualnegative', seat: sideSeat('negative') },
    { id: 'actualjudge', seat: judgeSeat() },
    { id: 'actualaffirmative', seat: sideSeat('affirmative') },
  ];
  const definition: BallotDefinition = {
    ...daisyWinnerBallot,
    key: 'seated-grid',
    revision: 1,
    speakerRanks: true,
    points: {
      ...daisyWinnerBallot.points!,
      per: 'seat',
      scale: { min: 0.25, max: 1.25, step: 0.1 },
      default: 0.35,
      criteria: { kind: 'holistic' },
    },
    written: { reason: null, feedback: null },
  };
  const judge = aiJudgeFor(
    definition,
    {
      sides: twoSides,
      seats: {
        sides: { affirmative: 1, negative: 1 },
        speakers: 0,
        judges: 1,
        moderators: 0,
      },
      segments: [],
    },
    participants,
  );
  const ballot = {
    rubricVersion: 'seated-grid@1',
    winner: 'affirmative',
    scores: { actualaffirmative: 0.35, actualnegative: 0.25 },
    speakerRanks: [['actualnegative'], ['actualaffirmative']],
  };
  const text = contentOf(
    judge.stageMessages(evidence(sideSeat('affirmative')), { stage: 'first' }),
  );
  assert({
    given: 'a complete frozen cast but evidence from just one speaker',
    should:
      'require and name both actual competitor keys, accepting their exact lattice and ranking only',
    actual: {
      accepted: judge.judgeAnswer(answer(ballot)).ok,
      missing: judge.judgeAnswer(
        answer({ ...ballot, scores: { actualaffirmative: 0.35 } }),
      ).ok,
      invented: judge.judgeAnswer(
        answer({
          ...ballot,
          speakerRanks: [['actualjudge'], ['actualaffirmative']],
        }),
      ).ok,
      legend: text.includes(
        '"key":"actualnegative","seat":{"kind":"side","side":"negative","slot":0}',
      ),
      judgeInLegend: text.includes('actualjudge'),
    },
    expected: {
      accepted: true,
      missing: false,
      invented: false,
      legend: true,
      judgeInLegend: false,
    },
  });
});
