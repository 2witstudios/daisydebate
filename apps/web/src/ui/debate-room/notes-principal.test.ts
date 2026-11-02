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

test('only proof of a change purges on a server-rendered mount', async () => {
  const { rootMountAction } = await import('./notes-principal');
  assert({
    given:
      'an anonymous mount with and without a sign-out, and a signed-in mount',
    should: 'keep the copies on expiry and publish otherwise',
    actual: [
      rootMountAction(null, false),
      rootMountAction(null, true),
      rootMountAction('member', false),
    ],
    expected: ['keep', 'publish', 'publish'],
  });
});

test('only a real sign-out form marks the intent', async () => {
  const { isSignOutPath } = await import('./notes-principal');
  assert({
    given: 'the sign-out and account closure forms, and any other form',
    should: 'mark sign-out only, since the server proves a completed closure',
    actual: ['/auth/sign-out', '/api/privacy/erase', '/settings'].map(
      isSignOutPath,
    ),
    expected: [true, false, false],
  });
});

test('the session is read only with an identity to lose and copies at stake', async () => {
  const { needsSessionRead } = await import('./notes-principal');
  const empty = memoryStorage();
  const holding = memoryStorage();
  holding.setItem('daisy:round-notes:draft:member:r:d', 'private');
  const denied = {
    ...memoryStorage(),
    get length(): number {
      throw new Error('denied');
    },
  };
  assert({
    given: 'each observed identity with no, some and unreadable copies',
    should:
      'skip the read with nothing to protect, and treat unreadable storage as at stake',
    actual: [
      needsSessionRead(holding, null),
      needsSessionRead(denied, null),
      needsSessionRead(empty, undefined),
      needsSessionRead(holding, undefined),
      needsSessionRead(denied, undefined),
      needsSessionRead(empty, 'member'),
      needsSessionRead(holding, 'member'),
      needsSessionRead(holding, 'other'),
      needsSessionRead(denied, 'member'),
    ],
    expected: [false, false, false, true, true, false, true, false, true],
  });
});

test('publishing warns only when a removal really failed', async () => {
  const { NOTES_PRINCIPAL_EVENT, publishNotesPrincipal } =
    await import('./notes-principal');
  const draft = 'daisy:round-notes:draft:old:r:d';
  const seen: string[] = [];
  const events = new EventTarget();
  const stored = (changes: Partial<ReturnType<typeof memoryStorage>> = {}) => {
    const storage = memoryStorage();
    storage.setItem(draft, 'private');
    return new Proxy(storage, {
      get: (target, name) => {
        if (name === 'removeItem') seen.push('removal');
        if (name in changes) return Reflect.get(changes, name);
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  events.addEventListener(NOTES_PRINCIPAL_EVENT, () => seen.push('event'));
  const refuse = () => {
    throw new Error('denied');
  };
  const denied = publishNotesPrincipal(null, events, refuse);
  const markerFailed = publishNotesPrincipal(null, events, () =>
    stored({ setItem: refuse }),
  );
  seen.length = 0;
  const removalFailed = publishNotesPrincipal(null, events, () =>
    stored({ removeItem: refuse }),
  );
  assert({
    given: 'a denied getter, a failed marker write and a failed removal',
    should:
      'report cleanup failure only for the removal, after notifying live owners first',
    actual: [denied, markerFailed, removalFailed, seen[0]],
    expected: [true, true, false, 'event'],
  });
});

test('the closure cookie is taken once and a denied cookie is no proof', async () => {
  const { takeNotesErasedCookie } = await import('./notes-principal');
  const jar = { cookie: 'theme=dark; daisy-notes-erased=1' };
  const first = takeNotesErasedCookie(jar);
  const cleared = jar.cookie;
  const none = takeNotesErasedCookie({ cookie: 'theme=dark' });
  const denied = takeNotesErasedCookie({
    get cookie(): string {
      throw new DOMException('denied', 'SecurityError');
    },
    set cookie(_value: string) {},
  });
  assert({
    given: 'a cookie jar with the proof, without it, and a sandboxed document',
    should: 'take it once by clearing it, and never throw',
    actual: [first, cleared.includes('Max-Age=0'), none, denied],
    expected: [true, true, false, false],
  });
});
