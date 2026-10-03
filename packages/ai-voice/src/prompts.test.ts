import { ipdaTurns } from '@daisy/debate-engine';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  cxMessages,
  judgeMessages,
  renderTranscript,
  speechMessages,
  type TranscriptEntry,
} from './prompts';

setupRitewayBun();

const resolution = 'Social media does more harm than good';
const transcript: TranscriptEntry[] = [
  { turnIndex: 0, role: 'person', text: 'I affirm. Social media harms teens.' },
  { turnIndex: 1, role: 'ai', text: 'What evidence links use to harm?' },
  { turnIndex: 1, role: 'person', text: 'Several longitudinal studies.' },
];

describe('renderTranscript', () => {
  test('labels each line with its turn and speaker', () => {
    assert({
      given: 'entries for the AC and the first CX with the AI on the negative',
      should: 'name the turn, side and who spoke',
      actual: renderTranscript(transcript, 'negative'),
      expected: [
        '[AC — affirmative (opponent)] I affirm. Social media harms teens.',
        '[CX — negative (you)] What evidence links use to harm?',
        '[CX — affirmative (opponent)] Several longitudinal studies.',
      ].join('\n'),
    });
  });
});

describe('speechMessages', () => {
  const messages = speechMessages({
    resolution,
    aiSide: 'negative',
    turn: ipdaTurns[2]!,
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
      turn: ipdaTurns[1]!,
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
