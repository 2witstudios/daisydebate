import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createDocumentHandlers } from './document-handlers';
import type { DocumentOperations } from './document-operations';

setupRitewayBun();

const ORIGIN = 'http://localhost:3000';
const DOC = 'ckdocument0000000000000a';

const member: Extract<Identity, { state: 'member' }> = {
  state: 'member',
  username: 'ada',
  principal: { kind: 'user', userId: 'user1', actorId: 'actor1' },
};

const document = {
  id: DOC,
  title: 'Notes',
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
  save?: DocumentOperations['saveDocument'];
} = {}) => {
  const calls: unknown[] = [];
  const operations = {
    listDrive: async (...args: unknown[]) => {
      calls.push(args);
      return { entries: [], next: null };
    },
    readDocuments: async (...args: unknown[]) => {
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
    },
  } as unknown as DocumentOperations;
  const handlers = createDocumentHandlers({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => ORIGIN,
    identify: async () => identity,
    limiter: () => ({
      consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    }),
    operations: () => operations,
  });
  return { handlers, calls };
};

const post = (body: unknown, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/documents/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });

const read = async (response: Response) => [
  response.status,
  await response.json(),
];

describe('document routes', () => {
  test('list, read, create and rename answer the documented shapes', async () => {
    const { handlers, calls } = handlersWith();
    assert({
      given: 'a member listing, reading, creating and renaming',
      should: 'answer each with no Round named anywhere',
      actual: [
        await read(
          await handlers.list.POST(post({ folderId: null, after: null })),
        ),
        await read(await handlers.read.POST(post({ ids: [DOC] }))),
        await read(await handlers.create.POST(post({ folderId: null }))),
        await read(
          await handlers.rename.POST(post({ id: DOC, title: 'Plan' })),
        ),
      ],
      expected: [
        [200, { entries: [], next: null }],
        [200, { documents: [document] }],
        [201, { document }],
        [200, {}],
      ],
    });
    assert({
      given: 'the create call',
      should: 'pass the explicit principal and only the validated fields',
      actual: calls[2],
      expected: [{ userId: 'user1', actorId: 'actor1' }, { folderId: null }],
    });
  });

  test('a plain form answers with a 303 back to its page', async () => {
    const { handlers, calls } = handlersWith();
    const form = (body: string, origin = ORIGIN) =>
      new Request(`${ORIGIN}/api/documents/x`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
        },
        body,
      });
    const answer = await handlers.rename.POST(
      form(`id=${DOC}&title=Plan&back=%2Fprep`),
    );
    const away = await handlers.rename.POST(
      form(`id=${DOC}&title=Plan&back=https%3A%2F%2Fevil.test`),
    );
    const refused = await handlers.rename.POST(
      form(`id=not-an-id&title=Plan&back=%2Fprep`),
    );
    assert({
      given: 'a form post, one naming another site, and one refused',
      should: 'return to its page, never off the site, and say so by a key',
      actual: [
        answer.status,
        answer.headers.get('location'),
        away.headers.get('location'),
        refused.headers.get('location'),
        calls.length,
      ],
      expected: [303, '/prep', '/prep', '/prep?notice=name-length', 2],
    });
  });

  test('a form body is bounded as it is read, and a refused form gets a page', async () => {
    const { handlers } = handlersWith();
    const form = (body: string) =>
      new Request(`${ORIGIN}/api/documents/x`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: ORIGIN,
        },
        body,
      });
    const large = await handlers.rename.POST(form('x'.repeat(4 * 1024 * 1024)));
    const anonymous = handlersWith({
      identity: { state: 'anonymous', principal: { kind: 'anonymous' } },
    });
    const refused = await anonymous.handlers.rename.POST(form(`id=${DOC}`));
    assert({
      given: 'a form far past the limit, and one with no session',
      should:
        'not read the first past its bound, and answer the second with a page',
      actual: [large.status, refused.status, refused.headers.get('location')],
      expected: [303, 303, '/prep?notice=refused'],
    });
  });

  test('a control character in a name is refused as invalid', async () => {
    const { handlers, calls } = handlersWith();
    const answer = await handlers.rename.POST(
      post({ id: DOC, title: 'a\u0000b' }),
    );
    assert({
      given: 'a title holding U+0000',
      should: 'refuse it before any operation',
      actual: [answer.status, calls.length],
      expected: [400, 0],
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
      identity: {
        state: 'provisional',
        principal: { kind: 'user', userId: 'user1', actorId: null },
      },
    });
    const waitlisted = handlersWith({
      identity: {
        state: 'waitlisted',
        username: 'ada',
        reason: 'pending',
        principal: { kind: 'user', userId: 'user1', actorId: 'actor1' },
      },
    });
    const restricted = handlersWith({
      identity: {
        state: 'restricted',
        username: 'ada',
        principal: { kind: 'user', userId: 'user1', actorId: 'actor1' },
      },
    });
    const revoked = handlersWith({
      identity: {
        state: 'waitlisted',
        username: 'ada',
        reason: 'revoked',
        principal: { kind: 'user', userId: 'user1', actorId: 'actor1' },
      },
    });
    const ageRequired = handlersWith({
      identity: {
        state: 'waitlisted',
        username: 'ada',
        reason: 'age-required',
        principal: { kind: 'user', userId: 'user1', actorId: 'actor1' },
      },
    });
    const list = { folderId: null, after: null };
    assert({
      given:
        'a foreign origin, no session, a provisional, pending, restricted, revoked or under-age account and bad bodies',
      should: 'refuse each before any operation runs',
      actual: [
        (await handlers.list.POST(post(list, 'https://evil.test'))).status,
        (await anonymous.handlers.list.POST(post(list))).status,
        (await provisional.handlers.list.POST(post(list))).status,
        (await waitlisted.handlers.list.POST(post(list))).status,
        (await restricted.handlers.list.POST(post(list))).status,
        (await revoked.handlers.search.POST(post({ text: 'x', page: 0 })))
          .status,
        (await ageRequired.handlers.read.POST(post({ ids: [DOC] }))).status,
        (await restricted.handlers.delete.POST(post({ id: DOC }))).status,
        (
          await handlers.list.POST(
            post({ folderId: 'not a valid id!', after: null }),
          )
        ).status,
        (await handlers.create.POST(post({ folderId: 'not a valid id!' })))
          .status,
        (
          await handlers.save.POST(
            post({ id: DOC, html: '<p></p>', expectedRevision: 0 }),
          )
        ).status,
        calls.length +
          waitlisted.calls.length +
          restricted.calls.length +
          revoked.calls.length +
          ageRequired.calls.length,
      ],
      expected: [403, 401, 403, 403, 403, 403, 403, 403, 400, 400, 400, 0],
    });
  });
});
