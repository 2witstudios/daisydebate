import type {
  CompetitionType,
  RatingDivision,
  TwoSideKey,
  RoomConfig,
  RoomExecutionPlan,
  RoundRules,
} from '@daisy/protocol';

export type NewRoom = {
  readonly id: string;
  readonly hostActorId: string | null;
  readonly title: string;
  /** Null exactly when the Room's plan has a draw (FMT-7). */
  readonly topic: string | null;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number | null;
  /** The catalog preset a casual room is based on (FMT-1); null for ranked and custom. */
  readonly basis: {
    readonly formatId: string;
    readonly presetVersion: number;
  } | null;
  readonly competitionType: CompetitionType;
  /** The lobby the Room is created in (ADR 0155), fixed for its life. */
  readonly division: RatingDivision;
  /** Team 1's side, or null for a coin flip at Start round (ADR 0145). */
  readonly teamOneSide: TwoSideKey | null;
  /** A Train practice: the Room holds its host from create (decision 75). */
  readonly holdsHost?: boolean;
  readonly config: RoomConfig;
  readonly executionPlan: RoomExecutionPlan;
  readonly rules: RoundRules;
};

/** A new Room's row: it assembles first, so no Room is ever stored started without its Round. */
export const newRoomValues = (room: NewRoom) => ({
  id: room.id,
  hostActorId: room.hostActorId,
  title: room.title,
  topic: room.topic,
  visibility: room.visibility,
  formatId: room.formatId,
  formatVersion: room.formatVersion,
  presetVersion: room.presetVersion,
  basisFormatId: room.basis?.formatId ?? null,
  basisPresetVersion: room.basis?.presetVersion ?? null,
  competitionType: room.competitionType,
  division: room.division,
  teamOneSide: room.teamOneSide,
  holdsHost: room.holdsHost ?? false,
  config: room.config,
  executionPlan: room.executionPlan,
  rulesSnapshot: room.rules,
  status: 'assembling' as const,
});
