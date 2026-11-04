import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { documentOperations } from '../src/document-operations';
import { erasePrivacySubject, exportPrivacySubject } from '../src/privacy';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';
import { bindings, now } from './privacy.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

/** No Room is open in this proof, so the engine's transitions never run. */
const rooms = {
  closeRoom: <T>(room: T) => room,
  eraseSeats: <T>(room: T) => room,
  activeRoomMembers: () => [],
};

const seedDrive = async (fixture: Fixture, actorId: string) => {
  const folderId = createId();
  const documentId = createId();
  await fixture.insert('document_folders', {
    id: folderId,
    owner_actor_id: actorId,
    name: 'Private folder',
  });
  await fixture.insert('documents', {
    id: documentId,
    owner_actor_id: actorId,
    folder_id: folderId,
    title: 'Private title',
    html: '<p>Private text</p>',
  });
  return { folderId, documentId };
};

const rowsOf = async (fixture: Fixture, actorId: string) => {
  const [row] = await fixture.sql`select
    (select count(*)::int from documents where owner_actor_id=${actorId}) as documents,
    (select count(*)::int from document_folders where owner_actor_id=${actorId}) as folders`;
  return row;
};

test('export returns a member’s documents and folders, and only theirs', async () => {
  await withFixture(url, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    const other = await createAuthorizationSubject(fixture);
    const mine = await seedDrive(fixture, subject.actorId);
    await seedDrive(fixture, other.actorId);
    const exported = await exportPrivacySubject(
      drizzle({ client: fixture.sql }),
      subject,
      rooms,
    );
    assert({
      given: 'two members with drives, one exporting',
      should: 'return their document and folder and nothing of the other',
      actual: [
        exported.documents?.map((row) => [row.id, row.title, row.html]),
        exported.document_folders?.map((row) => row.id),
      ],
      expected: [
        [[mine.documentId, 'Private title', '<p>Private text</p>']],
        [mine.folderId],
      ],
    });
    await erasePrivacySubject(
      drizzle({ client: fixture.sql }),
      { subject, now, vendors: [], jobIds: [] },
      rooms,
      bindings,
    );
    await erasePrivacySubject(
      drizzle({ client: fixture.sql }),
      { subject: other, now, vendors: [], jobIds: [] },
      rooms,
      bindings,
    );
  });
});

test('erasure leaves no title or text, and a later create is refused', async () => {
  await withFixture(url, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    const other = await createAuthorizationSubject(fixture);
    await seedDrive(fixture, subject.actorId);
    await seedDrive(fixture, other.actorId);
    const database = drizzle({ client: fixture.sql });
    await erasePrivacySubject(
      database,
      { subject, now, vendors: [], jobIds: [] },
      rooms,
      bindings,
    );
    assert({
      given: 'one member erased',
      should: 'delete their documents and folders and leave the other’s',
      actual: [
        await rowsOf(fixture, subject.actorId),
        await rowsOf(fixture, other.actorId),
      ],
      expected: [
        { documents: 0, folders: 0 },
        { documents: 1, folders: 1 },
      ],
    });
    const operations = documentOperations({
      database,
      searchDatabase: database,
    });
    await assertRejects({
      given: 'a create arriving after the erasure committed',
      should: 'be refused by the account fence',
      actual: () =>
        operations.createDocument({
          id: createId(),
          ownerActorId: subject.actorId,
          folderId: null,
          titleBase: 'Untitled',
          uniqueTitle: () => 'Untitled',
          html: '<p></p>',
          admits: (account) => account?.member === true && !account.erased,
        }),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'that refused create',
      should: 'store nothing',
      actual: await rowsOf(fixture, subject.actorId),
      expected: { documents: 0, folders: 0 },
    });
    await erasePrivacySubject(
      database,
      { subject: other, now, vendors: [], jobIds: [] },
      rooms,
      bindings,
    );
  });
});

test('a document outlives the Round it was written in, and its constraints hold', async () => {
  await withFixture(url, async (fixture) => {
    const subject = await createAuthorizationSubject(fixture);
    const { documentId } = await seedDrive(fixture, subject.actorId);
    const refused = (values: Record<string, unknown>) =>
      fixture
        .insert('documents', {
          id: createId(),
          owner_actor_id: subject.actorId,
          html: '<p></p>',
          title: 'x',
          ...values,
        })
        .then(
          () => 'stored',
          () => 'refused',
        );
    assert({
      given: 'an empty title, a long one and revision zero',
      should: 'refuse each',
      actual: [
        await refused({ title: '' }),
        await refused({ title: 'x'.repeat(121) }),
        await refused({ revision: 0 }),
      ],
      expected: ['refused', 'refused', 'refused'],
    });
    const [references] = await fixture.sql`select count(*)::int as n
      from information_schema.constraint_column_usage
      where table_name = 'documents' and constraint_name <> 'documents_pkey'
        and constraint_name not like 'documents_%'`;
    assert({
      given: 'the schema',
      should: 'hold no foreign key into documents, so no Round can reach one',
      actual: [references?.n, typeof documentId],
      expected: [0, 'string'],
    });
    await fixture.sql`delete from documents where owner_actor_id=${subject.actorId}`;
    await fixture.sql`delete from document_folders where owner_actor_id=${subject.actorId}`;
  });
});
