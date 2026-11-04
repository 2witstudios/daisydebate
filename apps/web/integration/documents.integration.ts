import { createId } from '@paralleldrive/cuid2';
import { fixedClock, systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { DRIVE_LIMITS } from '@daisy/db/documents';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  conflictRevision,
  createDocumentOperations,
} from '../src/features/documents/document-operations';
import { testDatabaseUrl, withSql } from './fixtures';

setupRitewayBun();
requireTestServices(process.env);

const NOW = '2026-10-05T18:00:00.000Z';

type Person = { readonly userId: string; readonly actorId: string };

const seedPerson = async (): Promise<Person> => {
  const person = { userId: createId(), actorId: createId() };
  await withSql(async (sql) => {
    await sql`insert into users (id, username, email_verified) values (${person.userId}, ${person.userId}, true)`;
    await sql`insert into actors (id, kind, user_id) values (${person.actorId}, 'human', ${person.userId})`;
    await sql`insert into account_age (user_id, birth_month, version, recorded_at)
      values (${person.userId}, '1990-01', 1, now())`;
    await sql`insert into account_beta_access (user_id, state, requested_at, decided_at, provenance)
      values (${person.userId}, 'approved', now(), now(), 'signup')`;
  });
  return person;
};

const removePerson = ({ userId, actorId }: Person) =>
  withSql(async (sql) => {
    await sql`delete from documents where owner_actor_id = ${actorId}`;
    await sql`delete from document_folders where owner_actor_id = ${actorId}`;
    await sql`delete from account_beta_access where user_id = ${userId}`;
    await sql`delete from account_age where user_id = ${userId}`;
    await sql`delete from actors where id = ${actorId}`;
    await sql`delete from users where id = ${userId}`;
  });

const withDrive = async (
  run: (input: {
    readonly operations: ReturnType<typeof createDocumentOperations>;
    readonly me: Person;
    readonly stranger: Person;
  }) => Promise<void>,
) => {
  const [me, stranger] = [await seedPerson(), await seedPerson()];
  const database = createDatabase({
    url: testDatabaseUrl,
    nextActorId: createId,
  });
  try {
    await run({
      operations: createDocumentOperations({
        store: database,
        clock: fixedClock(NOW),
        ids: systemId,
      }),
      me,
      stranger,
    });
  } finally {
    await database.close();
    await removePerson(me);
    await removePerson(stranger);
  }
};

const page = { folderId: null, after: null };

