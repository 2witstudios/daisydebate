import { MemoryStorage } from '../../lib/storage.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clearAccountMediaPreferences,
  selectMediaAccount,
} from './account-signout-cleanup';

setupRitewayBun();

test('account-signout cleanup drops every actor-scoped media record and nothing else', () => {
  const storage = new MemoryStorage();
  storage.setItem('daisy:mute:media:actor-a:round-1', 'muted');
  storage.setItem('daisy:mute:media:actor-b:round-2', 'unmuted');
  storage.setItem('daisy:left:media:actor-a:round-3', '1');
  storage.setItem('daisy:checked-devices:room-x:actor-b', '{}');
  storage.setItem('daisy:something-else', 'keep');
  clearAccountMediaPreferences(storage);
  assert({
    given:
      'two mute records, one departure record, an actor-scoped device record, and an unrelated key',
    should:
      'drop actor-scoped media and device lifetime records and keep unrelated keys',
    actual: [
      storage.getItem('daisy:mute:media:actor-a:round-1'),
      storage.getItem('daisy:mute:media:actor-b:round-2'),
      storage.getItem('daisy:left:media:actor-a:round-3'),
      storage.getItem('daisy:checked-devices:room-x:actor-b'),
      storage.getItem('daisy:something-else'),
    ],
    expected: [null, null, null, null, 'keep'],
  });
});

test('account-signout cleanup tolerates a null host', () => {
  assert({
    given: 'no storage host at all (no browser window)',
    should: 'not throw',
    actual: (() => {
      try {
        clearAccountMediaPreferences(null);
        return 'cleared';
      } catch {
        return 'threw';
      }
    })(),
    expected: 'cleared',
  });
});

test('an account switch clears outgoing local media records before restoring the new account', () => {
  const storage = new MemoryStorage();
  selectMediaAccount('actor-a', storage);
  storage.setItem('daisy:mute:media:actor-a:round-1', 'muted');
  storage.setItem('daisy:checked-devices:room:actor-a', '{}');
  selectMediaAccount('actor-a', storage);
  const keptOnReload = storage.getItem('daisy:mute:media:actor-a:round-1');
  selectMediaAccount('actor-b', storage);
  assert({
    given: 'same-account reload followed by another signed-in principal',
    should:
      'retain reload choices but remove outgoing media and checked-device records on account change',
    actual: [
      keptOnReload,
      storage.getItem('daisy:mute:media:actor-a:round-1'),
      storage.getItem('daisy:checked-devices:room:actor-a'),
    ],
    expected: ['muted', null, null],
  });
});
