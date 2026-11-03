import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MemoryStorage } from '../../lib/storage.test-support';
import {
  attemptedResume,
  clearResumeAttempt,
  markResumeAttempt,
} from './resume-attempt';

setupRitewayBun();

test('a resume attempt holds for its member and Round until the Round renders', () => {
  const tab = new MemoryStorage();
  const before = attemptedResume('me', 'round', tab);
  markResumeAttempt('me', 'round', tab);
  const held = [
    attemptedResume('me', 'round', tab),
    attemptedResume('other', 'round', tab),
    attemptedResume('me', 'other', tab),
    attemptedResume(null, 'round', tab),
  ];
  clearResumeAttempt('me', 'round', tab);
  assert({
    given: 'no attempt, an attempt, and the Round rendering',
    should: 'hold only for that member and Round, and clear when it renders',
    actual: [before, held, attemptedResume('me', 'round', tab)],
    expected: [false, [true, false, false, false], false],
  });
});

test('blocked storage neither throws nor blocks a resume', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  markResumeAttempt('me', 'round', blocked);
  clearResumeAttempt('me', 'round', blocked);
  assert({
    given: 'storage that refuses every call',
    should: 'read as no attempt',
    actual: attemptedResume('me', 'round', blocked),
    expected: false,
  });
});
