import { moderationNoticesSchema } from '@daisy/protocol/moderation';
import { GET as readNoticesRoute } from '../../api/moderation/notices/route';
import { readOwnRoute } from '../../../server/render-read';

/** The viewer's own unread warnings. */
export const readModerationNotices = async () =>
  (
    await readOwnRoute(
      readNoticesRoute,
      '/api/moderation/notices',
      moderationNoticesSchema,
    )
  )?.notices ?? [];
