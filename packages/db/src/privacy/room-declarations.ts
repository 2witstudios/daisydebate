import type { PrivacyFieldDeclaration } from './contracts';

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
  Object.entries(columns).flatMap(([table, groups]) =>
    Object.entries(groups).flatMap(([category, names]) =>
      names.map((column: string) => ({
        table,
        column,
        category: category as 'identifier' | 'personal' | 'none',
        ...(category === 'personal' ? { visibility: 'private' as const } : {}),
        storage: 'postgres' as const,
        owner: 'ROOM',
        purpose:
          category === 'personal'
            ? 'Host-authored Room description and frozen debate resolution'
            : 'Room assembly and durable competitive provenance',
        lawfulBasis: {
          status: 'pending' as const,
          decision: 'jc0qcdvpkmqzrelpaesi3pah',
        },
        retention: {
          status: 'pending' as const,
          decision: 'njiorsf64z4iqjm2dbfa3zuu',
        },
        erasure:
          category === 'personal'
            ? ('scrub' as const)
            : ('retain-nonpersonal' as const),
        exportable: category === 'personal',
      })),
    ),
  );
