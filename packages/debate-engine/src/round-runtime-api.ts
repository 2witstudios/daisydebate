import type { StartGateEvent } from './round-start-gate';
import type { RoundAdjudication } from './round-adjudication';
import type { IncidentEvent } from './round-incident';
import type {
  RoundCommand,
  RoundPosition,
  RoundProjection,
  RoundPanelCompletion,
  RuntimeCheckpoint,
} from '@daisy/protocol';

/** What createRoundRuntime returns: reads, decisions and the clock, each projecting its writes. */
export type RoundRuntime = {
  /** The derived position at `now`; a pure read. */
  readonly position: (now: string) => RoundPosition;
  /** Whether every segment has closed by `now`, the clock advanced first. */
  readonly debateOverAt: (now: string) => boolean;
  /** Applies one legal command and returns the writes to persist. */
  readonly execute: (input: {
    readonly command: RoundCommand;
    readonly actorId: string | null;
    readonly now: string;
  }) => RoundProjection;
  /** Internal durable attendance decision; never a public command. */
  readonly adjudicate: (input: RoundAdjudication) => RoundProjection;
  /** Internal completion after durable freeze/attendance verification; does not advance time. */
  readonly completePanel: (input: RoundPanelCompletion) => RoundProjection;
  /** The opening ended at `at`: the Round starts there and catches up to `now`. */
  readonly activate: (input: {
    readonly at: string;
    readonly now: string;
  }) => RoundProjection;
  /** A server-detected platform incident moving the Round's hold; no player reaches this. */
  readonly applyIncident: (event: IncidentEvent) => RoundProjection;
  /** Capture's readiness for the coming speech; a late start is the clock's own. */
  readonly applyStartGate: (event: StartGateEvent) => RoundProjection;
  /** Advances time alone, projecting whatever the clock moved. */
  readonly tick: (now: string) => RoundProjection;
  /** The current checkpoint. */
  readonly checkpoint: () => RuntimeCheckpoint;
};
