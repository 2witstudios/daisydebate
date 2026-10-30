import { createAppError } from '@daisy/errors';
import { handleOperation, requireSameOrigin } from '../../server/http';
import { readBoundedBody } from '../../server/bounded-body';
import { identify } from '../../lib/identity';
import { CLIENT_ID_HASH_HEADER } from '../auth/abuse/client-ip';
import type { App } from '../../server/app';
import { analyticsConfiguration } from './config';
import {
  CONSENT_COOKIE,
  parseConsent,
  mergeConsent,
  type Consent,
} from './consent';
import { trackServer } from './server-adapter';

export const cookieConsent = (header: string | null) => {
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  try {
    return parseConsent(value ? decodeURIComponent(value) : undefined);
  } catch {
    return parseConsent(undefined);
  }
};

/** Native POST: no consent action depends on hydration or JavaScript. */
export const createConsentHandler = (app: App) => (request: Request) =>
  handleOperation(app.logger, request, 'analytics.consent', async () => {
    requireSameOrigin(request, app.config.PUBLIC_APP_URL);
    const config = analyticsConfiguration(app.config);
    const body = await readBoundedBody(request, 1024);
    if (!body) throw createAppError('VALIDATION');
    const form = new URLSearchParams(body.toString('utf8'));
    if (
      new Set(form.keys()).size !== [...form.keys()].length ||
      [...form.keys()].some(
        (key) => !['choice', 'scope', 'analytics', 'replay'].includes(key),
      )
    )
      throw createAppError('VALIDATION');
    const mode = form.get('choice');
    if (!['accept', 'deny', 'save'].includes(mode ?? ''))
      throw createAppError('VALIDATION');
    const identity = await identify(app.auth(), request.headers);
    if (identity.state === 'unavailable')
      throw createAppError('INFRASTRUCTURE');
    const userId =
      identity.state === 'anonymous' ? null : identity.principal.userId;
    const budget = await app.limiter.consume(
      `analytics:consent:${userId ?? request.headers.get(CLIENT_ID_HASH_HEADER) ?? 'unresolved'}`,
      { max: 30, windowSeconds: 60 },
    );
    if (!budget.allowed) throw createAppError('RATE_LIMIT');
    const prior = userId
      ? ((await app.database.readAnalyticsConsent(userId)) ??
        cookieConsent(request.headers.get('cookie')))
      : cookieConsent(request.headers.get('cookie'));
    const choices: Partial<Pick<Consent, 'analytics' | 'replay'>> = {};
    for (const category of ['analytics', 'replay'] as const) {
      if (!config.available[category]) continue;
      if (
        form.get('scope') === 'unanswered' &&
        prior[category] !== 'unanswered'
      )
        continue;
      choices[category] =
        mode === 'deny'
          ? 'denied'
          : mode === 'accept' || form.get(category) === 'on'
            ? 'granted'
            : 'denied';
    }
    const consent = mergeConsent(prior, choices);
    if (userId)
      await app.database.saveAnalyticsConsent({
        userId,
        consent,
        now: app.clock.now(),
      });
    if (userId && consent.analytics === 'granted')
      await trackServer({
        key: config.serverKey,
        host: config.host,
        userId,
        consent,
        productEvent: {
          event: 'consent_updated',
          properties: { replay: consent.replay === 'granted' },
        },
      });
    const response = new Response(null, {
      status: 303,
      headers: { location: '/analytics?saved=1', 'cache-control': 'no-store' },
    });
    response.headers.append(
      'set-cookie',
      `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(consent))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000${app.config.PUBLIC_APP_URL.startsWith('https:') ? '; Secure' : ''}`,
    );
    return response;
  });
