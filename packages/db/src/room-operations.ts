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
  readonly topic: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number | null;
  readonly competitionType: CompetitionType;
  readonly config: RoomConfig;
  readonly executionPlan: RoomExecutionPlan;
  readonly rules: RoundRules;
};

export const newRoomValues = (
  room: NewRoom,
  status: 'assembling' | 'started',
) => ({
  id: room.id,
  hostActorId: room.hostActorId,
  title: room.title,
  topic: room.topic,
  visibility: room.visibility,
  formatId: room.formatId,
  formatVersion: room.formatVersion,
  presetVersion: room.presetVersion,
  competitionType: room.competitionType,
  config: room.config,
  executionPlan: room.executionPlan,
  rulesSnapshot: room.rules,
  prepRemainingMs: room.executionPlan.preRoundPrep.enabled
    ? room.executionPlan.preRoundPrep.durationMs
    : null,
  status,
});
