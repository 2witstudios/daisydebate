import { assert, setupRitewayBun, test } from 'riteway/bun';
import { photoDeletionRetryAt, sweepPhotoDeletions } from './deletion-sweep';
setupRitewayBun();

const now = '2026-11-16T00:00:00.000Z';
const photo = (n: number) => ({
  photoId: String(n).repeat(24),
  objectPrefix: `profile-photos/${String(n).repeat(24)}`,
  attempts: n,
});

const fakeStore = () => {
  const owedAt: string[] = [];
  const completed: string[] = [];
  const deferred: [string, string][] = [];
  return {
    owedAt,
    completed,
    deferred,
    store: {
      due: async () => [photo(1), photo(2)],
      complete: async (id: string) => {
        completed.push(id);
      },
      defer: async (id: string, at: string) => {
        deferred.push([id, at]);
      },
      owed: async (at: string) => {
        owedAt.push(at);
        return 7;
      },
    },
  };
};

test('the sweep deletes images before rows and defers failures', async () => {
  const fake = fakeStore();
  const removed: string[] = [];
  const result = await sweepPhotoDeletions(now, fake.store, {
    put: async () => undefined,
    read: async () => new Uint8Array(),
    removePrefix: async (prefix) => {
      if (prefix.includes('1')) throw new Error('storage refused');
      removed.push(prefix);
    },
  });
  assert({
    given: 'two due photos, the first refused by storage',
    should:
      'still delete the second, complete only it and defer the first with backoff',
    actual: {
      result,
      removed,
      completed: fake.completed,
      deferred: fake.deferred,
      owedAt: fake.owedAt,
    },
    expected: {
      result: { deleted: 1, retried: 1, owed: 7 },
      removed: [photo(2).objectPrefix],
      completed: [photo(2).photoId],
      deferred: [[photo(1).photoId, photoDeletionRetryAt(now, 1)]],
      owedAt: [now],
    },
  });
});

test('no storage configured keeps every deletion owed', async () => {
  const fake = fakeStore();
  const result = await sweepPhotoDeletions(now, fake.store, null);
  assert({
    given: 'due photos and no storage',
    should: 'complete nothing and defer each',
    actual: {
      result,
      completed: fake.completed,
      deferred: fake.deferred.length,
    },
    expected: {
      result: { deleted: 0, retried: 2, owed: 7 },
      completed: [],
      deferred: 2,
    },
  });
});

test('backoff doubles from a minute to at most an hour', () => {
  assert({
    given: 'zero, two and twenty earlier attempts',
    should: 'wait one minute, four minutes, then an hour',
    actual: [0, 2, 20].map((attempts) => photoDeletionRetryAt(now, attempts)),
    expected: [
      '2026-11-16T00:01:00.000Z',
      '2026-11-16T00:04:00.000Z',
      '2026-11-16T01:00:00.000Z',
    ],
  });
});

test('a failed defer never stops the pass', async () => {
  const fake = fakeStore();
  const removed: string[] = [];
  const result = await sweepPhotoDeletions(
    now,
    {
      ...fake.store,
      defer: async () => {
        throw new Error('database blip');
      },
    },
    {
      put: async () => undefined,
      read: async () => new Uint8Array(),
      removePrefix: async (prefix) => {
        if (prefix.includes('1')) throw new Error('storage refused');
        removed.push(prefix);
      },
    },
  );
  assert({
    given: 'storage refusing the first photo and the defer of it failing too',
    should: 'still delete the second and report the counts',
    actual: { result, removed },
    expected: {
      result: { deleted: 1, retried: 1, owed: 7 },
      removed: [photo(2).objectPrefix],
    },
  });
});
