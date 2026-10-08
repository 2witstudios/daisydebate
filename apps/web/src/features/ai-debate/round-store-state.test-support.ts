import type { RoundHydration } from '@daisy/db';
import type { RuntimeCheckpoint } from '@daisy/protocol';

/** One fake `rounds` row, exactly as the adapter persists it. */
type FakeRoundRow = {
  id: string;
  roomId: string | null;
  resolution: string;
  competitionType: 'ranked' | 'casual' | 'practice';
  length: 'full' | 'quick';
  formatId: string;
  formatVersion: number;
  presetVersion: number | null;
  rules: RoundHydration['rules'];
  status: RoundHydration['status'];
  currentStage: RoundHydration['currentStage'];
  startedAt: string | null;
  completedAt: string | null;
  outcome: RoundHydration['outcome'];
  checkpoint: RuntimeCheckpoint;
  version: number;
};

type FakeRoomRow = {
  formatId: string;
  formatVersion: number;
  presetVersion: number | null;
  competitionType: 'ranked' | 'casual' | 'practice';
  length: 'full' | 'quick';
  rules: RoundHydration['rules'];
  status: 'assembling' | 'ready' | 'started' | 'abandoned';
  seats: RoundHydration['participants'];
};

type FakeUtteranceRow = {
  id: string;
  roundId: string;
  segmentId: string;
  roundParticipantId: string;
  text: string;
  complete: boolean;
  generationToken?: string | null;
  generationExpiresAt?: number | null;
  createdAt: Date;
};

type FakeBallotRow = {
  id: string;
  judgeParticipantId: string;
  rubricVersion: string;
  winner: string;
  scores: unknown;
  reason: string;
  feedback: unknown;
  status: 'submitted' | 'voided';
};

type FakeRunRow = {
  id: string;
  roundParticipantId: string;
  kind: string;
  characters: number;
};

/** The in-memory rows the fake store's methods read and write. */
export type FakeRoundState = {
  rooms: Map<string, FakeRoomRow>;
  rounds: Map<string, FakeRoundRow>;
  participants: Map<string, RoundHydration['participants']>;
  segments: Map<
    string,
    Array<{
      id: string;
      sequence: number;
      type: 'speech' | 'cross_ex';
      rulesSegmentKey: string;
      startedAt: string;
      endedAt: string | null;
      durationMs: number;
    }>
  >;
  utteranceRows: Map<string, FakeUtteranceRow[]>;
  ballotRows: Map<string, FakeBallotRow>;
  commandIds: Set<string>;
  runRows: FakeRunRow[];
  reservationActors: Map<string, string[]>;
  /** The fake's clock: tests advance it; methods read it. */
  now: () => number;
  advance: (ms: number) => void;
  hydrationOf: (roundId: string) => RoundHydration | null;
};

export const createFakeRoundState = (): FakeRoundState => {
  let now = 0;
  const state = {
    rooms: new Map<string, FakeRoomRow>(),
    rounds: new Map<string, FakeRoundRow>(),
    participants: new Map<string, RoundHydration['participants']>(),
    segments: new Map<
      string,
      Array<{
        id: string;
        sequence: number;
        type: 'speech' | 'cross_ex';
        rulesSegmentKey: string;
        startedAt: string;
        endedAt: string | null;
        durationMs: number;
      }>
    >(),
    utteranceRows: new Map<string, FakeUtteranceRow[]>(),
    ballotRows: new Map<string, FakeBallotRow>(),
    commandIds: new Set<string>(),
    runRows: [] as FakeRunRow[],
    reservationActors: new Map<string, string[]>(),
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
  const hydrationOf = (roundId: string): RoundHydration | null => {
    const row = state.rounds.get(roundId);
    if (!row) return null;
    return {
      id: row.id,
      competitionType: row.competitionType,
      formatId: row.formatId,
      formatVersion: row.formatVersion,
      resolution: row.resolution,
      status: row.status,
      currentStage: row.currentStage,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      outcome: row.outcome,
      rules: row.rules,
      checkpoint: row.checkpoint,
      version: row.version,
      participants: state.participants.get(roundId) ?? [],
      segments: state.segments.get(roundId) ?? [],
    };
  };
  return { ...state, hydrationOf };
};
