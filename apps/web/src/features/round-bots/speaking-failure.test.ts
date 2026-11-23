import { createOpenRouter } from '@daisy/ai-voice';
import { createAppError } from '@daisy/errors';
import { publicationStopError } from '@daisy/media/audio';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { speakingFailureCause } from './speaking-failure';
import { inertWaits } from '../../lib/manual-waits.test-support';
setupRitewayBun();

/** The adapter's own error for an answer of `status`, as the bot sees it. */
const refusedWith = (status: number) =>
  createOpenRouter({
    apiKey: 'key',
    fetch: async () => new Response('{}', { status }),
    waits: inertWaits,
  })
    .completeStreamed(
      { model: 'm', messages: [], maxTokens: 1, reasoning: 'none' },
      () => undefined,
    )
    .then(
      () => null,
      (error: unknown) => error,
    );

test('a bot speech failure names why, for operators (ISSUE-1460)', async () => {
  assert({
    given:
      'the vendor refusing the request shape, a rate limit, an outage, a publication stop and an untyped error',
    should:
      'name provider_refused only for the refused request, keep the publication stop, and add nothing else',
    actual: [
      speakingFailureCause(await refusedWith(400)),
      speakingFailureCause(await refusedWith(404)),
      speakingFailureCause(await refusedWith(422)),
      speakingFailureCause(await refusedWith(429)),
      speakingFailureCause(await refusedWith(503)),
      speakingFailureCause(publicationStopError('connect', 'Join failed')),
      speakingFailureCause(createAppError('INFRASTRUCTURE', 'Other')),
      speakingFailureCause(new Error('untyped')),
    ],
    expected: [
      'provider_refused',
      'provider_refused',
      'provider_refused',
      undefined,
      undefined,
      'connect',
      undefined,
      undefined,
    ],
  });
});
