import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createDocumentSync,
  type DocumentsApi,
  type SaveResult,
  type StoredDocument,
  type Timers,
} from './document-sync';

setupRitewayBun();

const stored = (id: string, revision = 1): StoredDocument => ({
  id,
  title: id,
  folder: 'round',
  templateId: 'flow',
  html: '<p>\n</p>',
  createdAt: '2026-10-05T18:00:00.000Z',
  updatedAt: '2026-10-05T18:00:00.000Z',
  revision,
});

/** Timers that fire only when the test says so. */
const manualTimers = () => {
  const queued = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    set: (run) => {
      next += 1;
      queued.set(next, run);
      return next;
    },
    clear: (handle) => void queued.delete(handle as number),
  };
  const fire = () => {
    const runs = [...queued.values()];
    queued.clear();
    for (const run of runs) run();
  };
  return { timers, fire };
};

const fakeApi = (answer: (revision: number) => SaveResult) => {
  const saves: { id: string; html: string; expectedRevision: number }[] = [];
  const api: DocumentsApi = {
    list: async () => [stored('a', 3)],
    create: async ({ templateId }) => ({ ...stored('new'), templateId }),
    save: async (input) => {
      saves.push(input);
      return answer(input.expectedRevision);
    },
  };
  return { api, saves };
};

/** Saves bump the revision by one, as the server does. */
const bumping = (revision: number): SaveResult => ({
  status: 'saved',
  revision: revision + 1,
});

/** A sync over the api with manual timers and no conflict handling. */
const quietSync = (api: DocumentsApi, timers = manualTimers().timers) =>
  createDocumentSync({ api, aiDebateId: 'd', onConflict: () => {}, timers });

describe('createDocumentSync', () => {
  test('saves once typing pauses', async () => {
    const { api, saves } = fakeApi(bumping);
    const { timers, fire } = manualTimers();
    const sync = quietSync(api, timers);
    await sync.load();
    sync.change('a', '<p>1</p>');
    sync.change('a', '<p>12</p>');
    fire();
    await sync.flush();
    assert({
      given: 'two edits before the pause',
      should: 'save only the latest, against the revision it was read at',
      actual: saves,
      expected: [{ id: 'a', html: '<p>12</p>', expectedRevision: 3 }],
    });
  });

  test('carries the new revision forward', async () => {
    const { api, saves } = fakeApi(bumping);
    const sync = quietSync(api);
    await sync.load();
    sync.change('a', '<p>1</p>');
    await sync.flush();
    sync.change('a', '<p>2</p>');
    await sync.flush();
    assert({
      given: 'a second save after the first',
      should: 'expect the revision the first save produced',
      actual: saves.map((save) => save.expectedRevision),
      expected: [3, 4],
    });
  });

  test('a conflict', async () => {
    const { api } = fakeApi(() => ({ status: 'conflict', revision: 7 }));
    const conflicts: string[] = [];
    const sync = createDocumentSync({
      api,
      aiDebateId: 'd',
      onConflict: (id) => conflicts.push(id),
      timers: manualTimers().timers,
    });
    await sync.load();
    sync.change('a', '<p>mine</p>');
    await sync.flush();
    assert({
      given: 'another tab saved first',
      should: 'report the conflict for that document',
      actual: conflicts,
      expected: ['a'],
    });
  });

  test('an unknown document', async () => {
    const { api, saves } = fakeApi((revision) => ({
      status: 'saved',
      revision,
    }));
    const sync = quietSync(api);
    sync.change('never-loaded', '<p>x</p>');
    await sync.flush();
    assert({
      given: 'an edit to a document the room never loaded',
      should: 'not send it',
      actual: saves.length,
      expected: 0,
    });
  });

  test('a new document', async () => {
    const { api, saves } = fakeApi(bumping);
    const sync = quietSync(api);
    const doc = await sync.create('round', 'cross-ex');
    sync.change(doc.id, '<p>q</p>');
    await sync.flush();
    assert({
      given: 'a document created and then edited',
      should: 'save it against the revision it was created at',
      actual: { templateId: doc.templateId, saves },
      expected: {
        templateId: 'cross-ex',
        saves: [{ id: 'new', html: '<p>q</p>', expectedRevision: 1 }],
      },
    });
  });
});
