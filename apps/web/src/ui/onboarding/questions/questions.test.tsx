import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  emptyAnswers,
  type OnboardingAnswers,
} from '../../../features/onboarding/answers';
import {
  AboutStep,
  ExperienceStep,
  TopicsStep,
  type QuestionStepProps,
} from './questions';

setupRitewayBun();

const render = (
  step: typeof AboutStep,
  answers: Partial<OnboardingAnswers> = {},
  overrides: Partial<QuestionStepProps> = {},
) =>
  renderToString(
    h(step, {
      answers: { ...emptyAnswers, ...answers },
      action: '/onboarding/post',
      pending: false,
      backHref: '/onboarding/debate?next=%2Flobby',
      skip: null,
      ...overrides,
    }),
  ).replaceAll('<!-- -->', '');

/** Every input as `name=value` with `*` when it renders checked. */
const inputs = (html: string) =>
  [...html.matchAll(/<input ([^>]*)>/g)]
    .map((match) => match[1] as string)
    .filter((attributes) => !attributes.includes('type="hidden"'))
    .map((attributes) => {
      const name = /name="([^"]+)"/.exec(attributes)?.[1];
      const value = /value="([^"]+)"/.exec(attributes)?.[1];
      const type = /type="([^"]+)"/.exec(attributes)?.[1];
      return `${type}:${name}=${value}${attributes.includes('checked') ? '*' : ''}`;
    });

describe('AboutStep', () => {
  test('wants are many, club is one', () => {
    assert({
      given: 'a member who wants to debate and watch, on their own',
      should:
        'render four checkboxes and three radios with the saved ones checked',
      actual: inputs(
        render(AboutStep, { wants: ['debate', 'watch'], club: 'own' }),
      ),
      expected: [
        'checkbox:wants=debate*',
        'checkbox:wants=coach',
        'checkbox:wants=judge',
        'checkbox:wants=watch*',
        'radio:club=joining',
        'radio:club=starting',
        'radio:club=own*',
      ],
    });
  });

  test('the form', () => {
    const html = render(AboutStep);
    assert({
      given: 'the about step',
      should: 'post the step name, say "I want to" and say 4 of 6',
      actual: [
        html.includes('<input type="hidden" name="step" value="about"/>'),
        html.includes('I want to'),
        html.includes('4 of 6'),
        html.includes('>Next</button>'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a refusal', () => {
    assert({
      given: 'a post that was refused or never arrived',
      should: 'say the answers were not saved',
      actual: render(AboutStep, {}, { refused: true }).includes(
        'Your answers weren’t saved. Try again.',
      ),
      expected: true,
    });
  });

  test('while posting', () => {
    const html = render(AboutStep, {}, { pending: true });
    assert({
      given: 'a post on the way',
      should: 'disable every choice and the submit',
      actual: [
        (html.match(/disabled=""/g) ?? []).length,
        html.includes('aria-busy="true"'),
      ],
      expected: [8, true],
    });
  });
});

describe('ExperienceStep', () => {
  test('one level, many formats, one length', () => {
    assert({
      given: 'a circuit debater who likes both formats in full',
      should: 'check those answers',
      actual: inputs(
        render(ExperienceStep, {
          experience: 'circuit',
          formats: ['one-on-one', 'teams'],
          length: 'full',
        }),
      ),
      expected: [
        'radio:experience=new',
        'radio:experience=class',
        'radio:experience=circuit*',
        'radio:experience=veteran',
        'checkbox:formats=one-on-one*',
        'checkbox:formats=teams*',
        'radio:length=quick',
        'radio:length=full*',
      ],
    });
  });
});

describe('TopicsStep', () => {
  test('twelve topics and a count', () => {
    const html = render(TopicsStep, { topics: ['law', 'ethics'] });
    assert({
      given: 'a member who picked two topics',
      should: 'render twelve checkboxes, say 2 selected and offer Finish',
      actual: [
        inputs(html).length,
        inputs(html).filter((input) => input.endsWith('*')),
        html.includes('2 selected'),
        html.includes('>Finish</button>'),
      ],
      expected: [
        12,
        ['checkbox:topics=ethics*', 'checkbox:topics=law*'],
        true,
        true,
      ],
    });
  });
});
