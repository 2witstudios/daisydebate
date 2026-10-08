import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src';
import { foundationDefinition } from '../src/reference-formats';
import { validRules } from './round-fixtures';
import { withFixture, type Fixture } from './constraint-helpers';

const { databaseUrl: url } = requireTestServices(process.env);

/** The one-speech variant: the foundation grammar cut to its opening segment. */
const singleSpeechDefinition = {
  ...foundationDefinition,
  segments: [foundationDefinition.segments[0]!],
  configurable: {
    ...foundationDefinition.configurable,
    timing: {
      ...foundationDefinition.configurable.timing,
      segmentDurationMs: { AC: { min: 60_000, max: 600_000 } },
    },
  },
};

/** The rules a one-speech fixture round freezes, with no in-round prep. */
const singleSpeechRules = {
  ...validRules,
  segments: [validRules.segments[0]!],
  inRoundPrep: null,
};

/** The fixture round: the tester's actor holds its negative seat. */
export const withOwner = async (
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
        definition: singleSpeechDefinition,
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
      rules_snapshot: singleSpeechRules,
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

export const document = (
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
