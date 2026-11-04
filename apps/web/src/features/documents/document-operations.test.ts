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

describe('listDrive', () => {
  test('a member lists only their own, with no bodies', async () => {
    const { operations } = operationsOver([
      stored(),
      stored({ id: 'doc-x', ownerActorId: 'actor-x' }),
    ]);
    assert({
      given: 'documents of two members',
      should: 'list the caller’s, as entries with no text',
      actual: await operations.listDrive(me, { folderId: null, after: null }),
      expected: {
        entries: [{ kind: 'document', id: 'doc-1', title: 'Notes' }],
        next: null,
      },
    });
  });
});

describe('readDocuments', () => {
  test('another person’s body reads as absent', async () => {
    const { operations } = operationsOver([stored()]);
    assert({
      given: 'a stranger asking for a member’s document by id',
      should: 'read nothing',
      actual: await operations.readDocuments(stranger, { ids: ['doc-1'] }),
      expected: [],
    });
  });

  test('a read is bounded', async () => {
    const { operations } = operationsOver();
    await assertRejects({
      given: 'more ids than one read may ask for',
      should: 'refuse it as invalid',
      actual: () =>
        operations.readDocuments(me, {
          ids: Array.from({ length: 17 }, (_, i) => `doc-${i}`),
        }),
      code: 'VALIDATION',
    });
  });
});

describe('createDocument', () => {
  test('a new document is plain, untitled and stored normalized', async () => {
    const { operations } = operationsOver();
    const created = await operations.createDocument(me, { folderId: null });
    assert({
      given: 'a member creating with no Round involved',
      should: 'store an empty Untitled document at the first revision',
      actual: [created.id, created.title, created.revision, created.createdAt],
      expected: ['doc-new', 'Untitled', 1, NOW],
    });
  });

  test('the name stays unique among what it finds', async () => {
    const { operations } = operationsOver([stored({ title: 'Untitled' })]);
    const created = await operations.createDocument(me, { folderId: null });
    assert({
      given: 'an Untitled document already there',
      should: 'name the next one Untitled 2',
      actual: created.title,
      expected: 'Untitled 2',
    });
  });
});

describe('search', () => {
  test('nothing to search for asks nothing', async () => {
    const { operations } = operationsOver([stored()]);
    assert({
      given: 'words that are only punctuation',
      should: 'find nothing without a query',
      actual: await operations.search(me, { text: '!?', page: 0 }),
      expected: [],
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
    const { operations, documents } = operationsOver([stored()]);
    await operations.renameDocument(me, { id: 'doc-1', title: '  Plan  ' });
    assert({
      given: 'a padded title',
      should: 'store it trimmed and keep the revision',
      actual: [documents.get('doc-1')?.title, documents.get('doc-1')?.revision],
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

describe('moveDocument and deleteDocument', () => {
  test('reach only the caller’s own', async () => {
    const { operations, documents } = operationsOver([stored()]);
    await assertRejects({
      given: 'a stranger moving a member’s document',
      should: 'refuse it as not found',
      actual: () =>
        operations.moveDocument(stranger, { id: 'doc-1', folderId: null }),
      code: 'NOT_FOUND',
    });
    await assertRejects({
      given: 'a stranger deleting a member’s document',
      should: 'refuse it as not found',
      actual: () => operations.deleteDocument(stranger, { id: 'doc-1' }),
      code: 'NOT_FOUND',
    });
    await operations.deleteDocument(me, { id: 'doc-1' });
    assert({
      given: 'the owner deleting it',
      should: 'delete it',
      actual: documents.has('doc-1'),
      expected: false,
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
