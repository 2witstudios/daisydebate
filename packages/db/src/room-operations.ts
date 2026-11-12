import type {
  CompetitionType,
  RoomConfig,
  RoomExecutionPlan,
  RoundRules,
} from '@daisy/protocol';

export type NewRoom = {
  readonly id: string;
  readonly hostActorId: string;
  readonly title: string;
  /** Null exactly when the Room's plan has a draw (FMT-7). */
  readonly topic: string | null;
  readonly publishedResolutionId?: string | null;
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
  publishedResolutionId: room.publishedResolutionId ?? null,
  visibility: room.visibility,
  formatId: room.formatId,
  formatVersion: room.formatVersion,
  presetVersion: room.presetVersion,
  basisFormatId: room.basis?.formatId ?? null,
  basisPresetVersion: room.basis?.presetVersion ?? null,
  competitionType: room.competitionType,
  config: room.config,
  executionPlan: room.executionPlan,
  rulesSnapshot: room.rules,
  status: 'assembling' as const,
});
