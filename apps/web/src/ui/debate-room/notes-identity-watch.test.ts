import { assert, setupRitewayBun, test } from 'riteway/bun';
import { memoryStorage } from './document-sync.test-support';
import {
  type NotesIdentityResources,
  watchNotesIdentity,
} from './notes-identity-watch';
import {
  NOTES_FENCE_EVENT,
  NOTES_IDENTITY_CHECK_EVENT,
  NOTES_PRINCIPAL_KEY,
} from './notes-principal';

setupRitewayBun();

const DRAFT = 'daisy:round-notes:draft:member:r:d';
const settled = () => new Promise((resolve) => setImmediate(resolve));
const otherTab = (newValue: string) =>
  Object.assign(new Event('storage'), { key: NOTES_PRINCIPAL_KEY, newValue });

const harness = ({
  session = null as unknown,
  drafts = true,
  signedOut = false,
  closed = false,
} = {}) => {
  const events = new EventTarget();
  const visibility = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
  });
  const storage = memoryStorage();
  if (drafts) storage.setItem(DRAFT, 'private');
  const published: (string | null)[] = [];
  let mark = signedOut;
  const log = { reads: 0, fences: 0, closedTaken: 0, intentTaken: 0 };
  events.addEventListener(NOTES_FENCE_EVENT, () => {
    log.fences += 1;
  });
  const resources: NotesIdentityResources = {
    events,
    visibility,
    storage: () => storage,
    fetchSession: async () => {
      log.reads += 1;
      return { ok: true, json: async () => session };
    },
    hasSignOutIntent: () => mark,
    takeSignOutIntent: () => {
      log.intentTaken += 1;
      const taken = mark;
      mark = false;
      return taken;
    },
    takeAccountClosedProof: () => {
      log.closedTaken += 1;
      return closed;
    },
    publish: (id) => published.push(id),
  };
  return { events, visibility, storage, published, log, resources };
};

test('a mount publishes only on proof', () => {
  const run = (
    principalId: string | null | undefined,
    options: Parameters<typeof harness>[0],
  ) => {
    const h = harness(options);
    watchNotesIdentity(principalId, h.resources)();
    return h.published;
  };
  assert({
    given: 'each server identity, with and without a sign-out or closure',
    should:
      'publish a known identity and a proven ending, honour closure on any mount, and never guess',
    actual: [
      run('member', {}),
      run(null, {}),
      run(null, { signedOut: true }),
      run(null, { closed: true }),
      run('member', { closed: true }),
      run(undefined, { closed: true }),
      run(undefined, { signedOut: true }),
      run(undefined, {}),
    ],
    expected: [['member'], [], [null], [null], [null], [null], [], []],
  });
});

test('an unavailable mount settles a sign-out mark on the first session answer', async () => {
  const signedOut = harness({ signedOut: true });
  const stopSignedOut = watchNotesIdentity(undefined, signedOut.resources);
  const atMount = [...signedOut.published];
  await settled();
  stopSignedOut();
  const refused = harness({
    signedOut: true,
    session: { user: { id: 'member' } },
  });
  const stopRefused = watchNotesIdentity(undefined, refused.resources);
  await settled();
  stopRefused();
  const expiredLater = harness({ signedOut: false });
  const stopExpired = watchNotesIdentity(undefined, expiredLater.resources);
  await settled();
  stopExpired();
  assert({
    given:
      'a sign-out landing unavailable, a refused sign-out with a live session, and no mark',
    should:
      'publish nothing until the answer, then purge only on a signed-out answer with the mark, and otherwise only fence',
    actual: [
      atMount,
      signedOut.published,
      signedOut.log.fences,
      refused.published,
      refused.log.fences,
      expiredLater.published,
      expiredLater.log.fences,
    ],
    expected: [[], [null], 0, ['member'], 0, [], 1],
  });
});

test('a live answer from before a sign-out cannot discard its mark', async () => {
  const h = harness();
  let answer: (value: Pick<Response, 'ok' | 'json'>) => void = () => {};
  let marked = false;
  const stop = watchNotesIdentity(undefined, {
    ...h.resources,
    fetchSession: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
    hasSignOutIntent: () => marked,
    takeSignOutIntent: () => {
      const taken = marked;
      marked = false;
      return taken;
    },
  });
  // The form submits while the read is out.
  marked = true;
  answer({ ok: true, json: async () => ({ user: { id: 'member' } }) });
  await settled();
  stop();
  assert({
    given: 'a sign-out submitted while a session read was in flight',
    should: 'keep the mark, so the landing page can still purge',
    actual: marked,
    expected: true,
  });
});

