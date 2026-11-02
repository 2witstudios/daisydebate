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
    takeSignOutIntent: () => {
      log.intentTaken += 1;
      return signedOut;
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
      'publish a known identity and a proven ending, and never an anonymous or unavailable guess',
    actual: [
      run('member', {}),
      run(null, {}),
      run(null, { signedOut: true }),
      run(null, { closed: true }),
      run(undefined, { signedOut: true, closed: true }),
      run(undefined, {}),
    ],
    expected: [['member'], [], [null], [null], [], []],
  });
});

test('an unavailable mount consumes a sign-out mark but keeps closure proof', () => {
  const h = harness({ signedOut: true, closed: true });
  watchNotesIdentity(undefined, h.resources)();
  assert({
    given: 'identity unavailable when both signals are present',
    should:
      'consume the mark so it cannot purge later, and leave the short-lived proof for a known mount',
    actual: [h.log.intentTaken, h.log.closedTaken, h.published],
    expected: [1, 0, []],
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

test('a null answer fences once and stops the reads', async () => {
  const h = harness();
  const stop = watchNotesIdentity(undefined, h.resources);
  h.events.dispatchEvent(new Event('focus'));
  await settled();
  h.events.dispatchEvent(new Event('focus'));
  h.visibility.dispatchEvent(new Event('visibilitychange'));
  await settled();
  const copy = h.storage.getItem(DRAFT);
  stop();
  assert({
    given: 'an unavailable mount whose session read answers signed out',
    should: 'fence, keep the copy, publish nothing and read only once',
    actual: [h.log.reads, h.log.fences, copy, h.published],
    expected: [1, 1, 'private', []],
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
