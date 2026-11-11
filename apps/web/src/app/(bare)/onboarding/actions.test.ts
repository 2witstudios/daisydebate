import { join } from 'node:path';
import { mock } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { postedForm } from '../../../lib/testing/posted-form';

setupRitewayBun();

// The questionnaire's server actions as wired. Only their edges are
// replaced: the request store (next/headers), the in-process onboarding
// route (process-app) and the move-on (form-action).
const posts: unknown[] = [];
let routeAnswer: (body: { step?: unknown }) => Response = () =>
  Response.json({ saved: 'step' });

mock.module('next/headers', () => ({
  headers: async () => new Headers({ 'next-action': 'onboarding' }),
}));
mock.module(join(import.meta.dir, '../../../server/process-app.ts'), () => ({
  processRoute: () => async (request: Request) => {
    const body = (await request.json()) as { step?: unknown };
    posts.push(body);
    return routeAnswer(body);
  },
}));
mock.module(join(import.meta.dir, '../../../server/form-action.ts'), () => ({
  moveOn: (_incoming: Headers, to: string) => ({ next: to }),
}));

const { saveStepAction, skipAction } = await import('./actions');

const run = async <T>(
  answer: typeof routeAnswer,
  act: () => Promise<T>,
): Promise<{ readonly state: T; readonly posts: readonly unknown[] }> => {
  posts.length = 0;
  routeAnswer = answer;
  const state = await act();
  return { state, posts: [...posts] };
};

const saved = () => Response.json({ saved: 'step' });
const unavailable = () => new Response('{}', { status: 503 });

test('the topics step is one write: its answers and the finish travel together', async () => {
  const topics = await run(
    // A route that would lose a separate finish: the member's step is saved
    // only when nothing more than the step itself has to arrive.
    (body) => (body.step === 'finish' ? unavailable() : saved()),
    () =>
      saveStepAction(
        'topics',
        '/lobby',
        false,
        {},
        postedForm({ topics: ['law', 'ethics'] }),
      ),
  );
  assert({
    given: 'the topics step saved while a separate finish could not arrive',
    should: 'post the step once and move on to the send-off',
    actual: [topics.posts, topics.state],
    expected: [
      [{ step: 'topics', topics: ['law', 'ethics'] }],
      { next: '/onboarding/ready?next=%2Flobby' },
    ],
  });
});

test('each saved step posts once and moves on; a step that did not save shows the choices again', async () => {
  const about = await run(saved, () =>
    saveStepAction('about', '/lobby', false, {}, postedForm({ club: 'own' })),
  );
  const editing = await run(saved, () =>
    saveStepAction(
      'topics',
      '/settings',
      true,
      {},
      postedForm({ topics: ['law'] }),
    ),
  );
  const lost = await run(unavailable, () =>
    saveStepAction(
      'topics',
      '/lobby',
      false,
      {},
      postedForm({ topics: 'law' }),
    ),
  );
  const unknown = await run(saved, () =>
    saveStepAction('finish', '/lobby', false, {}, postedForm({})),
  );
  assert({
    given:
      'an about step, a topics step opened from Settings, a topics step the route could not take, and a step that is not a question',
    should:
      'post each once and go on (back to Settings when editing), keep the posted topics for the lost one, and post nothing for the unknown one',
    actual: [
      [about.posts, about.state],
      [editing.posts, editing.state],
      [lost.posts, lost.state],
      [unknown.posts, unknown.state],
    ],
    expected: [
      [
        [{ step: 'about', wants: [], club: 'own' }],
        { next: '/onboarding/experience?next=%2Flobby' },
      ],
      [[{ step: 'topics', topics: ['law'] }], { next: '/settings' }],
      [
        [{ step: 'topics', topics: ['law'] }],
        { refused: true, posted: { topics: ['law'] } },
      ],
      [[], { refused: true }],
    ],
  });
});

test('Skip records the finish alone and lands on the last step', async () => {
  const skipped = await run(saved, () => skipAction('/ranked', {}, null));
  const lost = await run(unavailable, () => skipAction('/ranked', {}, null));
  assert({
    given: 'a Skip the route takes, and one it cannot',
    should: 'post finish once and move to the send-off, or answer refused',
    actual: [skipped.posts, skipped.state, lost.posts, lost.state],
    expected: [
      [{ step: 'finish' }],
      { next: '/onboarding/ready?next=%2Franked' },
      [{ step: 'finish' }],
      { refused: true },
    ],
  });
});
