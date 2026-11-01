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
