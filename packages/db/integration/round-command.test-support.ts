import { createId } from '@paralleldrive/cuid2';
import type { RoundCommandEnvelope } from '@daisy/protocol';
import { createDatabase } from '../src';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';

/** A fixture Round authored by a fresh canonical subject, with the real database API. */
export const withAuthoredRound = (
  url: string,
  round: Parameters<Fixture['round']>[0],
  work: (
    fixture: Fixture,
    authored: {
      readonly actorId: string;
      readonly roundId: string;
      readonly database: ReturnType<typeof createDatabase>;
    },
  ) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const { actorId } = await createAuthorizationSubject(fixture);
    const roundId = await fixture.round({
      created_by_actor_id: actorId,
      ...round,
    });
    const database = createDatabase({ url, nextActorId: createId });
    await work(fixture, { actorId, roundId, database });
  });

/** Canonical input data; execution always goes through the actual fenced API. */
export const authoredRoundCommand = (
  author: { readonly roundId: string; readonly actorId: string },
  expectedVersion: number,
  command: RoundCommandEnvelope['command'] = { type: 'start' },
  commandId = createId(),
) => ({
  roundId: author.roundId,
  envelope: { version: 1 as const, commandId, expectedVersion, command },
  principal: { kind: 'human' as const, actorId: author.actorId },
  payloadDigest: 'a'.repeat(64),
  authorize: () => undefined,
});
