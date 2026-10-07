import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/** The fixture round: the tester's actor holds its negative seat. */
const withOwner = async (
  run: (input: {
    database: ReturnType<typeof createDatabase>;
    fixture: Fixture;
    userId: string;
    actorId: string;
    roundId: string;
  }) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const userId = await fixture.user();
    const actorId = await fixture.actor(userId);
    const formatId = `fmt-${createId()}`;
    await fixture.insert(
      'format_revisions',
      {
        format_id: formatId,
        version: 1,
        definition: {
          version: 1,
          seats: { affirmative: 1, negative: 1, judge: 0 },
          segments: [
            {
              key: 'AC',
              label: 'Affirmative constructive',
              type: 'speech',
              side: 'affirmative',
              slot: 0,
              defaultDurationMs: 240_000,
            },
          ],
          configurable: {
            timing: {
              segmentDurationMs: { AC: { min: 60_000, max: 600_000 } },
              countdownMs: { min: 0, max: 60_000 },
            },
            inRoundPrep: {
              budgetMsPerSide: { min: 0, max: 600_000 },
              spendableBefore: ['speech'],
              expiresAtSegment: null,
            },
            preRoundPrep: null,
            interaction: {
              crossExModes: ['ordered'],
              interruptions: null,
              yield: null,
            },
          },
        },
      },
      'format_id',
    );
    await fixture.insert('formats', {
      id: formatId,
      name: 'Fixture format',
      current_version: 1,
    });
    const roundId = createId();
    await fixture.insert('rounds', {
      id: roundId,
      resolution: 'Cities should make public transit free',
      competition_type: 'practice',
      length: 'full',
      format_id: formatId,
      format_version: 1,
      rules_snapshot: {
        version: 2,
        seats: { affirmative: 1, negative: 1, judge: 0 },
        segments: [
          {
            key: 'AC',
            label: 'Affirmative constructive',
            type: 'speech',
            side: 'affirmative',
            slot: 0,
            durationMs: 240_000,
          },
        ],
        inRoundPrep: null,
        countdownMs: 10_000,
        interaction: {
          crossExMode: 'ordered',
          yield: null,
          interruptions: null,
        },
      },
      status: 'scheduled',
    });
    await fixture.insert('round_participants', {
      id: createId(),
      round_id: roundId,
      actor_id: actorId,
      role: 'negative',
      slot: 0,
    });
    const database = createDatabase({ url, nextActorId: createId });
    try {
      await run({ database, fixture, userId, actorId, roundId });
    } finally {
      await database.close();
    }
  });

const document = (
  ownerActorId: string,
  folder: 'library' | 'scratch',
  title: string,
) => ({
  id: createId(),
  ownerActorId,
  folder,
  templateId: 'flow',
  title,
  html: '<h1>Flow</h1>',
});

describe('documents', () => {
  test('lists the owner’s documents plus the round’s refs, title order', async () => {
    await withOwner(async ({ database, fixture, actorId, roundId }) => {
      const stranger = await fixture.actor();
      const mine = await database.createDocument(
        document(actorId, 'scratch', 'Flow'),
      );
      await database.createDocument(document(actorId, 'library', 'Case'));
      await database.createDocument(document(actorId, 'library', 'Block'));
      const theirs = await database.createDocument(
        document(stranger, 'library', 'Theirs'),
      );
      await database.attachRoundDocument({
        roundId,
        documentId: theirs.id,
        role: 'flow',
      });
      const listed = await database.listDocuments({
        ownerActorId: actorId,
        roundId,
      });
      assert({
        given:
          'two library documents, one scratch round document and a scoped stranger’s',
        should: 'list the owner’s and the round’s view, by title',
        actual: listed.map((d) => [d.title, d.folder]),
        expected: [
          ['Block', 'library'],
          ['Case', 'library'],
          ['Flow', 'scratch'],
          ['Theirs', 'library'],
        ],
      });
      void mine;
    });
  });

  test('saves compare and swap on the revision', async () => {
    await withOwner(async ({ database, actorId }) => {
      const { id } = await database.createDocument(
        document(actorId, 'scratch', 'Flow'),
      );
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
        roundId: null,
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
      const { id } = await database.createDocument(
        document(actorId, 'library', 'Case'),
      );
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

  test('the document constraints: folders, templates, titles, revisions', async () => {
    await withOwner(async ({ fixture, actorId }) => {
      const row = (overrides: Record<string, unknown>) => ({
        id: createId(),
        owner_actor_id: actorId,
        folder: 'library',
        template_id: 'blank',
        title: 'Notes',
        html: '<p></p>',
        revision: 1,
        ...overrides,
      });
      assert({
        given: 'rows that break the document constraints',
        should: 'be refused by the named CHECK',
        actual: [
          await fixture.rejectedBy('documents', row({ folder: 'round' })),
          await fixture.rejectedBy('documents', row({ folder: 'club' })),
          await fixture.rejectedBy('documents', row({ template_id: 'essay' })),
          await fixture.rejectedBy('documents', row({ title: '' })),
          await fixture.rejectedBy(
            'documents',
            row({ title: 'x'.repeat(121) }),
          ),
          await fixture.rejectedBy('documents', row({ revision: 0 })),
        ],
        expected: [
          'documents_folder_check',
          'documents_folder_check',
          'documents_template_check',
          'documents_title_length',
          'documents_title_length',
          'documents_revision_positive',
        ],
      });
    });
  });

  test('round refs are scope, not existence', async () => {
    await withOwner(async ({ database, fixture, actorId, roundId }) => {
      const created = await database.createDocument(
        document(actorId, 'scratch', 'Flow'),
      );
      await database.attachRoundDocument({
        roundId,
        documentId: created.id,
        role: 'flow',
      });
      await fixture.sql.unsafe('delete from rounds where id = $1', [roundId]);
      const [survivor] = await database.listDocuments({
        ownerActorId: actorId,
        roundId: null,
      });
      assert({
        given: 'a round deleted with its refs',
        should: 'leave the owned document standing (ADR 0058 §9)',
        actual: survivor?.id,
        expected: created.id,
      });
    });
  });
});
