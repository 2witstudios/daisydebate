import type { RoundAdjudication } from './round-adjudication';
import type {
  RoundCommand,
  RoundPosition,
  RoundProjection,
  RoundUnjudgedCompletion,
  RuntimeCheckpoint,
} from '@daisy/protocol';

/** What createRoundRuntime returns: reads, decisions and the clock, each projecting its writes. */
export type RoundRuntime = {
  /** The derived position at `now`; a pure read. */
  readonly position: (now: string) => RoundPosition;
  /** Applies one legal command and returns the writes to persist. */
  readonly execute: (input: {
    readonly command: RoundCommand;
    readonly actorId: string | null;
    readonly now: string;
  }) => RoundProjection;
  /** Internal durable attendance decision; never a public command. */
  readonly adjudicate: (input: RoundAdjudication) => RoundProjection;
  /** Internal completion after durable freeze/attendance verification; does not advance time. */
  readonly completeUnjudged: (
    input: RoundUnjudgedCompletion,
  ) => RoundProjection;
  /** Maintenance ends a Round never started by its start horizon (DEC-214). */
  readonly abandonUnstarted: (now: string) => RoundProjection;
  /** Advances time alone, projecting whatever the clock moved. */
  readonly tick: (now: string) => RoundProjection;
  /** The current checkpoint. */
  readonly checkpoint: () => RuntimeCheckpoint;
};
