import { requestApp } from '../../lib/page-reads';

export const requestRealtimeEndpoint = (): string | null =>
  requestApp().websocketEndpoint;
