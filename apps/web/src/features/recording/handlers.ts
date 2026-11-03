import type { Clock } from '@daisy/clock';
import type { Identity } from '@daisy/auth';
import { createAppError, isAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { idSchema } from '@daisy/protocol';
import { readBoundedBody } from '../../server/bounded-body';
import { handleOperation, requireSameOrigin } from '../../server/http';
import { consumeOrThrow, type RateLimiter } from '../../server/rate-limit';
import { replayHref } from '../watch/routes';
import { openDownload, recordingDownloadRule } from './download';
import { openPlayback, type PlaybackAnswer } from './playback';
import type {
  RecordingInputs,
  RecordingObjectStore,
  RecordingStore,
} from './ports';
import { requestParticipantRemoval } from './removal';
import { recordingViewerOf } from './viewer';

const MAX_REMOVAL_FORM_BYTES = 1024;

export const removalNotices = {
  requested: 'requested',
  confirm: 'confirm',
  changed: 'changed',
  refused: 'refused',
} as const;

type Deps = {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  readonly clock: Clock;
  readonly store: RecordingStore;
  readonly objects: RecordingObjectStore;
  readonly inputs: RecordingInputs;
};

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location } });

const playbackResponse = (answer: PlaybackAnswer): Response =>
  answer.kind === 'playlist'
    ? new Response(answer.text, {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          // Each read is authorized again, so a takedown reaches a playing viewer.
          'cache-control': 'no-store',
        },
      })
    : new Response(null, {
        status: 302,
        headers: { location: answer.url, 'cache-control': 'no-store' },
      });

const readRemovalForm = async (request: Request) => {
  const body = await readBoundedBody(request, MAX_REMOVAL_FORM_BYTES);
  const form = new URLSearchParams(body?.toString('utf8') ?? '');
  const version = Number(form.get('version'));
  return {
    confirmed: form.get('confirm') === 'on',
    version: Number.isSafeInteger(version) && version > 0 ? version : null,
    roundId: idSchema.safeParse(form.get('roundId')).data ?? null,
  };
};

/**
 * The Recording routes. Reads authorize on every request. Removal is a native form
 * post, so it works with no script, and answers with a notice on the same page.
 */
export const createRecordingHandlers = (deps: Deps) => ({
  /** GET one file of a Recording's HLS, for anyone who may watch it. */
  playback: (request: Request, recordingId: string, path: readonly string[]) =>
    handleOperation(
      deps.logger,
      request,
      'recording.playback',
      async () =>
        playbackResponse(
          await openPlayback(deps, {
            recordingId,
            path,
            viewer: recordingViewerOf(await deps.identify(request)),
          }),
        ),
      deps.reporter,
    ),

  /** GET a short-lived link to the whole video, rate limited per account. */
  download: (request: Request, recordingId: string) =>
    handleOperation(
      deps.logger,
      request,
      'recording.download',
      async () => {
        const viewer = recordingViewerOf(await deps.identify(request));
        if (viewer.kind !== 'account') throw createAppError('AUTHENTICATION');
        await consumeOrThrow(
          deps.limiter(),
          `recording:download:${viewer.userId}`,
          recordingDownloadRule,
        );
        const url = await openDownload(deps, { recordingId, viewer });
        return new Response(null, { status: 302, headers: { location: url } });
      },
      deps.reporter,
    ),

  /** POST a participant's request to remove a casual Recording, whole. */
  removal: (request: Request, recordingId: string) =>
    handleOperation(
      deps.logger,
      request,
      'recording.removal',
      async () => {
        requireSameOrigin(request, deps.origin());
        const form = await readRemovalForm(request);
        const back = (notice: keyof typeof removalNotices) =>
          seeOther(
            `${form.roundId ? replayHref(form.roundId) : '/recordings'}?removal=${removalNotices[notice]}`,
          );
        if (!form.confirmed || form.version === null) return back('confirm');
        try {
          await requestParticipantRemoval(deps, {
            recordingId,
            expectedVersion: form.version,
            viewer: recordingViewerOf(await deps.identify(request)),
            now: deps.clock.now(),
          });
          return back('requested');
        } catch (error) {
          if (!isAppError(error)) throw error;
          if (error.code === 'CONFLICT') return back('changed');
          if (['AUTHORIZATION', 'NOT_FOUND'].includes(error.code))
            return back('refused');
          throw error;
        }
      },
      deps.reporter,
    ),
});
