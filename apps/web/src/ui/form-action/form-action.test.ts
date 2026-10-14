import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { answerUnavailableOnThrow } from './form-action';
import { createMovedOnce } from './use-moved-on';

setupRitewayBun();

type Answer = { readonly echo: string; readonly unavailable?: true };

const posted = (echo: string) => {
  const form = new FormData();
  form.set('echo', echo);
  return form;
};

const unavailable = (form: FormData): Answer => ({
  echo: String(form.get('echo')),
  unavailable: true,
});

describe('answerUnavailableOnThrow', () => {
  test('passes the action and its answer through', async () => {
    const seen: [Answer, string][] = [];
    const action = async (state: Answer, form: FormData): Promise<Answer> => {
      seen.push([state, String(form.get('echo'))]);
      return { echo: `answered ${String(form.get('echo'))}` };
    };
    const safe = answerUnavailableOnThrow(action, unavailable);
    assert({
      given: 'an action that answers',
      should: 'call it with the state and form and return its answer',
      actual: [await safe({ echo: 'before' }, posted('ada')), seen],
      expected: [{ echo: 'answered ada' }, [[{ echo: 'before' }, 'ada']]],
    });
  });

  test('a call that fails in transport is the unavailable answer for the posted form', async () => {
    const safe = answerUnavailableOnThrow<Answer>(
      () => Promise.reject(new TypeError('Failed to fetch')),
      unavailable,
    );
    assert({
      given: 'an action call that rejects, as a dropped connection does',
      should: 'answer unavailable with the posted value, never reject',
      actual: await safe({ echo: 'before' }, posted('ada')),
      expected: { echo: 'ada', unavailable: true },
    });
  });

  test('hands each settled answer to the moved observer before returning it', async () => {
    const moved: string[] = [];
    const safe = answerUnavailableOnThrow<Answer>(
      async (state, form) => ({ echo: `answered ${String(form.get('echo'))}` }),
      unavailable,
      (answer) => moved.push(answer.echo),
    );
    await safe({ echo: 'before' }, posted('ada'));
    await safe({ echo: 'answered ada' }, posted('grace'));
    assert({
      given:
        'answers settling while a live update may unmount the form in the same commit',
      should:
        'report each answer from the action continuation, not a cancellable effect',
      actual: moved,
      expected: ['answered ada', 'answered grace'],
    });
  });

  test('hands the unavailable answer to the moved observer too', async () => {
    const moved: Answer[] = [];
    const safe = answerUnavailableOnThrow<Answer>(
      () => Promise.reject(new TypeError('Failed to fetch')),
      unavailable,
      (answer) => moved.push(answer),
    );
    await safe({ echo: 'before' }, posted('ada'));
    assert({
      given: 'a call that fails in transport',
      should: 'report the unavailable answer with its own notice',
      actual: moved,
      expected: [{ echo: 'ada', unavailable: true }],
    });
  });
});

describe('createMovedOnce', () => {
  test('replaces to the first answered destination exactly once', () => {
    const paths: string[] = [];
    const moved = createMovedOnce((path) => paths.push(path));
    moved.navigate('/messages/c1');
    moved.navigate('/messages/c1');
    assert({
      given: 'one answer and then the same answer again',
      should: 'replace to the destination once',
      actual: paths,
      expected: ['/messages/c1'],
    });
  });

  test('keeps the first destination when answers race', () => {
    const paths: string[] = [];
    const moved = createMovedOnce((path) => paths.push(path));
    moved.navigate('/messages/c1');
    moved.navigate('/messages/c2');
    assert({
      given: 'a second answer with a different destination',
      should: 'keep the first destination the form moved on',
      actual: paths,
      expected: ['/messages/c1'],
    });
  });

  test('an answer without a destination leaves the form movable', () => {
    const paths: string[] = [];
    const moved = createMovedOnce((path) => paths.push(path));
    moved.navigate(undefined);
    moved.navigate('/messages/c1');
    assert({
      given: 'a refused answer first and a successful answer after',
      should: 'skip the refusal and still move on the success',
      actual: paths,
      expected: ['/messages/c1'],
    });
  });
});
