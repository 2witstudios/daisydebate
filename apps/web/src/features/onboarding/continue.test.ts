import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { afterPasskeyHref, afterStepHref, isEditing } from './continue';

setupRitewayBun();

describe('afterPasskeyHref', () => {
  test('onboarding path boundaries', () => {
    const destinations = [
      '/onboarding/welcome',
      '/onboarding/welcome?next=%2Franked',
      '/onboarding/welcome#intro',
      '/onboarding/welcome/',
      '/onboarding/welcome/?next=%2Franked',
      '/onboarding/welcome/#intro',
    ];
    assert({
      given:
        'onboarding steps with optional trailing slashes, queries or fragments',
      should: 'go directly to each destination',
      actual: destinations.map((destination) =>
        afterPasskeyHref(destination, null),
      ),
      expected: destinations,
    });
    const nestedPaths = ['/onboarding/welcome/extra', '/onboarding/welcome//'];
    assert({
      given: 'paths with extra segments or a second trailing slash',
      should: 'still lead into onboarding',
      actual: nestedPaths.map((destination) =>
        afterPasskeyHref(destination, null),
      ),
      expected: [
        '/onboarding/welcome?next=%2Fonboarding%2Fwelcome%2Fextra',
        '/onboarding/welcome?next=%2Fonboarding%2Fwelcome%2F%2F',
      ],
    });
  });

  test('where the passkey offer leads', () => {
    assert({
      given: 'a member who has not finished onboarding',
      should: 'lead to the welcome step, carrying the destination',
      actual: afterPasskeyHref('/ranked?tab=a', null),
      expected: '/onboarding/welcome?next=%2Franked%3Ftab%3Da',
    });
    assert({
      given: 'a member who finished onboarding before',
      should: 'go straight to the destination',
      actual: afterPasskeyHref('/ranked?tab=a', '2026-10-05T12:00:00.000Z'),
      expected: '/ranked?tab=a',
    });
    assert({
      given: 'a new member whose destination is already an onboarding step',
      should: 'go to that step once, not wrap onboarding inside onboarding',
      actual: [
        afterPasskeyHref('/onboarding/welcome', null),
        afterPasskeyHref('/onboarding/about?next=%2Franked', null),
      ],
      expected: ['/onboarding/welcome', '/onboarding/about?next=%2Franked'],
    });
    assert({
      given: 'a destination that only starts like an onboarding path',
      should: 'still lead into onboarding',
      actual: afterPasskeyHref('/onboardingx', null),
      expected: '/onboarding/welcome?next=%2Fonboardingx',
    });
  });
});

test('a saved question step goes on through the flow, or straight back when editing (ISSUE-324)', () => {
  assert({
    given:
      'each question step saved during onboarding, and the same steps saved from Settings in edit mode',
    should:
      'walk about → experience → topics → ready during onboarding, and return straight to the destination when editing one answer',
    actual: [
      afterStepHref('about', '/lobby', false),
      afterStepHref('experience', '/lobby', false),
      afterStepHref('topics', '/lobby', false),
      afterStepHref('about', '/settings', true),
      afterStepHref('topics', '/settings', true),
      isEditing({ edit: '1' }),
      isEditing({ edit: 'yes' }),
      isEditing({}),
    ],
    expected: [
      '/onboarding/experience?next=%2Flobby',
      '/onboarding/topics?next=%2Flobby',
      '/onboarding/ready?next=%2Flobby',
      '/settings',
      '/settings',
      true,
      false,
      false,
    ],
  });
});
