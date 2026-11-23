import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { roundBallotOperations } from '../round-ballot-operations';
import { roundCommandOperations } from '../round-command-operations';
import type { RoundTimeSource } from '../round-execution-time';
import { roundOperations } from '../round-operations';
import { roundProtectedReads } from '../round-protected-reads';
import { roundSpeakingRead } from '../round-speaking-read';
import { utteranceOperations } from '../utterance-operations';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

export type RoundStoreOptions = {
  /** Trusted Round persistence time resource; absent in production composition. */
  readonly roundTime?: RoundTimeSource | undefined;
  /** Required for completing a Round; absence refuses atomically, never defaults. */
  readonly decisionRelease?: DecisionReleasePolicy | undefined;
};

/** Rounds: their reads, commands and utterances on the competitive lane. */
export const createRoundStore = (
  resources: DatabaseResources,
  { roundTime, decisionRelease }: RoundStoreOptions = {},
) => {
  const { lane, eventSink } = resourcesOf(resources);
  const database = lane('competitive').database;
  return namedLaneOperations({
    ...roundOperations({ database, eventSink }),
    ...roundCommandOperations({
      database,
      eventSink,
      roundTime,
      decisionRelease,
    }),
    ...roundProtectedReads({ database }),
    ...roundSpeakingRead({ database }),
    ...utteranceOperations({ database, eventSink }),
  });
};
export type RoundStore = ReturnType<typeof createRoundStore>;

/** A Round's ballots: submission and reads, on the competitive lane. */
export const createRoundBallotStore = (
  resources: DatabaseResources,
  { roundTime, decisionRelease }: RoundStoreOptions = {},
) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    roundBallotOperations({
      database: lane('competitive').database,
      eventSink,
      roundTime,
      decisionRelease,
    }),
  );
};
export type RoundBallotStore = ReturnType<typeof createRoundBallotStore>;
export type { RoundRoomAuthority } from '../round-room-authority';
export type { RoundHydration } from '../round-hydration';