describe('a member’s documents over PostgreSQL', () => {
  test('ownership: a stranger reaches nothing', async () => {
    await withDrive(async ({ operations, me, stranger }) => {
      const mine = await operations.createDocument(me, { folderId: null });
      const folder = await operations.createFolder(me, {
        parentFolderId: null,
        name: 'Cases',
      });
      assert({
        given: 'a member’s document and folder, and a stranger',
        should: 'list and read nothing of theirs',
        actual: [
          (await operations.listDrive(stranger, page)).entries,
          await operations.readDocuments(stranger, { ids: [mine.id] }),
          await operations.lastEdited(stranger),
          await operations.listFolders(stranger),
        ],
        expected: [[], [], { id: null }, []],
      });
      for (const [given, attempt] of [
        [
          'a save',
          () =>
            operations.saveDocument(stranger, {
              id: mine.id,
              html: '<p>x</p>',
              expectedRevision: 1,
            }),
        ],
        [
          'a delete',
          () => operations.deleteDocument(stranger, { id: mine.id }),
        ],
        [
          'a create in their folder',
          () => operations.createDocument(stranger, { folderId: folder.id }),
        ],
        [
          'a move into their folder',
          async () => {
            const own = await operations.createDocument(stranger, {
              folderId: null,
            });
            await operations.moveDocument(stranger, {
              id: own.id,
              folderId: folder.id,
            });
          },
        ],
        [
          'deleting their folder',
          () => operations.deleteFolder(stranger, { id: folder.id }),
        ],
      ] as const)
        await assertRejects({
          given: `${given} from a stranger`,
          should: 'answer as if it were not there',
          actual: attempt,
          code: 'NOT_FOUND',
        });
    });
  });

  test('saves are conflict-safe, and rename and move never touch the revision', async () => {
    await withDrive(async ({ operations, me }) => {
      const doc = await operations.createDocument(me, { folderId: null });
      const folder = await operations.createFolder(me, {
        parentFolderId: null,
        name: 'Cases',
      });
      const saved = await operations.saveDocument(me, {
        id: doc.id,
        html: '<p onclick="x()">Turn</p>',
        expectedRevision: 1,
      });
      const stale = await operations
        .saveDocument(me, {
          id: doc.id,
          html: '<p>b</p>',
          expectedRevision: 1,
        })
        .catch(conflictRevision);
      await operations.renameDocument(me, { id: doc.id, title: 'Plan' });
      await operations.moveDocument(me, { id: doc.id, folderId: folder.id });
      const after = await operations.saveDocument(me, {
        id: doc.id,
        html: '<p>c</p>',
        expectedRevision: 2,
      });
      const [read] = await operations.readDocuments(me, { ids: [doc.id] });
      assert({
        given: 'a save, a stale save, then a rename and a move',
        should: 'refuse the stale one and keep the open editor saving',
        actual: [saved.revision, stale, after.revision, read?.title],
        expected: [2, 2, 3, 'Plan'],
      });
    });
  });

  test('folders: moves and deletes keep one tree', async () => {
    await withDrive(async ({ operations, me }) => {
      const folder = (name: string, parentFolderId: string | null) =>
        operations.createFolder(me, { parentFolderId, name });
      const a = await folder('A', null);
      const b = await folder('B', a.id);
      const c = await folder('C', b.id);
      const doc = await operations.createDocument(me, { folderId: c.id });
      await assertRejects({
        given: 'a folder moved under its own descendant',
        should: 'refuse it',
        actual: () =>
          operations.moveFolder(me, { id: a.id, parentFolderId: c.id }),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'a folder moved under itself',
        should: 'refuse it',
        actual: () =>
          operations.moveFolder(me, { id: a.id, parentFolderId: a.id }),
        code: 'CONFLICT',
      });
      const count = await operations.folderDocumentCount(me, { id: a.id });
      await operations.moveFolder(me, { id: c.id, parentFolderId: null });
      const root = await operations.listDrive(me, page);
      await operations.deleteFolder(me, { id: a.id });
      const kept = await operations.readDocuments(me, { ids: [doc.id] });
      await operations.deleteFolder(me, { id: c.id });
      const gone = await operations.readDocuments(me, { ids: [doc.id] });
      assert({
        given: 'a subtree moved out, then each folder deleted',
        should:
          'count what a deletion takes, keep what moved out, and take the document with its folder',
        actual: [
          count,
          root.entries.map((entry) => entry.id).sort(),
          kept.length,
          gone.length,
        ],
        expected: [1, [a.id, c.id].sort(), 1, 0],
      });
    });
  });

  test('two concurrent moves cannot form a cycle', async () => {
    await withDrive(async ({ operations, me }) => {
      for (let round = 0; round < 10; round += 1) {
        const a = await operations.createFolder(me, {
          parentFolderId: null,
          name: `A${round}`,
        });
        const b = await operations.createFolder(me, {
          parentFolderId: null,
          name: `B${round}`,
        });
        const outcomes = await Promise.allSettled([
          operations.moveFolder(me, { id: a.id, parentFolderId: b.id }),
          operations.moveFolder(me, { id: b.id, parentFolderId: a.id }),
        ]);
        assert({
          given: 'A into B and B into A at once',
          should: 'let exactly one win',
          actual: outcomes.filter((one) => one.status === 'fulfilled').length,
          expected: 1,
        });
      }
    });
  });

  test('the store itself refuses a cycle and a cross-owner link', async () => {
    await withDrive(async ({ operations, me, stranger }) => {
      const a = await operations.createFolder(me, {
        parentFolderId: null,
        name: 'A',
      });
      const b = await operations.createFolder(me, {
        parentFolderId: a.id,
        name: 'B',
      });
      const theirs = await operations.createFolder(stranger, {
        parentFolderId: null,
        name: 'Theirs',
      });
      const refused = (work: () => Promise<unknown>) =>
        work().then(
          () => 'stored',
          () => 'refused',
        );
      const answers = await withSql(async (sql) => [
        await refused(
          () =>
            sql`update document_folders set parent_folder_id = ${b.id} where id = ${a.id}`,
        ),
        await refused(
          () =>
            sql`update document_folders set parent_folder_id = ${theirs.id} where id = ${b.id}`,
        ),
      ]);
      assert({
        given: 'direct writes that skip the operations',
        should: 'be refused by the database',
        actual: answers,
        expected: ['refused', 'refused'],
      });
    });
  });

  test('a nest stops at the depth limit', async () => {
    await withDrive(async ({ operations, me }) => {
      let parent: string | null = null;
      for (let depth = 0; depth < DRIVE_LIMITS.depth; depth += 1) {
        const made: { id: string } = await operations.createFolder(me, {
          parentFolderId: parent,
          name: `Level ${depth}`,
        });
        parent = made.id;
      }
      await assertRejects({
        given: 'one level past the limit',
        should: 'refuse it',
        actual: () =>
          operations.createFolder(me, { parentFolderId: parent, name: 'Deep' }),
        code: 'CONFLICT',
      });
    });
  });

  test('a large library lists by page and never reads a body to do it', async () => {
    await withDrive(async ({ operations, me }) => {
      await withSql(
        (sql) => sql`insert into documents (id, owner_actor_id, title, html)
          select md5(i::text || ${me.actorId}), ${me.actorId},
            'Doc ' || lpad(i::text, 4, '0'), '<p>word' || i || ' ' || repeat('x ', 500) || '</p>'
          from generate_series(1, ${DRIVE_LIMITS.documents}) as i`,
      );
      const seen: string[] = [];
      let after = null;
      let pages = 0;
      do {
        const listed: Awaited<ReturnType<typeof operations.listDrive>> =
          await operations.listDrive(me, { folderId: null, after });
        seen.push(...listed.entries.map((entry) => entry.id));
        after = listed.next;
        pages += 1;
        assert({
          given: 'a page of a large library',
          should: 'hold at most one page and no body',
          actual: [
            listed.entries.length <= 100,
            JSON.stringify(listed).includes('<p>'),
          ],
          expected: [true, false],
        });
      } while (after !== null);
      assert({
        given: 'a library at the limit, walked by cursor',
        should: 'reach each document exactly once',
        actual: [new Set(seen).size, seen.length, pages],
        expected: [DRIVE_LIMITS.documents, DRIVE_LIMITS.documents, 20],
      });
      await assertRejects({
        given: 'one document past the limit',
        should: 'refuse it',
        actual: () => operations.createDocument(me, { folderId: null }),
        code: 'CONFLICT',
      });
    });
  });

  test('search finds title and body, skips tags, and stays the owner’s', async () => {
    await withDrive(async ({ operations, me, stranger }) => {
      const doc = await operations.createDocument(me, { folderId: null });
      await operations.renameDocument(me, { id: doc.id, title: 'Plan' });
      await operations.saveDocument(me, {
        id: doc.id,
        html: '<p>The <strong>carbon</strong> tax turns on enforcement.</p>',
        expectedRevision: 1,
      });
      const titles = async (text: string, who = me) =>
        (await operations.search(who, { text, page: 0 })).map((hit) => hit.id);
      const [hit] = await operations.search(me, { text: 'carb', page: 0 });
      assert({
        given: 'a title word, a body word by prefix, tag names, and a stranger',
        should: 'find the first two only, with a plain snippet',
        actual: {
          title: await titles('plan'),
          body: await titles('carb'),
          tag: await titles('strong'),
          stranger: await titles('carbon', stranger),
          injected: await titles("carbon' | !x:* (y"),
          snippetHasTags: hit?.snippet.includes('<'),
        },
        expected: {
          title: [doc.id],
          body: [doc.id],
          tag: [],
          stranger: [],
          injected: [],
          snippetHasTags: false,
        },
      });
    });
  });

  test('an account no longer admitted changes nothing', async () => {
    await withDrive(async ({ operations, me }) => {
      const doc = await operations.createDocument(me, { folderId: null });
      await withSql(
        (sql) =>
          sql`update account_beta_access set state = 'revoked' where user_id = ${me.userId}`,
      );
      for (const [given, attempt] of [
        ['create', () => operations.createDocument(me, { folderId: null })],
        [
          'rename',
          () => operations.renameDocument(me, { id: doc.id, title: 'x' }),
        ],
        ['delete', () => operations.deleteDocument(me, { id: doc.id })],
        [
          'folder',
          () =>
            operations.createFolder(me, { parentFolderId: null, name: 'F' }),
        ],
      ] as const)
        await assertRejects({
          given: `${given} by a revoked account under the fence`,
          should: 'refuse it',
          actual: attempt,
          code: 'AUTHORIZATION',
        });
    });
  });
});
