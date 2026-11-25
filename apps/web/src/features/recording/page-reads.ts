import { nowMs } from '@daisy/clock';
import { spectatorClockAt } from '../spectating/spectator-clock';
import {
  ARCHIVE_PAGE_SIZE,
  recordOfferDue,
  type ArchiveEntry,
} from './archive';
import { type RecordingsQuery } from './archive-query';
import { type RecordingViewer } from './audience';
import { recordingReads } from './composition';
import { openRecordingHistory } from './history';
import { requestApp } from '../../lib/page-reads';

/** One archive page for this viewer, and how many Recordings are public. */
export const readRecordingArchive = async (
  query: RecordingsQuery,
  viewer: RecordingViewer,
) => {
  const app = requestApp();
  const { archive } = recordingReads(app);
  const clock = spectatorClockAt(app.clock.now());
  const [page, publicCount] = await Promise.all([
    archive.listArchive({
      query,
      viewerActorId: viewer.kind === 'account' ? viewer.actorId : null,
      clock,
      limit: ARCHIVE_PAGE_SIZE,
    }),
    archive.countPublicArchive({ clock }),
  ]);
  return { page, publicCount, nowMs: nowMs(app.clock) };
};

/** A finished Round's history screen for this viewer. */
export const readRecordingHistory = (
  input: Parameters<typeof openRecordingHistory>[1],
) => openRecordingHistory(recordingReads(requestApp()).inputs, input);

/**
 * Whether this page of "My debates" offers recording: an own casual Round
 * went unrecorded and the account lacks the capture entitlement. A failed
 * entitlement read offers nothing.
 */
export const readRecordOffer = async (
  query: RecordingsQuery,
  viewer: RecordingViewer,
  rows: readonly ArchiveEntry[],
): Promise<boolean> =>
  viewer.kind === 'account' &&
  recordOfferDue(query.scope, rows) &&
  !(await recordingReads(requestApp())
    .inputs.holdsCasualCapture(viewer.userId)
    .catch(() => true));
