import { moderationNoticesSchema } from '@daisy/protocol';
import { GET as readNoticesRoute } from '../../api/moderation/notices/route';
import { readOwnRoute } from '../friends/read-route';

/** The viewer's own unread warnings. */
export const readModerationNotices = async () =>
  (
    await readOwnRoute(
      readNoticesRoute,
      '/api/moderation/notices',
      moderationNoticesSchema,
    )
  )?.notices ?? [];
