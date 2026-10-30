import { describe, test, assert, setupRitewayBun } from 'riteway/bun';
import { sanitizeCapture, syncAnalytics } from './client-adapter';
import { unansweredConsent } from './consent';

setupRitewayBun();
describe('browser analytics admission', () => {
  test('SDK enrichment never bypasses product privacy', () => {
    const output = sanitizeCapture({
      event: 'page_viewed',
      properties: {
        area: 'home',
        distinct_id: 'anonymous',
        $current_url: 'https://daisy.test/?email=private',
        $referrer: 'private-referrer',
        email: 'private@example.test',
        $set: { name: 'Private' },
      },
    });
    assert({
      given: 'SDK URL, referrer, profile enrichment and unregistered fields',
      should: 'send only admitted properties and one scoped identity',
      actual: output?.properties,
      expected: {
        area: 'home',
        distinct_id: 'anonymous',
        anonymousId: 'anonymous',
        $geoip_disable: true,
      },
    });
    assert({
      given: 'automatic exception capture',
      should: 'refuse delivery',
      actual: sanitizeCapture({
        event: '$exception',
        properties: { distinct_id: 'anonymous', message: 'private' },
      }),
      expected: null,
    });
  });
  test('no keys and unanswered consent are inert', () => {
    assert({
      given: 'server rendering with no browser or keys',
      should: 'initialize nothing',
      actual: syncAnalytics({
        key: null,
        host: null,
        consent: unansweredConsent,
        userId: null,
      }),
      expected: undefined,
    });
  });
});
