import type { App } from '../../server/app';
import { identify } from '../../lib/identity';
import { cookieConsent } from './handlers';
import { analyticsConfiguration } from './config';
import type { ProductEvent } from './events';

/** Read-only named input from a successful feature operation; analytics owns its whole capture path. */
export async function trackRequest(
  app: App,
  request: Request,
  productEvent: ProductEvent,
) {
  const config = analyticsConfiguration(app.config);
  if (
    !config.serverKey ||
    cookieConsent(request.headers.get('cookie')).analytics !== 'granted'
  )
    return;
  try {
    const identity = await identify(app.auth(), request.headers);
    if (identity.state === 'anonymous' || identity.state === 'unavailable')
      return;
    const userId = identity.principal.userId;
    await app.database.saveAnalyticsConsent({
      userId,
      consent: cookieConsent(request.headers.get('cookie')),
      now: app.clock.now(),
      adopt: true,
    });
    const consent = await app.database.readAnalyticsConsent(userId);
    if (consent)
      app.analyticsDelivery.enqueue({
        userId,
        consent,
        productEvent,
      });
  } catch {
    /* Optional telemetry cannot change a committed product outcome. */
  }
}
