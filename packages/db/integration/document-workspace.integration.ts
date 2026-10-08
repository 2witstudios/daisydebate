import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { document, withOwner } from './debate-documents.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('a workspace includes library documents and only its referenced scratch documents', async () => {
  await withOwner(async ({ database, fixture, actorId, roundId }) => {
    const library = await database.createDocument(
      document(actorId, 'library', 'Case'),
    );
    const scratch = await database.createDocument(
      document(actorId, 'scratch', 'Flow'),
    );
    const otherRound = createId();
    await fixture.sql.unsafe(
      'insert into rounds (id, resolution, competition_type, length, format_id, format_version, rules_snapshot, status) select $1, resolution, competition_type, length, format_id, format_version, rules_snapshot, status from rounds where id = $2',
      [otherRound, roundId],
    );
    const unrelated = await database.createDocument(
      document(actorId, 'scratch', 'Other flow'),
    );
    await database.attachRoundDocument({
      roundId: otherRound,
      documentId: unrelated.id,
      role: 'flow',
    });
    await database.attachRoundDocument({
      roundId,
      documentId: scratch.id,
      role: 'flow',
    });
    await database.attachRoundDocument({
      roundId,
      documentId: library.id,
      role: 'case',
    });
    const listed = await database.listDocuments({
      ownerActorId: actorId,
      roundId,
    });
    await fixture.sql.unsafe(
      'delete from round_document_refs where round_id = $1 and document_id = $2',
      [roundId, scratch.id],
    );
    const detached = await database.listDocuments({
      ownerActorId: actorId,
      roundId,
    });
    await fixture.sql.unsafe('delete from rounds where id = $1', [otherRound]);
    assert({
      given:
        'two rounds’ scratch flows and a library document also referenced here',
      should:
        'scope scratch by reference, deduplicate library, and remove detached scratch',
      actual: [listed.map((row) => row.id), detached.map((row) => row.id)],
      expected: [[library.id, scratch.id], [library.id]],
    });
  });
});
