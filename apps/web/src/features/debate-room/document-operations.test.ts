import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { conflictRevision } from './document-operations';
import {
  NOW,
  operationsOver,
  stored,
} from './document-operations.test-support';

setupRitewayBun();

const me = { userId: 'user-me', actorId: 'actor-me' };
const stranger = { userId: 'user-x', actorId: 'actor-x' };

describe('listDocuments', () => {
  test('the person’s own debate lists their documents', async () => {
    const { operations } = operationsOver([stored()]);
    const listed = await operations.listDocuments(me, {
      roundId: 'debate-1',
    });
    assert({
      given: 'one stored round document',
      should: 'return it as a workspace document with its revision',
      actual: listed,
      expected: [
        {
          id: 'doc-1',
          title: 'Flow',
          folder: 'round',
          templateId: 'flow',
          html: '<p>a</p>',
          createdAt: NOW,
          updatedAt: NOW,
          revision: 1,
        },
      ],
    });
  });

  test('another person’s or an unknown debate is not found', async () => {
    const { operations } = operationsOver();
    await assertRejects({
      given: 'a debate that belongs to another actor',
      should: 'refuse it as not found',
      actual: () => operations.listDocuments(stranger, { roundId: 'debate-1' }),
      code: 'NOT_FOUND',
    });
    await assertRejects({
      given: 'an unknown debate',
      should: 'refuse it as not found',
      actual: () => operations.listDocuments(me, { roundId: 'missing' }),
      code: 'NOT_FOUND',
    });
  });
});

describe('createDocument', () => {
  test('a round flow is built for the person’s side and stored normalized', async () => {
    const { operations, documents } = operationsOver([stored()]);
    const created = await operations.createDocument(me, {
      roundId: 'debate-1',
      folder: 'round',
      templateId: 'flow',
    });
    assert({
      given: 'a stored "Flow" and a request for another flow',
      should: 'title it "Flow 2" and mark the negative speeches as yours',
      actual: {
        title: created.title,
        revision: created.revision,
        folder: documents.get('doc-new')?.folder,
        scoped: documents.get('doc-new') !== undefined,
        yours: created.html.includes('NC · Neg · You'),
        stored: documents.get('doc-new')?.html === created.html,
        lines: created.html.includes('\n'),
      },
      expected: {
        title: 'Flow 2',
        revision: 1,
        folder: 'scratch',
        scoped: true,
        yours: true,
        stored: true,
        lines: true,
      },
    });
  });

  test('a library document has no debate and its own titles', async () => {
    const { operations, documents } = operationsOver([stored()]);
    const created = await operations.createDocument(me, {
      roundId: 'debate-1',
      folder: 'library',
      templateId: 'flow',
    });
    assert({
      given: 'a round "Flow" and a new library flow',
      should: 'store it without a debate, titled "Flow"',
      actual: [created.folder, created.title, documents.get('doc-new')?.folder],
      expected: ['library', 'Flow', 'library'],
    });
  });

  test('another person’s debate is not found', async () => {
    const { operations, documents } = operationsOver();
    await assertRejects({
      given: 'a debate that belongs to another actor',
      should: 'refuse it and store nothing',
      actual: () =>
        operations.createDocument(stranger, {
          roundId: 'debate-1',
          folder: 'library',
          templateId: 'blank',
        }),
      code: 'NOT_FOUND',
    });
    assert({
      given: 'the refused create',
      should: 'leave the store empty',
      actual: documents.size,
      expected: 0,
    });
  });
});

describe('saveDocument', () => {
  test('a save at the current revision stores normalized HTML', async () => {
    const { operations, documents } = operationsOver([stored()]);
    const saved = await operations.saveDocument(me, {
      id: 'doc-1',
      html: '<p onclick="x()">hi</p>',
      expectedRevision: 1,
    });
    assert({
      given: 'HTML with an event handler',
      should: 'store it without the handler and bump the revision',
      actual: [saved, documents.get('doc-1')?.html.includes('onclick')],
      expected: [{ revision: 2 }, false],
    });
  });

  test('a stale save is a conflict carrying the current revision', async () => {
    const { operations } = operationsOver([stored({ revision: 4 })]);
    const attempt = operations.saveDocument(me, {
      id: 'doc-1',
      html: '<p>b</p>',
      expectedRevision: 3,
    });
    await assertRejects({
      given: 'an expected revision behind the stored one',
      should: 'refuse it as a conflict',
      actual: () => attempt,
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused save',
      should: 'report the current revision',
      actual: conflictRevision(await attempt.catch((error: unknown) => error)),
      expected: 4,
    });
  });

  test('refusals: too large, not HTML, another person’s document', async () => {
    const { operations, documents } = operationsOver([stored()]);
    const save = (html: string, principal = me) =>
      operations.saveDocument(principal, {
        id: 'doc-1',
        html,
        expectedRevision: 1,
      });
    await assertRejects({
      given: 'a body over the size limit',
      should: 'refuse it as too large',
      actual: () => save(`<p>${'x'.repeat(200_001)}</p>`),
      code: 'PAYLOAD_TOO_LARGE',
    });
    await assertRejects({
      given: 'plain text',
      should: 'refuse it as invalid',
      actual: () => save('just words'),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'nesting deeper than the document bound',
      should: 'refuse it as invalid, never a server error',
      actual: () =>
        save(
          `${'<blockquote>'.repeat(7_500)}x${'</blockquote>'.repeat(7_500)}`,
        ),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'another person’s document',
      should: 'refuse it as not found',
      actual: () => save('<p>b</p>', stranger),
      code: 'NOT_FOUND',
    });
    assert({
      given: 'three refused saves',
      should: 'leave the document as it was',
      actual: documents.get('doc-1')?.revision,
      expected: 1,
    });
  });
});

describe('renameDocument', () => {
  test('a trimmed title within bounds renames', async () => {
    const { operations } = operationsOver([stored()]);
    const renamed = await operations.renameDocument(me, {
      id: 'doc-1',
      title: '  Plan  ',
    });
    assert({
      given: 'a padded title',
      should: 'store it trimmed and keep the revision',
      actual: [renamed.title, renamed.revision],
      expected: ['Plan', 1],
    });
  });

  test('refusals: blank, too long, another person’s document', async () => {
    const { operations } = operationsOver([stored()]);
    const rename = (title: string, principal = me) =>
      operations.renameDocument(principal, { id: 'doc-1', title });
    await assertRejects({
      given: 'a blank title',
      should: 'refuse it as invalid',
      actual: () => rename('   '),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'a 121-character title',
      should: 'refuse it as invalid',
      actual: () => rename('x'.repeat(121)),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'another person’s document',
      should: 'refuse it as not found',
      actual: () => rename('Mine', stranger),
      code: 'NOT_FOUND',
    });
  });
});

describe('conflictRevision', () => {
  test('other errors carry no revision', () => {
    assert({
      given: 'a plain error',
      should: 'answer null',
      actual: conflictRevision(new Error('x')),
      expected: null,
    });
  });
});
