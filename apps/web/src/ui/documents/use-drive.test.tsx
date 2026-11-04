import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type * as Client from './use-drive.test-support';
import type { ManagerAction } from '../../features/documents/document-manager-state';
import type { DriveActions } from './use-drive';
import type { DocumentSync } from './document-sync';
setupRitewayBun();
const doc = {
  id: 'a',
  title: 'Notes',
  html: '<p></p>',
  createdAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  revision: 1,
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const mount = async (
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
  options: {
    listRoot?: boolean;
    showRecent?: boolean;
    timer?: (run: () => void, ms: number) => unknown;
    sync?: Partial<DocumentSync>;
    opened?: readonly import('../../features/documents/open-documents').OpenDocument[];
  } = {},
) => {
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./use-drive.test-support', import.meta.dir),
    {
      fetch,
      AbortSignal,
      setTimeout: options.timer ?? setTimeout,
      clearTimeout: options.timer ? () => {} : clearTimeout,
    },
  );
  const { browser, root } = client;
  const actions: ManagerAction[] = [];
  let drive!: DriveActions;
  const sync = {
    create: async () => doc,
    available: () => true,
    canOpen: () => true,
    forgetAll: () => {},
    forget: () => {},
    recheck: async () => {},
    ...options.sync,
  } as unknown as DocumentSync;
  function Hook({ save }: { save: 'saved' | 'saving' }) {
    drive = client.useDrive({
      sync,
      opened: options.opened ?? [],
      dispatch: (action) => actions.push(action),
      initialFolders: [{ id: 'cases', name: 'Cases', parentFolderId: null }],
      listRoot: options.listRoot ?? false,
      showRecent: options.showRecent ?? false,
      save,
    });
    return null;
  }
  const render = async (save: 'saved' | 'saving' = 'saved') => {
    await client.act(async () =>
      root.render(client.createElement(Hook, { save })),
    );
  };
  await render();
  return {
    ...client,
    actions,
    browser,
    root,
    render,
    drive: () => drive,
    close: async () => {
      await client.act(async () => root.unmount());
      await browser.happyDOM.abort();
    },
  };
};

test('a first listing cannot overwrite an acknowledged mutation', async () => {
  const first = deferred<Response>();
  let reads = 0;
  const fixture = await mount(
    async (path) => {
      if (path.endsWith('/list'))
        return ++reads === 1
          ? first.promise
          : Response.json({
              entries: [{ kind: 'document', id: 'a', title: 'Notes' }],
              next: null,
            });
      return Response.json({});
    },
    { listRoot: true },
  );
  try {
    await fixture.act(async () => fixture.drive().createDocument(null));
    await fixture.act(async () =>
      first.resolve(Response.json({ entries: [], next: null })),
    );
    const pages = fixture.actions.filter(
      (action) => action.type === 'drive/page',
    );
    assert({
      given:
        'a root read that began before creating a document and answered later',
      should: 'never publish that stale empty page',
      actual: pages.some(
        (action) => action.type === 'drive/page' && action.entries.length === 0,
      ),
      expected: false,
    });
  } finally {
    await fixture.close();
  }
});

test('drive failures preserve status, clear on success and keep known folder destinations', async () => {
  let refuse = true;
  const fixture = await mount(async (path) =>
    path.endsWith('/folders')
      ? new Response('{}', { status: 503 })
      : new Response('{}', { status: refuse ? 409 : 200 }),
  );
  try {
    await fixture.act(async () =>
      fixture
        .drive()
        .change('folders/create', { name: 'New folder', parentFolderId: '' }),
    );
    assert({
      given: 'a full or too-deep drive',
      should: 'explain that retrying cannot fix it',
      actual: fixture.drive().problem,
      expected: 'That change is not possible: the drive is full or too deep.',
    });
    refuse = false;
    await fixture.act(async () =>
      fixture.drive().change('rename', { id: 'a', title: 'New notes' }),
    );
    await fixture.act(async () => fixture.drive().loadFolders());
    assert({
      given: 'a successful retry followed by a failed destinations read',
      should:
        'clear the stale mutation notice and preserve known destinations with an explicit read failure',
      actual: [
        fixture.drive().problem,
        fixture.drive().folders.map((folder) => folder.name),
        Boolean(fixture.drive().folderProblem),
      ],
      expected: [null, ['Cases'], true],
    });
  } finally {
    await fixture.close();
  }
});

