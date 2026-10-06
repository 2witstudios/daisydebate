import { createId } from '@paralleldrive/cuid2';
import { fixedClock, systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '@daisy/db';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  conflictRevision,
  createDebateDocumentOperations,
} from '../src/features/debate-room/document-operations';
import { testDatabaseUrl, withSql } from './fixtures';

setupRitewayBun();
requireTestServices(process.env);

const NOW = '2026-10-05T18:00:00.000Z';

/** A user, their actor and their AI debate; removed with everything after. */
const withDebater = async (
  run: (input: {
    operations: ReturnType<typeof createDebateDocumentOperations>;
    me: { userId: string; actorId: string };
    stranger: { userId: string; actorId: string };
    aiDebateId: string;
  }) => Promise<void>,
) => {
  const [userId, actorId, otherUser, otherActor, aiDebateId] = [
    createId(),
    createId(),
    createId(),
    createId(),
    createId(),
  ];
  await withSql(async (sql) => {
    await sql`insert into users (id) values (${userId}), (${otherUser})`;
    await sql`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${userId}), (${otherActor}, 'human', ${otherUser})`;
    await sql`insert into ai_debates (id, actor_id, resolution, person_side, opponent, voice, speech_model, cx_model, judge_model, tts_model, stt_model, expected_end_at)
      values (${aiDebateId}, ${actorId}, 'Cities should make transit free', 'affirmative', 'wren', 'v', 'm', 'm', 'm', 'm', 'm', ${new Date(NOW)})`;
  });
  const database = createDatabase({
    url: testDatabaseUrl,
    nextActorId: createId,
  });
  try {
    await run({
      operations: createDebateDocumentOperations({
        store: database,
        clock: fixedClock(NOW),
        ids: systemId,
      }),
      me: { userId, actorId },
      stranger: { userId: otherUser, actorId: otherActor },
      aiDebateId,
    });
  } finally {
    await database.close();
    await withSql(async (sql) => {
      // Documents cascade from their owner and their AI debate.
      await sql`delete from ai_debates where id = ${aiDebateId}`;
      await sql`delete from actors where id in (${actorId}, ${otherActor})`;
      await sql`delete from users where id in (${userId}, ${otherUser})`;
    });
  }
};

describe('debate room documents over PostgreSQL', () => {
  test('create, save, rename and list round-trip for the owner only', async () => {
    await withDebater(async ({ operations, me, stranger, aiDebateId }) => {
      const flow = await operations.createDocument(me, {
        aiDebateId,
        folder: 'round',
        templateId: 'flow',
      });
      const library = await operations.createDocument(me, {
        aiDebateId,
        folder: 'library',
        templateId: 'case',
      });
      const saved = await operations.saveDocument(me, {
        id: flow.id,
        html: '<p onclick="x()">Turn</p>',
        expectedRevision: 1,
      });
      const stale = await operations
        .saveDocument(me, {
          id: flow.id,
          html: '<p>b</p>',
          expectedRevision: 1,
        })
        .catch((error: unknown) => error);
      await operations.renameDocument(me, { id: library.id, title: ' Aff ' });
      const listed = await operations.listDocuments(me, { aiDebateId });
      assert({
        given: 'a round flow, a library case, a save, a stale save, a rename',
        should:
          'list both by creation then title, with saved HTML and revisions',
        actual: {
          saved,
          stale: conflictRevision(stale),
          documents: listed.map((d) => [d.title, d.folder, d.revision]),
          html: listed.find((d) => d.id === flow.id)?.html,
        },
        expected: {
          saved: { revision: 2 },
          stale: 2,
          documents: [
            ['Aff', 'library', 1],
            ['Flow', 'round', 2],
          ],
          html: '<p>\nTurn\n</p>',
        },
      });
      await assertRejects({
        given: 'another person opening the debate',
        should: 'refuse it as not found',
        actual: () => operations.listDocuments(stranger, { aiDebateId }),
        code: 'NOT_FOUND',
      });
      await assertRejects({
        given: 'another person saving the owner’s document',
        should: 'refuse it as not found',
        actual: () =>
          operations.saveDocument(stranger, {
            id: flow.id,
            html: '<p>mine</p>',
            expectedRevision: 2,
          }),
        code: 'NOT_FOUND',
      });
    });
  });
});
