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
      return `${type}:${name}=${value ?? ''}${attributes.includes('checked') ? '*' : ''}`;
    });

describe('AboutStep', () => {
  test('wants are many, club is one, and a club name waits for “I have a club”', () => {
    const html = render(AboutStep, { wants: ['debate', 'watch'], club: 'own' });
    assert({
      given: 'a member who wants to debate and watch, on their own',
      should:
        'render four checkboxes and three radios with the saved ones checked, and the club-name field present but shown only once joining is picked',
      actual: [
        inputs(html),
        html.includes('onboarding-club-reveal'),
        html.includes('Club name'),
      ],
      expected: [
        [
          'checkbox:wants=debate*',
          'checkbox:wants=coach',
          'checkbox:wants=judge',
          'checkbox:wants=watch*',
          'radio:club=joining',
          'radio:club=starting',
          'radio:club=own*',
          'text:clubName=',
        ],
        true,
        true,
      ],
    });
  });

  test('a saved club name shows again', () => {
    const html = render(AboutStep, {
      club: 'joining',
      clubName: 'Nova Academy',
    });
    assert({
      given: 'a member whose club is joining, with a saved name',
      should: 'carry the name in the field, checked radio and all',
      actual: [
        html.includes('value="Nova Academy"'),
        inputs(html).filter((input) => input === 'radio:club=joining*').length,
      ],
      expected: [true, 1],
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
      should: 'disable every choice, the club name and the submit',
      actual: [
        (html.match(/disabled=""/g) ?? []).length,
        html.includes('aria-busy="true"'),
      ],
      expected: [9, true],
    });
  });
});

describe('ExperienceStep', () => {
  test('one level, and leagues as chips with an open field', () => {
    const html = render(ExperienceStep, {
      experience: 'circuit',
      leagues: ['NSDA', 'PhD League'],
    });
    const leagues = inputs(html).filter((input) =>
      input.startsWith('checkbox:leagues='),
    );
    assert({
      given:
        'a circuit debater affiliated with NSDA and a league Daisy does not list',
      should:
        'check both, offer the catalog’s other leagues as unchecked chips and an open field beside them, and ask no match length',
      actual: [
        inputs(html).filter((input) => input.startsWith('radio:experience=')),
        leagues.filter((league) => league.endsWith('*')),
        leagues.map((league) => league.replace(/\*$/, '').split('=')[1]),
        inputs(html).includes('text:leagueOther='),
        html.includes('Leagues you’ve been affiliated with'),
        html.includes('formats'),
      ],
      expected: [
        [
          'radio:experience=new',
          'radio:experience=class',
          'radio:experience=circuit*',
          'radio:experience=veteran',
        ],
        ['checkbox:leagues=PhD League*', 'checkbox:leagues=NSDA*'],
        [
          'PhD League',
          'NSDA',
          'NCFL',
          'TFA',
          'CHSSA',
          'NCFCA',
          'Stoa',
          'APDA',
          'NPDA',
          'NDT',
          'CEDA',
          'ADA',
          'NFA',
          'AFA',
          'PKD',
          'IPDA',
          'BP',
        ],
        true,
        true,
        false,
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

describe('a step opened to change one answer (ISSUE-324)', () => {
  test('saves and goes back, with no onboarding progress', () => {
    const editing = [AboutStep, ExperienceStep, TopicsStep].map((step) =>
      render(step, {}, { editing: true }),
    );
    const onboarding = render(AboutStep);
    assert({
      given:
        'the about, experience and topics steps opened from Settings, and the about step during onboarding',
      should:
        'label the submit Save and show no step count when editing, and keep Next with "4 of 6" during onboarding',
      actual: [
        editing.map(
          (html) => html.includes('>Save<') && !/\d of \d/.test(html),
        ),
        onboarding.includes('>Next<') && /\d of \d/.test(onboarding),
      ],
      expected: [[true, true, true], true],
    });
  });
});
