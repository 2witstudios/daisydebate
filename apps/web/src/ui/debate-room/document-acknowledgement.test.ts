import {
  loadNoteSync,
  manualNoteResources,
  memoryStorage,
  stored,
} from './document-sync.test-support';

import { assert, setupRitewayBun, test } from 'riteway/bun';

import { createDocumentsApi } from './documents-api';

setupRitewayBun();
for (const body of [
  {},
  { revision: '4' },
  { revision: null },
  { revision: -1 },
  { revision: 4.5 },
  { revision: 3 },
  { revision: 5 },
])
  test(`an invalid successful acknowledgement ${JSON.stringify(body)} cannot erase the active copy`, async () => {
    const storage = memoryStorage();
    let saved = 0,
      failed = 0;
    const sync = await loadNoteSync({
      ...manualNoteResources('ack', { storage }),

      api: createDocumentsApi({
        send: async (path) =>
          path.endsWith('/list')
            ? Response.json({ documents: [stored('a', 3)] })
            : Response.json(body),
      }),
      roundId: 'r',
      principalId: 'p',
      onConflict: () => {},
      onSaved: () => {
        saved++;
      },
      onSaveFailed: () => {
        failed++;
      },
    });

    sync.change('a', '<p>PRIVATE</p>');
    await sync.flush();
    const raw = storage.getItem('daisy:round-notes:draft:p:r:a');
    assert({
      given: 'HTTP200 without the exact next revision acknowledgement',
      should:
        'retain the active edit and report uncertain delivery instead of Saved',
      actual: [raw ? JSON.parse(raw).active.html : null, saved, failed],
      expected: ['<p>PRIVATE</p>', 0, 1],
    });
  });

const key = 'daisy:round-notes:draft:p:r:a';
const recovery = {
  generation: 'REC',
  html: '<p>REC</p>',
  baseRevision: 2,
  savedAt: 100,
  expiresAt: 604800100,
};
const malformed = [
  { revision: Number.MAX_SAFE_INTEGER },
  { revision: Number.MAX_SAFE_INTEGER + 1 },
  { revision: 2_147_483_648 },
  { revision: 0 },
  { revision: 4, unexpected: true },
  Object.create({ revision: 4 }),
  JSON.parse('{"__proto__":{"revision":4}}'),
];
for (const [index, receipt] of malformed.entries())
  test(`malformed or inherited revision control ${index} leaves both durable copies byte-for-byte unchanged`, async () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ recovery }));
    const requests: number[] = [];
    let saved = 0;
    const sync = await loadNoteSync({
      ...manualNoteResources('malformed', { storage }),

      api: createDocumentsApi({
        send: async (path, init) => {
          if (path.endsWith('/list'))
            return Response.json({ documents: [stored('a', 3)] });
          requests.push(JSON.parse(String(init.body)).expectedRevision);
          const response = Response.json({});
          response.json = async () => receipt;
          return response;
        },
      }),
      roundId: 'r',
      principalId: 'p',
      onConflict: () => {},
      onSaved: () => {
        saved++;
      },
    });

    sync.change('a', '<p>NEW</p>');
    const before = storage.getItem(key);
    await sync.flush();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert({
      given: 'a malformed successful receipt with active and recovery copies',
      should:
        'neither mutate durable data nor report Saved, advance base or immediately resend',
      actual: [storage.getItem(key), saved, requests],
      expected: [before, 0, [3]],
    });
  });

test('a valid fresh acknowledgement clears only its active generation', async () => {
  const storage = memoryStorage();
  let saved = 0;
  const sync = await loadNoteSync({
    ...manualNoteResources('fresh', { storage }),

    api: createDocumentsApi({
      send: async (path) =>
        path.endsWith('/list')
          ? Response.json({ documents: [stored('a', 3)] })
          : Response.json({ revision: 4 }),
    }),
    roundId: 'r',
    principalId: 'p',
    onConflict: () => {},
    onSaved: () => {
      saved++;
    },
  });

  sync.change('a', '<p>NEW</p>');
  await sync.flush();
  assert({
    given: 'the exact next revision receipt from a fresh CAS',
    should: 'clear the acknowledged active copy and report Saved',
    actual: [storage.getItem(key), saved],
    expected: [null, 1],
  });
});

