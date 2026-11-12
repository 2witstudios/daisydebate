import { assert, setupRitewayBun, test } from 'riteway/bun';
import { caseMapSchema } from '@daisy/protocol';
import { caseMapAnswer } from './judge';
import { caseMapWireSchema } from './judge-contract';
import { judgingStageMessages } from './staged-judge';
import { stubCaseMap } from './testing';
import type { TranscriptEvidenceInput } from './transcript-evidence';
setupRitewayBun();

const evidence: TranscriptEvidenceInput = {
  resolution: 'Transit should be free',
  revision: 1,
  completeness: 'complete',
  coverage: [],
  gaps: [
    {
      sequence: 1,
      side: 'negative',
      slot: 0,
      fromOffsetMs: 59_900,
      untilOffsetMs: 60_000,
      cause: 'edge',
    },
  ],
  utterances: [
    {
      segmentSequence: 1,
      sequence: 0,
      side: 'negative',
      slot: 0,
      text: 'Costs displace other services.',
      complete: true,
      interrupted: true,
    },
    {
      segmentSequence: 0,
      sequence: 0,
      side: 'affirmative',
      slot: 0,
      text: 'Access improves.',
      complete: true,
      interrupted: false,
    },
  ],
};
const user = (messages: { role: string; content: string }[]) =>
  messages.find((message) => message.role === 'user')!.content;

test('the case map reads numbered lines and only the transcript', () => {
  const content = user(judgingStageMessages(evidence, { stage: 'map' }));
  assert({
    given: 'a frozen transcript with an interrupted line and an edge gap',
    should:
      'number lines in played order, mark the interruption, state the gap and ask for no decision',
    actual: [
      content.indexOf('[0.0] affirmative 0: Access improves.') <
        content.indexOf('[1.0] negative 0 (interrupted):'),
      content.includes("at the speech's edge"),
      content.includes('rubricVersion'),
    ],
    expected: [true, true, false],
  });
});

test('the final judge decides from the map, in dependency order', () => {
  const [system, final] = judgingStageMessages(evidence, {
    stage: 'final',
    caseMap: stubCaseMap,
  });
  assert({
    given: 'a stored case map',
    should:
      'carry the map and the transcript, decide framework first, and ask for the ballot contract on the current rubric',
    actual: [
      final!.content.includes(JSON.stringify(stubCaseMap)),
      final!.content.includes('[0.0] affirmative 0: Access improves.'),
      system!.content.includes('first the dispute over the framework'),
      final!.content.includes('"rubricVersion": "speaker-10@2"'),
      system!.content.includes('Burdens: 1 = No burdens set'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('the first pass is the single-call judge on the current rubric', () => {
  const [system, first] = judgingStageMessages(evidence, { stage: 'first' });
  assert({
    given: 'the first stage',
    should: 'send the frozen evidence and the coherency anchors, and no map',
    actual: [
      first!.content.includes('Frozen evidence:'),
      system!.content.includes('Coherence: 1 = The case contradicts itself'),
      first!.content.includes('A map of the round'),
    ],
    expected: [true, true, false],
  });
});

test('case-map answers', () => {
  const answer = (text: string, finish: 'stop' | 'length' = 'stop') =>
    caseMapAnswer({ text, finish, refused: false });
  const rejected = answer(
    JSON.stringify({ ...stubCaseMap, secret: 'the speaker said x' }),
  );
  assert({
    given:
      'a valid map, a map with an unknown key, malformed JSON and a cut-off answer',
    should:
      'accept the map, and record the others by category with only the case_map field',
    actual: [
      answer(JSON.stringify(stubCaseMap)).ok,
      rejected.ok ? null : rejected.diagnostic.category,
      rejected.ok ? null : rejected.diagnostic.issues.map((i) => i.field),
      JSON.stringify(rejected).includes('the speaker said x'),
      (() => {
        const bad = answer('{');
        return bad.ok ? null : bad.diagnostic.category;
      })(),
      (() => {
        const cut = answer('{"about":', 'length');
        return cut.ok ? null : cut.diagnostic.category;
      })(),
    ],
    expected: [
      true,
      'schema_rejected',
      ['case_map'],
      false,
      'invalid_json',
      'truncated',
    ],
  });
});

test('the case-map wire schema is derived from its contract', () => {
  const required = (caseMapWireSchema as { required: string[] }).required;
  assert({
    given: 'the case-map request schema',
    should:
      'require every top-level field of the contract and accept the stub map',
    actual: [
      [...required].sort(),
      caseMapSchema.safeParse(stubCaseMap).success,
    ],
    expected: [Object.keys(caseMapSchema.shape).sort(), true],
  });
});
