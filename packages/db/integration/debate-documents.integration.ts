import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { document, withOwner } from './debate-documents.test-support';

setupRitewayBun();

requireTestServices(process.env);

describe('documents', () => {
  test('a list returns only the reader’s own documents', async () => {
    await withOwner(async ({ database, fixture, actorId, roundId }) => {
      const stranger = await fixture.actor();
      const judge = await fixture.actor();
      for (const [reader, role] of [
        [stranger, 'affirmative'],
        [judge, 'judge'],
      ] as const)
        await fixture.insert('round_participants', {
          id: createId(),
          round_id: roundId,
          actor_id: reader,
          role,
          slot: 0,
        });
      await database.createDocument(document(actorId, 'Notes'));
      await database.createDocument(document(actorId, 'Case'));
      await database.createDocument(document(actorId, 'Block'));
      const theirs = await database.createDocument(
        document(stranger, 'Theirs'),
      );
      const listed = await database.listDocuments({ ownerActorId: actorId });
      assert({
        given: 'an owner naming a new document',
        should: 'read only that owner’s titles',
        actual: [
          ...(await database.listDocumentTitles({ ownerActorId: actorId })),
        ].sort(),
        expected: ['Block', 'Case', 'Notes'],
      });
      assert({
        given: 'three of mine and an opponent’s in the same Round',
        should: 'list only mine, by title',
        actual: listed.map((d) => d.title),
        expected: ['Block', 'Case', 'Notes'],
      });
      for (const reader of [stranger, judge]) {
        const visible = await database.listDocuments({ ownerActorId: reader });
        assert({
          given: 'an opponent or judge seated in the same Round',
          should: 'return only that reader’s own documents and HTML',
          actual: visible.map((row) => [row.id, row.html]),
          expected: reader === stranger ? [[theirs.id, theirs.html]] : [],
        });
      }
    });
  });

  test('saves compare and swap on the revision', async () => {
    await withOwner(async ({ database, actorId }) => {
      const { id } = await database.createDocument(document(actorId, 'Notes'));
      const save = (expectedRevision: number, ownerActorId = actorId) =>
        database.saveDocument({
          id,
          ownerActorId,
          html: `<p>r${expectedRevision}</p>`,
          expectedRevision,
        });
      const first = await save(1);
      const stale = await save(1);
      const stranger = await save(2, createId());
      const missing = await database.saveDocument({
        id: createId(),
        ownerActorId: actorId,
        html: '<p></p>',
        expectedRevision: 1,
      });
      const [stored] = await database.listDocuments({
        ownerActorId: actorId,
      });
      assert({
        given: 'a save, a stale save, a stranger’s save and an unknown id',
        should: 'save once, report the conflict, and hide the rest',
        actual: [first, stale, stranger, missing],
        expected: [
          { status: 'saved', revision: 2 },
          { status: 'conflict', revision: 2 },
          { status: 'missing' },
          { status: 'missing' },
        ],
      });
      assert({
        given: 'the stored document',
        should: 'hold the first save only',
        actual: [stored?.html, stored?.revision],
        expected: ['<p>r1</p>', 2],
      });
    });
  });

  test('renames keep the revision and refuse a stranger', async () => {
    await withOwner(async ({ database, actorId }) => {
      const { id } = await database.createDocument(document(actorId, 'Case'));
      const renamed = await database.renameDocument({
        id,
        ownerActorId: actorId,
        title: 'Plan',
      });
      const refused = await database.renameDocument({
        id,
        ownerActorId: createId(),
        title: 'Mine',
      });
      assert({
        given: 'a rename by the owner, then one by a stranger',
        should: 'rename once and leave the revision',
        actual: [renamed?.title, renamed?.revision, refused],
        expected: ['Plan', 1, null],
      });
    });
  });

  test('the document constraints: titles and revisions', async () => {
    await withOwner(async ({ fixture, actorId }) => {
      const row = (overrides: Record<string, unknown>) => ({
        id: createId(),
        owner_actor_id: actorId,
        title: 'Notes',
        html: '<p></p>',
        revision: 1,
        ...overrides,
      });
      assert({
        given: 'rows that break the document constraints',
        should: 'be refused by the named CHECK',
        actual: [
          await fixture.rejectedBy('documents', row({ title: '' })),
          await fixture.rejectedBy(
            'documents',
            row({ title: 'x'.repeat(121) }),
          ),
          await fixture.rejectedBy('documents', row({ revision: 0 })),
        ],
        expected: [
          'documents_title_length',
          'documents_title_length',
          'documents_revision_positive',
        ],
      });
    });
  });

  test('a document outlives the Round it was written in', async () => {
    await withOwner(async ({ database, fixture, actorId, roundId }) => {
      const created = await database.createDocument(document(actorId, 'Notes'));
      await fixture.sql.unsafe('delete from rounds where id = $1', [roundId]);
      const [survivor] = await database.listDocuments({
        ownerActorId: actorId,
      });
      assert({
        given: 'a deleted Round',
        should: 'leave its participant’s document standing',
        actual: survivor?.id,
        expected: created.id,
      });
    });
  });
});
