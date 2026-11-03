import type {
  RecordingClass,
  RecordingLifecycle,
  RecordingMedia,
  RecordingRemovalCause,
  RecordingSource,
  recordingTakedownReasons,
} from './recording';

/** Every object of a Recording sits here, so the whole of it can be deleted. */
export const recordingObjectPrefix = (recordingId: string): string =>
  `recordings/${recordingId}/`;

export type RecordingEvent =
  | {
      readonly type: 'capture_started';
      readonly source: RecordingSource;
      readonly attempt: number;
      readonly egressId: string;
      readonly at: string;
    }
  | { readonly type: 'capture_ended'; readonly at: string }
  | { readonly type: 'media_verified'; readonly media: RecordingMedia }
  | {
      readonly type: 'failed';
      readonly reason: Extract<
        RecordingLifecycle,
        { status: 'failed' }
      >['reason'];
      readonly at: string;
    }
  | {
      readonly type: 'taken_down';
      readonly at: string;
      readonly reason: (typeof recordingTakedownReasons)[number];
    }
  | { readonly type: 'rebuild_requested' }
  | { readonly type: 'restored' }
  | {
      readonly type: 'removal_requested';
      readonly cause: RecordingRemovalCause;
      readonly at: string;
      /**
       * Set when an open report holds a taken-down casual Recording as evidence:
       * the removal is owed, and waits until then at the latest.
       */
      readonly evidenceHeldUntil?: string;
    }
  | { readonly type: 'evidence_hold_ended' }
  | { readonly type: 'objects_gone'; readonly at: string };

type RecordingRefusal =
  | 'ranked_is_kept'
  | 'different_capture'
  | 'foreign_object'
  | 'not_restorable'
  | 'not_rebuildable'
  | 'evidence_held'
  | 'out_of_order';

/** Repeating a settled event changes nothing, so a retry cannot duplicate one. */
export type RecordingTransition =
  | { readonly kind: 'moved'; readonly next: RecordingLifecycle }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: RecordingRefusal };

type Subject = {
  readonly id: string;
  readonly class: RecordingClass;
  readonly lifecycle: RecordingLifecycle;
};

const moved = (next: RecordingLifecycle): RecordingTransition => ({
  kind: 'moved',
  next,
});
const unchanged: RecordingTransition = { kind: 'unchanged' };
const refused = (reason: RecordingRefusal): RecordingTransition => ({
  kind: 'refused',
  reason,
});

const sameSource = (x: RecordingSource, y: RecordingSource) =>
  x.kind === y.kind &&
  (x.kind !== 'broadcast_hold' ||
    (y.kind === 'broadcast_hold' && x.broadcastId === y.broadcastId));

const captureStarted = (
  { lifecycle }: Subject,
  event: Extract<RecordingEvent, { type: 'capture_started' }>,
): RecordingTransition => {
  const attempt = {
    attempt: event.attempt,
    egressId: event.egressId,
    startedAt: event.at,
  };
  if (lifecycle.status === 'requested')
    return moved({
      status: 'capturing',
      capture: {
        source: event.source,
        startedAt: event.at,
        attempts: [attempt],
      },
    });
  if (lifecycle.status !== 'capturing') return refused('out_of_order');
  const { capture } = lifecycle;
  if (!sameSource(capture.source, event.source))
    return refused('different_capture');
  const known = capture.attempts.find((a) => a.attempt === event.attempt);
  if (known)
    return known.egressId === event.egressId
      ? unchanged
      : refused('different_capture');
  // Attempts only grow, so an old report cannot reorder the timeline.
  return event.attempt > (capture.attempts.at(-1)?.attempt ?? 0)
    ? moved({
        status: 'capturing',
        capture: { ...capture, attempts: [...capture.attempts, attempt] },
      })
    : refused('out_of_order');
};

const captureEnded = (
  { lifecycle }: Subject,
  event: Extract<RecordingEvent, { type: 'capture_ended' }>,
): RecordingTransition => {
  if (lifecycle.status === 'capturing')
    return moved({
      status: 'processing',
      capture: { ...lifecycle.capture, endedAt: event.at },
    });
  return lifecycle.status === 'processing'
    ? unchanged
    : refused('out_of_order');
};

const mediaVerified = (
  { id, lifecycle }: Subject,
  { media }: Extract<RecordingEvent, { type: 'media_verified' }>,
): RecordingTransition => {
  if (lifecycle.status === 'processing') {
    const prefix = recordingObjectPrefix(id);
    const povKeys = (media.povs ?? []).flatMap((pov) =>
      pov.status === 'built'
        ? [pov.audio.key, ...(pov.video ? [pov.video.key] : [])]
        : [],
    );
    if (
      ![media.playlistKey, media.downloadKey, ...povKeys].every((key) =>
        key.startsWith(prefix),
      )
    )
      return refused('foreign_object');
    return moved({ status: 'ready', capture: lifecycle.capture, media });
  }
  return lifecycle.status === 'ready' &&
    lifecycle.media.playlistKey === media.playlistKey
    ? unchanged
    : refused('out_of_order');
};

