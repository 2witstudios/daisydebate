import { renderReadHeaders } from '../../../server/render-read';
import { notificationShellSchema } from '@daisy/protocol/notifications';
import { headers } from 'next/headers';
import { GET as readShellRoute } from '../../api/notifications/shell/route';

/** The viewer's notification shell, read in-process so the first HTML holds the count. */
export async function readNotificationShell() {
  const response = await readShellRoute(
    new Request('http://in-process.invalid/api/notifications/shell', {
      headers: renderReadHeaders(await headers()),
    }),
  );
  if (!response.ok) return null;
  const parsed = notificationShellSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}
