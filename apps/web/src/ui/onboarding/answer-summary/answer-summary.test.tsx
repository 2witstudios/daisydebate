import { assert, setupRitewayBun, test } from 'riteway/bun';
import { answerEditHrefs } from './answer-summary';

setupRitewayBun();

test('each answer is changed at its own step, returning where it came from (ISSUE-324)', () => {
  assert({
    given: 'Settings as the destination',
    should: 'link the about, experience and topics steps back to Settings',
    actual: answerEditHrefs('/settings'),
    expected: {
      about: '/onboarding/about?next=%2Fsettings',
      experience: '/onboarding/experience?next=%2Fsettings',
      topics: '/onboarding/topics?next=%2Fsettings',
    },
  });
});

test('Settings opens each step to change one answer and come straight back (ISSUE-324)', () => {
  assert({
    given: 'Settings as the destination, in edit mode',
    should: 'mark each step link edit=1 so its save returns to Settings',
    actual: answerEditHrefs('/settings', true),
    expected: {
      about: '/onboarding/about?next=%2Fsettings&edit=1',
      experience: '/onboarding/experience?next=%2Fsettings&edit=1',
      topics: '/onboarding/topics?next=%2Fsettings&edit=1',
    },
  });
});