const failed = (
  { lifecycle }: Subject,
  event: Extract<RecordingEvent, { type: 'failed' }>,
): RecordingTransition => {
  if (lifecycle.status === 'failed') return unchanged;
  if (lifecycle.status === 'processing')
    return moved({
      status: 'failed',
      reason: event.reason,
      failedAt: event.at,
      capture: lifecycle.capture,
    });
  return lifecycle.status === 'requested' || lifecycle.status === 'capturing'
    ? moved({ status: 'failed', reason: event.reason, failedAt: event.at })
    : refused('out_of_order');
};

const takenDown = (
  { lifecycle }: Subject,
  event: Extract<RecordingEvent, { type: 'taken_down' }>,
): RecordingTransition => {
  if (lifecycle.status === 'taken_down') return unchanged;
  if (lifecycle.status === 'removing' || lifecycle.status === 'removed')
    return refused('out_of_order');
  return moved({
    status: 'taken_down',
    takenDownAt: event.at,
    reason: event.reason,
    held: lifecycle.status === 'ready' ? lifecycle : null,
  });
};

/** A subject asked for this to go while it was held, so it never comes back. */
const restored = ({ lifecycle }: Subject): RecordingTransition => {
  if (lifecycle.status === 'ready') return unchanged;
  if (lifecycle.status !== 'taken_down') return refused('out_of_order');
  return lifecycle.held && !lifecycle.removalOwed
    ? moved(lifecycle.held)
    : refused('not_restorable');
};

/** Only ranked is kept for this: a failed casual Recording is cleaned up instead. */
const rebuildRequested = (subject: Subject): RecordingTransition => {
  const { lifecycle } = subject;
  if (lifecycle.status === 'processing') return unchanged;
  if (lifecycle.status !== 'failed') return refused('out_of_order');
  return subject.class === 'ranked' && lifecycle.capture
    ? moved({ status: 'processing', capture: lifecycle.capture })
    : refused('not_rebuildable');
};

const evidenceHoldEnded = ({ lifecycle }: Subject): RecordingTransition => {
  if (lifecycle.status === 'removing' || lifecycle.status === 'removed')
    return unchanged;
  return lifecycle.status === 'taken_down' && lifecycle.removalOwed
    ? moved({
        status: 'removing',
        cause: 'participant_request',
        requestedAt: lifecycle.removalOwed.requestedAt,
      })
    : refused('out_of_order');
};

const removalRequested = (
  subject: Subject,
  event: Extract<RecordingEvent, { type: 'removal_requested' }>,
): RecordingTransition => {
  const { lifecycle } = subject;
  if (subject.class === 'ranked' && event.cause === 'participant_request')
    return refused('ranked_is_kept');
  if (lifecycle.status === 'removing' || lifecycle.status === 'removed')
    return unchanged;
  // Only a legal removal outruns an owed erasure's hold.
  if (
    lifecycle.status === 'taken_down' &&
    lifecycle.removalOwed &&
    event.cause === 'moderation'
  )
    return refused('evidence_held');
  if (
    lifecycle.status === 'taken_down' &&
    event.cause === 'participant_request' &&
    event.evidenceHeldUntil !== undefined
  )
    return lifecycle.removalOwed
      ? unchanged
      : moved({
          ...lifecycle,
          removalOwed: {
            requestedAt: event.at,
            heldUntil: event.evidenceHeldUntil,
          },
        });
  return moved({
    status: 'removing',
    cause: event.cause,
    requestedAt: event.at,
  });
};

const objectsGone = (
  { lifecycle }: Subject,
  event: Extract<RecordingEvent, { type: 'objects_gone' }>,
): RecordingTransition => {
  if (lifecycle.status === 'removed') return unchanged;
  return lifecycle.status === 'removing'
    ? moved({
        status: 'removed',
        cause: lifecycle.cause,
        requestedAt: lifecycle.requestedAt,
        removedAt: event.at,
      })
    : refused('out_of_order');
};

/** The one place a Recording changes state. Pure and total. */
export const transitionRecording = (
  subject: Subject,
  event: RecordingEvent,
): RecordingTransition => {
  switch (event.type) {
    case 'capture_started':
      return captureStarted(subject, event);
    case 'capture_ended':
      return captureEnded(subject, event);
    case 'media_verified':
      return mediaVerified(subject, event);
    case 'failed':
      return failed(subject, event);
    case 'taken_down':
      return takenDown(subject, event);
    case 'restored':
      return restored(subject);
    case 'removal_requested':
      return removalRequested(subject, event);
    case 'rebuild_requested':
      return rebuildRequested(subject);
    case 'evidence_hold_ended':
      return evidenceHoldEnded(subject);
    case 'objects_gone':
      return objectsGone(subject, event);
  }
};
