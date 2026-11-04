import { Window as BrowserWindow } from 'happy-dom';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
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
  } = {},
) => {
  const browser = new BrowserWindow({ url: 'https://daisy.test/' });
  const built = await Bun.build({
    entrypoints: [Bun.resolveSync('./use-drive.test-support', import.meta.dir)],
    format: 'cjs',
    target: 'browser',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  if (!built.success) throw new Error('Drive test client failed to build');
  const client = runInNewContext(
    `${await built.outputs[0]!.text()}; module.exports;`,
    {
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
      module: { exports: {} },
      setTimeout: options.timer ?? setTimeout,
      clearTimeout: options.timer ? () => {} : clearTimeout,
      queueMicrotask,
      console,
      MessageChannel,
      fetch,
      AbortSignal,
    },
  ) as typeof Client;
  const container = browser.document.createElement('div');
  browser.document.body.append(container);
  const root = client.createRoot(container as unknown as HTMLElement);
  const actions: ManagerAction[] = [];
  let drive!: DriveActions;
  const problems: (string | null)[] = [];
  const sync = {
    create: async () => doc,
    forget: () => {},
    recheck: async () => {},
  } as unknown as DocumentSync;
  function Hook({ save }: { save: 'saved' | 'saving' }) {
    drive = client.useDrive({
      sync,
      opened: [],
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
    problems,
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
