import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  photoDeletionRetryAt,
  reconcileOrphans,
  sweepPhotoDeletions,
} from './deletion-sweep';
setupRitewayBun();

const now = '2026-11-16T00:00:00.000Z';
const photo = (n: number) => ({
  photoId: String(n).repeat(24),
  objectPrefix: `profile-photos/${String(n).repeat(24)}`,
  attempts: n,
});

const fakeStore = () => {
  const completed: string[] = [];
  const deferred: [string, string][] = [];
  return {
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
      owed: async () => 7,
      existing: async () => new Set<string>(),
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
    list: async () => [],
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
    },
    expected: {
      result: { deleted: 1, retried: 1, owed: 7 },
      removed: [photo(2).objectPrefix],
      completed: [photo(2).photoId],
      deferred: [[photo(1).photoId, photoDeletionRetryAt(now, 1)]],
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

test('the reconcile deletes aged objects no row names, and walks on', async () => {
  const orphan = 'o'.repeat(24);
  const kept = 'k'.repeat(24);
  const fresh = 'f'.repeat(24);
  const old = '2026-11-15T22:00:00.000Z';
  const removed: string[] = [];
  const page = [
    { key: `profile-photos/${kept}/128.webp`, writtenAt: old },
    { key: `profile-photos/${orphan}/128.webp`, writtenAt: old },
    { key: `profile-photos/${orphan}/512.webp`, writtenAt: old },
    { key: `profile-photos/${fresh}/512.webp`, writtenAt: now },
  ];
  const result = await reconcileOrphans(
    now,
    null,
    { existing: async (ids) => new Set(ids.filter((id) => id === kept)) },
    {
      put: async () => undefined,
      read: async () => new Uint8Array(),
      removePrefix: async (prefix) => {
        removed.push(prefix);
      },
      list: async () => page,
    },
  );
  assert({
    given:
      'an aged photo with a row, an aged orphan, and an orphan written a moment ago',
    should:
      'delete only the aged orphan once, and restart the walk after a short page',
    actual: { result, removed },
    expected: {
      result: { next: null, orphans: 1 },
      removed: [`profile-photos/${orphan}`],
    },
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
      list: async () => [],
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

test('an object with no write time ages from when it was first seen', async () => {
  const key = `profile-photos/${'n'.repeat(24)}/512.webp`;
  const run = async (firstSeen: Map<string, string>) => {
    const removed: string[] = [];
    const result = await reconcileOrphans(
      now,
      null,
      { existing: async () => new Set<string>() },
      {
        put: async () => undefined,
        read: async () => new Uint8Array(),
        removePrefix: async (prefix) => {
          removed.push(prefix);
        },
        list: async () => [{ key, writtenAt: null }],
      },
      firstSeen,
    );
    return { orphans: result.orphans, removed, remembered: firstSeen.has(key) };
  };
  assert({
    given:
      'an unnamed object storage gave no write time, seen for the first time, then first seen two hours ago',
    should:
      'keep it the first time and remember when, and delete it once that sighting is an hour old',
    actual: [
      await run(new Map()),
      await run(new Map([[key, '2026-11-15T22:00:00.000Z']])),
    ],
    expected: [
      { orphans: 0, removed: [], remembered: true },
      {
        orphans: 1,
        removed: [`profile-photos/${'n'.repeat(24)}`],
        remembered: false,
      },
    ],
  });
});
