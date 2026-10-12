import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationStore } from './observation-store';
setupRitewayBun();
test('content dirt retains progress and authority loss fences all late results', () => {
  const store = createObservationStore({
    decode: (value: unknown) => (typeof value === 'string' ? value : null),
  });
  const first = store.begin();
  store.authorize(first, { partition: 'same', disclosureRevision: 1 });
  store.snapshot(first, {
    partition: 'same',
    disclosureRevision: 1,
    contentRevision: 1,
    body: 'one',
  });
  store.dirty();
  const during = store.read();
  store.snapshot(first, {
    partition: 'same',
    disclosureRevision: 1,
    contentRevision: 2,
    body: 'two',
  });
  const newer = store.read();
  store.deny();
  store.snapshot(first, {
    partition: 'same',
    disclosureRevision: 1,
    contentRevision: 999,
    body: 'late',
  });
  assert({
    given: 'continuous dirt then denial with a larger late version',
    should:
      'retain authorized content progress then irreversibly fence the prior acquisition',
    actual: { during, newer, after: store.read() },
    expected: {
      during: { status: 'degraded', content: 'one', revision: 1 },
      newer: { status: 'ready', content: 'two', revision: 2 },
      after: { status: 'denied', content: null, revision: null },
    },
  });
});
test('disposal is final and unavailable recovers without another content event', () => {
  const store = createObservationStore({
    decode: (value: unknown) => (typeof value === 'string' ? value : null),
  });
  store.unavailable();
  const attempt = store.begin();
  store.authorize(attempt, { partition: 'same', disclosureRevision: 1 });
  store.snapshot(attempt, {
    partition: 'same',
    disclosureRevision: 1,
    contentRevision: 1,
    body: 'current',
  });
  const recovered = store.read();
  store.dispose();
  store.authorize(attempt, { partition: 'same', disclosureRevision: 1 });
  assert({
    given: 'infrastructure failure then baseline repair and final disposal',
    should: 'recover from current state and never restore disposed content',
    actual: { recovered, after: store.read() },
    expected: {
      recovered: { status: 'ready', content: 'current', revision: 1 },
      after: { status: 'disposed', content: null, revision: null },
    },
  });
});

test('disclosure identity transition hides old body and resets revision floor', () => {
  const store = createObservationStore({
    decode: (value: unknown) => (typeof value === 'string' ? value : null),
  });
  const first = store.begin();
  store.authorize(first, { partition: 'wide', disclosureRevision: 1 });
  store.snapshot(first, {
    partition: 'wide',
    disclosureRevision: 1,
    contentRevision: 10,
    body: 'wide',
  });
  const next = store.begin();
  store.authorize(next, { partition: 'narrow', disclosureRevision: 2 });
  const hidden = store.read().content;
  store.snapshot(next, {
    partition: 'narrow',
    disclosureRevision: 2,
    contentRevision: 10,
    body: 'narrow',
  });
  assert({
    given: 'new canonical disclosure with unchanged content revision',
    should: 'intrinsically hide incompatible bytes and accept its own baseline',
    actual: { hidden, current: store.read().content },
    expected: { hidden: null, current: 'narrow' },
  });
});
test('actor overlays follow authorization and disappear with authority', () => {
  const store = createObservationStore({
    decode: (value: unknown) => (typeof value === 'string' ? value : null),
  });
  const identity = { partition: 'same', disclosureRevision: 1 };
  const attempt = store.begin();
  store.authorize(attempt, identity, { own: ['a'] });
  store.snapshot(attempt, { ...identity, contentRevision: 1, body: 'one' });
  const first = store.read();
  store.authorize(attempt, identity, { own: ['b'] });
  const renewed = store.read();
  store.deny();
  assert({
    given: 'an overlay, a snapshot, a renewed overlay and then denial',
    should:
      'keep content with the latest canonical overlay and hide both together',
    actual: { first, renewed, denied: store.read() },
    expected: {
      first: {
        status: 'ready',
        content: 'one',
        revision: 1,
        overlay: { own: ['a'] },
      },
      renewed: {
        status: 'ready',
        content: 'one',
        revision: 1,
        overlay: { own: ['b'] },
      },
      denied: { status: 'denied', content: null, revision: null },
    },
  });
});
