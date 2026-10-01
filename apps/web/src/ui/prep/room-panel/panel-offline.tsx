'use client';

import type { ReactNode } from 'react';
import { useOnline } from '../offline-notice/use-online';
import { renderPanelOffline } from './panel-offline.render';

/**
 * Says so when the connection drops. The panel keeps showing what the page
 * already loaded; nothing is fetched while you read it.
 */
export function PanelOffline(props: {
  readonly since: string;
  readonly retry: ReactNode;
}) {
  return renderPanelOffline({
    offline: !useOnline(),
    since: props.since,
    retry: props.retry,
  });
}
