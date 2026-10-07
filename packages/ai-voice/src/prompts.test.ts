import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { SpeechTurn } from './prompts';
import {
  cxMessages,
  debaterPersona,
  judgeMessages,
  renderTranscript,
  speechMessages,
  type TranscriptEntry,
} from './prompts';

setupRitewayBun();

const resolution = 'Social media does more harm than good';
const transcript: TranscriptEntry[] = [
  { turn: 'AC', role: 'person', text: 'I affirm. Social media harms teens.' },
  { turn: 'CX1', role: 'ai', text: 'What evidence links use to harm?' },
  { turn: 'CX1', role: 'person', text: 'Several longitudinal studies.' },
];

const ncTurn: SpeechTurn = {
  index: 2,
  name: 'NC',
  label: 'Negative constructive',
  kind: 'speech',
  side: 'negative',
  durationMs: 360_000,
};
const cxCrossTurn: SpeechTurn = {
  index: 1,
  name: 'CX1',
  label: 'Cross-examination of the affirmative',
  kind: 'cross-examination',
  side: 'negative',
  durationMs: 120_000,
};

describe('renderTranscript', () => {
  test('labels each line with its turn and speaker', () => {
    assert({
      given: 'entries for the AC and the first CX with the AI on the negative',
      should: 'name the turn, side and who spoke',
      actual: renderTranscript(transcript, 'negative'),
      expected: [
        '[AC — affirmative (opponent)] I affirm. Social media harms teens.',
        '[CX1 — negative (you)] What evidence links use to harm?',
        '[CX1 — affirmative (opponent)] Several longitudinal studies.',
      ].join('\n'),
    });
  });
});

describe('speechMessages', () => {
  const messages = speechMessages({
    resolution,
    aiSide: 'negative',
    turn: ncTurn,
    transcript,
    persona: 'PERSONA',
  });
  const user = messages.at(-1)!.content;
  test('frames the speech for the slot', () => {
    assert({
      given: 'the NC',
      should: 'start from the persona as the system message',
      actual: messages[0],
      expected: { role: 'system', content: 'PERSONA' },
    });
    assert({
      given: 'a six minute NC',
      should: 'ask for about 810 words',
      actual: user.includes('about 810 words'),
      expected: true,
    });
    assert({
      given: 'the debate so far',
      should: 'include the transcript and the resolution',
      actual:
        user.includes('Several longitudinal studies.') &&
        user.includes(resolution),
      expected: true,
    });
  });
});

describe('cxMessages', () => {
  test('asks one question when the AI is the asker', () => {
    const user = cxMessages({
      resolution,
      aiSide: 'negative',
      turn: cxCrossTurn,
      aiRole: 'asker',
      transcript,
      persona: 'P',
    }).at(-1)!.content;
    assert({
      given: 'the AI asking in CX',
      should: 'ask for exactly one short question',
      actual: user.includes('Ask exactly one question'),
      expected: true,
    });
  });
});

describe('judgeMessages', () => {
  test('requests a JSON ballot over the whole transcript', () => {
    const user = judgeMessages({
      resolution,
      personSide: 'affirmative',
      transcript,
      rubric: 'R',
    }).at(-1)!.content;
    assert({
      given: 'a finished debate',
      should: 'ask for the JSON ballot shape',
      actual:
        user.includes('"winner"') &&
        user.includes('Several longitudinal studies.'),
      expected: true,
    });
  });
});

describe('debaterPersona', () => {
  const persona = debaterPersona({
    name: 'Wren',
    tagline: 'Quick-witted and dry',
    personality: 'Sarcastic in a friendly way, always has a comeback.',
  });
  test('a character over the debating rules', () => {
    assert({
      given: "a bot's name, tagline and personality",
      should: 'speak as that character',
      actual: [
        persona.includes('You are Wren, quick-witted and dry.'),
        persona.includes('Sarcastic in a friendly way, always has a comeback.'),
      ],
      expected: [true, true],
    });
    assert({
      given: 'the same persona',
      should: 'keep the rules that make it a fair, spoken debater',
      actual: [
        persona.includes('Write for the ear.'),
        persona.includes('Never invent specific studies'),
      ],
      expected: [true, true],
    });
  });
});