test('an invalid acknowledgement after a real commit uses original CAS then reread reconciliation before rebasing', async () => {
  const storage = memoryStorage();
  storage.setItem(key, JSON.stringify({ recovery }));
  let server = stored('a', 3),
    uncertain = 0,
    conflicts = 0;
  const sent: number[] = [];
  const sync = await loadNoteSync({
    ...manualNoteResources('replay', { storage }),

    api: createDocumentsApi({
      send: async (path, init) => {
        if (path.endsWith('/list'))
          return Response.json({ documents: [server] });
        const input = JSON.parse(String(init.body));
        sent.push(input.expectedRevision);
        if (input.expectedRevision !== server.revision)
          return Response.json({ revision: server.revision }, { status: 409 });
        server = { ...server, html: input.html, revision: server.revision + 1 };
        return Response.json(
          sent.length === 1 ? {} : { revision: server.revision },
        );
      },
    }),
    roundId: 'r',
    principalId: 'p',
    onConflict: () => {
      conflicts++;
    },
    onSaveFailed: () => {
      uncertain++;
    },
  });

  sync.change('a', '<p>Committed but unknown</p>');
  const before = storage.getItem(key);
  await sync.flush();
  assert({
    given: 'server commit followed by an invalid HTTP200 receipt',
    should:
      'retain both exact copies and the old base while delivery remains uncertain',
    actual: [storage.getItem(key), sent, uncertain],
    expected: [before, [3], 1],
  });
  await sync.flush();
  assert({
    given:
      'an explicit retry of that original CAS receives409 and rereads its exact own commit',
    should:
      'clear only active after reconciliation while keeping independent recovery',
    actual: [JSON.parse(storage.getItem(key)!), sent, conflicts],
    expected: [{ recovery }, [3, 3], 0],
  });
  sync.change('a', '<p>Next</p>');
  await sync.flush();
  assert({
    given: 'a new edit after successful reconciliation',
    should: 'use only the proven acknowledged base for its fresh CAS',
    actual: [
      sent,
      server.revision,
      server.html,
      JSON.parse(storage.getItem(key)!),
    ],
    expected: [[3, 3, 4], 5, '<p>Next</p>', { recovery }],
  });
});

for (const body of [
  {},
  { revision: '4' },
  { revision: Number.MAX_SAFE_INTEGER + 1 },
])
  test(`a malformed conflict receipt ${JSON.stringify(body)} does not fence or consume either durable copy`, async () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ recovery }));
    let conflicts = 0,
      failed = 0;
    const sync = await loadNoteSync({
      ...manualNoteResources('conflict', { storage }),

      api: createDocumentsApi({
        send: async (path) =>
          path.endsWith('/list')
            ? Response.json({ documents: [stored('a', 3)] })
            : Response.json(body, { status: 409 }),
      }),
      roundId: 'r',
      principalId: 'p',
      onConflict: () => {
        conflicts++;
      },
      onSaveFailed: () => {
        failed++;
      },
    });

    sync.change('a', '<p>NEW</p>');
    const before = storage.getItem(key);
    await sync.flush();
    assert({
      given: 'HTTP409 without a valid current-revision scalar',
      should:
        'retain both copies as uncertain without inventing a conflict revision',
      actual: [storage.getItem(key), conflicts, failed],
      expected: [before, 0, 1],
    });
  });

test('the largest valid server revision is accepted without safe-integer overflow', async () => {
  const api = createDocumentsApi({
    send: async () => Response.json({ revision: 2_147_483_647 }),
  });
  const result = await api.save({
    id: 'a',
    html: '<p>NEW</p>',
    expectedRevision: 2_147_483_646,
  });
  assert({
    given: 'a fresh CAS at the upper server integer boundary',
    should: 'accept its exact safe next revision',
    actual: result,
    expected: { status: 'saved', revision: 2_147_483_647 },
  });
});
