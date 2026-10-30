import type { NextRequest } from 'next/server';
import { handleProxy } from './server/proxy-handler';
import { processApp } from './server/process-app';

export function proxy(request: NextRequest) {
  const app = processApp();
  return handleProxy(request, {
    foundationProofEnabled: app.config.FOUNDATION_PROOF_ENABLED,
    publicAppUrl: app.config.PUBLIC_APP_URL,
    websocketEndpoint: app.websocketEndpoint,
    mediaPublicUrl: app.config.LIVEKIT_PUBLIC_URL ?? null,
    // ADR 0037: the browser's capture origin, present only when the client
    // DSN is configured; absent otherwise, so the CSP names no vendor host.
    sentryEndpoint: app.config.NEXT_PUBLIC_SENTRY_DSN
      ? new URL(app.config.NEXT_PUBLIC_SENTRY_DSN).origin
      : null,
    development: app.config.NODE_ENV === 'development',
    ids: app.ids,
  });
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
