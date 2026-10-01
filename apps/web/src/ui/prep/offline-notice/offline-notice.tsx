'use client';

import { renderOfflineNotice } from './offline-notice.render';
import { useOnline } from './use-online';

/** Shows the offline banner while the browser reports no connection. */
export function OfflineNotice() {
  return renderOfflineNotice({ offline: !useOnline() });
}
