import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { postedForm } from '../../../lib/testing/posted-form';
import { createSubmitStep, refusedStep, stepBody } from './submit-step';

setupRitewayBun();

describe('stepBody', () => {
  test('each step reads only its own fields', () => {
    const form = postedForm({
      wants: ['debate', 'watch'],
      club: 'joining',
      clubName: 'Nova Academy',
    });
    assert({
      given: 'an about form with two wants, a club and its name',
      should: 'post the lists and the single choices',
      actual: stepBody('about', form),
      expected: {
        step: 'about',
        wants: ['debate', 'watch'],
        club: 'joining',
        clubName: 'Nova Academy',
      },
    });
    assert({
      given: 'an experience form with a checked league and a typed one',
      should: 'post the league list and the typed field',
      actual: stepBody(
        'experience',
        postedForm({ leagues: ['NSDA'], leagueOther: 'Golden State' }),
      ),
      expected: {
        step: 'experience',
        leagues: ['NSDA'],
        leagueOther: 'Golden State',
      },
    });
    assert({
      given: 'an experience form with nothing chosen',
      should: 'post empty lists and leave the single choices out',
      actual: stepBody('experience', postedForm({})),
      expected: { step: 'experience', leagues: [] },
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

describe('refusedStep', () => {
  test('a refused post keeps what was chosen', () => {
    assert({
      given: 'an about post that was refused, naming a club it did not pick',
      should:
        'answer refused with the posted choices to show again, holding no name for a choice that hides the field',
      actual: refusedStep('about')(
        postedForm({
          wants: ['judge'],
          club: 'starting',
          clubName: 'Nova Academy',
        }),
      ),
      expected: {
        refused: true,
        posted: {
          wants: ['judge'],
          club: 'starting',
          clubName: null,
        },
      },
    });
    assert({
      given: 'a refused about post that picks “I have a club” and names it',
      should: 'keep the name so the member sees what they typed',
      actual: refusedStep('about')(
        postedForm({
          wants: ['judge'],
          club: 'joining',
          clubName: 'Nova Academy',
        }),
      ),
      expected: {
        refused: true,
        posted: {
          wants: ['judge'],
          club: 'joining',
          clubName: 'Nova Academy',
        },
      },
    });
    assert({
      given: 'a post carrying a value off the list',
      should: 'show nothing new rather than a value the step cannot hold',
      actual: refusedStep('topics')(postedForm({ topics: 'astrology' })),
      expected: { refused: true, posted: {} },
    });
  });
});
