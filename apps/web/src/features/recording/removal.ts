import { createAppError } from '@daisy/errors';
import { mayRequestRemoval, type RecordingViewer } from './audience';
import { transitionRecording, type RecordingEvent } from './lifecycle';
import type { RecordingInputs, RecordingRecord, RecordingStore } from './ports';

/**
 * A participant has a casual Recording removed, whole. The version is the one
 * their form showed, so a changed Recording is confirmed again rather than acted
 * on blind. Ranked is refused by the transition as well as by this check.
 */
export const requestParticipantRemoval = async (
  deps: {
    readonly store: Pick<RecordingStore, 'find' | 'apply'>;
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
  const applied = await deps.store.apply(
    input.recordingId,
    (current) =>
      transitionRecording(current, {
        type: 'removal_requested',
        cause: 'participant_request',
        at: input.now,
      }),
    input.expectedVersion,
  );
  if (applied.kind === 'missing') throw createAppError('NOT_FOUND');
  if (applied.kind === 'stale') throw createAppError('CONFLICT');
  if (applied.transition.kind === 'refused')
    throw createAppError('AUTHORIZATION');
  return applied.record;
};

/** What moderation may do. An operator's authority is checked at the admin API. */
export type ModerationAction = 'take_down' | 'restore' | 'remove';

const moderationEvent = (
  action: ModerationAction,
  now: string,
): RecordingEvent => {
  switch (action) {
    case 'take_down':
      return { type: 'taken_down', at: now };
    case 'restore':
      return { type: 'restored' };
    case 'remove':
      return { type: 'removal_requested', cause: 'moderation', at: now };
  }
};

/** A versioned moderation decision on any Recording, ranked included. */
export const applyModeration = async (
  store: Pick<RecordingStore, 'apply'>,
  input: {
    readonly recordingId: string;
    readonly action: ModerationAction;
    readonly expectedVersion: number;
    readonly now: string;
  },
): Promise<RecordingRecord> => {
  const applied = await store.apply(
    input.recordingId,
    (current) =>
      transitionRecording(current, moderationEvent(input.action, input.now)),
    input.expectedVersion,
  );
  if (applied.kind === 'missing') throw createAppError('NOT_FOUND');
  if (applied.kind === 'stale' || applied.transition.kind === 'refused')
    throw createAppError('CONFLICT');
  return applied.record;
};
