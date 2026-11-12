import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { TranscriptEvidenceInput } from '@daisy/ai-voice';
import { placeholdersFor, productionPrompt } from './evidence';
import { expand, parsePromptFile, renderPromptFile } from './prompt-file';

setupRitewayBun();

const evidence: TranscriptEvidenceInput = {
  resolution: 'Space exploration has been worth its cost.',
  revision: 1,
  completeness: 'complete',
  coverage: [
    {
      sequence: 0,
      side: 'affirmative',
      slot: 0,
      state: 'sealed',
      chunkCount: 2,
      sealedChunkCount: 2,
    },
  ],
  gaps: [],
  utterances: [
    {
      segmentSequence: 0,
      sequence: 0,
      side: 'affirmative',
      slot: 0,
      text: 'Worth it means better than not.',
      complete: true,
      interrupted: false,
    },
    {
      segmentSequence: 1,
      sequence: 0,
      side: 'negative',
      slot: 0,
      text: 'Opportunity cost: the oceans.',
      complete: true,
      interrupted: true,
    },
  ],
};

const options = {
  model: 'm',
  reasoning: 'medium',
  maxTokens: 6000,
  schema: 'ballot',
} as const;
const placeholders = placeholdersFor(evidence);
const expanded = (source: string) =>
  parsePromptFile(source).calls.map((call) =>
    call.messages.map((message) => ({
      role: message.role,
      content: expand(message.content, placeholders, new Map()),
    })),
  );

describe('renderPromptFile', () => {
  test('an unedited prompt file is the production prompt', () => {
    const { messages, evidence: json } = productionPrompt(evidence);
    const source = renderPromptFile({ messages, evidence: json, options });

    assert({
      given: 'the production messages rendered and parsed back',
      should: 'expand to exactly the messages production sends, in one call',
      actual: expanded(source),
      expected: [messages],
    });
    assert({
      given: 'the rendered file',
      should:
        'carry the evidence as a placeholder and the options as frontmatter',
      actual: [
        source.includes('{{evidence}}'),
        parsePromptFile(source).options,
      ],
      expected: [true, options],
    });
  });
});

describe('parsePromptFile', () => {
  const source = [
    '---',
    'model: base',
    'schema: none',
    '---',
    '=== call 1: system ===',
    'Flow the round. <!-- not sent -->',
    '=== call 1: user ===',
    '{{transcript}}',
    '',
    '=== call 2: options ===',
    'schema: ballot   # the verdict',
    'reasoning: high',
    '=== call 2: user ===',
    'Flow: {{call1}}',
  ].join('\n');
  const file = parsePromptFile(source);

  test('chained calls with per-call options', () => {
    assert({
      given: 'two calls, the second with its own options',
      should: 'keep the file options and the call override apart',
      actual: [file.options, file.calls.map((call) => call.options)],
      expected: [
        { model: 'base', schema: 'none' },
        [{}, { schema: 'ballot', reasoning: 'high' }],
      ],
    });
    assert({
      given: 'an HTML comment in a message',
      should: 'drop it before sending',
      actual: file.calls[0]!.messages[0]!.content,
      expected: 'Flow the round. ',
    });
    assert({
      given: 'a {{callN}} placeholder and the output of call 1',
      should: 'paste that output in',
      actual: expand(
        file.calls[1]!.messages[0]!.content,
        placeholders,
        new Map([[1, 'AFF wins the framework']]),
      ),
      expected: 'Flow: AFF wins the framework',
    });
    assert({
      given: '{{transcript}}',
      should: 'expand to one readable line per utterance',
      actual: expand('{{transcript}}', placeholders, new Map()),
      expected:
        '[0.0] affirmative 0: Worth it means better than not.\n[1.0] negative 0 (interrupted): Opportunity cost: the oceans.',
    });
  });

  test('mistakes are refused', () => {
    const refused = (run: () => unknown) => {
      try {
        run();
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    };
    assert({
      given: 'a call output used before that call has run',
      should: 'refuse to expand it',
      actual: refused(() => expand('{{call2}}', placeholders, new Map())),
      expected: '{{call2}} is used before call 2 has run',
    });
    assert({
      given: 'an unknown option',
      should: 'name it',
      actual: refused(() =>
        parsePromptFile('---\nmodle: x\n---\n=== call 1: user ===\nhi'),
      ),
      expected: 'unknown option "modle"',
    });
  });
});
