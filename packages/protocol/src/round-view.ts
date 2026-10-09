import type { DebateRole } from './primitives';
import type { RoomConfig } from './room';
import type { RoundRules } from './format';
import type { RoundStatus } from './round';
import type { RatedOutcome } from './ratings';
/** Durable Launch projection. Active floor/media/history producers extend this boundary later. */
export type RoundView = {
  readonly id: string;
  readonly roomId: string;
  readonly version: number;
  readonly status: RoundStatus;
  readonly topic: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly hostActorId: string | null;
  readonly config: RoomConfig;
  readonly rules: RoundRules;
  readonly participants: readonly {
    readonly id: string;
    readonly actorId: string;
    readonly kind: 'human' | 'bot';
    readonly label: string;
    readonly role: DebateRole;
    readonly slot: number;
  }[];
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly outcome: RatedOutcome | null;
};
