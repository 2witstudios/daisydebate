import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createDebateRoomDocumentHandlers } from './document-handlers';
import type { DebateDocumentOperations } from './document-operations';

setupRitewayBun();

const ORIGIN = 'http://localhost:3000';
const DOC = 'ckdocument0000000000000a';
const DEBATE = 'ckaidebate00000000000000';

const member: Identity = {
  state: 'member',
  username: 'ada',
  principal: { kind: 'user', userId: 'user1', permissions: [] },
};

const document = {
  id: DOC,
  title: 'Flow',
  folder: 'round' as const,
  templateId: 'flow' as const,
  html: '<p>\n</p>',
  createdAt: '2026-10-05T18:00:00.000Z',
  updatedAt: '2026-10-05T18:00:00.000Z',
  revision: 1,
};

const conflictAt = (revision: number) =>
  Object.assign(createAppError('CONFLICT'), { revision });

const handlersWith = ({
  identity = member,
  save = async () => ({ revision: 2 }),
}: {
  identity?: Identity;
  save?: DebateDocumentOperations['saveDocument'];
} = {}) => {
  const calls: unknown[] = [];
  const operations = {
    listDocuments: async (...args: unknown[]) => {
      calls.push(args);
      return [document];
    },
    createDocument: async (...args: unknown[]) => {
      calls.push(args);
      return document;
    },
    saveDocument: save,
    renameDocument: async (...args: unknown[]) => {
      calls.push(args);
      return { ...document, title: 'Plan' };
    },
  } as DebateDocumentOperations;
  const handlers = createDebateRoomDocumentHandlers({
    logger: silentLogger,
    origin: () => ORIGIN,
    identify: async () => identity,
    limiter: () => ({
      consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    }),
    getActorByUserId: async () => ({ id: 'actor1' }),
    operations: () => operations,
  });
  return { handlers, calls };
};

const post = (body: unknown, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/debate-room/documents/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });

const read = async (response: Response) => [
  response.status,
  await response.json(),
];

describe('debate room document routes', () => {
  test('list, create and rename answer the documented shapes', async () => {
    const { handlers, calls } = handlersWith();
    assert({
      given: 'a member listing, creating and renaming',
      should: 'answer documents, the created document and the renamed one',
      actual: [
        await read(await handlers.list.POST(post({ roundId: DEBATE }))),
        await read(
          await handlers.create.POST(
            post({ roundId: DEBATE, folder: 'round', templateId: 'flow' }),
          ),
        ),
        await read(
          await handlers.rename.POST(post({ id: DOC, title: 'Plan' })),
        ),
      ],
      expected: [
        [200, { documents: [document] }],
        [201, { document }],
        [200, { document: { ...document, title: 'Plan' } }],
      ],
    });
    assert({
      given: 'the create call',
      should: 'pass the explicit principal and only the validated fields',
      actual: calls[1],
      expected: [
        { userId: 'user1', actorId: 'actor1' },
        { roundId: DEBATE, folder: 'round', templateId: 'flow' },
      ],
    });
  });

  test('a save answers its revision, or 409 with the current one', async () => {
    const saved = handlersWith();
    const stale = handlersWith({
      save: async () => {
        throw conflictAt(7);
      },
    });
    const body = { id: DOC, html: '<p>a</p>', expectedRevision: 1 };
    assert({
      given: 'a save that lands and one against a stale revision',
      should: 'answer the new revision, then 409 with the current one',
      actual: [
        await read(await saved.handlers.save.POST(post(body))),
        await read(await stale.handlers.save.POST(post(body))),
      ],
      expected: [
        [200, { revision: 2 }],
        [409, { revision: 7 }],
      ],
    });
  });

  test('other save refusals keep the public error contract', async () => {
    const { handlers } = handlersWith({
      save: async () => {
        throw createAppError('PAYLOAD_TOO_LARGE');
      },
    });
    const response = await handlers.save.POST(
      post({ id: DOC, html: '<p>a</p>', expectedRevision: 1 }),
    );
    assert({
      given: 'an operation refusing a too-large document',
      should: 'answer 413 PAYLOAD_TOO_LARGE',
      actual: [
        response.status,
        ((await response.json()) as { error: { code: string } }).error.code,
      ],
      expected: [413, 'PAYLOAD_TOO_LARGE'],
    });
  });

  test('gates: origin, session, membership and body shape', async () => {
    const { handlers, calls } = handlersWith();
    const anonymous = handlersWith({
      identity: { state: 'anonymous', principal: { kind: 'anonymous' } },
    });
    const provisional = handlersWith({
      identity: { state: 'provisional', principal: member.principal },
    });
    const list = { roundId: DEBATE };
    assert({
      given: 'a foreign origin, no session, a provisional user and bad bodies',
      should: 'refuse each before any operation runs',
      actual: [
        (await handlers.list.POST(post(list, 'https://evil.test'))).status,
        (await anonymous.handlers.list.POST(post(list))).status,
        (await provisional.handlers.list.POST(post(list))).status,
        (await handlers.list.POST(post({ roundId: 'not-a-cuid' }))).status,
        (
          await handlers.create.POST(
            post({ roundId: DEBATE, folder: 'club', templateId: 'flow' }),
          )
        ).status,
        (
          await handlers.save.POST(
            post({ id: DOC, html: '<p></p>', expectedRevision: 0 }),
          )
        ).status,
        calls.length,
      ],
      expected: [403, 401, 403, 400, 400, 400, 0],
    });
  });
});
