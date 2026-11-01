import { assert, setupRitewayBun, test } from 'riteway/bun';
import { memoryStorage } from './document-sync.test-support';
import { retainPrincipalDrafts } from './notes-principal';
setupRitewayBun();
test('identity changes erase other principals without touching other storage', () => {
  const storage = memoryStorage();
  storage.setItem('daisy:round-notes:draft:old:r:d', 'private');
  storage.setItem('daisy:round-notes:draft:new:r:d', 'current');
  storage.setItem('theme', 'dark');
  retainPrincipalDrafts(storage, 'new');
  assert({
    given: 'the browser changes accounts',
    should: 'keep only current-principal drafts and unrelated storage',
    actual: [...storage.dump()],
    expected: [
      ['daisy:round-notes:draft:new:r:d', 'current'],
      ['theme', 'dark'],
    ],
  });
  retainPrincipalDrafts(storage, null);
  assert({
    given: 'the browser signs out',
    should: 'erase remaining private drafts only',
    actual: [...storage.dump()],
    expected: [['theme', 'dark']],
  });
});

test('denied removal reports incomplete privacy cleanup and preserves unrelated data', () => {
  const storage = memoryStorage();
  storage.setItem('daisy:round-notes:draft:old:r:d', 'private');
  storage.setItem('theme', 'dark');
  const removed = retainPrincipalDrafts(
    {
      ...storage,
      get length() {
        return storage.length;
      },
      removeItem: () => {
        throw new Error('removal denied');
      },
    },
    null,
  );
  assert({
    given: 'browser storage allows reads but denies private-draft deletion',
    should: 'report cleanup failure rather than claim erasure succeeded',
    actual: [
      removed,
      storage.dump().has('daisy:round-notes:draft:old:r:d'),
      storage.dump().get('theme'),
    ],
    expected: [false, true, 'dark'],
  });
});

test('only an explicit valid session identity changes the notes principal', async () => {
  const { readSessionPrincipal } = await import('./notes-principal');
  assert({
    given: 'published session responses and unavailable or malformed data',
    should:
      'distinguish signed out, a known principal and unavailable identity without any code generation',
    actual: [
      readSessionPrincipal(null),
      readSessionPrincipal({ user: { id: 'member' } }),
      readSessionPrincipal({ user: { id: 123 } }),
      readSessionPrincipal(undefined),
    ],
    expected: [null, 'member', undefined, undefined],
  });
});
