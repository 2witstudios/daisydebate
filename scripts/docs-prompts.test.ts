import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import {
  DOCUMENTATION_PROMPT_VERSION,
  DOCUMENTATION_PROMPTS,
  promptFor,
} from './docs-prompts';
import { DOCUMENT_PIPELINES } from './docs-pipeline';

setupRitewayBun();

describe('DOCUMENTATION_PROMPTS', async () => {
  test('covers every documentation pipeline', async () => {
    assert({
      given: 'the prompt registry',
      should: 'define a prompt for every pipeline',
      actual: DOCUMENT_PIPELINES.map(
        (pipeline) => DOCUMENTATION_PROMPTS[pipeline] !== undefined,
      ),
      expected: DOCUMENT_PIPELINES.map(() => true),
    });
  });

  test('treats event text as untrusted data in every prompt', async () => {
    assert({
      given: 'any registered prompt',
      should: 'state that event text is untrusted data and never instructions',
      actual: DOCUMENT_PIPELINES.every((pipeline) =>
        /untrusted/i.test(DOCUMENTATION_PROMPTS[pipeline]),
      ),
      expected: true,
    });
  });

  test('forbids the agent closing or rescoping existing tasks', async () => {
    assert({
      given: 'any registered prompt',
      should:
        'let the agent create review tasks but never change an existing task, since Done comes from an independent review',
      actual: DOCUMENT_PIPELINES.every((pipeline) =>
        /never change the status, criteria or scope of an existing task/i.test(
          DOCUMENTATION_PROMPTS[pipeline],
        ),
      ),
      expected: true,
    });
  });
});

describe('promptFor', async () => {
  test('returns the versioned prompt for a pipeline', async () => {
    const actual = promptFor('accuracy-review');
    assert({
      given: 'the accuracy-review pipeline',
      should: 'return the current prompt version and non-empty prompt',
      actual: {
        version: actual.version,
        hasPrompt: actual.prompt.length > 0,
      },
      expected: {
        version: DOCUMENTATION_PROMPT_VERSION,
        hasPrompt: true,
      },
    });
  });

  test('throws for an unknown pipeline', async () => {
    let threw = false;
    try {
      promptFor('oracle-reads' as never);
    } catch {
      threw = true;
    }
    assert({
      given: 'an unknown pipeline',
      should: 'throw',
      actual: threw,
      expected: true,
    });
  });
});
