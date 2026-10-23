import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withGeneration } from './bot-generation.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a definitely failed voice call settles with no usage and gives its characters back', async () => {
  await withGeneration(async ({ target, operations }) => {
    const claim = await operations.claimWorker(target);
    const voice = await operations.beginGeneration(claim.scope, claim.token, {
      kind: 'tts',
      characters: 8,
    });
    await assertRejects({
      given: 'a failed call that claims usage',
      should: 'refuse it: nothing was served',
      actual: () =>
        operations.finishGeneration(claim.scope, voice.execution, 'failed', {
          inputTokens: 0,
          outputTokens: 0,
          characters: 8,
        }),
      code: 'VALIDATION',
    });
    await operations.finishGeneration(claim.scope, voice.execution, 'failed', {
      inputTokens: 0,
      outputTokens: 0,
      characters: 0,
    });
    const next = await operations
      .beginGeneration(claim.scope, claim.token, { kind: 'tts', characters: 8 })
      .then(
        () => 'admitted',
        () => 'refused',
      );
    assert({
      given:
        'an 8-character voice call that definitely failed against a 10-character budget',
      should: 'admit another 8-character call',
      actual: next,
      expected: 'admitted',
    });
  });
});
