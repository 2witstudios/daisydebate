import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 18, minute));

/** A user who owns one AI debate, and a database over the test server. */
const withOwner = async (
  run: (input: {
    database: ReturnType<typeof createDatabase>;
    fixture: Fixture;
    userId: string;
    aiDebateId: string;
  }) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const userId = await fixture.user();
    const actorId = await fixture.actor(userId);
    const aiDebateId = createId();
    await fixture.insert('ai_debates', {
      id: aiDebateId,
      actor_id: actorId,
      resolution: 'Cities should make public transit free',
      person_side: 'affirmative',
      opponent: 'wren',
      voice: 'v',
      speech_model: 'm',
      cx_model: 'm',
      judge_model: 'm',
      tts_model: 'm',
      stt_model: 'm',
      expected_end_at: at(59),
    });
    const database = createDatabase({ url, nextActorId: createId });
    try {
      await run({ database, fixture, userId, aiDebateId });
    } finally {
      await database.close();
    }
  });

const document = (
  ownerUserId: string,
  aiDebateId: string | null,
  title: string,
  minute: number,
) => ({
  id: createId(),
  ownerUserId,
  aiDebateId,
  folder: aiDebateId === null ? ('library' as const) : ('round' as const),
  templateId: 'flow',
  title,
  html: '<h1>Flow</h1>',
  createdAt: at(minute),
});

describe('debate documents', () => {
  test('lists the debate round documents and the library, oldest first', async () => {
    await withOwner(async ({ database, fixture, userId, aiDebateId }) => {
      const otherDebate = createId();
      await fixture.insert('ai_debates', {
        id: otherDebate,
        actor_id: await fixture.actor(await fixture.user()),
        resolution: 'Another resolution',
        person_side: 'negative',
        opponent: 'wren',
        voice: 'v',
        speech_model: 'm',
        cx_model: 'm',
        judge_model: 'm',
        tts_model: 'm',
        stt_model: 'm',
        expected_end_at: at(59),
      });
      const stranger = await fixture.user();
      const created = await database.createDebateDocument(
        document(userId, aiDebateId, 'Flow', 2),
      );
      await database.createDebateDocument(document(userId, null, 'Case', 1));
      await database.createDebateDocument(document(userId, null, 'Block', 1));
      await database.createDebateDocument(
        document(stranger, otherDebate, 'Theirs', 0),
      );
      await database.createDebateDocument(document(stranger, null, 'Lib', 0));
      const listed = await database.listDebateDocuments({
        ownerUserId: userId,
        aiDebateId,
      });
      assert({
        given: 'a round document, two library documents and a stranger’s',
        should: 'list only the owner’s, by creation time then title',
        actual: listed.map((d) => [d.title, d.folder, d.revision]),
        expected: [
          ['Block', 'library', 1],
          ['Case', 'library', 1],
          ['Flow', 'round', 1],
        ],
      });
      assert({
        given: 'a created document',
        should: 'read back its timestamps as created',
        actual: [created.createdAt, created.updatedAt],
        expected: [at(2), at(2)],
      });
    });
  });

  test('saves compare and swap on the revision', async () => {
    await withOwner(async ({ database, fixture, userId, aiDebateId }) => {
      const { id } = await database.createDebateDocument(
        document(userId, aiDebateId, 'Flow', 0),
      );
      const save = (expectedRevision: number, ownerUserId = userId) =>
        database.saveDebateDocument({
          id,
          ownerUserId,
          html: `<p>r${expectedRevision}</p>`,
          expectedRevision,
          updatedAt: at(5),
        });
      const first = await save(1);
      const stale = await save(1);
      const stranger = await save(2, await fixture.user());
      const missing = await database.saveDebateDocument({
        id: createId(),
        ownerUserId: userId,
        html: '<p></p>',
        expectedRevision: 1,
        updatedAt: at(5),
      });
      const [stored] = await database.listDebateDocuments({
        ownerUserId: userId,
        aiDebateId,
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
        actual: [stored?.html, stored?.revision, stored?.updatedAt],
        expected: ['<p>r1</p>', 2, at(5)],
      });
    });
  });

  test('renames keep the revision and refuse a stranger', async () => {
    await withOwner(async ({ database, fixture, userId }) => {
      const { id } = await database.createDebateDocument(
        document(userId, null, 'Case', 0),
      );
      const renamed = await database.renameDebateDocument({
        id,
        ownerUserId: userId,
        title: 'Plan',
        updatedAt: at(3),
      });
      const refused = await database.renameDebateDocument({
        id,
        ownerUserId: await fixture.user(),
        title: 'Mine',
        updatedAt: at(4),
      });
      assert({
        given: 'a rename by the owner, then one by a stranger',
        should: 'rename once and leave the revision',
        actual: [
          renamed?.title,
          renamed?.revision,
          renamed?.updatedAt,
          refused,
        ],
        expected: ['Plan', 1, at(3), null],
      });
    });
  });

  test('the folder and debate agree, and titles are bounded', async () => {
    await withOwner(async ({ fixture, userId, aiDebateId }) => {
      const row = (overrides: Record<string, unknown>) => ({
        id: createId(),
        owner_user_id: userId,
        ai_debate_id: null,
        folder: 'library',
        template_id: 'blank',
        title: 'Notes',
        html: '<p></p>',
        ...overrides,
      });
      assert({
        given: 'rows that break the document constraints',
        should: 'be refused by the named CHECK',
        actual: [
          await fixture.rejectedBy(
            'debate_documents',
            row({ folder: 'round' }),
          ),
          await fixture.rejectedBy(
            'debate_documents',
            row({ ai_debate_id: aiDebateId }),
          ),
          await fixture.rejectedBy('debate_documents', row({ folder: 'club' })),
          await fixture.rejectedBy('debate_documents', row({ title: '' })),
          await fixture.rejectedBy(
            'debate_documents',
            row({ title: 'x'.repeat(121) }),
          ),
          await fixture.rejectedBy('debate_documents', row({ revision: 0 })),
        ],
        expected: [
          'debate_documents_round_has_debate',
          'debate_documents_round_has_debate',
          'debate_documents_folder_check',
          'debate_documents_title_length',
          'debate_documents_title_length',
          'debate_documents_revision_positive',
        ],
      });
    });
  });
});
