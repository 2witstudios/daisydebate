import { describe, test, assert, setupRitewayBun } from 'riteway/bun';
import { parseConsent, consentNeeded, mergeConsent } from './consent';

setupRitewayBun();
describe('analytics consent', () => {
  test('untrusted and old records fail closed', () => {
    for (const value of [undefined, '', '{}', '{"version":0}', 'null'])
      assert({
        given: 'missing, malformed or obsolete consent',
        should: 'deny optional capture',
        actual: parseConsent(value).analytics,
        expected: 'unanswered',
      });
  });
  test('deployment changes preserve previous choices', () => {
    const prior = {
      version: 1,
      necessary: 'granted',
      analytics: 'denied',
      replay: 'unanswered',
    } as const;
    assert({
      given: 'previous analytics refusal and newly available replay',
      should: 'ask only about the unanswered category',
      actual: consentNeeded(prior, { analytics: true, replay: true }),
      expected: ['replay'],
    });
    assert({
      given: 'an analytics-only answer',
      should: 'preserve the hidden replay choice',
      actual: mergeConsent(prior, { analytics: 'granted' }).replay,
      expected: 'unanswered',
    });
  });
});