test('Recent refreshes are bounded and ignore superseded responses', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let reads = 0;
  let trailing: (() => void) | null = null;
  const fixture = await mount(
    async (path) =>
      path.endsWith('/recent')
        ? ++reads === 1
          ? first.promise
          : second.promise
        : Response.json({}),
    {
      showRecent: true,
      timer: (run) => {
        trailing = run;
        return 1;
      },
    },
  );
  try {
    for (let index = 0; index < 5; index++) {
      await fixture.render('saving');
      await fixture.render('saved');
    }
    assert({
      given: 'five closely spaced autosaves',
      should:
        'share one trailing Recent refresh rather than spend five read requests',
      actual: reads,
      expected: 1,
    });
    await fixture.act(async () => {
      trailing?.();
    });
    await fixture.act(async () =>
      second.resolve(
        Response.json({ documents: [{ id: 'new', title: 'New' }] }),
      ),
    );
    await fixture.act(async () =>
      first.resolve(
        Response.json({ documents: [{ id: 'old', title: 'Old' }] }),
      ),
    );
    assert({
      given: 'an older Recent response arriving last',
      should: 'keep the newest result',
      actual: fixture.drive().recent.map((document) => document.id),
      expected: ['new'],
    });
  } finally {
    await fixture.close();
  }
});

test('failed folder reads roll back expansion and only clear their own notice', async () => {
  let status = 503;
  const fixture = await mount(async (path) =>
    path.endsWith('/list')
      ? new Response(JSON.stringify({ entries: [], next: null }), { status })
      : new Response('{}', { status: 409 }),
  );
  try {
    await fixture.act(async () => {
      await fixture.drive().toggle('cases', true, false);
    });
    assert({
      given: 'a folder whose first read failed',
      should: 'roll back its expansion so one more click retries',
      actual: fixture.actions.at(-1),
      expected: { type: 'drive/expand', folderId: 'cases', expanded: false },
    });
    status = 200;
    await fixture.act(async () => {
      await fixture.drive().toggle('cases', true, false);
    });
    assert({
      given: 'the same read succeeding on retry',
      should: 'clear its stale error',
      actual: fixture.drive().problem,
      expected: null,
    });
    await fixture.act(async () =>
      fixture.drive().change('rename', { id: 'a', title: 'Notes' }),
    );
    await fixture.act(async () => {
      await fixture.drive().toggle('cases', true, false);
    });
    assert({
      given: 'a successful read after an unrelated mutation failure',
      should: 'keep the mutation explanation',
      actual: fixture.drive().problem,
      expected: 'That change is not possible: the drive is full or too deep.',
    });
  } finally {
    await fixture.close();
  }
});

test('external deletion unlists the stale row and rechecks open text without discarding it', async () => {
  const rechecked: readonly string[][] = [];
  let forgotten = 0;
  const fixture = await mount(async () => new Response('{}', { status: 404 }), {
    opened: [{ kind: 'loaded', document: doc }],
    sync: {
      forget: () => {
        forgotten++;
      },
      recheck: async (ids) => {
        (rechecked as string[][]).push([...ids]);
      },
    },
  });
  try {
    await fixture.act(async () =>
      fixture.drive().change('rename', { id: 'a', title: 'New title' }),
    );
    assert({
      given: 'rename reporting that an open document was deleted elsewhere',
      should: 'unlist it with an accurate notice and recheck its retained text',
      actual: [
        fixture.drive().problem,
        fixture.actions.some(
          (action) => action.type === 'drive/unlist' && action.id === 'a',
        ),
        rechecked,
        forgotten,
        fixture.actions.some((action) => action.type === 'drive/remove'),
      ],
      expected: ['That is no longer in your drive.', true, [['a']], 0, false],
    });
    await fixture.act(async () => {
      await fixture.drive().toggle('cases', true, false);
    });
    assert({
      given: 'a missing folder',
      should: 'unlist it without closing any open descendant text',
      actual: [
        fixture.actions.some(
          (action) => action.type === 'drive/unlist' && action.id === 'cases',
        ),
        forgotten,
      ],
      expected: [true, 0],
    });
  } finally {
    await fixture.close();
  }
});

