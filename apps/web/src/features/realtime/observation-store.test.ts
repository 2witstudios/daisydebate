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
