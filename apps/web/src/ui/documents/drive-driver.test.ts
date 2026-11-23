import { virtualClock } from '@daisy/clock/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ManagerAction } from '../../features/documents/document-manager-state';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import type { DocumentSync } from './document-sync';
import { createDriveDriver, seedDrive, type DriveOwner } from './drive-driver';
import { createDriveOperations } from './drive-operations';

setupRitewayBun();

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const failure = (status: number) =>
  Object.assign(new Error('Drive request failed'), { status });
const sync = (over: Partial<DocumentSync> = {}) =>
  ({
    available: () => true,
    canOpen: () => true,
    recheck: async () => {},
    forget: () => {},
    forgetAll: () => {},
    ...over,
  }) as unknown as DocumentSync;

type Api = Parameters<typeof createDriveDriver>[0]['api'];
const start = (
  api: Partial<Api>,
  options: { readonly recent?: boolean; readonly owner?: DocumentSync } = {},
) => {
  const clock = virtualClock(10_000);
  const { scheduler } = virtualBrowserTime(clock);
  const actions: ManagerAction[] = [];
  const owned = options.owner ?? sync();
  let owner: DriveOwner = { sync: owned, scope: createDriveOperations(owned) };
  owner.scope.activate();
  const driver = createDriveDriver({
    seed: seedDrive([], undefined),
    recentSeeded: false,
    api: {
      list: async () => ({ entries: [], next: null }),
      change: async () => ({}) as never,
      folders: async () => [],
      hasDocument: async () => true,
      folderCount: async () => 0,
      recent: async () => [],
      ...api,
    } as Api,
    owner: () => owner,
    opened: () => [],
    dispatch: (action) => actions.push(action),
    showRecent: () => options.recent ?? false,
    now: () => '2026-11-23T00:00:00.000Z',
    clockMs: clock.nowMs,
    after: scheduler.after,
  });
  return {
    clock,
    driver,
    actions,
    replaceOwner: () => {
      owner.scope.close();
      const next = sync();
      owner = { sync: next, scope: createDriveOperations(next) };
      owner.scope.activate();
    },
    types: () => actions.map((action) => action.type),
  };
};

describe('drive driver', () => {
  test('a root page read before a change is read again, never applied', async () => {
    const first = deferred<{ entries: never[]; next: null }>();
    let reads = 0;
    const { clock, driver, actions } = start({
      list: async () =>
        ++reads === 1
          ? first.promise
          : {
              entries: [{ kind: 'document', id: 'a', title: 'A' }] as never[],
              next: null,
            },
    });
    driver.readRoot();
    driver.change('rename', { id: 'a', title: 'A' });
    await clock.settle();
    first.resolve({ entries: [], next: null });
    await clock.settle();
    const pages = actions.filter((action) => action.type === 'drive/page');
    assert({
      given: 'a root read that began before an acknowledged rename',
      should: 'drop its answer and publish only the page read after',
      actual: {
        reads,
        pages: pages.length,
        empty: pages.some(
          (page) => page.type === 'drive/page' && page.entries.length === 0,
        ),
      },
      expected: { reads: 2, pages: 1, empty: false },
    });
  });

  test('a failed change says so until a later change succeeds', async () => {
    let fail = true;
    const { clock, driver } = start({
      change: async () => {
        if (fail) throw failure(409);
        return {} as never;
      },
    });
    driver.change('rename', { id: 'a', title: 'A' });
    await clock.settle();
    const refused = driver.readSnapshot().problem;
    fail = false;
    driver.change('rename', { id: 'a', title: 'B' });
    await clock.settle();
    assert({
      given: 'a conflicting rename, then one that saves',
      should: 'show the conflict notice, then clear it',
      actual: [refused?.kind, driver.readSnapshot().problem],
      expected: ['change', null],
    });
  });

  test('a missing row is unlisted and open text rechecked', async () => {
    const rechecked: string[] = [];
    const { clock, driver, types } = start(
      {
        change: async () => {
          throw failure(404);
        },
      },
      {
        owner: sync({
          recheck: async () => void rechecked.push('recheck'),
        }),
      },
    );
    driver.change('rename', { id: 'gone', title: 'X' });
    await clock.settle();
    assert({
      given: 'a rename of a row another tab deleted',
      should: 'unlist it, recheck open documents and say it is missing',
      actual: {
        types: types(),
        rechecked,
        problem: driver.readSnapshot().problem?.kind,
      },
      expected: {
        types: ['drive/unlist'],
        rechecked: ['recheck'],
        problem: 'missing',
      },
    });
  });

  test('Recent reads at most once every three seconds, trailing the last', async () => {
    let reads = 0;
    const { clock, driver } = start(
      {
        recent: async () => {
          reads += 1;
          return [{ id: `r${reads}`, title: 'Doc' }] as never;
        },
      },
      { recent: true },
    );
    for (let index = 0; index < 5; index++) {
      driver.saveSettled('saving', true);
      driver.saveSettled('saved', true);
      await clock.advance(200);
    }
    const early = reads;
    await clock.advance(3000);
    assert({
      given: 'five saves settling within a second',
      should: 'read once at once and once more three seconds later',
      actual: { early, reads, shown: driver.readSnapshot().recent },
      expected: {
        early: 1,
        reads: 2,
        shown: [{ id: 'r2', title: 'Doc' }],
      },
    });
  });

  test('a replaced owner never publishes the old one’s answer', async () => {
    const answer = deferred<never>();
    const { clock, driver, replaceOwner, types } = start({
      change: () => answer.promise,
    });
    driver.change('rename', { id: 'a', title: 'A' });
    await clock.settle();
    replaceOwner();
    answer.resolve({} as never);
    await clock.settle();
    assert({
      given: 'a rename whose owner was replaced before it answered',
      should: 'dispatch nothing',
      actual: types(),
      expected: [],
    });
  });

  test('a folder that will not open closes again with its notice', async () => {
    const { clock, driver, actions } = start({
      list: async () => {
        throw failure(500);
      },
    });
    let opened = true;
    void driver.toggle('f', true, false).then((result) => {
      opened = result;
    });
    await clock.settle();
    assert({
      given: 'an expansion whose first read fails',
      should: 'expand, collapse, and show the folder notice',
      actual: {
        opened,
        actions,
        problem: driver.readSnapshot().problem,
      },
      expected: {
        opened: false,
        actions: [
          { type: 'drive/expand', folderId: 'f', expanded: true },
          { type: 'drive/expand', folderId: 'f', expanded: false },
        ],
        problem: {
          kind: 'read',
          resourceId: 'f',
          message: 'That folder did not open. Try again.',
        },
      },
    });
  });
});
