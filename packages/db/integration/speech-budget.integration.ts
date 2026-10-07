import { assert, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { roundAuthoring, withFixture } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';

const { databaseUrl: url } = integrationSuite();

/**
 * The voice budget has to be a ceiling, not a suggestion.
 *
 * `speak` used to read the seat's spent TTS characters, compare that total to
 * the budget, and only then call the vendor and record the usage. Between the
 * read and the write there was no lock, so every request that asked for a
 * phrase at the same moment read the same starting total, passed the same
 * check, and called the vendor — however many were in flight, the budget was
 * exceeded by the sum of all of them.
 *
 * `reserveSpokenCharacters` claims the characters first, in one transaction
 * that locks the seat row, so concurrent claims queue and each sees the
 * previous one. This fires them at once for real: two separate connections,
 * `Promise.all`, no artificial delay inside the critical section.
 */
test('concurrent voice claims cannot both pass on the same starting total', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, actorId, database, rules, formatId } =
      await roundAuthoring(fixture, url);
    try {
      await database.createRound({
        id: roundId,
        createdByActorId: null,
        resolution: 'budget race proof',
        competitionType: 'casual',
        length: 'full',
        formatId,
        formatVersion: 1,
        presetVersion: null,
        rules,
      });

      // Seat a debater and give that seat a TTS budget of 100 characters.
      const participantId = createId();
      await fixture.sql`
        insert into round_participants (id, round_id, actor_id, role, slot)
        values (
          ${participantId},
          ${roundId},
          ${actorId},
          'affirmative',
          0
        )
      `;

      const claim = (database_: typeof database, characters: number) =>
        database_.reserveSpokenCharacters({
          id: createId(),
          roundParticipantId: participantId,
          characters,
          budget: 100,
          model: 'tts-model',
          provider: 'openrouter',
        });

      // Two independent claims, both of which fit in an empty budget on their
      // own, started together. With a read-then-write check both would pass;
      // the second must find the first's claim already spent.
      const [first, second] = await Promise.all([
        claim(database, 60),
        claim(database, 60),
      ]);

      assert({
        given: 'two 60-character claims against a 100-character budget, racing',
        should: 'let exactly one through, so the ceiling holds',
        actual: {
          claimsThatSucceeded: [first, second].filter(Boolean).length,
          spent: await database.spokenCharactersFor({
            roundParticipantId: participantId,
          }),
        },
        expected: { claimsThatSucceeded: 1, spent: 60 },
      });
    } finally {
      await database.close();
    }
  });
});
