import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { postedForm } from '../../../lib/testing/posted-form';
import { createSubmitStep, stepBody } from './submit-step';

setupRitewayBun();

describe('stepBody', () => {
  test('each step reads only its own fields', () => {
    const form = postedForm({ wants: ['debate', 'watch'], club: 'own' });
    assert({
      given: 'an about form with two wants and a club',
      should: 'post the lists and the single choice',
      actual: stepBody('about', form),
      expected: { step: 'about', wants: ['debate', 'watch'], club: 'own' },
    });
    assert({
      given: 'an experience form with nothing chosen',
      should: 'post empty lists and leave the single choices out',
      actual: stepBody('experience', postedForm({})),
      expected: { step: 'experience', formats: [] },
    });
    assert({
      given: 'a topics form carrying a stray field',
      should: 'post only the topics',
      actual: stepBody('topics', postedForm({ topics: 'law', wants: 'judge' })),
      expected: { step: 'topics', topics: ['law'] },
    });
  });
});

describe('createSubmitStep', () => {
  const answering = (status: number) =>
    createSubmitStep(async () => new Response('{}', { status }));
  test('the outcomes', async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    const submit = createSubmitStep(async (url, init) => {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ saved: 'finish' });
    });
    assert({
      given: 'a finish the endpoint saves',
      should: 'post it to the onboarding endpoint and answer saved',
      actual: [await submit({ step: 'finish' }), posts],
      expected: [
        'saved',
        [{ url: '/api/account/onboarding', body: { step: 'finish' } }],
      ],
    });
    assert({
      given: 'a refusal, a lapsed session, a limit and an outage',
      should: 'tell a refusal from everything that is unavailable',
      actual: [
        await answering(400)({ step: 'finish' }),
        await answering(401)({ step: 'finish' }),
        await answering(429)({ step: 'finish' }),
        await answering(503)({ step: 'finish' }),
        await createSubmitStep(async () => {
          throw new Error('down');
        })({ step: 'finish' }),
      ],
      expected: [
        'refused',
        'unavailable',
        'unavailable',
        'unavailable',
        'unavailable',
      ],
    });
  });
});
