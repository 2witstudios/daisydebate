import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentSync, type DocumentsApi } from './document-sync';
import { manualTimers, stored } from './document-sync.test-support';

setupRitewayBun();

/**
 * One stored document behind the save route's revision check. `timeOut`
 * makes the next save commit and then fail as a timed-out request does,
 * without a status; `elsewhere` saves as another tab would.
 */
const fakeServer = () => {
  let doc = stored('a', 3);
  let timeOut = false;
  const sent: { html: string; expectedRevision: number }[] = [];
  const commit = (html: string) => {
    doc = { ...doc, html, revision: doc.revision + 1 };
  };
  const api: DocumentsApi = {
    list: async () => [doc],
    create: async () => stored('new'),
    save: async ({ html, expectedRevision }) => {
      sent.push({ html, expectedRevision });
      if (expectedRevision !== doc.revision)
        return { status: 'conflict', revision: doc.revision };
      commit(html);
      if (timeOut) {
        timeOut = false;
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }
      return { status: 'saved', revision: doc.revision };
    },
  };
  return {
    api,
    sent,
    current: () => ({ html: doc.html, revision: doc.revision }),
    timeOutNextSave: () => void (timeOut = true),
    elsewhere: commit,
  };
};

const watchedSync = (api: DocumentsApi) => {
  const { timers, fire } = manualTimers();
  const conflicts: string[] = [];
  const saved: string[] = [];
  const sync = createDocumentSync({
    api,
    roundId: 'd',
    onConflict: (id) => conflicts.push(id),
    onSaved: (id) => saved.push(id),
    timers,
  });
  return { sync, fire, conflicts, saved };
};

/** '<p>first</p>' saved, committed by the server, and its request timed out. */
const afterTimedOutSave = async () => {
  const server = fakeServer();
  const watched = watchedSync(server.api);
  await watched.sync.load();
  server.timeOutNextSave();
  watched.sync.change('a', '<p>first</p>');
  await watched.sync.flush();
  return { server, ...watched };
};

describe('createDocumentSync after a save timed out', () => {
  test('edits typed since the timed-out save', async () => {
    const { server, sync, conflicts } = await afterTimedOutSave();
    sync.change('a', '<p>first and more</p>');
    await sync.flush();
    assert({
      given:
        'a save the server committed before the request timed out, then more typing',
      should:
        'adopt the committed revision on the 409 and send the later edit on top',
      actual: { server: server.current(), conflicts },
      expected: {
        server: { html: '<p>first and more</p>', revision: 5 },
        conflicts: [],
      },
    });
  });

  test('nothing typed since', async () => {
    const { server, sync, fire, conflicts, saved } = await afterTimedOutSave();
    fire();
    await sync.flush();
    sync.change('a', '<p>second</p>');
    await sync.flush();
    assert({
      given: 'the retry of a save the server already committed',
      should:
        'report it saved, with no conflict, and save the next edit on its revision',
      actual: { server: server.current(), conflicts, saved },
      expected: {
        server: { html: '<p>second</p>', revision: 5 },
        conflicts: [],
        saved: ['a', 'a'],
      },
    });
  });

  test('another tab saved after the timed-out save', async () => {
    const { server, sync, conflicts } = await afterTimedOutSave();
    server.elsewhere('<p>theirs</p>');
    sync.change('a', '<p>first and more</p>');
    await sync.flush();
    assert({
      given: 'a timed-out save, then another tab saving on top of it',
      should: 'report a conflict and overwrite nothing',
      actual: { server: server.current(), conflicts },
      expected: {
        server: { html: '<p>theirs</p>', revision: 5 },
        conflicts: ['a'],
      },
    });
  });
});

describe('createDocumentSync on a conflict', () => {
  test('the stale edit is not sent again', async () => {
    const server = fakeServer();
    const { sync, fire, conflicts } = watchedSync(server.api);
    await sync.load();
    server.elsewhere('<p>theirs</p>');
    sync.change('a', '<p>mine</p>');
    await sync.flush();
    fire();
    await sync.flush();
    assert({
      given: 'another tab saved first',
      should:
        'report the conflict once and stop saving that document, overwriting nothing',
      actual: {
        conflicts,
        sends: server.sent.length,
        server: server.current().html,
      },
      expected: {
        conflicts: ['a'],
        sends: 1,
        server: '<p>theirs</p>',
      },
    });
  });
});
