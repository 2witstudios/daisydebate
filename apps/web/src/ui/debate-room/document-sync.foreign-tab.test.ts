import {
  manualNoteResources,
  memoryStorage,
  stored,
} from './document-sync.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDocumentSync } from './document-sync';

setupRitewayBun();
test('a legitimate newer foreign-tab active copy is withheld without a false storage failure or blocking own saves', async () => {
  const storage = memoryStorage(),
    warnings: string[] = [],
    saved: string[] = [];
  let documents = [stored('a', 3), stored('b', 3)];
  const api = {
    list: async () => documents,
    create: async () => stored('new'),
    save: async (input: {
      id: string;
      html: string;
      expectedRevision: number;
    }) => {
      const current = documents.find((d) => d.id === input.id)!;
      if (current.revision !== input.expectedRevision)
        return { status: 'conflict' as const, revision: current.revision };
      documents = documents.map((d) =>
        d.id === input.id
          ? { ...d, html: input.html, revision: d.revision + 1 }
          : d,
      );
      return { status: 'saved' as const, revision: current.revision + 1 };
    },
  };
  const owner = (name: string) =>
    createDocumentSync({
      ...manualNoteResources(name, { storage }),

      api,
      roundId: 'r',
      principalId: 'p',
      onConflict: () => {},
      onDraftStorageFailed: (id) => {
        if (name === 'one') warnings.push(id);
      },
      onSaved: (id) => {
        if (name === 'one') saved.push(id);
      },
    });
  const one = owner('one'),
    two = owner('two');
  await one.load();
  await two.load();
  two.change('a', 'committed foreign text');
  await two.flush();
  two.change('a', 'new foreign text');
  const foreign = storage.getItem('daisy:round-notes:draft:p:r:a');
  one.refreshRecovery();
  one.change('b', 'own edit');
  await one.flush();
  assert({
    given:
      'another tab commits revision4 and stores a newer active edit while this tab knows3',
    should:
      'preserve and withhold the foreign offer without calling storage broken or blocking this tab acknowledgement',
    actual: [
      warnings,
      saved,
      one.recoveryOffers(),
      storage.getItem('daisy:round-notes:draft:p:r:a'),
    ],
    expected: [[], ['b'], [], foreign],
  });
});
