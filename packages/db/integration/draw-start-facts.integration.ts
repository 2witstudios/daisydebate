import { requireTestServices } from '@daisy/config';
import { resolutionDrawEvidenceSchema } from '@daisy/protocol/resolution-draw';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawStartFacts } from '../src/draw-start-facts';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture } from './constraint-helpers';

const { databaseUrl } = requireTestServices(process.env);
setupRitewayBun();

test('a new draw batches the seated humans’ recent winning bank entries', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const people = await Promise.all(
      Array.from({ length: 4 }, () => createAuthorizationSubject(fixture)),
    );
    const at = '2026-10-01T00:00:00.000Z';
    const roomId = createId();
    const evidence = (bankEntryId: string) =>
      resolutionDrawEvidenceSchema.parse({
        version: 1,
        manifest: {
          version: 1,
          algorithm: 'daisy-draw-v1',
          roomId,
          drawId: createId(),
          source: {
            kind: 'bank',
            revision: 1,
            categories: ['policy'],
            locale: 'en',
            difficulties: ['advanced', 'intro', 'standard'],
          },
          drawSize: 3,
          firstStriker: 'negative',
          strikeWindowMs: 60_000,
          controllers: { affirmative: 'human', negative: 'human' },
          inputCommitment: 'b'.repeat(64),
        },
        manifestDigest: 'c'.repeat(64),
        commitment: 'd'.repeat(64),
        startedAt: at,
        revealedAt: at,
        items: [
          { position: 0, category: 'policy', bankEntryId: 'struck' },
          { position: 1, category: 'policy', bankEntryId },
        ],
        strikes: [],
        survivorPosition: 1,
      });
    for (const [index, person] of people.entries()) {
      const roundId = await fixture.round({
        resolution_evidence: evidence(index % 2 ? 'x' : 'y'),
      });
      await fixture.participant(roundId, 'affirmative', 0, person.actorId);
    }
    const statements: string[] = [];
    const database = drizzle({
      client: fixture.sql,
      logger: { logQuery: (query) => statements.push(query) },
    });
    const facts = await database.transaction((tx) =>
      drawStartFacts(tx, {
        executionPlan: {
          resolutionDraw: {
            enabled: true,
            drawSize: 3,
            strikeWindowMs: 60_000,
            firstStriker: 'negative',
            source: { kind: 'bank', categories: ['policy'] },
          },
        },
        participants: people.map(({ actorId }) => ({ actorId, kind: 'human' })),
      }),
    );
    const history = statements.filter((query) =>
      query.includes('round_participants'),
    );
    assert({
      given:
        'four seated humans with recurring winners and an unchosen bank entry',
      should:
        'exclude each chosen entry once using a single bounded lateral query',
      actual: {
        choices: [...facts.exclusions].sort(),
        statements: history.length,
        bounded: /join lateral[\s\S]*limit/i.test(history[0] ?? ''),
      },
      expected: { choices: ['x', 'y'], statements: 1, bounded: true },
    });
  });
});