test('saving recovered text as new participates in first-page ordering', async () => {
  const first = deferred<Response>();
  let reads = 0;
  const fixture = await mount(
    async (path) =>
      path.endsWith('/list')
        ? ++reads === 1
          ? first.promise
          : Response.json({
              entries: [{ kind: 'document', id: 'a', title: 'Notes' }],
              next: null,
            })
        : Response.json({}),
    { listRoot: true, sync: { saveAsNew: async () => doc } },
  );
  try {
    await fixture.act(async () => {
      await fixture.drive().saveRecovered('gone');
    });
    await fixture.act(async () =>
      first.resolve(Response.json({ entries: [], next: null })),
    );
    assert({
      given:
        'a root read held across saving a recovered copy as a new document',
      should: 'insert the recovered row and never publish the old empty page',
      actual: [
        fixture.actions.some(
          (action) => action.type === 'drive/add' && action.entry.id === 'a',
        ),
        fixture.actions.some(
          (action) =>
            action.type === 'drive/page' && action.entries.length === 0,
        ),
      ],
      expected: [true, false],
    });
  } finally {
    await fixture.close();
  }
});

test('closed or forgotten owners never turn a null open into a missing-document claim', async () => {
  let available = false;
  let resolve!: (value: null) => void;
  const fixture = await mount(async () => Response.json({}), {
    sync: {
      canOpen: () => available,
      open: () =>
        new Promise<null>((done) => {
          resolve = done;
        }),
    },
  });
  try {
    await fixture.act(async () => fixture.drive().open('a', 'Notes'));
    assert({
      given: 'a row chosen after the owner closed',
      should: 'leave its tree, tabs and notices unchanged',
      actual: fixture.actions.length,
      expected: 0,
    });
    available = true;
    await fixture.act(async () => fixture.drive().open('a', 'Notes'));
    available = false;
    await fixture.act(async () => resolve(null));
    assert({
      given: 'an outstanding open forgotten or closed before its response',
      should: 'avoid claiming deletion or unlisting it',
      actual: [
        fixture.drive().problem,
        fixture.actions.some((action) => action.type === 'drive/unlist'),
      ],
      expected: [null, false],
    });
  } finally {
    await fixture.close();
  }
});

test('a missing destination never unlists a move source that still exists', async () => {
  const fixture = await mount(async (path) =>
    path.endsWith('/folders')
      ? Response.json({
          folders: [
            { id: 'source-folder', name: 'Source', parentFolderId: null },
          ],
        })
      : path.endsWith('/read')
        ? Response.json({ documents: [doc] })
        : new Response('{}', { status: 404 }),
  );
  try {
    await fixture.act(async () =>
      fixture.drive().change('move', { id: doc.id, folderId: 'gone-target' }),
    );
    await fixture.act(async () =>
      fixture
        .drive()
        .change('folders/move', {
          id: 'source-folder',
          parentFolderId: 'gone-target',
        }),
    );
    assert({
      given:
        'document and folder moves whose destination vanished while their sources remain owned',
      should: 'keep both sources and refresh the available destinations',
      actual: [
        fixture.actions.some((action) => action.type === 'drive/unlist'),
        fixture.drive().folders.map((folder) => folder.id),
        fixture.drive().problem,
      ],
      expected: [
        false,
        ['source-folder'],
        'That destination is no longer in your drive. Choose another folder.',
      ],
    });
  } finally {
    await fixture.close();
  }
});

test('missing notices end on later success while unrelated read errors survive a change', async () => {
  let status = 404;
  const fixture = await mount(async (path) =>
    path.endsWith('/list')
      ? new Response(JSON.stringify({ entries: [], next: null }), { status })
      : Response.json({}),
  );
  try {
    await fixture.act(async () => {
      await fixture.drive().toggle('gone', true, false);
    });
    await fixture.act(async () =>
      fixture.drive().change('rename', { id: 'a', title: 'Notes' }),
    );
    assert({
      given: 'a missing row followed by a successful rename',
      should: 'clear the completed missing-item notice',
      actual: fixture.drive().problem,
      expected: null,
    });
    status = 503;
    await fixture.act(async () => {
      await fixture.drive().toggle('offline', true, false);
    });
    await fixture.act(async () =>
      fixture.drive().change('rename', { id: 'a', title: 'Notes' }),
    );
    assert({
      given:
        'a different unread folder that is still unavailable after a successful rename',
      should: 'keep its unrelated read failure',
      actual: fixture.drive().problem,
      expected: 'That folder did not open. Try again.',
    });
  } finally {
    await fixture.close();
  }
});