test('a mark settles at mount even with no copies stored', async () => {
  const h = harness({
    drafts: false,
    signedOut: true,
    session: { user: { id: 'member' } },
  });
  const stop = watchNotesIdentity(undefined, h.resources);
  await settled();
  stop();
  assert({
    given: 'a refused sign-out landing unavailable with nothing stored yet',
    should: 'still read, and discard the mark on the live answer',
    actual: [h.log.reads, h.resources.hasSignOutIntent()],
    expected: [1, false],
  });
});

test('a mark a live session refused cannot purge a later expiry', async () => {
  const h = harness({ signedOut: true });
  const answers: unknown[] = [{ user: { id: 'member' } }, null];
  const stop = watchNotesIdentity(undefined, {
    ...h.resources,
    fetchSession: async () => ({
      ok: true,
      json: async () => answers.shift(),
    }),
  });
  await settled();
  h.events.dispatchEvent(new Event(NOTES_IDENTITY_CHECK_EVENT));
  await settled();
  stop();
  assert({
    given: 'a refused sign-out, then the same session expiring',
    should: 'keep the copies and only fence',
    actual: [h.published, h.log.fences],
    expected: [['member'], 1],
  });
});

test('an unavailable mount still follows other tabs', () => {
  const h = harness();
  const stop = watchNotesIdentity(undefined, h.resources);
  h.events.dispatchEvent(otherTab('other'));
  h.events.dispatchEvent(otherTab(''));
  stop();
  h.events.dispatchEvent(otherTab('late'));
  assert({
    given: 'another tab changing account and signing out, then an unmount',
    should: 'follow both, and nothing after stopping',
    actual: h.published,
    expected: ['other', null],
  });
});

test('an unavailable mount with no copies never reads the session', async () => {
  const h = harness({ drafts: false });
  const stop = watchNotesIdentity(undefined, h.resources);
  h.events.dispatchEvent(new Event('focus'));
  h.visibility.dispatchEvent(new Event('visibilitychange'));
  await settled();
  stop();
  assert({
    given: 'a visitor with nothing stored',
    should: 'make no request on focus or visibility',
    actual: h.log.reads,
    expected: 0,
  });
});

test('a null answer fences and later checks still ask', async () => {
  const h = harness();
  const answers: unknown[] = [null, null, { user: { id: 'member' } }];
  const stop = watchNotesIdentity(undefined, {
    ...h.resources,
    fetchSession: async () => {
      h.log.reads += 1;
      return { ok: true, json: async () => answers.shift() };
    },
  });
  await settled();
  const copy = h.storage.getItem(DRAFT);
  h.events.dispatchEvent(new Event(NOTES_IDENTITY_CHECK_EVENT));
  await settled();
  const fences = h.log.fences;
  h.events.dispatchEvent(new Event('focus'));
  await settled();
  stop();
  assert({
    given: 'an unavailable mount signed out twice, then signed in again',
    should:
      'fence each time because a fence can refuse, keep the copy, then follow the session',
    actual: [fences, copy, h.published],
    expected: [2, 'private', ['member']],
  });
});

test('a known identity is reconciled by the read and never purged by expiry', async () => {
  const changed = harness({ session: { user: { id: 'other' } } });
  const stopChanged = watchNotesIdentity('member', changed.resources);
  changed.events.dispatchEvent(new Event(NOTES_IDENTITY_CHECK_EVENT));
  await settled();
  stopChanged();
  const expired = harness();
  const stopExpired = watchNotesIdentity('member', expired.resources);
  expired.events.dispatchEvent(new Event('focus'));
  await settled();
  stopExpired();
  assert({
    given: 'a read naming another account, and a read answering signed out',
    should: 'publish the account change, and only fence the expiry',
    actual: [
      changed.published,
      changed.log.fences,
      expired.published,
      expired.log.fences,
    ],
    expected: [['member', 'other'], 0, ['member'], 1],
  });
});

test('a malformed answer or failed read changes nothing', async () => {
  const h = harness({ session: { user: {} } });
  const stop = watchNotesIdentity('member', h.resources);
  h.events.dispatchEvent(new Event(NOTES_IDENTITY_CHECK_EVENT));
  await settled();
  stop();
  const failing = harness();
  const stopFailing = watchNotesIdentity('member', {
    ...failing.resources,
    fetchSession: async () => {
      throw new Error('offline');
    },
  });
  failing.events.dispatchEvent(new Event(NOTES_IDENTITY_CHECK_EVENT));
  await settled();
  stopFailing();
  assert({
    given: 'a session answer with no id, and an offline read',
    should: 'neither publish a change nor fence',
    actual: [h.published, h.log.fences, failing.published, failing.log.fences],
    expected: [['member'], 0, ['member'], 0],
  });
});
