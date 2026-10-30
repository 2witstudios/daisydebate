import { createAppError } from '@daisy/errors';
import { handleOperation, requireSameOrigin } from '../../server/http';
import { readBoundedBody } from '../../server/bounded-body';
import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import { analyticsConfiguration } from './config';
import {
  CONSENT_COOKIE,
  parseConsent,
  mergeConsent,
  type Consent,
} from './consent';

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
    if (!['accept', 'deny', 'save', 'adopt'].includes(mode ?? ''))
      throw createAppError('VALIDATION');
    const identity = await identify(app.auth(), request.headers);
    if (identity.state === 'unavailable')
      throw createAppError('INFRASTRUCTURE');
    const userId =
      identity.state === 'anonymous' ? null : identity.principal.userId;
    // Anonymous choices change only that response's cookie: no durable write
    // or vendor call, and no shared fallback bucket can block another visitor.
    if (userId) {
      const budget = await app.limiter.consume(`analytics:consent:${userId}`, {
        max: 30,
        windowSeconds: 60,
      });
      if (!budget.allowed) throw createAppError('RATE_LIMIT');
    }
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
    if (mode === 'adopt' && !userId) throw createAppError('AUTHENTICATION');
    const consent = mode === 'adopt' ? prior : mergeConsent(prior, choices);
    if (userId)
      await app.database.saveAnalyticsConsent({
        userId,
        consent,
        now: app.clock.now(),
        adopt: mode === 'adopt',
        ...(mode !== 'adopt' &&
        prior.analytics === 'granted' &&
        consent.analytics === 'denied' &&
        app.posthogErasure
          ? { deletionJobId: app.ids.next() }
          : {}),
      });
    if (mode !== 'adopt' && userId && consent.analytics === 'granted')
      app.analyticsDelivery.enqueue({
        userId,
        consent,
        productEvent: {
          event: 'consent_updated',
          properties: { replay: consent.replay === 'granted' },
        },
      });
    const response = new Response(null, {
      status: mode === 'adopt' ? 204 : 303,
      headers: { location: '/analytics?saved=1', 'cache-control': 'no-store' },
    });
    response.headers.append(
      'set-cookie',
      `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(consent))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000${app.config.PUBLIC_APP_URL.startsWith('https:') ? '; Secure' : ''}`,
    );
    return response;
  });
