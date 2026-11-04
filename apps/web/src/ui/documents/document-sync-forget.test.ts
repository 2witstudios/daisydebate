import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createDocumentSync,
  documentApi,
  memoryStorage,
  manualTimers,
  stored,
  manualDraftResources,
} from './document-sync.test-support';
import { newDraftCopy } from '../../features/documents/document-draft';
setupRitewayBun();

test('one folder deletion forgets a full drive in one publication and retains outside text', async () => {
  const documents = Array.from({ length: 500 }, (_, index) =>
    stored(`doc${index}`, 3),
  );
  const storage = memoryStorage();
  for (let index = 0; index < 15; index++)
    storage.setItem(
      `daisy:document-drafts:copy:p:doc${index}`,
      JSON.stringify({
        recovery: newDraftCopy({
          html: `<p>Recovered ${index}</p>`,
          generation: `${'a'.repeat(23)}${index.toString(16)}`,
          baseRevision: 2,
          now: 100,
        }),
      }),
    );
  const saved: string[] = [];
  const sync = createDocumentSync({
    principalId: 'p',
    api: documentApi(
      async (input) => {
        saved.push(input.id);
        return { status: 'saved', revision: 4 };
      },
      () => documents,
    ),
    ...manualDraftResources('p', { storage, timers: manualTimers().timers }),
    onConflict: () => {},
  });
  try {
    await sync.load();
    sync.change('doc499', '<p>Outside typing</p>');
    let publications = 0;
    const stop = sync.subscribe(() => {
      publications++;
    });
    sync.forgetAll(
      documents
        .slice(0, 14)
        .map((document) => document.id)
        .concat(documents.slice(15, 499).map((document) => document.id)),
    );
    assert({
      given:
        'a confirmed folder delete spanning498 documents and14 recovery offers',
      should: 'publish once and preserve the outside offer and typing',
      actual: [
        publications,
        sync.recoveryOffers().map((offer) => offer.documentId),
        sync.canOpen('doc0'),
        sync.canOpen('doc499'),
        JSON.parse(storage.getItem('daisy:document-drafts:copy:p:doc499')!)
          .active.html,
      ],
      expected: [1, ['doc14'], false, true, '<p>Outside typing</p>'],
    });
    await sync.flush();
    assert({
      given: 'the next flush after bulk deletion',
      should: 'send only surviving pending text',
      actual: saved,
      expected: ['doc499'],
    });
    stop();
  } finally {
    sync.dispose();
  }
});
