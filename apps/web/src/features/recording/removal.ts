import { createAppError } from '@daisy/errors';
import { mayRequestRemoval, type RecordingViewer } from './audience';
import { transitionRecording } from '@daisy/protocol';
import type { RecordingInputs, RecordingRecord, RecordingStore } from './ports';

/**
 * A participant has a casual Recording removed, whole. The version is the one
 * their form showed, so a changed Recording is confirmed again rather than acted
 * on blind. Ranked is refused by the transition as well as by this check. The store
 * ends the Round's open feed with it.
 */
export const requestParticipantRemoval = async (
  deps: {
    readonly store: Pick<RecordingStore, 'find' | 'applyParticipantRemoval'>;
    readonly inputs: Pick<RecordingInputs, 'readRound'>;
  },
  input: {
    readonly recordingId: string;
    readonly expectedVersion: number;
    readonly viewer: RecordingViewer;
    readonly now: string;
  },
): Promise<RecordingRecord> => {
  const record = await deps.store.find(input.recordingId);
  if (record === null) throw createAppError('NOT_FOUND');
  const round = await deps.inputs.readRound(record.roundId);
  if (round === null) throw createAppError('NOT_FOUND');
  const allowed = mayRequestRemoval({
    recordingClass: record.class,
    round,
    viewer: input.viewer,
    status: record.lifecycle.status,
  });
  if (!allowed) throw createAppError('AUTHORIZATION');
  const applied = await deps.store.applyParticipantRemoval(
    input.recordingId,
    (current) =>
      transitionRecording(current, {
        type: 'removal_requested',
        cause: 'participant_request',
        at: input.now,
      }),
    { expectedVersion: input.expectedVersion, now: input.now },
  );
  if (applied.kind === 'missing') throw createAppError('NOT_FOUND');
  if (applied.kind === 'stale') throw createAppError('CONFLICT');
  if (applied.transition.kind === 'refused')
    throw createAppError('AUTHORIZATION');
  return applied.record;
};
