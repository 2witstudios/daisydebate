import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';
import { privacyColumns, pendingPrivacyField } from './field-declarations';

/** Actor associations are retained competitive identifiers (ADR 0029). */
const columns = {
  rooms: {
    identifier: ['id', 'host_actor_id', 'format_id'],
    personal: ['title', 'topic'],
    none: [
      'visibility',
      'version',
      'change_version',
      'format_version',
      'preset_version',
      'competition_type',
      'config',
      'execution_plan',
      'rules_snapshot',
      'prep_started_at',
      'prep_remaining_ms',
      'last_command_at',
      'status',
      'created_at',
      'updated_at',
    ],
  },
  room_participants: {
    identifier: ['id', 'room_id', 'actor_id', 'readiness_command_id'],
    personal: [],
    none: ['role', 'slot', 'readiness_version'],
  },
  rounds: {
    identifier: [
      'id',
      'room_id',
      'created_by_actor_id',
      'format_id',
      'runtime_state',
    ],
    personal: ['resolution'],
    none: [
      'visibility',
      'competition_type',
      'format_version',
      'preset_version',
      'room_config_snapshot',
      'resolution_evidence',
      'rules_snapshot',
      'status',
      'current_stage',
      'outcome',
      'ladder_id',
      'started_at',
      'completed_at',
      'final_segment_ended_at',
      'transcript_admission_cutoff',
      'ballot_deadline_at',
      'created_at',
      'updated_at',
      'version',
    ],
  },
  round_participants: {
    identifier: ['id', 'round_id', 'actor_id'],
    personal: [],
    none: ['role', 'slot'],
  },
} as const;

/**
 * Authored text belongs to rooms.host_actor_id / rounds.created_by_actor_id,
 * not every participant. Scrub text while retaining competitive provenance.
 * Pending policies confer no collection or numeric retention authority.
 */
export const roomPrivacyFields: readonly PrivacyFieldDeclaration[] =
  privacyColumns(columns).map(({ table, column, category }) =>
    pendingPrivacyField({
      table,
      column,
      category,
      ...(category === 'personal' ? { visibility: 'private' as const } : {}),
      owner: 'ROOM',
      purpose:
        category === 'personal'
          ? 'Host-authored Room description and frozen debate resolution'
          : 'Room assembly and durable competitive provenance',
      erasure: category === 'personal' ? 'scrub' : 'retain-nonpersonal',
      exportable: category === 'personal',
    }),
  );
