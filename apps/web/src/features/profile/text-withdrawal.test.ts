import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isTextWithdrawal } from './text-withdrawal';
setupRitewayBun();

test('isTextWithdrawal', () => {
  const current = { displayName: 'Ada', bio: 'Policy' };
  assert({
    given:
      'clearing one field, clearing both, keeping both, changing one and setting a new one',
    should: 'treat only clears and keeps as a withdrawal',
    actual: [
      isTextWithdrawal(current, { displayName: 'Ada', bio: null }),
      isTextWithdrawal(current, { displayName: null, bio: null }),
      isTextWithdrawal(current, current),
      isTextWithdrawal(current, { displayName: 'Ada L', bio: null }),
      isTextWithdrawal(
        { displayName: null, bio: null },
        { displayName: null, bio: 'New' },
      ),
    ],
    expected: [true, true, true, false, false],
  });
});
