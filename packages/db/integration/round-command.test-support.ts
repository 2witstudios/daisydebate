import { createHealthStore } from '../src/stores/health';
import { createRoundStore } from '../src/stores/rounds';
import { openDatabaseResources } from '../src/resources';
import { hostWaits } from '@daisy/worker/host';
import { roundDecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { createId } from '@paralleldrive/cuid2';
import type { RoundCommandEnvelope } from '@daisy/protocol/round-command';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';
/** This file's database: the area stores it reads, over one set of resources. */
const openStores = (
  options: Parameters<typeof openDatabaseResources>[0] & {
    readonly roundTime?: NonNullable<
      Parameters<typeof createRoundStore>[1]
    >['roundTime'];
    readonly decisionRelease?: NonNullable<
      Parameters<typeof createRoundStore>[1]
    >['decisionRelease'];
  },
) => {
  const resources = openDatabaseResources(options);
  return {
    ...createHealthStore(resources),
    ...createRoundStore(resources, {
      roundTime: options.roundTime,
      decisionRelease: options.decisionRelease,
    }),
    close: resources.close,
  };
};

/** A fixture Round authored by a fresh canonical subject, with the real database API. */
export const withAuthoredRound = (
  url: string,
  round: Parameters<Fixture['round']>[0],
  work: (
    fixture: Fixture,
    authored: {
      readonly actorId: string;
      readonly roundId: string;
      readonly database: ReturnType<typeof openStores>;
    },
  ) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const { actorId } = await createAuthorizationSubject(fixture);
    const roundId = await fixture.round({
      created_by_actor_id: actorId,
      ...round,
    });
    const database = openStores({
      waits: hostWaits,
      decisionRelease: roundDecisionReleasePolicy,
      url,
    });
    await work(fixture, { actorId, roundId, database });
  });

/** Canonical input data; execution always goes through the actual fenced API. */
export const authoredRoundCommand = (
  author: { readonly roundId: string; readonly actorId: string },
  expectedVersion: number,
  command: RoundCommandEnvelope['command'] = {
    type: 'yield',
    participantId: createId(),
    sequence: 0,
  },
  commandId = createId(),
) => ({
  roundId: author.roundId,
  envelope: { version: 1 as const, commandId, expectedVersion, command },
  principal: { kind: 'human' as const, actorId: author.actorId },
  payloadDigest: 'a'.repeat(64),
  authorize: () => undefined,
});
